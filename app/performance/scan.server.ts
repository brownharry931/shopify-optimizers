import { isIP } from "node:net";
import prisma from "../db.server";
import { selectCruxFieldData, type PageSpeedFieldSet } from "./field-data";
import { measureImageSavings } from "./image-savings.server";
import {
  CATEGORY_IDS,
  extractLighthouseReport,
  readStoredReport,
  type RawLighthouseResult,
} from "./lighthouse-report";
import {
  buildTargetUrl,
  normalizeTargetPath,
  type ScanStrategy,
} from "./scan-targets";

const scanFindings = [
  "largest-contentful-paint-element",
  "lcp-discovery",
  "render-blocking-resources",
  "uses-optimized-images",
  "modern-image-formats",
  "uses-responsive-images",
  "unused-css-rules",
  "unused-javascript",
  "font-display",
  "uses-text-compression",
  "uses-long-cache-ttl",
] as const;

type LighthouseAudit = {
  title?: string;
  description?: string;
  score?: number | null;
  displayValue?: string;
  numericValue?: number;
};

type PageSpeedResponse = {
  error?: { message?: string };
  loadingExperience?: PageSpeedFieldSet;
  originLoadingExperience?: PageSpeedFieldSet;
  lighthouseResult?: RawLighthouseResult & {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, LighthouseAudit>;
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Call PageSpeed Insights v5 — the same API that powers pagespeed.web.dev. */
async function fetchPageSpeed(pageUrl: string, strategy: ScanStrategy) {
  const endpoint = new URL(
    "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
  );
  endpoint.searchParams.set("url", pageUrl);
  endpoint.searchParams.set("strategy", strategy);
  // Request all four categories, exactly like the PageSpeed web UI does.
  for (const category of CATEGORY_IDS) {
    endpoint.searchParams.append("category", category.toUpperCase().replace("-", "_"));
  }
  endpoint.searchParams.set("locale", "en");
  const key = process.env.GOOGLE_PAGESPEED_API_KEY?.trim();
  if (key) endpoint.searchParams.set("key", key);

  let lastMessage = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(90_000),
    });
    const payload = (await response.json().catch(() => ({}))) as PageSpeedResponse;
    if (response.ok && !payload.error) return payload;
    lastMessage = payload.error?.message || `HTTP ${response.status}`;
    // Retry transient quota/5xx responses with backoff; never retry 4xx input errors.
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === 2) break;
    await sleep(attempt === 0 ? 4_000 : 10_000);
  }
  throw new Error(explainProviderError(lastMessage));
}

export type ScanFinding = {
  id: string;
  title: string;
  description: string;
  displayValue: string | null;
};

