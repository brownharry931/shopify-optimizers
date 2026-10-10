import { useFetcher, useLoaderData } from "react-router";
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
import {
  deferCompatibleThemeScripts,
  inspectShopifyImageTags,
  optimizeShopifyImageTags,
  type LiquidImageTagCandidate,
  type ThemeLiquidOptimizationMode,
} from "../optimization/liquid-transform.server";

type ThemeSummary = { id: string; name: string; role: string };
type ThemeAsset = {
  filename: string;
  contentType: string;
  size: number;
  checksumMd5: string | null;
};
type ThemeLiquidFile = Pick<ThemeAsset, "filename" | "size">;
type CoreFieldMetrics = {
  lcpP75Ms?: number;
  inpP75Ms?: number;
  clsP75?: number;
  lcpCategory?: string;
  inpCategory?: string;
  clsCategory?: string;
};
type OptimizerActionResult =
  | { ok: false; intent: "error"; error: string }
  | {
      ok: true;
      intent: "list-assets";
      theme: ThemeSummary;
      assets: ThemeAsset[];
      liquidFiles: ThemeLiquidFile[];
      truncated: boolean;
      notice: string;
    }
  | {
      ok: true;
      intent: "inspect-liquid";
      theme: ThemeSummary;
      filename: string;
      images: LiquidImageTagCandidate[];
      notice: string;
    }
  | {
      ok: true;
      intent: "preview-liquid";
      theme: ThemeSummary;
      filename: string;
      mode: ThemeLiquidOptimizationMode;
      imageIndex: number | null;
      optimizedCode: string;
      sourceBytes: number;
      outputBytes: number;
      changedCount: number;
      skippedCount: number;
      sourceHash: string;
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

function validateLiquidFilename(
  value: FormDataEntryValue | null,
  mode: ThemeLiquidOptimizationMode,
): string {
  const allowed =
    mode === "defer-js"
      ? value === "layout/theme.liquid"
      : typeof value === "string" &&
        /^((sections|snippets)\/[A-Za-z0-9_.-]+\.liquid)$/i.test(value) &&
        !value.includes("..");
  if (!allowed || typeof value !== "string" || value.length > 240) {
    throw new Error(
      mode === "defer-js"
        ? "JavaScript deferral is limited to layout/theme.liquid."
        : "Choose a Liquid section or snippet from this theme's read-only inventory.",
    );
  }
  return value;
}

function validateLiquidMode(
  value: FormDataEntryValue | null,
): ThemeLiquidOptimizationMode {
  if (
    value !== "defer-js" &&
    value !== "lazy-images" &&
    value !== "prioritize-lcp"
  ) {
    throw new Error("Choose a supported theme optimization.");
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

async function createAndSubmitThemeChange(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  shop: string,
  theme: ThemeSummary,
  filename: string,
  originalContent: string,
  optimizedContent: string,
) {
  const change = await prisma.themeAssetChange.create({
    data: {
      shop,
      themeId: theme.id,
      themeName: theme.name,
      filename,
      activeKey: activeAssetKey(shop, theme.id, filename),
      originalContent,
      sourceHash: assetHash(originalContent),
      optimizedHash: assetHash(optimizedContent),
      originalBytes: Buffer.byteLength(originalContent, "utf8"),
      optimizedBytes: Buffer.byteLength(optimizedContent, "utf8"),
      status: "PREPARED",
    },
  });

  try {
    const shopifyJobId = await submitThemeAsset(
      admin,
      theme.id,
      filename,
      optimizedContent,
    );
    await prisma.themeAssetChange.updateMany({
      where: { id: change.id, shop },
      data: { status: "SUBMITTED", shopifyJobId, error: null },
    });
  } catch (error) {
    await prisma.themeAssetChange.updateMany({
      where: { id: change.id, shop },
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

  return change.id;
}

async function loadThemeAssets(
  admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"],
  themeId: string,
) {
  const assets: ThemeAsset[] = [];
  const liquidFiles: ThemeLiquidFile[] = [];
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
        /^assets\/.+\.(?:css|js|mjs)$/i.test(asset.filename),
      ),
    );
    liquidFiles.push(
      ...data.theme.files.nodes
        .filter((file) =>
          /^(?:sections|snippets)\/[A-Za-z0-9_.-]+\.liquid$/i.test(
            file.filename,
          ),
        )
        .map((file) => ({ filename: file.filename, size: file.size })),
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
  return { theme, assets, liquidFiles, truncated };
}

async function rebuildSavedThemeChange(
  filename: string,
  source: string,
  expectedHash: string,
): Promise<string | null> {
  if (/\.css$/i.test(filename)) {
    const result = minifyCssAsset(source);
    return assetHash(result.code) === expectedHash ? result.code : null;
  }
  if (/\.(?:js|mjs)$/i.test(filename)) {
    const result = await minifyJavaScriptAsset(source);
    return assetHash(result.code) === expectedHash ? result.code : null;
  }
  if (filename === "layout/theme.liquid") {
    const result = deferCompatibleThemeScripts(source);
    return result.changedCount > 0 && assetHash(result.code) === expectedHash
      ? result.code
      : null;
  }
  if (/^(?:sections|snippets)\/[A-Za-z0-9_.-]+\.liquid$/i.test(filename)) {
    const lazy = optimizeShopifyImageTags(source, "lazy-images");
    if (lazy.changedCount > 0 && assetHash(lazy.code) === expectedHash) {
      return lazy.code;
    }
    for (const candidate of inspectShopifyImageTags(source)) {
      const priority = optimizeShopifyImageTags(
        source,
        "prioritize-lcp",
        candidate.index,
      );
      if (
        priority.changedCount > 0 &&
        assetHash(priority.code) === expectedHash
      ) {
        return priority.code;
      }
    }
  }
  return null;
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
        "Shopify confirms the saved optimization is present on this draft theme.",
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
    const optimizedCode = await rebuildSavedThemeChange(
      change.filename,
      change.originalContent,
      change.optimizedHash,
    );
    if (!optimizedCode) {
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
      optimizedCode,
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
      latestScan: null,
      themeError: null as string | null,
    };
  }

  const [changes, latestScan] = await Promise.all([
    prisma.themeAssetChange.findMany({
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
    }),
    prisma.performanceScan.findFirst({
      where: { shop: session.shop, status: "COMPLETE" },
      orderBy: { createdAt: "desc" },
      select: {
        pageUrl: true,
        strategy: true,
        performance: true,
        lcpMs: true,
        tbtMs: true,
        cls: true,
        fieldDataSource: true,
        fieldData: true,
        createdAt: true,
      },
    }),
  ]);
  const publicChanges: ThemeChangeView[] = (
    changes as Array<Omit<ThemeChangeView, "createdAt"> & { createdAt: Date }>
  ).map((change) => ({
    ...change,
    createdAt: change.createdAt.toISOString(),
  }));
  const latestScanView = latestScan
    ? {
        ...latestScan,
        fieldData:
          latestScan.fieldData &&
          typeof latestScan.fieldData === "object" &&
          !Array.isArray(latestScan.fieldData)
            ? (latestScan.fieldData as CoreFieldMetrics)
            : null,
        createdAt: latestScan.createdAt.toISOString(),
      }
    : null;

  try {
    const data = await readGraphql<{
      themes: { nodes: ThemeSummary[] };
    }>(admin, THEMES_QUERY);
    return {
      canOptimize: true,
      subscriptionVerified: true,
      themes: data.themes.nodes,
      changes: publicChanges,
      latestScan: latestScanView,
      themeError: null,
    };
  } catch (error) {
    return {
      canOptimize: true,
      subscriptionVerified: true,
      themes: [] as ThemeSummary[],
      changes: publicChanges,
      latestScan: latestScanView,
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

    if (intent === "inspect-liquid") {
      const filename = validateLiquidFilename(
        form.get("filename"),
        "lazy-images",
      );
      const current = await readThemeAsset(admin, themeId, filename);
      if (
        Buffer.byteLength(current.source, "utf8") >
        MAX_INTERACTIVE_PREVIEW_BYTES
      ) {
        throw new Error(
          "This Liquid file is larger than the safe 1 MB interactive preview limit.",
        );
      }
      return {
        ok: true as const,
        intent: "inspect-liquid" as const,
        theme: current.theme,
        filename,
        images: inspectShopifyImageTags(current.source),
        notice:
          "Read-only inspection of Shopify image_tag expressions. Raw img markup and dynamic Liquid are deliberately not rewritten.",
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

    if (intent === "apply-liquid") {
      if (form.get("confirmApply") !== "yes") {
        throw new Error(
          "Confirm the reviewed draft-theme change before applying it.",
        );
      }
      const mode = validateLiquidMode(form.get("mode"));
      const filename = validateLiquidFilename(form.get("filename"), mode);
      const imageIndexValue = form.get("imageIndex");
      const imageIndex =
        typeof imageIndexValue === "string" && /^\d+$/.test(imageIndexValue)
          ? Number(imageIndexValue)
          : undefined;
      if (mode === "prioritize-lcp" && imageIndex === undefined) {
        throw new Error("Choose the exact LCP image expression to prioritize.");
      }
      const expectedSourceHash = form.get("sourceHash");
      if (
        typeof expectedSourceHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(expectedSourceHash)
      ) {
        throw new Error(
          "The preview is missing a valid source checksum. Preview the file again.",
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
          "The theme file changed after this preview. Generate a fresh preview before applying.",
        );
      }
      if (
        Buffer.byteLength(current.source, "utf8") >
        MAX_INTERACTIVE_PREVIEW_BYTES
      ) {
        throw new Error("This file exceeds the safe interactive apply limit.");
      }
      const result =
        mode === "defer-js"
          ? deferCompatibleThemeScripts(current.source)
          : optimizeShopifyImageTags(current.source, mode, imageIndex);
      if (result.changedCount === 0) {
        throw new Error(
          "No supported image or script markup would change. No theme write was made.",
        );
      }
      const changeId = await createAndSubmitThemeChange(
        admin,
        session.shop,
        current.theme,
        filename,
        current.source,
        result.code,
      );
      return {
        ok: true as const,
        intent: "change" as const,
        changeId,
        status: "SUBMITTED",
        notice:
          "Shopify accepted this reviewed change for the unpublished theme. Recheck its status before previewing; the live theme was not touched.",
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
      const changeId = await createAndSubmitThemeChange(
        admin,
        session.shop,
        current.theme,
        filename,
        current.source,
        result.code,
      );
      return {
        ok: true as const,
        intent: "change" as const,
        changeId,
        status: "SUBMITTED",
        notice:
          "Shopify accepted the minification request for the unpublished theme. Recheck its status before previewing; the live theme was not touched.",
      };
    }

    if (intent === "preview-liquid") {
      const mode = validateLiquidMode(form.get("mode"));
      const filename = validateLiquidFilename(form.get("filename"), mode);
      const imageIndexValue = form.get("imageIndex");
      const imageIndex =
        typeof imageIndexValue === "string" && /^\d+$/.test(imageIndexValue)
          ? Number(imageIndexValue)
          : undefined;
      if (mode === "prioritize-lcp" && imageIndex === undefined) {
        throw new Error("Choose the exact LCP image expression to preview.");
      }
      const current = await readThemeAsset(admin, themeId, filename);
      const sourceBytes = Buffer.byteLength(current.source, "utf8");
      if (sourceBytes > MAX_INTERACTIVE_PREVIEW_BYTES) {
        throw new Error(
          "This Liquid file is larger than the safe 1 MB interactive preview limit.",
        );
      }
      const result =
        mode === "defer-js"
          ? deferCompatibleThemeScripts(current.source)
          : optimizeShopifyImageTags(current.source, mode, imageIndex);
      if (result.changedCount === 0) {
        throw new Error(
          mode === "defer-js"
            ? "No compatible static first-party theme scripts were found. Dynamic, app, remote, inline, async, and module scripts are left untouched."
            : "No compatible image_tag expressions need this change. Existing or dynamic loading hints were left untouched.",
        );
      }
      return {
        ok: true as const,
        intent: "preview-liquid" as const,
        theme: current.theme,
        filename,
        mode,
        imageIndex: imageIndex ?? null,
        optimizedCode: result.code,
        sourceBytes,
        outputBytes: Buffer.byteLength(result.code, "utf8"),
        changedCount: result.changedCount,
        skippedCount: result.skippedCount,
        sourceHash: assetHash(current.source),
        notice:
          "Preview only. Review every changed line and test the draft storefront. No Shopify theme file has been changed.",
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
        ? "This theme file already has an active or pending SpeedBoost change. Recheck or roll it back before applying another optimization."
        : error instanceof Error
          ? error.message
          : "The theme asset could not be inspected.",
    };
  }
};

function bytes(value: number) {
  return `${new Intl.NumberFormat().format(value)} bytes`;
}

function milliseconds(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return "No field data";
  }
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

function fieldStatus(value: string | undefined) {
  if (value === "FAST") return "Good";
  if (value === "AVERAGE") return "Needs improvement";
  if (value === "SLOW") return "Poor";
  return "Not classified";
}

export default function ThemeOptimizationPage() {
  const data = useLoaderData<typeof loader>();
  const inventoryFetcher = useFetcher<typeof action>();
  const imageInspectionFetcher = useFetcher<typeof action>();
  const minifyFetcher = useFetcher<typeof action>();
  const liquidFetcher = useFetcher<typeof action>();
  const historyFetcher = useFetcher<typeof action>();
  const fetchers = [
    inventoryFetcher,
    imageInspectionFetcher,
    minifyFetcher,
    liquidFetcher,
    historyFetcher,
  ];
  const busy = fetchers.some((fetcher) => fetcher.state !== "idle");
  const listed =
    inventoryFetcher.data?.ok && inventoryFetcher.data.intent === "list-assets"
      ? inventoryFetcher.data
      : null;
  const inspection =
    imageInspectionFetcher.data?.ok &&
    imageInspectionFetcher.data.intent === "inspect-liquid"
      ? imageInspectionFetcher.data
      : null;
  const preview =
    minifyFetcher.data?.ok && minifyFetcher.data.intent === "preview-minify"
      ? minifyFetcher.data
      : null;
  const liquidPreview =
    liquidFetcher.data?.ok && liquidFetcher.data.intent === "preview-liquid"
      ? liquidFetcher.data
      : null;
  const actionErrors = fetchers
    .map((fetcher) => fetcher.data)
    .flatMap((result) => (result && !result.ok ? [result.error] : []));
  const changeResult = [
    liquidFetcher.data,
    minifyFetcher.data,
    historyFetcher.data,
  ].find(
    (
      result,
    ): result is Extract<
      OptimizerActionResult,
      { ok: true; intent: "change" }
    > => result?.ok === true && result.intent === "change",
  );
  const scan = data.latestScan;
  const fieldMetrics = scan?.fieldData;

  return (
    <s-page heading="Storefront optimization">
      <main className="pp-scanPage">
        <section className="pp-scanPanel pp-optimizeHero">
          <p className="pp-eyebrow">Measured fixes · draft-theme safe</p>
          <h1>Turn real speed findings into reviewed theme changes.</h1>
          <p>
            See the latest Core Web Vitals data, preview CSS/JavaScript
            minification, defer compatible theme scripts, and tune Shopify image
            loading. Every change is opt-in, checksum-protected, and limited to
            an unpublished or development theme.
          </p>
          <div className="pp-optimizeActions">
            <a className="pp-scanButtonLink" href="/app/scan">
              Run a fresh audit
            </a>
            <a
              className="pp-scanButtonLink pp-optimizeSecondaryLink"
              href="#theme-picker"
            >
              Open optimization tools
            </a>
          </div>
        </section>

        <section className="pp-scanPanel" aria-labelledby="core-vitals-heading">
          <div className="pp-scanPanelHeader">
            <div>
              <p className="pp-eyebrow">Your latest storefront measurement</p>
              <h2 id="core-vitals-heading">Core Web Vitals action center</h2>
              <p>
                {scan
                  ? `${scan.strategy} PageSpeed run · ${new Date(scan.createdAt).toLocaleString()} · ${scan.pageUrl}`
                  : "No completed audit is available yet. Run a PageSpeed audit to load measured results."}
              </p>
            </div>
            <a className="pp-secondaryButton" href="/app/scan">
              View Speed Audit
            </a>
          </div>
          <div className="pp-vitalsGrid">
            <article className="pp-vitalCard">
              <span>Largest Contentful Paint · LCP</span>
              <strong>
                {fieldMetrics?.lcpP75Ms !== undefined
                  ? milliseconds(fieldMetrics.lcpP75Ms)
                  : scan?.lcpMs !== null && scan?.lcpMs !== undefined
                    ? milliseconds(scan.lcpMs)
                    : "Not measured"}
              </strong>
              <small>
                {fieldMetrics?.lcpP75Ms !== undefined
                  ? `Real-user ${scan?.fieldDataSource?.toLowerCase() ?? "CrUX"} p75 · ${fieldStatus(fieldMetrics.lcpCategory)}`
                  : scan?.lcpMs !== null && scan?.lcpMs !== undefined
                    ? "Synthetic lab result · not field Core Web Vitals"
                    : "Run a storefront audit first"}
              </small>
            </article>
            <article className="pp-vitalCard">
              <span>Interaction to Next Paint · INP</span>
              <strong>{milliseconds(fieldMetrics?.inpP75Ms)}</strong>
              <small>
                {fieldMetrics?.inpP75Ms !== undefined
                  ? `Real-user ${scan?.fieldDataSource?.toLowerCase() ?? "CrUX"} p75 · ${fieldStatus(fieldMetrics.inpCategory)}`
                  : "Google returned no field INP. TBT is a separate lab diagnostic, not INP."}
              </small>
            </article>
            <article className="pp-vitalCard">
              <span>Cumulative Layout Shift · CLS</span>
              <strong>
                {fieldMetrics?.clsP75 !== undefined
                  ? fieldMetrics.clsP75.toFixed(3)
                  : scan?.cls !== null && scan?.cls !== undefined
                    ? scan.cls.toFixed(3)
                    : "Not measured"}
              </strong>
              <small>
                {fieldMetrics?.clsP75 !== undefined
                  ? `Real-user ${scan?.fieldDataSource?.toLowerCase() ?? "CrUX"} p75 · ${fieldStatus(fieldMetrics.clsCategory)}`
                  : scan?.cls !== null && scan?.cls !== undefined
                    ? "Synthetic lab result · field CLS is not available"
                    : "Run a storefront audit first"}
              </small>
            </article>
            <article className="pp-vitalCard pp-vitalDiagnostic">
              <span>Total Blocking Time · lab diagnostic</span>
              <strong>
                {scan?.tbtMs === null || scan?.tbtMs === undefined
                  ? "Not measured"
                  : `${scan.tbtMs} ms`}
              </strong>
              <small>
                Use this to investigate JavaScript work; it is not a substitute
                for field INP.
              </small>
            </article>
          </div>
          <p className="pp-scanFootnote">
            These measurements do not automatically change your theme. A metric
            improves only after a reviewed change is applied and the same page
            is tested again; PageSpeed variation is not proof of causation.
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
            {actionErrors.length > 0 ? (
              <aside className="pp-scanNotice" role="alert">
                {Array.from(new Set(actionErrors)).map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </aside>
            ) : changeResult ? (
              <aside className="pp-scanNotice" role="status">
                {changeResult.notice}{" "}
                <strong>Status: {changeResult.status}</strong>
              </aside>
            ) : null}

            <section
              className="pp-scanPanel"
              id="theme-picker"
              aria-labelledby="asset-picker-title"
            >
              <h2 id="asset-picker-title">1. Choose a theme to inspect</h2>
              {data.themes.length === 0 ? (
                <p>No themes were returned for this Shopify store.</p>
              ) : (
                <inventoryFetcher.Form
                  method="post"
                  className="pp-optimizeForm"
                >
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
                    {inventoryFetcher.state !== "idle"
                      ? "Reading theme files…"
                      : "Load CSS/JS and image tools"}
                  </button>
                </inventoryFetcher.Form>
              )}
              {data.themes.length > 0 ? (
                <liquidFetcher.Form method="post" className="pp-optimizeForm">
                  <label>
                    Theme for compatible JavaScript deferral
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
                  <input type="hidden" name="mode" value="defer-js" />
                  <input
                    type="hidden"
                    name="filename"
                    value="layout/theme.liquid"
                  />
                  <button
                    className="pp-secondaryButton"
                    name="intent"
                    value="preview-liquid"
                    disabled={busy}
                  >
                    {liquidFetcher.state !== "idle" &&
                    liquidFetcher.formData?.get("mode") === "defer-js"
                      ? "Inspecting JavaScript…"
                      : "Preview compatible JS deferral"}
                  </button>
                </liquidFetcher.Form>
              ) : null}
            </section>

            {listed ? (
              <section className="pp-scanPanel">
                <h2>2. Minify a CSS or JavaScript asset</h2>
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
                  <minifyFetcher.Form method="post" className="pp-optimizeForm">
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
                      {minifyFetcher.state !== "idle"
                        ? "Generating preview…"
                        : "Generate minified preview"}
                    </button>
                  </minifyFetcher.Form>
                )}
              </section>
            ) : null}

            {listed ? (
              <section
                className="pp-scanPanel"
                id="optimizer-tools"
                aria-labelledby="image-tools-title"
              >
                <p className="pp-eyebrow">Image loading · LCP</p>
                <h2 id="image-tools-title">Review Shopify image markup</h2>
                <p>
                  Choose a section or snippet to inspect Shopify{" "}
                  <code>image_tag</code> expressions. The app can preview
                  lazy-loading changes for images you confirm are below the
                  fold, or add high priority to one exact LCP/hero image. Raw{" "}
                  <code>&lt;img&gt;</code> tags and dynamic Liquid are not
                  rewritten.
                </p>
                {listed.liquidFiles.length ? (
                  <imageInspectionFetcher.Form
                    method="post"
                    className="pp-optimizeForm"
                  >
                    <input
                      type="hidden"
                      name="themeId"
                      value={listed.theme.id}
                    />
                    <label>
                      Section or snippet
                      <select
                        name="filename"
                        required
                        defaultValue={inspection?.filename ?? ""}
                      >
                        <option value="" disabled>
                          Select a Liquid file
                        </option>
                        {listed.liquidFiles.map((file) => (
                          <option key={file.filename} value={file.filename}>
                            {file.filename} · {bytes(file.size)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="pp-secondaryButton"
                      name="intent"
                      value="inspect-liquid"
                      disabled={busy}
                    >
                      {imageInspectionFetcher.state !== "idle"
                        ? "Inspecting image markup…"
                        : "Inspect image_tag expressions"}
                    </button>
                  </imageInspectionFetcher.Form>
                ) : (
                  <p>
                    No section/snippet Liquid files were returned. Confirm
                    Shopify granted <code>read_themes</code> and reload the
                    inventory.
                  </p>
                )}

                {inspection ? (
                  <div className="pp-imageInspection">
                    <h3>{inspection.filename}</h3>
                    <p>{inspection.notice}</p>
                    {inspection.images.length ? (
                      <>
                        <ol className="pp-imageCandidates">
                          {inspection.images.map((image) => (
                            <li key={`${inspection.filename}-${image.index}`}>
                              <div>
                                <strong>
                                  Image tag {image.index + 1} · line{" "}
                                  {image.line}
                                </strong>
                                <pre>{image.expression}</pre>
                                <small>
                                  Current loading:{" "}
                                  {image.loading ??
                                    (image.loadingConfigured
                                      ? "dynamic/unknown"
                                      : "not explicit")}{" "}
                                  · fetch priority:{" "}
                                  {image.fetchpriority ??
                                    (image.fetchpriorityConfigured
                                      ? "dynamic/unknown"
                                      : "not explicit")}
                                </small>
                              </div>
                              <liquidFetcher.Form method="post">
                                <input
                                  type="hidden"
                                  name="themeId"
                                  value={inspection.theme.id}
                                />
                                <input
                                  type="hidden"
                                  name="filename"
                                  value={inspection.filename}
                                />
                                <input
                                  type="hidden"
                                  name="mode"
                                  value="prioritize-lcp"
                                />
                                <input
                                  type="hidden"
                                  name="imageIndex"
                                  value={image.index}
                                />
                                <button
                                  className="pp-secondaryButton"
                                  name="intent"
                                  value="preview-liquid"
                                  disabled={busy}
                                >
                                  Preview as LCP image
                                </button>
                              </liquidFetcher.Form>
                            </li>
                          ))}
                        </ol>
                        <liquidFetcher.Form
                          method="post"
                          className="pp-applyForm pp-imageLazyForm"
                        >
                          <input
                            type="hidden"
                            name="intent"
                            value="preview-liquid"
                          />
                          <input
                            type="hidden"
                            name="themeId"
                            value={inspection.theme.id}
                          />
                          <input
                            type="hidden"
                            name="filename"
                            value={inspection.filename}
                          />
                          <input
                            type="hidden"
                            name="mode"
                            value="lazy-images"
                          />
                          <p>
                            Lazy-load mode changes eligible Shopify image_tag
                            calls in this file only. Use it only when every
                            affected image is below the fold; do not use it on a
                            hero, first product image, or any LCP candidate.
                          </p>
                          <button
                            className="pp-secondaryButton"
                            disabled={busy}
                          >
                            {liquidFetcher.state !== "idle" &&
                            liquidFetcher.formData?.get("mode") ===
                              "lazy-images"
                              ? "Generating image preview…"
                              : "Preview below-the-fold lazy loading"}
                          </button>
                        </liquidFetcher.Form>
                      </>
                    ) : (
                      <p>
                        No supported Shopify <code>image_tag</code> expressions
                        were found in this file.
                      </p>
                    )}
                  </div>
                ) : null}
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
                  <minifyFetcher.Form method="post" className="pp-applyForm">
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
                      {minifyFetcher.state !== "idle"
                        ? "Submitting to Shopify…"
                        : "Apply to this draft theme"}
                    </button>
                  </minifyFetcher.Form>
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

            {liquidPreview ? (
              <section
                className="pp-scanPanel"
                aria-label="Reviewed Liquid optimization preview"
              >
                <div className="pp-scanPanelHeader">
                  <div>
                    <p className="pp-eyebrow">No Shopify file changed yet</p>
                    <h2>
                      {liquidPreview.mode === "defer-js"
                        ? "Defer compatible theme JavaScript"
                        : liquidPreview.mode === "lazy-images"
                          ? "Lazy-load selected below-the-fold images"
                          : "Prioritize the selected LCP image"}
                    </h2>
                    <p>
                      {liquidPreview.theme.name} · {liquidPreview.filename} ·{" "}
                      {liquidPreview.theme.role.toLowerCase()}
                    </p>
                  </div>
                </div>
                <div className="pp-scanMetrics">
                  <article>
                    <span>Original file</span>
                    <strong>{bytes(liquidPreview.sourceBytes)}</strong>
                    <p>UTF-8 source bytes</p>
                  </article>
                  <article>
                    <span>Reviewed preview</span>
                    <strong>{bytes(liquidPreview.outputBytes)}</strong>
                    <p>UTF-8 source bytes after edit</p>
                  </article>
                  <article>
                    <span>Changed expressions</span>
                    <strong>{liquidPreview.changedCount}</strong>
                    <p>
                      {liquidPreview.skippedCount} selected expression(s) left
                      untouched
                    </p>
                  </article>
                </div>
                <p className="pp-scanFootnote">{liquidPreview.notice}</p>
                <aside className="pp-scanNotice" role="note">
                  {liquidPreview.mode === "defer-js"
                    ? "This adds defer to compatible first-party theme asset scripts. It does not delay execution until user interaction, and it skips app, remote, inline, async, module, and dynamic scripts. Test cart, menus, search, consent, analytics, and app blocks before publishing."
                    : liquidPreview.mode === "lazy-images"
                      ? "This is only for a section/snippet whose affected images are all below the fold. Never lazy-load the hero, first product image, or identified LCP image. Shopify may already lazy-load lower sections; verify the rendered output and retest. Raw img markup is not changed."
                      : "Only the selected image_tag expression is changed. Confirm it is the actual LCP image on the tested page; high priority on multiple images can compete and make performance worse."}
                </aside>
                <details className="pp-codePreview">
                  <summary>Review the complete changed Liquid file</summary>
                  <pre>
                    <code>{liquidPreview.optimizedCode}</code>
                  </pre>
                </details>
                {["UNPUBLISHED", "DEVELOPMENT"].includes(
                  liquidPreview.theme.role,
                ) ? (
                  <liquidFetcher.Form method="post" className="pp-applyForm">
                    <input type="hidden" name="intent" value="apply-liquid" />
                    <input
                      type="hidden"
                      name="themeId"
                      value={liquidPreview.theme.id}
                    />
                    <input
                      type="hidden"
                      name="filename"
                      value={liquidPreview.filename}
                    />
                    <input
                      type="hidden"
                      name="mode"
                      value={liquidPreview.mode}
                    />
                    {liquidPreview.imageIndex !== null ? (
                      <input
                        type="hidden"
                        name="imageIndex"
                        value={liquidPreview.imageIndex}
                      />
                    ) : null}
                    <input
                      type="hidden"
                      name="sourceHash"
                      value={liquidPreview.sourceHash}
                    />
                    <label>
                      <input
                        type="checkbox"
                        name="confirmApply"
                        value="yes"
                        required
                      />
                      {liquidPreview.mode === "lazy-images"
                        ? "I confirmed every affected image in this selected file is below the fold and none is the hero/LCP image."
                        : liquidPreview.mode === "prioritize-lcp"
                          ? "I confirmed this exact image is the page's primary LCP/hero image and reviewed the generated Liquid."
                          : "I reviewed the exact script changes and will test core shopping flows on this unpublished/development theme."}{" "}
                      The original file will be saved for conflict-checked
                      rollback.
                    </label>
                    <button className="pp-scanButton" disabled={busy}>
                      {liquidFetcher.state !== "idle" &&
                      liquidFetcher.formData?.get("intent") === "apply-liquid"
                        ? "Submitting reviewed change…"
                        : "Apply reviewed change to this draft theme"}
                    </button>
                  </liquidFetcher.Form>
                ) : (
                  <aside className="pp-scanNotice" role="note">
                    This is a read-only preview. Applying is available only on
                    an unpublished/development theme; the published theme will
                    not be modified.
                  </aside>
                )}
              </section>
            ) : null}

            <section className="pp-scanPanel" aria-label="Optimization history">
              <h2>Draft theme changes and rollback</h2>
              <p>
                Only changes made by this app are listed. Rollback verifies the
                current file checksum first and refuses to overwrite newer
                merchant edits. Shopify theme writes require the approved app
                permission and are limited here to unpublished/development
                themes; the app never publishes the theme.
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
                        <historyFetcher.Form method="post">
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
                        </historyFetcher.Form>
                      ) : change.status === "APPLIED" ? (
                        <historyFetcher.Form
                          method="post"
                          className="pp-rollbackForm"
                        >
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
                        </historyFetcher.Form>
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
