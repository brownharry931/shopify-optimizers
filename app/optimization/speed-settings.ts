/**
 * Storefront speed-booster settings. They are stored as a JSON app-data
 * metafield on the app installation and read by the Theme App Embed, so
 * nothing in the merchant's theme files is modified and disabling the embed
 * (or a toggle) reverts the behaviour instantly.
 */

export type SpeedSettings = {
  delayAppScripts: boolean;
  delayTrackers: boolean;
  delayTimeoutMs: number;
  instantPage: boolean;
  instantPageMode: "hover" | "viewport";
  lazyMedia: boolean;
  preloadLcp: boolean;
  lcpImageSizes: string;
  fontOptimization: boolean;
  passiveListeners: boolean;
  pageStabilizer: boolean;
  loadingBar: boolean;
  loadingBarColor: string;
  lazySections: boolean;
  delayPatterns: string[];
  neverDelayPatterns: string[];
};

export const SPEED_SETTINGS_NAMESPACE = "speedboost";
export const SPEED_SETTINGS_KEY = "settings";

export const DEFAULT_SPEED_SETTINGS: SpeedSettings = {
  delayAppScripts: false,
  delayTrackers: false,
  delayTimeoutMs: 0,
  instantPage: false,
  instantPageMode: "hover",
  lazyMedia: false,
  preloadLcp: false,
  lcpImageSizes: "(min-width: 990px) 55vw, 100vw",
  fontOptimization: false,
  passiveListeners: false,
  pageStabilizer: false,
  loadingBar: false,
  loadingBarColor: "#2563eb",
  lazySections: false,
  delayPatterns: [],
  neverDelayPatterns: [],
};

/** Third-party tags that are safe to postpone until the visitor interacts. */
export const KNOWN_TRACKER_PATTERNS = [
  "googletagmanager.com",
  "google-analytics.com",
  "connect.facebook.net",
  "analytics.tiktok.com",
  "static.hotjar.com",
  "clarity.ms",
  "sc-static.net",
  "s.pinimg.com",
  "static.ads-twitter.com",
  "widget.intercom.io",
  "js.driftt.com",
  "embed.tawk.to",
  "code.tidio.co",
  "static.zdassets.com",
  "static.klaviyo.com/onsite",
  "cdn.attn.tv",
];

/** Never delayed regardless of settings: checkout, payments, consent, Shopify. */
export const ALWAYS_ALLOWED_PATTERNS = [
  "cdn.shopify.com",
  "shopifycloud",
  "/checkouts/",
  "paypal.com",
  "js.stripe.com",
  "pay.google.com",
  "applepay",
  "recaptcha",
  "hcaptcha",
  "cookielaw.org",
  "cookiebot.com",
  "consent",
];

const BOOLEAN_KEYS = [
  "delayAppScripts",
  "delayTrackers",
  "instantPage",
  "lazyMedia",
  "preloadLcp",
  "fontOptimization",
  "passiveListeners",
  "pageStabilizer",
  "loadingBar",
  "lazySections",
] as const satisfies ReadonlyArray<keyof SpeedSettings>;

export type SpeedBooleanKey = (typeof BOOLEAN_KEYS)[number];
export const SPEED_BOOLEAN_KEYS: readonly SpeedBooleanKey[] = BOOLEAN_KEYS;

const PATTERN = /^[a-z0-9.\-_/:]{3,120}$/i;

function parsePatterns(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  const patterns: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const pattern = entry.trim().toLowerCase();
    if (!pattern) continue;
    if (!PATTERN.test(pattern)) {
      throw new Error(
        `"${pattern.slice(0, 40)}" is not a valid script pattern. Use part of a script URL such as example.com/widget.js.`,
      );
    }
    if (!patterns.includes(pattern)) patterns.push(pattern);
  }
  if (patterns.length > 40) throw new Error("Use at most 40 script patterns.");
  return patterns;
}

/** Validate unknown input (stored JSON or a form post) into settings. */
export function parseSpeedSettings(input: unknown): SpeedSettings {
  const source =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const settings: SpeedSettings = { ...DEFAULT_SPEED_SETTINGS };
  for (const key of BOOLEAN_KEYS) {
    const value = source[key];
    settings[key] = value === true || value === "true" || value === "on";
  }
  const timeout = Number(source.delayTimeoutMs ?? 0);
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 30_000) {
    throw new Error("The script delay fallback must be between 0 and 30 seconds.");
  }
  settings.delayTimeoutMs = timeout;
  settings.instantPageMode =
    source.instantPageMode === "viewport" ? "viewport" : "hover";
  const sizes = typeof source.lcpImageSizes === "string" ? source.lcpImageSizes.trim() : "";
  if (sizes) {
    if (!/^[a-z0-9(),:.\s%-]{1,120}$/i.test(sizes)) {
      throw new Error("The LCP image sizes value contains unsupported characters.");
    }
    settings.lcpImageSizes = sizes;
  }
  const color = typeof source.loadingBarColor === "string" ? source.loadingBarColor.trim() : "";
  if (color) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error("Use a hex colour such as #2563eb.");
    settings.loadingBarColor = color.toLowerCase();
  }
  settings.delayPatterns = parsePatterns(source.delayPatterns);
  settings.neverDelayPatterns = parsePatterns(source.neverDelayPatterns);
  return settings;
}

/** Lenient read of a stored metafield value; falls back to defaults. */
export function readSpeedSettings(raw: string | null | undefined): SpeedSettings {
  if (!raw) return { ...DEFAULT_SPEED_SETTINGS };
  try {
    return parseSpeedSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SPEED_SETTINGS };
  }
}

export function enabledCount(settings: SpeedSettings) {
  return BOOLEAN_KEYS.filter((key) => settings[key]).length;
}

/**
 * The value written to the metafield: the merchant's settings plus the fully
 * resolved script lists, so the storefront runtime has one source of truth.
 */
export function storefrontPayload(settings: SpeedSettings) {
  return {
    ...settings,
    resolvedDelay: [
      ...(settings.delayTrackers ? KNOWN_TRACKER_PATTERNS : []),
      ...settings.delayPatterns,
    ],
    resolvedNever: [...ALWAYS_ALLOWED_PATTERNS, ...settings.neverDelayPatterns],
  };
}
