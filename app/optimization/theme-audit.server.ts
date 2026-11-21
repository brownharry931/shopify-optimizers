import type { authenticate } from "../shopify.server";
import { minifyCssAsset, minifyJavaScriptAsset } from "./asset-transform.server";
import {
  auditTheme,
  minifyCandidates,
  type MinifyMeasurement,
  type ThemeFileInput,
} from "./theme-audit";

type AdminApi = Awaited<ReturnType<typeof authenticate.admin>>["admin"];

export type ThemeSummary = { id: string; name: string; role: string };

type GraphqlPayload<T> = { data?: T; errors?: Array<{ message?: string }> };

const MAX_LIST_PAGES = 8; // 8 × 250 files
const MAX_READ_BYTES = 1.5 * 1024 * 1024;
const READ_BATCH = 20;
const READ_CONCURRENCY = 4;

async function gql<T>(admin: AdminApi, query: string, variables?: Record<string, unknown>) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const payload = (await response.json()) as GraphqlPayload<T>;
  if (payload.errors?.length) {
    const message = payload.errors.map((error) => error.message).join(" ");
    if (/access denied|read_themes/i.test(message)) {
      throw new Error("SpeedBoost doesn't have permission to read themes on this store yet. Open the app from Shopify admin to approve the updated permissions.");
    }
    throw new Error("Shopify couldn't return the theme files right now. Please try again in a moment.");
  }
  if (!payload.data) throw new Error("Shopify returned an empty response.");
  return payload.data;
}

export async function listThemes(admin: AdminApi) {
  const data = await gql<{ themes: { nodes: ThemeSummary[] } }>(
    admin,
    `#graphql
      query AuditThemes { themes(first: 50) { nodes { id name role } } }`,
  );
  // Published theme first, then drafts.
  return [...data.themes.nodes].sort((a, b) => Number(b.role === "MAIN") - Number(a.role === "MAIN"));
}

export function validateThemeId(value: unknown) {
  if (typeof value !== "string" || !/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/.test(value)) {
    throw new Error("Choose a theme from this store.");
  }
  return value;
}

async function listFiles(admin: AdminApi, themeId: string) {
  type Page = {
    theme: {
      name: string;
      role: string;
      files: { nodes: Array<{ filename: string; size: number }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } | null;
  };
  const files: Array<{ filename: string; size: number }> = [];
  let after: string | null = null;
  let theme: { name: string; role: string } | null = null;
  let truncated = false;
  for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
    const data: Page = await gql<Page>(
      admin,
      `#graphql
        query AuditThemeFiles($themeId: ID!, $after: String) {
          theme(id: $themeId) {
            name role
            files(first: 250, after: $after) {
              nodes { filename size }
              pageInfo { hasNextPage endCursor }
            }
          }
        }`,
      { themeId, after },
    );
    if (!data.theme) throw new Error("That theme no longer exists in this store.");
    theme = { name: data.theme.name, role: data.theme.role };
    files.push(...data.theme.files.nodes);
    if (!data.theme.files.pageInfo.hasNextPage || !data.theme.files.pageInfo.endCursor) break;
    if (page === MAX_LIST_PAGES - 1) truncated = true;
    after = data.theme.files.pageInfo.endCursor;
  }
  return { theme: theme!, files, truncated };
}

/** Read text bodies for the given files (read-only), in parallel batches. */
export async function readFileBodies(admin: AdminApi, themeId: string, filenames: string[]) {
  const batches: string[][] = [];
  for (let i = 0; i < filenames.length; i += READ_BATCH) batches.push(filenames.slice(i, i + READ_BATCH));
  const bodies = new Map<string, string>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const data = await gql<{
          theme: { files: { nodes: Array<{ filename: string; body: { content?: string } | null }> } } | null;
        }>(
          admin,
          `#graphql
            query AuditThemeBodies($themeId: ID!, $filenames: [String!]!) {
              theme(id: $themeId) {
                files(filenames: $filenames, first: ${READ_BATCH}) {
                  nodes { filename body { ... on OnlineStoreThemeFileBodyText { content } } }
                }
              }
            }`,
          { themeId, filenames: batch },
        );
        for (const node of data.theme?.files.nodes ?? []) {
          if (typeof node.body?.content === "string") bodies.set(node.filename, node.body.content);
        }
      }
    }),
  );
  return bodies;
}

async function minifiedSize(filename: string, source: string) {
  try {
    const result = /\.css$/i.test(filename) ? minifyCssAsset(source) : await minifyJavaScriptAsset(source);
    return result.outputBytes;
  } catch {
    return null; // Unparseable files are skipped rather than reported.
  }
}

export async function runThemeAudit(admin: AdminApi, themeId: string) {
  const startedAt = Date.now();
  const { theme, files, truncated } = await listFiles(admin, themeId);
  const textFiles = files.filter(
    (file) =>
      file.size <= MAX_READ_BYTES &&
      (/^(layout|sections|snippets|blocks|templates)\/.+\.(liquid|json)$/i.test(file.filename) ||
        /^assets\/.+\.(css|js|css\.liquid)$/i.test(file.filename)),
  );
  const bodies = await readFileBodies(admin, themeId, textFiles.map((file) => file.filename));
  const inputs: ThemeFileInput[] = files.map((file) => ({ ...file, content: bodies.get(file.filename) }));

  const measurements: MinifyMeasurement[] = [];
  for (const candidate of minifyCandidates(inputs)) {
    const source = bodies.get(candidate.filename);
    if (!source) continue;
    const minifiedBytes = await minifiedSize(candidate.filename, source);
    if (minifiedBytes === null) continue;
    measurements.push({ filename: candidate.filename, sourceBytes: Buffer.byteLength(source, "utf8"), minifiedBytes });
  }

  return {
    theme: { id: themeId, ...theme },
    filesChecked: bodies.size,
    totalFiles: files.length,
    truncated,
    findings: auditTheme(inputs, measurements),
    durationMs: Date.now() - startedAt,
  };
}

/** Minify one theme asset on demand so the merchant can copy it. Read-only. */
export async function minifiedCopy(admin: AdminApi, themeId: string, filename: string) {
  if (!/^assets\/[^/]+\.(css|js)$/i.test(filename) || filename.includes("..")) {
    throw new Error("Only CSS and JavaScript files in the theme's assets folder can be minified.");
  }
  const bodies = await readFileBodies(admin, themeId, [filename]);
  const source = bodies.get(filename);
  if (!source) throw new Error("That file couldn't be read from the theme.");
  const result = /\.css$/i.test(filename) ? minifyCssAsset(source) : await minifyJavaScriptAsset(source);
  return { filename, code: result.code, sourceBytes: result.sourceBytes, minifiedBytes: result.outputBytes };
}
