import type { ImageSaving } from "./image-savings";

/**
 * Extracts the parts of a PageSpeed Insights v5 response that the PageSpeed
 * web UI renders, *verbatim*. Titles, descriptions and display values are the
 * exact strings Lighthouse produced, and scores use the same rounding as the
 * Lighthouse report renderer (Math.round(score * 100)), so a run stored here
 * reads exactly like the same run on pagespeed.web.dev.
 *
 * This module is shared by server and client code: no Node-only imports.
 */

export type LighthouseCategoryId =
  | "performance"
  | "accessibility"
  | "best-practices"
  | "seo";

export const CATEGORY_IDS: LighthouseCategoryId[] = [
  "performance",
  "accessibility",
  "best-practices",
  "seo",
];

export const METRIC_IDS = [
  "first-contentful-paint",
  "largest-contentful-paint",
  "total-blocking-time",
  "cumulative-layout-shift",
  "speed-index",
] as const;

export type MetricId = (typeof METRIC_IDS)[number];

export const METRIC_ACRONYM: Record<MetricId, string> = {
  "first-contentful-paint": "FCP",
  "largest-contentful-paint": "LCP",
  "total-blocking-time": "TBT",
  "cumulative-layout-shift": "CLS",
  "speed-index": "SI",
};

export type Rating = "pass" | "average" | "fail" | "informative" | "error";

export type ReportHeading = {
  key: string;
  label: string;
  valueType: string;
  granularity?: number;
};

export type ReportCell =
  | string
  | number
  | boolean
  | null
  | {
      type?: string;
      value?: string | number;
      url?: string;
      text?: string;
      snippet?: string;
      nodeLabel?: string;
      selector?: string;
      line?: number;
      column?: number;
    };

export type ReportRow = Record<string, ReportCell>;

export type ReportAudit = {
  id: string;
  title: string;
  description: string;
  displayValue: string | null;
  score: number | null;
  scoreDisplayMode: string;
  rating: Rating;
  group: string | null;
  savingsMs: number | null;
  savingsBytes: number | null;
  metricSavings: Record<string, number>;
  headings: ReportHeading[];
  items: ReportRow[];
  totalItems: number;
};

export type ReportMetric = {
  id: MetricId;
  acronym: string;
  title: string;
  description: string;
  displayValue: string;
  numericValue: number | null;
  score: number | null;
  rating: Rating;
};

export type ReportCategory = {
  id: LighthouseCategoryId;
  title: string;
  score: number | null;
  passed: number;
  failed: number;
};

export type ReportImage = {
  url: string;
  totalBytes: number | null;
  wastedBytes: number | null;
  wastedPercent: number | null;
  sources: string[];
};

export type FilmstripFrame = { timing: number; data: string };

export type LighthouseReport = {
  version: 2;
  lighthouseVersion: string | null;
  fetchTime: string | null;
  requestedUrl: string | null;
  finalUrl: string | null;
  formFactor: "mobile" | "desktop" | null;
  device: string;
  network: string;
  runWarnings: string[];
  categories: ReportCategory[];
  metrics: ReportMetric[];
  groups: Record<string, string>;
  audits: ReportAudit[];
  passedAudits: Array<Pick<ReportAudit, "id" | "title" | "displayValue">>;
  screenshot: string | null;
  filmstrip: FilmstripFrame[];
  images: ReportImage[];
  fieldOverall: string | null;
  fieldOriginOverall: string | null;
  /** Measured after the run on Shopify's CDN (see image-savings.server.ts). */
  imageSavings?: ImageSaving[];
};

/* ------------------------------------------------------------------ */
/* Raw PageSpeed shapes (only what we read)                            */
/* ------------------------------------------------------------------ */

type RawDetails = {
  type?: string;
  headings?: Array<Record<string, unknown>>;
  items?: Array<Record<string, unknown>>;
  data?: unknown;
  overallSavingsMs?: number;
  overallSavingsBytes?: number;
};

type RawAudit = {
  id?: string;
  title?: string;
  description?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
  details?: RawDetails;
  metricSavings?: Record<string, unknown>;
};

type RawCategory = {
  id?: string;
  title?: string;
  score?: number | null;
  auditRefs?: Array<{ id?: string; group?: string; weight?: number }>;
};

