import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createHash } from "node:crypto";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import {
  minifyCssAsset,
  minifyJavaScriptAsset,
} from "../optimization/asset-transform.server";
import {
  canWriteThemeRole,
  verifyThemeChangeState,
  type ThemeChangeStatus,
} from "../optimization/theme-change-policy";

type ThemeSummary = { id: string; name: string; role: string };
type ThemeAsset = {
  filename: string;
  contentType: string;
  size: number;
  checksumMd5: string | null;
};
type OptimizerActionResult =
  | { ok: false; intent: "error"; error: string }
  | {
      ok: true;
      intent: "list-assets";
      theme: ThemeSummary;
      assets: ThemeAsset[];
      truncated: boolean;
      notice: string;
    }
  | {
      ok: true;
      intent: "preview-minify";
      theme: ThemeSummary;
      filename: string;
      optimizedCode: string;
      sourceBytes: number;
      outputBytes: number;
      savedBytes: number;
      savingPercent: number;
      smallerThanSource: boolean;
      sourceHash: string;
      notice: string;
    }
  | {
      ok: true;
      intent: "change";
      changeId: string;
      status: string;
      notice: string;
    };
type GraphqlResult<T> = { data?: T; errors?: Array<{ message?: string }> };

const MAX_INTERACTIVE_PREVIEW_BYTES = 1024 * 1024;

type ThemeAssetPageInfo = { hasNextPage: boolean; endCursor: string | null };
type ThemeAssetsPage = {
  theme: {
    id: string;
    name: string;
    role: string;
    files: {
      nodes: ThemeAsset[];
      pageInfo: ThemeAssetPageInfo;
    };
  } | null;
};
type ThemeFileBody = {
  content?: string | null;
  contentBase64?: string | null;
  url?: string | null;
};

type ThemeAssetFile = {
  filename: string;
  body?: ThemeFileBody | null;
};
type ThemeFileQueryData = {
  theme: {
    id: string;
    name: string;
    role: string;
    files: {
      nodes: ThemeAssetFile[];
      userErrors: Array<{ filename?: string; code?: string }>;
    };
  } | null;
};
type ThemeChangeView = {
  id: string;
  themeId: string;
  themeName: string;
  filename: string;
  originalBytes: number;
  optimizedBytes: number;
  status: string;
  error: string | null;
  createdAt: string;
};
type ThemeAssetChangeRecord = {
  id: string;
  shop: string;
  themeId: string;
  themeName: string;
  filename: string;
  activeKey: string | null;
  originalContent: string;
  sourceHash: string;
  optimizedHash: string;
  originalBytes: number;
  optimizedBytes: number;
  status: ThemeChangeStatus;
  shopifyJobId: string | null;
};

const THEMES_QUERY = `#graphql
  query OptimizerThemes {
    themes(first: 50) {
      nodes { id name role }
    }
  }
`;

const THEME_ASSETS_QUERY = `#graphql
  query OptimizerThemeAssets($themeId: ID!, $after: String) {
    theme(id: $themeId) {
      id
      name
      role
      files(first: 250, after: $after) {
        nodes { filename contentType size checksumMd5 }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const THEME_FILE_UPSERT_MUTATION = `#graphql
  mutation OptimizerThemeFileUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      job { id }
      userErrors { field message }
    }
  }
`;

const THEME_FILE_QUERY = `#graphql
  query OptimizerThemeFile($themeId: ID!, $filenames: [String!]!) {
    theme(id: $themeId) {
      id
      name
      role
      files(filenames: $filenames) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText { content }
            ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
            ... on OnlineStoreThemeFileBodyUrl { url }
          }
        }
        userErrors { filename code }
      }
    }
  }
