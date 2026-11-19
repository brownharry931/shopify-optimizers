import { isIP } from "node:net";
import prisma from "../db.server";
import { selectCruxFieldData, type PageSpeedFieldSet } from "./field-data";
import { measureImageSavings } from "./image-savings.server";
import { runPageSpeed } from "./pagespeed-client.server";
import {
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
    const payload = await runPageSpeed<PageSpeedResponse>(pageUrl, strategy);

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
