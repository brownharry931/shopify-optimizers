import { transform as transformCss } from "lightningcss";
import { transform as transformJavaScript } from "esbuild";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;

type AssetKind = "css" | "javascript";

export type AssetTransformResult = {
  kind: AssetKind;
  code: string;
  sourceBytes: number;
  outputBytes: number;
  savedBytes: number;
  savingPercent: number;
  smallerThanSource: boolean;
};

function validateSource(source: string, kind: AssetKind) {
  if (typeof source !== "string" || source.length === 0) {
    throw new Error(`${kind} source must be a non-empty string.`);
  }

  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > MAX_ASSET_BYTES) {
    throw new Error(
      `${kind} source exceeds the safe ${MAX_ASSET_BYTES / 1024 / 1024} MB transform limit.`,
    );
  }
  return bytes;
}

function summarize(
  kind: AssetKind,
  source: string,
  code: string,
  sourceBytes: number,
): AssetTransformResult {
  const outputBytes = Buffer.byteLength(code, "utf8");
  const savedBytes = Math.max(0, sourceBytes - outputBytes);
  return {
    kind,
    code,
    sourceBytes,
    outputBytes,
    savedBytes,
    savingPercent:
      sourceBytes > 0 ? Math.round((savedBytes / sourceBytes) * 1000) / 10 : 0,
    smallerThanSource: outputBytes < sourceBytes,
  };
}

/**
 * Minifies one standalone stylesheet without fetching, executing, or publishing it.
 * Callers must retain the original and publish only after validation/preview.
 */
export function minifyCssAsset(source: string): AssetTransformResult {
  const sourceBytes = validateSource(source, "css");
  const result = transformCss({
    filename: "storefront.css",
    code: Buffer.from(source, "utf8"),
    minify: true,
    errorRecovery: false,
  });
  return summarize("css", source, Buffer.from(result.code).toString("utf8"), sourceBytes);
}

/**
 * Minifies one standalone JavaScript file without bundling or executing it.
 * Legal comments are retained; callers must preserve the original asset.
 */
export async function minifyJavaScriptAsset(
  source: string,
): Promise<AssetTransformResult> {
  const sourceBytes = validateSource(source, "javascript");
  const result = await transformJavaScript(source, {
    loader: "js",
    target: "esnext",
    minify: true,
    legalComments: "inline",
    sourcemap: false,
    sourcefile: "storefront.js",
  });
  return summarize("javascript", source, result.code, sourceBytes);
}
