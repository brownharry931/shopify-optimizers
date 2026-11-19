/**
 * Parses a theme's config/settings_data.json to find the SpeedBoost app
 * embed. Shopify stores activated app embeds in `current.blocks` with a type
 * of `shopify://apps/<app>/blocks/<block-handle>/<uuid>` and a `disabled`
 * flag. This is the theme-independent, Shopify-documented source of truth:
 * it reflects what the merchant *saved* in the theme editor.
 */
import { EMBED_BLOCK_HANDLE } from "./embed-handle";

export type EmbedState = "enabled" | "disabled" | "not-added";

export type EmbedStatus = {
  /** Saved state in the live (published) theme, or "unknown" if it could not be read. */
  theme: EmbedState | "unknown";
  themeName: string | null;
  /** True when the storefront runtime pinged the app in the last 7 days. */
  live: boolean;
  lastSeenAt: string | null;
  /** Readable reason when the theme could not be read. */
  error: string | null;
};

/** Active if saved as enabled, or — when the theme can't be read — if the runtime is reporting in. */
export function embedIsActive(status: EmbedStatus) {
  return status.theme === "enabled" || (status.theme === "unknown" && status.live);
}

type Block = { type?: unknown; disabled?: unknown };

/** Strip the comment header Shopify writes at the top of settings_data.json. */
export function stripJsonComments(source: string) {
  let out = "";
  let inString = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
    } else if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i + 2);
      i = end === -1 ? source.length : end - 1;
    } else {
      out += char;
    }
  }
  return out;
}

export function isSpeedBoostEmbedType(type: unknown, blockHandle = EMBED_BLOCK_HANDLE) {
  return (
    typeof type === "string" &&
    type.startsWith("shopify://apps/") &&
    type.includes(`/blocks/${blockHandle}/`)
  );
}

/** Returns the embed state, or throws if the file cannot be parsed. */
export function embedStateFromSettingsData(source: string, blockHandle = EMBED_BLOCK_HANDLE): EmbedState {
  const data = JSON.parse(stripJsonComments(source)) as {
    current?: unknown;
    presets?: Record<string, unknown>;
  };
  // Older themes store `current` as the name of a preset.
  const current =
    typeof data.current === "string" ? data.presets?.[data.current] : data.current;
  const blocks =
    current && typeof current === "object"
      ? ((current as { blocks?: Record<string, Block> }).blocks ?? {})
      : {};
  let found: EmbedState = "not-added";
  for (const block of Object.values(blocks)) {
    if (!block || !isSpeedBoostEmbedType(block.type, blockHandle)) continue;
    if (block.disabled === true || block.disabled === "true") {
      found = "disabled";
      continue;
    }
    return "enabled";
  }
  return found;
}