`;

function graphQlFailure<T>(payload: GraphqlResult<T>) {
  if (!payload.errors?.length) return null;
  const message = payload.errors.map((error) => error.message).join(" ");
  if (/write_themes|exemption/i.test(message)) {
    return "Shopify has not granted this public app the theme-write exemption. The write was not applied; request the exemption through Shopify before trying again.";
  }
  if (/access denied|read_themes/i.test(message)) {
    return "Shopify has not granted read_themes to this installation yet. Sync the current app configuration and approve/reinstall on your development store.";
  }
  return "Shopify could not complete the theme request. Retry shortly; no theme files were changed.";
}

function validateThemeId(value: FormDataEntryValue | null): string {
  if (
    typeof value !== "string" ||
    !/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/.test(value)
  ) {
    throw new Error("Choose a valid theme from this store.");
  }
  return value;
}

function validateAssetFilename(value: FormDataEntryValue | null): string {
  if (
    typeof value !== "string" ||
    value.length > 240 ||
    !/^assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:css|js|mjs)$/i.test(
      value,
    ) ||
    value.includes("..")
  ) {
    throw new Error(
      "Choose a static CSS, JS, or MJS file under the theme's assets directory. Liquid and other dynamic files are excluded.",
    );
  }
  return value;
}

async function readGraphql<T>(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(
    query,
    variables ? { variables } : undefined,
  );
  const payload = (await response.json()) as GraphqlResult<T>;
  const failure = graphQlFailure(payload);
  if (!response.ok || failure) {
    throw new Error(
      failure || "Shopify returned an error while reading this theme.",
    );
  }
  return payload.data as T;
}

function assetHash(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function submitThemeAsset(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  themeId: string,
  filename: string,
  content: string,
) {
  const result = await readGraphql<{
    themeFilesUpsert: {
      upsertedThemeFiles: Array<{ filename: string }>;
      job: { id: string } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(admin, THEME_FILE_UPSERT_MUTATION, {
    themeId,
    files: [{ filename, body: { type: "TEXT", value: content } }],
  });
  const operation = result.themeFilesUpsert;
  if (operation.userErrors.length > 0) {
    const message = operation.userErrors
      .map((error) => error.message)
      .join(" ");
    if (/write_themes|exemption/i.test(message)) {
      throw new Error(
        "Shopify has not granted this public app the theme-write exemption. The theme file was not changed.",
      );
    }
    throw new Error(message);
  }
  if (operation.upsertedThemeFiles.length === 0 && !operation.job?.id) {
    throw new Error("Shopify did not confirm the theme asset operation.");
  }
  return operation.job?.id ?? null;
}

async function readThemeAsset(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  themeId: string,
  filename: string,
) {
  const data = await readGraphql<ThemeFileQueryData>(admin, THEME_FILE_QUERY, {
    themeId,
    filenames: [filename],
  });
  if (!data.theme)
    throw new Error("Shopify could not find that theme in this store.");
  const file = data.theme.files.nodes.find(
    (item) => item.filename === filename,
  );
  const source = file?.body?.content;
  if (typeof source !== "string") {
    throw new Error(
      "Shopify did not return inline text for this asset. Remote asset URLs are not fetched, to avoid unsafe external requests.",
    );
  }
  return {
    theme: {
      id: data.theme.id,
      name: data.theme.name,
      role: data.theme.role,
    },
    source,
  };
}

function activeAssetKey(shop: string, themeId: string, filename: string) {
  return assetHash(`${shop}\u0000${themeId}\u0000${filename}`);
}

function isUniqueConstraintConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function loadThemeAssets(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  themeId: string,
) {
  const assets: ThemeAsset[] = [];
  let after: string | null = null;
  let theme: ThemeSummary | null = null;
  let truncated = false;

  for (let page = 0; page < 10; page += 1) {
    const data: ThemeAssetsPage = await readGraphql<ThemeAssetsPage>(
      admin,
      THEME_ASSETS_QUERY,
      { themeId, after },
    );
    if (!data.theme)
      throw new Error("Shopify could not find that theme in this store.");
    theme = { id: data.theme.id, name: data.theme.name, role: data.theme.role };
    assets.push(
      ...data.theme.files.nodes.filter((asset) =>
        /\.(?:css|js|mjs)$/i.test(asset.filename),
      ),
    );
    const pageInfo: ThemeAssetPageInfo = data.theme.files.pageInfo;
    if (!pageInfo.hasNextPage) break;
    if (!pageInfo.endCursor) {
      throw new Error("Shopify returned an incomplete theme asset cursor.");
    }
    if (page === 9) {
      truncated = true;
      break;
    }
    after = pageInfo.endCursor;
  }

  if (!theme) throw new Error("Shopify did not return a theme record.");
  return { theme, assets, truncated };
}

async function verifyChangeState(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  change: ThemeAssetChangeRecord,
) {
  const current = await readThemeAsset(admin, change.themeId, change.filename);
  const decision = verifyThemeChangeState(
    change.status,
    assetHash(current.source),
    change.sourceHash,
    change.optimizedHash,
  );

  if (decision === "applied") {
    await prisma.themeAssetChange.updateMany({
      where: { id: change.id, shop: change.shop },
      data: { status: "APPLIED", appliedAt: new Date(), error: null },
    });
    return {
      status: "APPLIED",
      notice:
        "Shopify confirms the minified asset is present on this draft theme.",
    };
  }

  if (decision === "retry-apply") {
    if (!canWriteThemeRole(current.theme.role)) {
      return {
        status: "PREPARED",
        notice:
          "This theme is not an unpublished/development theme. Automatic writes are blocked.",
      };
    }
    const result = /\.css$/i.test(change.filename)
      ? minifyCssAsset(change.originalContent)
      : await minifyJavaScriptAsset(change.originalContent);
    if (assetHash(result.code) !== change.optimizedHash) {
      await prisma.themeAssetChange.updateMany({
        where: { id: change.id, shop: change.shop },
        data: {
          status: "CONFLICT",
          error: "Saved optimization output did not validate.",
        },
      });
      return {
        status: "CONFLICT",
        notice:
          "Saved optimization output could not be revalidated. No retry was made.",
      };
    }
    const shopifyJobId = await submitThemeAsset(
      admin,
      change.themeId,
      change.filename,
      result.code,
    );
    await prisma.themeAssetChange.updateMany({
      where: { id: change.id, shop: change.shop },
      data: { status: "SUBMITTED", shopifyJobId, error: null },
    });
    return {
      status: "SUBMITTED",
      notice:
        "Recovered the interrupted operation and resubmitted it to Shopify. Recheck shortly.",
    };
  }

  if (decision === "rolled-back") {
    await prisma.themeAssetChange.updateMany({
      where: { id: change.id, shop: change.shop },
      data: {
        status: "ROLLED_BACK",
        rolledBackAt: new Date(),
        activeKey: null,
        error: null,
      },
    });
    return {
      status: "ROLLED_BACK",
      notice: "Shopify confirms the original asset has been restored.",
    };
  }

  if (decision === "pending") {
    return {
      status: change.status,
      notice:
        "Shopify has not finished the asset operation yet. Recheck shortly.",
    };
  }

  if (decision === "conflict") {
    const error =
      "The asset now differs from both the saved original and app-generated version. Automatic changes were stopped to preserve merchant edits.";
    await prisma.themeAssetChange.updateMany({
      where: { id: change.id, shop: change.shop },
      data: { status: "CONFLICT", error },
    });
    return { status: "CONFLICT", notice: error };
  }

  return {
    status: change.status,
    notice: `No pending Shopify asset operation exists. Current state: ${change.status}.`,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await getVerifiedSubscription(admin, session.shop);
  if (!access.isVerified || !access.hasActiveSubscription) {
    return {
      canOptimize: false,
      subscriptionVerified: access.isVerified,
      themes: [] as ThemeSummary[],
      changes: [],
      themeError: null as string | null,
    };
  }

  const changes = await prisma.themeAssetChange.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      themeId: true,
      themeName: true,
      filename: true,
      originalBytes: true,
      optimizedBytes: true,
      status: true,
      error: true,
      createdAt: true,
    },
  });
  const publicChanges: ThemeChangeView[] = (
    changes as Array<Omit<ThemeChangeView, "createdAt"> & { createdAt: Date }>
  ).map((change) => ({
    ...change,
    createdAt: change.createdAt.toISOString(),
  }));

  try {
    const data = await readGraphql<{
      themes: { nodes: ThemeSummary[] };
    }>(admin, THEMES_QUERY);
    return {
      canOptimize: true,
      subscriptionVerified: true,
      themes: data.themes.nodes,
      changes: publicChanges,
      themeError: null,
    };
  } catch (error) {
    return {
      canOptimize: true,
      subscriptionVerified: true,
      themes: [] as ThemeSummary[],
      changes: publicChanges,
      themeError:
        error instanceof Error
          ? error.message
          : "Shopify themes could not be read.",
    };
  }
};

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<OptimizerActionResult> => {
  const { admin, session } = await authenticate.admin(request);
  const access = await getVerifiedSubscription(admin, session.shop);
  if (!access.isVerified || !access.hasActiveSubscription) {
    return {
      ok: false as const,
      intent: "error" as const,
      error: !access.isVerified
        ? "Shopify billing could not be verified. Theme optimization remains locked."
        : "An active Shopify subscription is required to inspect theme assets.",
    };
  }

  const form = await request.formData();
  const intent = form.get("intent");
  try {
    const themeId = validateThemeId(form.get("themeId"));
    if (intent === "list-assets") {
      const result = await loadThemeAssets(admin, themeId);
      return {
        ok: true as const,
        intent: "list-assets" as const,
        ...result,
        notice: "Read-only inventory. Shopify theme files were not changed.",
      };
    }

    if (intent === "verify-change" || intent === "rollback-change") {
      const changeIdValue = form.get("changeId");
      if (typeof changeIdValue !== "string" || changeIdValue.length > 100) {
        throw new Error("Choose a valid optimization history entry.");
      }
      const found = await prisma.themeAssetChange.findFirst({
        where: { id: changeIdValue, shop: session.shop },
      });
      if (!found)
        throw new Error("That history entry does not belong to this store.");
      const change = found as ThemeAssetChangeRecord;

      if (intent === "verify-change") {
        const verified = await verifyChangeState(admin, change);
        return {
          ok: true as const,
          intent: "change" as const,
          changeId: change.id,
          status: verified.status,
          notice: verified.notice,
        };
      }

      if (form.get("confirmRollback") !== "yes") {
        throw new Error(
          "Confirm the rollback before restoring the saved original.",
        );
      }
      if (change.status !== "APPLIED") {
        throw new Error(
          "Only an app-verified optimization can be rolled back.",
        );
      }
      const current = await readThemeAsset(
        admin,
        change.themeId,
        change.filename,
      );
      if (!canWriteThemeRole(current.theme.role)) {
        throw new Error(
          "This theme is now published. Automatic rollback is blocked to avoid changing the live storefront; restore from the draft theme instead.",
        );
      }
      if (assetHash(current.source) !== change.optimizedHash) {
        const error =
          "The theme asset has changed since SpeedBoost applied it. Rollback was blocked to preserve the merchant's newer edits.";
        await prisma.themeAssetChange.updateMany({
          where: { id: change.id, shop: session.shop },
          data: { status: "CONFLICT", error },
        });
        throw new Error(error);
      }
      const shopifyJobId = await submitThemeAsset(
        admin,
        change.themeId,
        change.filename,
        change.originalContent,
      );
      await prisma.themeAssetChange.updateMany({
        where: { id: change.id, shop: session.shop },
        data: { status: "ROLLBACK_SUBMITTED", shopifyJobId, error: null },
      });
      return {
        ok: true as const,
        intent: "change" as const,
        changeId: change.id,
        status: "ROLLBACK_SUBMITTED",
        notice:
          "Shopify accepted the rollback request. Recheck its status to confirm the exact original file is restored.",
      };
    }

    if (intent === "apply-minify") {
      if (form.get("confirmApply") !== "yes") {
        throw new Error("Confirm the draft-theme change before applying it.");
      }
      const filename = validateAssetFilename(form.get("filename"));
      const expectedSourceHash = form.get("sourceHash");
      if (
        typeof expectedSourceHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(expectedSourceHash)
      ) {
        throw new Error(
          "The preview is missing a valid source checksum. Preview the asset again.",
        );
      }
      const current = await readThemeAsset(admin, themeId, filename);
      if (!canWriteThemeRole(current.theme.role)) {
        throw new Error(
          "Changes are allowed only on an unpublished/development theme. The published theme is never modified by this workflow.",
        );
      }
      if (assetHash(current.source) !== expectedSourceHash) {
        throw new Error(
          "The theme asset changed after this preview. Generate a fresh preview before applying.",
        );
      }
      if (
        Buffer.byteLength(current.source, "utf8") >
        MAX_INTERACTIVE_PREVIEW_BYTES
      ) {
        throw new Error("This asset exceeds the safe interactive apply limit.");
      }
      const result = /\.css$/i.test(filename)
        ? minifyCssAsset(current.source)
        : await minifyJavaScriptAsset(current.source);
      if (!result.smallerThanSource) {
        throw new Error(
          "Minification did not reduce source bytes; no theme write was made.",
        );
      }
      const change = await prisma.themeAssetChange.create({
        data: {
          shop: session.shop,
          themeId,
          themeName: current.theme.name,
          filename,
          activeKey: activeAssetKey(session.shop, themeId, filename),
          originalContent: current.source,
          sourceHash: expectedSourceHash,
          optimizedHash: assetHash(result.code),
          originalBytes: result.sourceBytes,
          optimizedBytes: result.outputBytes,
          status: "PREPARED",
        },
      });
      try {
        const shopifyJobId = await submitThemeAsset(
          admin,
          themeId,
          filename,
          result.code,
        );
        await prisma.themeAssetChange.updateMany({
          where: { id: change.id, shop: session.shop },
          data: { status: "SUBMITTED", shopifyJobId, error: null },
        });
      } catch (error) {
        await prisma.themeAssetChange.updateMany({
          where: { id: change.id, shop: session.shop },
          data: {
            status: "FAILED",
            activeKey: null,
            error:
              error instanceof Error
                ? error.message.slice(0, 1000)
                : "Shopify rejected the theme file update.",
          },
        });
        throw error;
      }
      return {
        ok: true as const,
        intent: "change" as const,
        changeId: change.id,
        status: "SUBMITTED",
        notice:
          "Shopify accepted the minification request for the unpublished theme. Recheck its status before previewing; the live theme was not touched.",
      };
    }

    if (intent !== "preview-minify") {
      return {
        ok: false as const,
        intent: "error" as const,
        error: "Unsupported optimizer action.",
      };
    }
    const filename = validateAssetFilename(form.get("filename"));
    const current = await readThemeAsset(admin, themeId, filename);
    const source = current.source;

    if (Buffer.byteLength(source, "utf8") > MAX_INTERACTIVE_PREVIEW_BYTES) {
      throw new Error(
        "This asset is larger than the safe 1 MB interactive preview limit. Large assets need the durable background-worker workflow, which is not available yet.",
      );
    }

    const result = /\.css$/i.test(filename)
      ? minifyCssAsset(source)
      : await minifyJavaScriptAsset(source);
    return {
      ok: true as const,
      intent: "preview-minify" as const,
      theme: current.theme,
      filename,
      optimizedCode: result.code,
      sourceBytes: result.sourceBytes,
      outputBytes: result.outputBytes,
      savedBytes: result.savedBytes,
      savingPercent: result.savingPercent,
      smallerThanSource: result.smallerThanSource,
      sourceHash: assetHash(source),
      notice:
        "Preview only. This result measures raw UTF-8 source bytes, not compressed transfer size. Shopify theme files were not changed.",
    };
  } catch (error) {
    return {
      ok: false as const,
      intent: "error" as const,
      error: isUniqueConstraintConflict(error)
        ? "This theme asset already has an active or pending SpeedBoost change. Recheck or roll it back before applying another optimization."
        : error instanceof Error
          ? error.message
          : "The theme asset could not be inspected.",
    };
  }
};

function bytes(value: number) {
  return `${new Intl.NumberFormat().format(value)} bytes`;
}

export default function ThemeOptimizationPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const listed =
    actionData?.ok && actionData.intent === "list-assets" ? actionData : null;
  const preview =
    actionData?.ok && actionData.intent === "preview-minify"
      ? actionData
      : null;

  return (
    <s-page heading="Theme optimization">
      <main className="pp-scanPage">
        <section className="pp-scanPanel">
          <p className="pp-eyebrow">CSS and JavaScript · read-only preview</p>
          <h1>Inspect and minify a theme asset</h1>
          <p>
            Select a theme, list its static CSS/JavaScript assets, then generate
            a real minified preview. This first workflow never writes to a theme
            or changes the live storefront.
          </p>
        </section>

        {!data.canOptimize ? (
          <aside className="pp-scanNotice" role="status">
            {!data.subscriptionVerified
              ? "Shopify subscription status is not verified. Theme tools remain locked."
              : "An active Shopify subscription is required to inspect theme assets."}{" "}
            <a href="/app/billing">View billing</a>
          </aside>
        ) : data.themeError ? (
          <aside className="pp-scanNotice" role="alert">
            {data.themeError}
          </aside>
        ) : (
          <>
            {actionData && !actionData.ok ? (
              <aside className="pp-scanNotice" role="alert">
                {actionData.error}
              </aside>
            ) : actionData?.ok && actionData.intent === "change" ? (
              <aside className="pp-scanNotice" role="status">
                {actionData.notice} <strong>Status: {actionData.status}</strong>
              </aside>
            ) : null}

            <section
              className="pp-scanPanel"
              aria-labelledby="asset-picker-title"
            >
              <h2 id="asset-picker-title">1. Choose a theme asset</h2>
              {data.themes.length === 0 ? (
                <p>No themes were returned for this Shopify store.</p>
              ) : (
                <Form method="post" className="pp-optimizeForm">
                  <label>
                    Theme
                    <select name="themeId" required defaultValue="">
                      <option value="" disabled>
                        Select a theme
                      </option>
                      {data.themes.map((theme) => (
                        <option key={theme.id} value={theme.id}>
                          {theme.name} · {theme.role.toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="pp-scanButton"
                    name="intent"
                    value="list-assets"
                    disabled={busy}
                  >
                    {busy &&
                    navigation.formData?.get("intent") === "list-assets"
                      ? "Reading theme assets…"
                      : "List CSS and JavaScript assets"}
                  </button>
                </Form>
              )}
            </section>

            {listed ? (
              <section className="pp-scanPanel">
                <h2>2. Select a static stylesheet or script</h2>
                <p>{listed.notice}</p>
                {listed.truncated ? (
                  <p role="status">
                    The Shopify 2,500-file inventory limit was reached. Some
                    assets might not appear in this list.
                  </p>
                ) : null}
                {listed.assets.length === 0 ? (
                  <p>No static CSS, JS, or MJS assets were found.</p>
                ) : (
                  <Form method="post" className="pp-optimizeForm">
                    <input
                      type="hidden"
                      name="themeId"
                      value={listed.theme.id}
                    />
                    <label>
                      Theme asset
                      <select name="filename" required defaultValue="">
                        <option value="" disabled>
                          Select an asset
                        </option>
                        {listed.assets.map((asset) => (
                          <option key={asset.filename} value={asset.filename}>
                            {asset.filename} · {bytes(asset.size)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="pp-scanButton"
                      name="intent"
                      value="preview-minify"
                      disabled={busy}
                    >
                      {busy &&
                      navigation.formData?.get("intent") === "preview-minify"
                        ? "Generating preview…"
                        : "Generate minified preview"}
                    </button>
                  </Form>
                )}
              </section>
            ) : null}

            {preview ? (
              <section
                className="pp-scanPanel"
                aria-label="Minification preview"
              >
                <div className="pp-scanPanelHeader">
                  <div>
                    <h2>{preview.filename}</h2>
                    <p>
                      {preview.theme.name} · {preview.theme.role.toLowerCase()}{" "}
                      · no theme changes made
                    </p>
                  </div>
                </div>
                <div className="pp-scanMetrics">
                  <article>
                    <span>Original source</span>
                    <strong>{bytes(preview.sourceBytes)}</strong>
                    <p>UTF-8 bytes</p>
                  </article>
                  <article>
                    <span>Minified preview</span>
                    <strong>{bytes(preview.outputBytes)}</strong>
                    <p>UTF-8 bytes</p>
                  </article>
                  <article>
                    <span>Measured source reduction</span>
                    <strong>
                      {preview.smallerThanSource
                        ? `${bytes(preview.savedBytes)} · ${preview.savingPercent}%`
                        : "No reduction"}
                    </strong>
                    <p>Does not predict compressed network transfer savings</p>
                  </article>
                </div>
                <p className="pp-scanFootnote">{preview.notice}</p>
                <details className="pp-codePreview">
                  <summary>View minified output</summary>
                  <pre>
                    <code>{preview.optimizedCode}</code>
                  </pre>
                </details>
                {preview.smallerThanSource &&
                ["UNPUBLISHED", "DEVELOPMENT"].includes(preview.theme.role) ? (
                  <Form method="post" className="pp-applyForm">
                    <input type="hidden" name="intent" value="apply-minify" />
                    <input
                      type="hidden"
                      name="themeId"
                      value={preview.theme.id}
                    />
                    <input
                      type="hidden"
                      name="filename"
                      value={preview.filename}
                    />
                    <input
                      type="hidden"
                      name="sourceHash"
                      value={preview.sourceHash}
                    />
                    <label>
                      <input
                        type="checkbox"
                        name="confirmApply"
                        value="yes"
                        required
                      />
                      I reviewed this generated output and want to replace this
                      file on the selected unpublished/development theme. The
                      original file will be saved for conflict-checked rollback.
                    </label>
                    <button className="pp-scanButton" disabled={busy}>
                      {busy &&
                      navigation.formData?.get("intent") === "apply-minify"
                        ? "Submitting to Shopify…"
                        : "Apply to this draft theme"}
                    </button>
                  </Form>
                ) : preview.smallerThanSource ? (
                  <aside className="pp-scanNotice" role="note">
                    Writes are allowed only to unpublished/development themes.
                    The published or unsupported theme was not changed.
                  </aside>
                ) : (
                  <p className="pp-scanFootnote">
                    There is no measured byte reduction, so no apply option is
                    offered.
                  </p>
                )}
              </section>
            ) : null}

            <section className="pp-scanPanel" aria-label="Optimization history">
              <h2>Draft asset changes and rollback</h2>
              <p>
                Only changes made by this app are listed. Rollback verifies the
                current asset checksum first and refuses to overwrite newer
                merchant edits. Shopify theme writes require the approved app
                permission and are limited here to unpublished/development
                themes.
              </p>
              {data.changes.length === 0 ? (
                <p>No theme asset changes have been made by this app.</p>
              ) : (
                <ul className="pp-changeHistory">
                  {data.changes.map((change) => (
                    <li key={change.id}>
                      <div>
                        <strong>{change.filename}</strong>
                        <span>
                          {change.themeName} · {change.status} ·{" "}
                          {new Date(change.createdAt).toLocaleString()}
                        </span>
                        <small>
                          {bytes(change.originalBytes)} →{" "}
                          {bytes(change.optimizedBytes)}
                        </small>
                        {change.error ? (
                          <p role="alert">{change.error}</p>
                        ) : null}
                      </div>
                      {["PREPARED", "SUBMITTED", "ROLLBACK_SUBMITTED"].includes(
                        change.status,
                      ) ? (
                        <Form method="post">
                          <input
                            type="hidden"
                            name="themeId"
                            value={change.themeId}
                          />
                          <input
                            type="hidden"
                            name="changeId"
                            value={change.id}
                          />
                          <button
                            className="pp-secondaryButton"
                            name="intent"
                            value="verify-change"
                            disabled={busy}
                          >
                            Recheck Shopify status
                          </button>
                        </Form>
                      ) : change.status === "APPLIED" ? (
                        <Form method="post" className="pp-rollbackForm">
                          <input
                            type="hidden"
                            name="themeId"
                            value={change.themeId}
                          />
                          <input
                            type="hidden"
                            name="changeId"
                            value={change.id}
                          />
                          <label>
                            <input
                              type="checkbox"
                              name="confirmRollback"
                              value="yes"
                              required
                            />
                            Restore saved original on this draft theme
                          </label>
                          <button
                            className="pp-secondaryButton"
                            name="intent"
                            value="rollback-change"
                            disabled={busy}
                          >
                            Roll back this file
                          </button>
                        </Form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
