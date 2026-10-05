import { isIP } from "node:net";
import prisma from "../db.server";

const MAX_SCANS_PER_HOUR = 3;
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
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, LighthouseAudit>;
  };
};

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
    return "Google PageSpeed is rate-limiting scans right now. Wait a few minutes and retry.";
  }
  if (/lighthouse|FAILED_DOCUMENT_REQUEST|NOT_HTML/i.test(message)) {
    return "PageSpeed could not load the storefront. Check that the store is published and publicly reachable, then retry.";
  }
  return "The storefront scan provider could not complete this scan. Please retry shortly.";
}

export async function runStorefrontScan(shop: string, storefrontUrl: string) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    throw new Error(
      "The authenticated Shopify domain is not valid for scanning.",
    );
  }

  let target: URL;
  try {
    target = new URL(storefrontUrl);
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

  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const scansInWindow = await prisma.performanceScan.count({
    where: { shop, createdAt: { gte: since } },
  });
  if (scansInWindow >= MAX_SCANS_PER_HOUR) {
    throw new Error(
      "Scan limit reached: up to three scans per store each hour.",
    );
  }

  const pageUrl = `${target.origin}/`;
  const scan = await prisma.performanceScan.create({
    data: { shop, pageUrl, strategy: "mobile" },
  });

  try {
    const endpoint = new URL(
      "https://www.googleapis.com/pagespeedonline/v5/runPagespeed",
    );
    endpoint.searchParams.set("url", pageUrl);
    endpoint.searchParams.set("strategy", "mobile");
    endpoint.searchParams.append("category", "performance");
    if (process.env.GOOGLE_PAGESPEED_API_KEY?.trim()) {
      endpoint.searchParams.set(
        "key",
        process.env.GOOGLE_PAGESPEED_API_KEY.trim(),
      );
    }

    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(75_000),
    });
    const payload = (await response.json()) as PageSpeedResponse;
    if (!response.ok || payload.error) {
      const providerMessage =
        payload.error?.message || `HTTP ${response.status}`;
      throw new Error(explainProviderError(providerMessage));
    }

    const lighthouse = payload.lighthouseResult;
    const audits = lighthouse?.audits;
    const score = lighthouse?.categories?.performance?.score;
    if (!audits || typeof score !== "number") {
      throw new Error(
        "The scan provider returned an incomplete Lighthouse report.",
      );
    }

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
        findings,
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
  pageUrl: string;
  strategy: string;
  status: string;
  performance: number | null;
  lcpMs: number | null;
  tbtMs: number | null;
  cls: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  findings: unknown;
  error: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    ...scan,
    createdAt: scan.createdAt.toISOString(),
    completedAt: scan.completedAt?.toISOString() || null,
    findings: Array.isArray(scan.findings)
      ? (scan.findings as ScanFinding[])
      : [],
  };
}