export type RawLighthouseResult = {
  lighthouseVersion?: string;
  fetchTime?: string;
  requestedUrl?: string;
  finalUrl?: string;
  finalDisplayedUrl?: string;
  runWarnings?: unknown[];
  configSettings?: {
    formFactor?: string;
    emulatedFormFactor?: string;
    throttlingMethod?: string;
    throttling?: {
      rttMs?: number;
      throughputKbps?: number;
      cpuSlowdownMultiplier?: number;
    };
  };
  environment?: { networkUserAgent?: string };
  categories?: Record<string, RawCategory | undefined>;
  categoryGroups?: Record<string, { title?: string } | undefined>;
  audits?: Record<string, RawAudit | undefined>;
};

export type RawPageSpeedPayload = {
  lighthouseResult?: RawLighthouseResult;
  loadingExperience?: { overall_category?: string };
  originLoadingExperience?: { overall_category?: string };
};

/* ------------------------------------------------------------------ */
/* Score helpers — identical thresholds to the Lighthouse renderer     */
/* ------------------------------------------------------------------ */

export const PASS_THRESHOLD = 0.9;

/** Lighthouse renderer: Math.round(score * 100). */
export function toDisplayScore(score: number | null | undefined) {
  return typeof score === "number" && Number.isFinite(score)
    ? Math.round(score * 100)
    : null;
}

export function ratingForScore(
  score: number | null | undefined,
  mode?: string,
): Rating {
  if (mode === "error") return "error";
  if (mode === "informative" || mode === "manual") return "informative";
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return "informative";
  }
  if (score >= PASS_THRESHOLD) return "pass";
  if (score >= 0.5) return "average";
  return "fail";
}

/** Gauge rating for a 0–100 category score (PSI: 90–100, 50–89, 0–49). */
export function ratingForDisplayScore(score: number | null | undefined): Rating {
  if (typeof score !== "number") return "informative";
  if (score >= 90) return "pass";
  if (score >= 50) return "average";
  return "fail";
}