function numericAuditValue(
  audits: Record<string, LighthouseAudit>,
  id: string,
) {
  const value = audits[id]?.numericValue;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function explainProviderError(message: string) {
  if (/quota|rate limit|429/i.test(message)) {
    return process.env.GOOGLE_PAGESPEED_API_KEY?.trim()
      ? "Google PageSpeed quota for this app's API key is exhausted. Wait a few minutes and retry."
      : "Google PageSpeed's shared anonymous quota is exhausted. Add a GOOGLE_PAGESPEED_API_KEY to the app server to scan reliably.";
  }
  if (/lighthouse|FAILED_DOCUMENT_REQUEST|NOT_HTML/i.test(message)) {
    return "PageSpeed could not load the storefront. Check that the store is published and publicly reachable, then retry.";
  }
  return "The storefront scan provider could not complete this scan. Please retry shortly.";
}

export async function runStorefrontScan(
  shop: string,
  primaryOrigin: string,
  targetPath: string,
  strategy: ScanStrategy,
  auditRunId: string,
) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    throw new Error(
      "The authenticated Shopify domain is not valid for scanning.",
    );
  }

  const normalizedTarget = normalizeTargetPath(targetPath);
  const pageUrl = buildTargetUrl(primaryOrigin, normalizedTarget.targetPath);
  let target: URL;
  try {
    target = new URL(primaryOrigin);
  } catch {
    throw new Error("Shopify did not provide a valid primary storefront URL.");
  }
  const hostname = target.hostname.toLowerCase();
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.port ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    isIP(hostname) ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Shopify did not provide a safe HTTPS storefront origin.");
  }

  const now = new Date();
  const retentionCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  await prisma.performanceScan.deleteMany({
    where: { shop, createdAt: { lt: retentionCutoff } },
  });
  await prisma.auditRun.deleteMany({
    where: { shop, createdAt: { lt: retentionCutoff } },
  });

  const scan = await prisma.performanceScan.create({
    data: {
      shop,
      auditRunId,
      pageUrl,
      template: normalizedTarget.template,
      strategy,
    },
  });

  try {
    const payload = await fetchPageSpeed(pageUrl, strategy);

    const lighthouse = payload.lighthouseResult;
    const audits = lighthouse?.audits;
    const score = lighthouse?.categories?.performance?.score;
    if (!audits || typeof score !== "number") {
      throw new Error(
        "The scan provider returned an incomplete Lighthouse report.",
      );
    }

    const fieldData = selectCruxFieldData(
      payload.loadingExperience,
      payload.originLoadingExperience,
    );
    const findings: ScanFinding[] = scanFindings.flatMap((id) => {
      const audit = audits[id];
      if (!audit || audit.score === 1 || audit.score === null) return [];
      return [
        {
          id,
          title: audit.title || id,
          description: (audit.description || "")
            .split("[Learn more]")[0]
            .trim(),
          displayValue: audit.displayValue || null,
        },
      ];
    });
    const report = extractLighthouseReport(payload);
    if (report?.images.length) {
      const hosts = [hostname, shop.toLowerCase()];
      report.imageSavings = await measureImageSavings(report.images, hosts).catch(
        () => [],
      );
    }
    const completed = await prisma.performanceScan.update({
      where: { id: scan.id },
      data: {
        status: "COMPLETE",
        performance: Math.round(score * 100),
        lcpMs: numericAuditValue(audits, "largest-contentful-paint"),
        tbtMs: numericAuditValue(audits, "total-blocking-time"),
        cls: (() => {
          const value = audits["cumulative-layout-shift"]?.numericValue;
          return typeof value === "number" && Number.isFinite(value)
            ? value
            : null;
        })(),
        fcpMs: numericAuditValue(audits, "first-contentful-paint"),
        speedIndexMs: numericAuditValue(audits, "speed-index"),
        fieldDataSource: fieldData?.source ?? null,
        fieldData: fieldData?.metrics,
        findings,
        report: report ?? undefined,
        lighthouseVersion: report?.lighthouseVersion ?? null,
        completedAt: new Date(),
      },
    });

    return completed;
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "The scan timed out while waiting for the storefront measurement provider. Retry shortly."
        : error instanceof Error
          ? error.message
          : "The scan failed unexpectedly. Please retry.";
    await prisma.performanceScan.update({
      where: { id: scan.id },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    });
    throw new Error(message);
  }
}

export function publicScan(scan: {
  id: string;
  auditRunId?: string | null;
  pageUrl: string;
  template?: string;
  strategy: string;
  status: string;
  performance: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  fieldDataSource?: string | null;
  fieldData?: unknown;
  findings: unknown;
  report?: unknown;
  lighthouseVersion?: string | null;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    ...scan,
    report: readStoredReport(scan.report),
    createdAt: scan.createdAt.toISOString(),
    completedAt: scan.completedAt?.toISOString() || null,
    findings: Array.isArray(scan.findings)
      ? (scan.findings as ScanFinding[])
      : [],
  };
}

export function publicAudit(audit: {
  id: string;
  targetPath: string;
  pageUrl: string;
  template: string;
  strategies: string[];
  status: string;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
  scans: Array<Parameters<typeof publicScan>[0]>;
}) {
  return {
    ...audit,
    createdAt: audit.createdAt.toISOString(),
    completedAt: audit.completedAt?.toISOString() || null,
    scans: audit.scans.map(publicScan),
  };
}