function isShownAsPassed(audit: RawAudit) {
  const mode = audit.scoreDisplayMode;
  if (mode === "notApplicable" || mode === "manual") return true;
  if (mode === "error") return false;
  if (mode === "informative") return false;
  return typeof audit.score === "number" && audit.score >= PASS_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/* Value formatting — mirrors Lighthouse i18n formatter output (en-US) */
/* ------------------------------------------------------------------ */

const groupedNumber = (value: number, fractionDigits: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

function digitsFor(granularity: number) {
  if (granularity >= 1) return 0;
  return Math.min(4, Math.ceil(-Math.log10(granularity)));
}

function roundTo(value: number, granularity: number) {
  return Math.round(value / granularity) * granularity;
}

export function formatBytesToKiB(bytes: number, granularity = 0.1) {
  const kib = roundTo(bytes / 1024, granularity);
  return `${groupedNumber(kib, digitsFor(granularity))} KiB`;
}

export function formatMilliseconds(ms: number, granularity = 10) {
  const rounded = roundTo(ms, granularity);
  return `${groupedNumber(rounded, digitsFor(granularity))} ms`;
}

export function formatSeconds(ms: number, granularity = 0.1) {
  const seconds = roundTo(ms / 1000, granularity);
  return `${groupedNumber(seconds, digitsFor(granularity))} s`;
}

export function formatNumber(value: number, granularity = 0.1) {
  return groupedNumber(roundTo(value, granularity), digitsFor(granularity));
}

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

const MAX_ROWS = 12;
const MAX_STRING = 600;
const DATA_IMAGE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const KEEP_CELL_KEYS = [
  "type",
  "value",
  "url",
  "text",
  "snippet",
  "nodeLabel",
  "selector",
  "line",
  "column",
] as const;

function clip(value: string) {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeCell(value: unknown): ReportCell {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return clip(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const cell: Record<string, string | number> = {};
    for (const key of KEEP_CELL_KEYS) {
      const field = source[key];
      if (typeof field === "string") cell[key] = clip(field);
      else if (typeof field === "number" && Number.isFinite(field)) {
        cell[key] = field;
      }
    }
    // Lighthouse "source-location" cells use url/line/column; nodes use snippet.
    return Object.keys(cell).length ? (cell as ReportCell) : null;
  }
  return null;
}

function headingsFor(details: RawDetails | undefined): ReportHeading[] {
  if (!details?.headings) return [];
  return details.headings.flatMap((heading) => {
    const key = heading.key;
    if (typeof key !== "string" || !key) return [];
    const label =
      typeof heading.label === "string"
        ? heading.label
        : typeof heading.text === "string"
          ? heading.text
          : "";
    const valueType =
      typeof heading.valueType === "string"
        ? heading.valueType
        : typeof heading.itemType === "string"
          ? heading.itemType
          : "text";
    const granularity = finite(heading.granularity) ?? undefined;
    return [{ key, label, valueType, granularity }];
  });
}

function rowsFor(details: RawDetails | undefined, headings: ReportHeading[]) {
  if (!details?.items || !headings.length) return [];
  return details.items.slice(0, MAX_ROWS).map((item) => {
    const row: ReportRow = {};
    for (const heading of headings) {
      row[heading.key] = sanitizeCell(item[heading.key]);
    }
    return row;
  });
}

function metricSavingsFor(audit: RawAudit) {
  const savings: Record<string, number> = {};
  for (const [key, value] of Object.entries(audit.metricSavings ?? {})) {
    const numeric = finite(value);
    if (numeric !== null && numeric > 0) savings[key] = numeric;
  }
  return savings;
}

function deviceLabel(result: RawLighthouseResult) {
  const formFactor =
    result.configSettings?.formFactor ??
    result.configSettings?.emulatedFormFactor;
  // Same wording as the PageSpeed Insights runtime-settings footer.
  return formFactor === "desktop" ? "Emulated Desktop" : "Emulated Moto G Power";
}

function networkLabel(result: RawLighthouseResult) {
  const throttling = result.configSettings?.throttling;
  const formFactor = result.configSettings?.formFactor;
  if (!throttling) return "Default throttling";
  // PSI mobile uses Lighthouse's "Slow 4G" preset (150 ms RTT, 1.6 Mbps).
  if (formFactor === "desktop") return "Custom throttling (desktop)";
  if (throttling.rttMs === 150 && throttling.throughputKbps === 1638.4) {
    return "Slow 4G throttling";
  }
  return "Custom throttling";
}

const IMAGE_AUDITS = [
  "image-delivery-insight",
  "uses-optimized-images",
  "modern-image-formats",
  "uses-responsive-images",
  "offscreen-images",
] as const;

function collectImages(audits: Record<string, RawAudit | undefined>) {
  const byUrl = new Map<string, ReportImage>();
  for (const auditId of IMAGE_AUDITS) {
    const items = audits[auditId]?.details?.items ?? [];
    for (const item of items) {
      const url = typeof item.url === "string" ? item.url : null;
      if (!url || !/^https:\/\//i.test(url)) continue;
      const existing = byUrl.get(url) ?? {
        url,
        totalBytes: null,
        wastedBytes: null,
        wastedPercent: null,
        sources: [],
      };
      const total = finite(item.totalBytes);
      const wasted = finite(item.wastedBytes);
      const percent = finite(item.wastedPercent);
      if (total !== null) existing.totalBytes = Math.max(existing.totalBytes ?? 0, total);
      if (wasted !== null) existing.wastedBytes = Math.max(existing.wastedBytes ?? 0, wasted);
      if (percent !== null) {
        existing.wastedPercent = Math.max(existing.wastedPercent ?? 0, percent);
      }
      if (!existing.sources.includes(auditId)) existing.sources.push(auditId);
      byUrl.set(url, existing);
    }
  }
  return Array.from(byUrl.values())
    .sort((a, b) => (b.wastedBytes ?? 0) - (a.wastedBytes ?? 0))
    .slice(0, 12);
}

const RATING_ORDER: Record<Rating, number> = {
  error: 0,
  fail: 1,
  average: 2,
  informative: 3,
  pass: 4,
};

export function extractLighthouseReport(
  payload: RawPageSpeedPayload,
): LighthouseReport | null {
  const result = payload.lighthouseResult;
  const audits = result?.audits;
  if (!result || !audits || !result.categories) return null;

  const categories: ReportCategory[] = CATEGORY_IDS.flatMap((id) => {
    const category = result.categories?.[id];
    if (!category) return [];
    let passed = 0;
    let failed = 0;
    for (const ref of category.auditRefs ?? []) {
      const audit = ref.id ? audits[ref.id] : undefined;
      if (!audit || ref.group === "hidden") continue;
      if (audit.scoreDisplayMode === "notApplicable") continue;
      if (audit.scoreDisplayMode === "manual") continue;
      if (isShownAsPassed(audit)) passed += 1;
      else failed += 1;
    }
    return [
      {
        id,
        title: category.title ?? id,
        score: toDisplayScore(category.score),
        passed,
        failed,
      },
    ];
  });

  const metrics: ReportMetric[] = METRIC_IDS.flatMap((id) => {
    const audit = audits[id];
    if (!audit) return [];
    return [
      {
        id,
        acronym: METRIC_ACRONYM[id],
        title: audit.title ?? id,
        description: audit.description ?? "",
        displayValue: audit.displayValue ?? "—",
        numericValue: finite(audit.numericValue),
        score: finite(audit.score),
        rating: ratingForScore(audit.score, audit.scoreDisplayMode),
      },
    ];
  });

  const groups: Record<string, string> = {};
  for (const [id, group] of Object.entries(result.categoryGroups ?? {})) {
    if (group?.title) groups[id] = group.title;
  }

  const shown: ReportAudit[] = [];
  const passedAudits: LighthouseReport["passedAudits"] = [];
  const performanceRefs = result.categories.performance?.auditRefs ?? [];
  for (const ref of performanceRefs) {
    if (!ref.id || !ref.group) continue;
    if (ref.group === "metrics" || ref.group === "hidden") continue;
    const audit = audits[ref.id];
    if (!audit) continue;
    if (
      audit.scoreDisplayMode === "notApplicable" ||
      audit.scoreDisplayMode === "manual"
    ) {
      continue;
    }
    if (isShownAsPassed(audit)) {
      passedAudits.push({
        id: ref.id,
        title: audit.title ?? ref.id,
        displayValue: audit.displayValue ?? null,
      });
      continue;
    }
    const headings = headingsFor(audit.details);
    shown.push({
      id: ref.id,
      title: audit.title ?? ref.id,
      description: audit.description ?? "",
      displayValue: audit.displayValue ?? null,
      score: finite(audit.score),
      scoreDisplayMode: audit.scoreDisplayMode ?? "numeric",
      rating: ratingForScore(audit.score, audit.scoreDisplayMode),
      group: ref.group,
      savingsMs: finite(audit.details?.overallSavingsMs),
      savingsBytes: finite(audit.details?.overallSavingsBytes),
      metricSavings: metricSavingsFor(audit),
      headings,
      items: rowsFor(audit.details, headings),
      totalItems: audit.details?.items?.length ?? 0,
    });
  }
  // Same visible ordering principle as the report: failing before warnings
  // before informative diagnostics; larger estimated savings first.
  shown.sort((a, b) => {
    const byRating = RATING_ORDER[a.rating] - RATING_ORDER[b.rating];
    if (byRating) return byRating;
    const aImpact = (a.metricSavings.LCP ?? 0) + (a.metricSavings.FCP ?? 0) + (a.savingsMs ?? 0);
    const bImpact = (b.metricSavings.LCP ?? 0) + (b.metricSavings.FCP ?? 0) + (b.savingsMs ?? 0);
    return bImpact - aImpact;
  });

  const screenshotData = audits["final-screenshot"]?.details?.data;
  const screenshot =
    typeof screenshotData === "string" && DATA_IMAGE.test(screenshotData)
      ? screenshotData
      : null;
  const filmstrip: FilmstripFrame[] = (
    audits["screenshot-thumbnails"]?.details?.items ?? []
  ).flatMap((item) => {
    const timing = finite(item.timing);
    const data = item.data;
    return timing !== null && typeof data === "string" && DATA_IMAGE.test(data)
      ? [{ timing, data }]
      : [];
  });

  const formFactor = result.configSettings?.formFactor;
  return {
    version: 2,
    lighthouseVersion: result.lighthouseVersion ?? null,
    fetchTime: result.fetchTime ?? null,
    requestedUrl: result.requestedUrl ?? null,
    finalUrl: result.finalDisplayedUrl ?? result.finalUrl ?? null,
    formFactor:
      formFactor === "mobile" || formFactor === "desktop" ? formFactor : null,
    device: deviceLabel(result),
    network: networkLabel(result),
    runWarnings: (result.runWarnings ?? [])
      .filter((warning): warning is string => typeof warning === "string")
      .map(clip),
    categories,
    metrics,
    groups,
    audits: shown,
    passedAudits,
    screenshot,
    filmstrip,
    images: collectImages(audits),
    fieldOverall: payload.loadingExperience?.overall_category ?? null,
    fieldOriginOverall:
      payload.originLoadingExperience?.overall_category ?? null,
  };
}

/** Narrow an unknown JSON column back to a report (older rows have none). */
export function readStoredReport(value: unknown): LighthouseReport | null {
  if (!value || typeof value !== "object") return null;
  const report = value as Partial<LighthouseReport>;
  if (report.version !== 2 || !Array.isArray(report.metrics)) return null;
  return report as LighthouseReport;
}

/** Link that opens the same URL and device on pagespeed.web.dev. */
export function pageSpeedWebUrl(pageUrl: string, strategy: string) {
  const url = new URL("https://pagespeed.web.dev/report");
  url.searchParams.set("url", pageUrl);
  url.searchParams.set("form_factor", strategy === "desktop" ? "desktop" : "mobile");
  return url.toString();
}
