import { useEffect, useMemo, useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  Link,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import prisma from "../db.server";
import { Icon } from "../components/icons";
import {
  Badge,
  Banner,
  Card,
  EmptyState,
  GaugeLegend,
  LighthouseMarkdown,
  PageHeader,
  RatingShape,
  ScoreGauge,
  Spinner,
  Time,
  formatBytes,
} from "../components/ui";
import type { CruxFieldMetrics } from "../performance/field-data";
import type { ImageSaving } from "../performance/image-savings";
import {
  formatBytesToKiB,
  formatMilliseconds,
  formatNumber,
  pageSpeedWebUrl,
  ratingForDisplayScore,
  type LighthouseReport,
  type Rating,
  type ReportAudit,
  type ReportCell,
  type ReportHeading,
} from "../performance/lighthouse-report";
import { guidanceForFinding } from "../performance/recommendations";
import {
  normalizeTargetPath,
  parseStrategies,
} from "../performance/scan-targets";
import {
  publicAudit,
  runStorefrontScan,
} from "../performance/scan.server";
import { pageSpeedKeyConfigured } from "../performance/pagespeed-client.server";

const MAX_AUDITS_PER_HOUR = 6;
// A completed audit of the same page and devices is reused for this long, so
// repeat clicks never spend Google quota on an identical measurement.
const CACHE_MINUTES = 10;
// A RUNNING audit younger than this blocks a duplicate run of the same page.
const RUNNING_LOCK_MINUTES = 3;

async function primaryDomain(admin: Awaited<ReturnType<typeof authenticate.admin>>["admin"]) {
  const response = await admin.graphql(`#graphql
    query StorefrontAuditTarget { shop { primaryDomain { url } } }
  `);
  const result = await response.json();
  const url = result.data?.shop?.primaryDomain?.url;
  return typeof url === "string" ? url : null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const requestedAudit = new URL(request.url).searchParams.get("audit");
  const [access, audit, origin] = await Promise.all([
    getVerifiedSubscription(admin, session.shop),
    prisma.auditRun.findFirst({
      where: {
        shop: session.shop,
        ...(requestedAudit ? { id: requestedAudit } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { scans: { orderBy: { strategy: "desc" } } },
    }),
    primaryDomain(admin).catch(() => null),
  ]);
  return {
    canScan: access.isVerified && access.hasActiveSubscription,
    pageSpeedKeyConfigured: pageSpeedKeyConfigured(),
    subscriptionVerified: access.isVerified,
    storefrontOrigin: origin,
    latestAudit: audit ? publicAudit(audit) : null,
    viewingHistory: Boolean(requestedAudit),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") !== "scan") {
    return { ok: false as const, error: "Unsupported scan action." };
  }

  const access = await getVerifiedSubscription(admin, session.shop);
  if (!access.isVerified) {
    return {
      ok: false as const,
      error:
        "Shopify billing has not been verified. Auditing remains locked until verification succeeds.",
    };
  }
  if (!access.hasActiveSubscription) {
    return {
      ok: false as const,
      error: "An active Shopify subscription is required before starting an audit.",
    };
  }

  try {
    const target = normalizeTargetPath(form.get("targetPath") ?? "/");
    const strategies = parseStrategies(form.get("strategy"));
    const primaryOrigin = await primaryDomain(admin);
    if (!primaryOrigin) {
      throw new Error("Shopify did not return a primary storefront URL.");
    }

    const pageUrl = new URL(target.targetPath, primaryOrigin).toString();
    const force = form.get("force") === "1";
    const now = Date.now();

    if (!force) {
      const cached = await prisma.auditRun.findFirst({
        where: {
          shop: session.shop,
          pageUrl,
          status: "COMPLETE",
          strategies: { hasEvery: strategies },
          createdAt: { gte: new Date(now - CACHE_MINUTES * 60_000) },
        },
        orderBy: { createdAt: "desc" },
        include: { scans: { orderBy: { strategy: "desc" } } },
      });
      if (cached) {
        return { ok: true as const, error: null, cached: true, audit: publicAudit(cached) };
      }
    }

    const audit = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        // Serialize per shop so concurrent submissions cannot both pass the
        // duplicate and quota checks.
        await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtextextended(${session.shop}, 0))) AS advisory_lock`;
        const running = await tx.auditRun.findFirst({
          where: {
            shop: session.shop,
            pageUrl,
            status: "RUNNING",
            createdAt: { gte: new Date(now - RUNNING_LOCK_MINUTES * 60_000) },
          },
          select: { id: true },
        });
        if (running) {
          throw new Error(
            "An audit of this page is already running. Its result will appear here when it finishes; no second Google request was made.",
          );
        }
        const since = new Date(now - 60 * 60 * 1000);
        const runsInWindow = await tx.auditRun.count({
          where: { shop: session.shop, createdAt: { gte: since } },
        });
        if (runsInWindow >= MAX_AUDITS_PER_HOUR) {
          throw new Error(
            `Audit limit reached: up to ${MAX_AUDITS_PER_HOUR} fresh audits per store each hour. Recent results stay available below.`,
          );
        }
        return tx.auditRun.create({
          data: {
            shop: session.shop,
            targetPath: target.targetPath,
            pageUrl,
            template: target.template,
            strategies,
            status: "RUNNING",
          },
        });
      },
    );

    await Promise.allSettled(
      strategies.map((strategy) =>
        runStorefrontScan(session.shop, primaryOrigin, target.targetPath, strategy, audit.id),
      ),
    );

    const scans = await prisma.performanceScan.findMany({
      where: { shop: session.shop, auditRunId: audit.id },
      select: { status: true, strategy: true, error: true },
    });
    const completedCount = scans.filter((scan) => scan.status === "COMPLETE").length;
    const status =
      completedCount === strategies.length
        ? "COMPLETE"
        : completedCount > 0
          ? "PARTIAL"
          : "FAILED";
    const error =
      status === "COMPLETE"
        ? null
        : scans
            .filter((scan) => scan.status === "FAILED" && scan.error)
            .map((scan) => `${scan.strategy}: ${scan.error}`)
            .join(" ") || "No requested Lighthouse run completed.";
    const updatedAudit = await prisma.auditRun.update({
      where: { id: audit.id },
      data: { status, error, completedAt: new Date() },
      include: { scans: { orderBy: { strategy: "desc" } } },
    });
    return {
      ok: status !== "FAILED",
      error,
      cached: false,
      audit: publicAudit(updatedAudit),
    } as const;
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error ? error.message : "The audit could not be completed. Please retry.",
    };
  }
};

type AuditView = NonNullable<Awaited<ReturnType<typeof loader>>["latestAudit"]>;
type ScanView = AuditView["scans"][number];

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */

// PageSpeed's field-data section shows seconds with one decimal.
function fieldMs(value: number | undefined) {
  if (value === undefined) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

function fieldRating(category: string | undefined): Rating {
  if (category === "FAST") return "pass";
  if (category === "AVERAGE") return "average";
  if (category === "SLOW") return "fail";
  return "informative";
}

function cellText(cell: ReportCell, heading: ReportHeading): { text: string; kind: "num" | "url" | "code" | "text" } {
  if (cell === null || cell === undefined) return { text: "", kind: "text" };
  const valueType = typeof cell === "object" && cell.type ? cell.type : heading.valueType;
  const raw = typeof cell === "object" ? (cell.value ?? cell.url ?? cell.text ?? cell.nodeLabel ?? cell.snippet ?? "") : cell;
  if (typeof raw === "number") {
    if (valueType === "bytes") return { text: formatBytesToKiB(raw, heading.granularity ?? 0.1), kind: "num" };
    if (valueType === "ms" || valueType === "timespanMs") {
      return { text: formatMilliseconds(raw, heading.granularity ?? 10), kind: "num" };
    }
    return { text: formatNumber(raw, heading.granularity ?? 0.1), kind: "num" };
  }
  if (typeof cell === "object" && valueType === "node") {
    return { text: cell.nodeLabel || cell.snippet || cell.selector || "", kind: "code" };
  }
  if (typeof cell === "object" && valueType === "source-location") {
    return { text: `${cell.url ?? ""}${cell.line !== undefined ? `:${cell.line + 1}` : ""}`, kind: "url" };
  }
  if (valueType === "url" || valueType === "thumbnail") return { text: String(raw), kind: "url" };
  if (valueType === "code") return { text: String(raw), kind: "code" };
  return { text: String(raw), kind: "text" };
}

/* ------------------------------------------------------------------ */
/* Report sections                                                     */
/* ------------------------------------------------------------------ */

function AuditTable({ audit }: { audit: ReportAudit }) {
  const headings = audit.headings.filter((heading) => heading.valueType !== "thumbnail");
  if (!headings.length || !audit.items.length) return null;
  return (
    <div className="sb-tableWrap">
      <table className="sb-table">
        <thead>
          <tr>
            {headings.map((heading) => (
              <th
                key={heading.key}
                className={["bytes", "ms", "timespanMs", "numeric"].includes(heading.valueType) ? "sb-cellNum" : undefined}
                scope="col"
              >
                {heading.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {audit.items.map((row, index) => (
            <tr key={index}>
              {headings.map((heading) => {
                const { text, kind } = cellText(row[heading.key], heading);
                const node = row[heading.key];
                const snippet = typeof node === "object" && node && heading.valueType === "node" ? node.snippet : undefined;
                return (
                  <td key={heading.key} className={kind === "num" ? "sb-cellNum" : undefined}>
                    {kind === "url" ? (
                      <span className="sb-cellUrl" title={text}>{text}</span>
                    ) : kind === "code" ? (
                      <>
                        <span className="sb-cellLabel">{text}</span>
                        {snippet && snippet !== text ? <span className="sb-cellCode" title={snippet}>{snippet}</span> : null}
                      </>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {audit.totalItems > audit.items.length ? (
        <p className="sb-tableMore">
          Showing {audit.items.length} of {audit.totalItems} items. The full list is on PageSpeed Insights.
        </p>
      ) : null}
    </div>
  );
}

function AuditRow({ audit }: { audit: ReportAudit }) {
  const guidance = guidanceForFinding(audit.id);
  const savings = Object.keys(audit.metricSavings);
  return (
    <li>
      <details className="sb-audit">
        <summary>
          <RatingShape rating={audit.rating} />
          <span className="sb-auditTitle">
            {audit.title}
            {audit.displayValue ? (
              <em className={`sb-text-${audit.rating}`}>— {audit.displayValue}</em>
            ) : null}
          </span>
          <span className="sb-auditSavings">
            {savings.map((metric) => (
              <span className="sb-chip" key={metric}>{metric}</span>
            ))}
          </span>
          <Icon name="chevronDown" className="sb-chevron" />
        </summary>
        <div className="sb-auditBody">
          <p><LighthouseMarkdown text={audit.description} /></p>
          <AuditTable audit={audit} />
          <div className="sb-guidance">
            <strong>{guidance.area} · what to do in SpeedBoost</strong>
            <span>{guidance.nextStep}</span>
            <span className="sb-muted">{guidance.automation}</span>
          </div>
        </div>
      </details>
    </li>
  );
}

function ImageSavings({ report }: { report: LighthouseReport }) {
  const savings = report.imageSavings ?? [];
  const optimized = savings.filter((item): item is ImageSaving & { beforeBytes: number; afterBytes: number } =>
    item.status === "optimized" && item.beforeBytes !== null && item.afterBytes !== null,
  );
  if (!report.images.length) return null;
  const before = optimized.reduce((sum, item) => sum + item.beforeBytes, 0);
  const after = optimized.reduce((sum, item) => sum + item.afterBytes, 0);
  const others = savings.filter((item) => item.status !== "optimized");

  return (
    <Card
      icon="image"
      title="Image optimization · before and after"
      subtitle="Images flagged by this Lighthouse run, with the actual bytes downloaded from Shopify's CDN today and the bytes of a correctly sized variant, both requested as Chrome would."
    >
      {optimized.length ? (
        <>
          <div className="sb-totals">
            <div className="sb-stat"><span>Before</span><strong className="sb-num">{formatBytes(before)}</strong><small>{optimized.length} image{optimized.length === 1 ? "" : "s"}</small></div>
            <div className="sb-stat"><span>After</span><strong className="sb-num">{formatBytes(after)}</strong><small>Right-sized CDN variants</small></div>
            <div className="sb-stat"><span>Saved</span><strong className="sb-num sb-text-pass">{before ? Math.round((1 - after / before) * 100) : 0}%</strong><small>{formatBytes(before - after)} less to download</small></div>
          </div>
          <div className="sb-imageList">
            {optimized.map((item) => (
              <article className="sb-imageRow" key={item.url}>
                <div className="sb-imageSide">
                  <div className="sb-thumb"><img src={item.url} alt="" loading="lazy" decoding="async" /></div>
                  <div>
                    <small>Before</small>
                    <strong>{formatBytes(item.beforeBytes)}</strong>
                    <small>{item.beforeWidth ? `${item.beforeWidth}px wide` : ""}{item.beforeFormat ? ` · ${item.beforeFormat}` : ""}</small>
                  </div>
                </div>
                <div className="sb-imageArrow"><Icon name="arrowRight" /></div>
                <div className="sb-imageSide">
                  <div className="sb-thumb"><img src={item.afterUrl ?? item.url} alt="" loading="lazy" decoding="async" /></div>
                  <div>
                    <small>After</small>
                    <strong>{formatBytes(item.afterBytes)}</strong>
                    <small>{item.afterWidth ? `${item.afterWidth}px wide` : ""}{item.afterFormat ? ` · ${item.afterFormat}` : ""}</small>
                  </div>
                </div>
                <div className="sb-saving">
                  <strong>−{Math.round((1 - item.afterBytes / item.beforeBytes) * 100)}%</strong>
                  <small>{formatBytes(item.beforeBytes - item.afterBytes)} saved</small>
                </div>
                <div className="sb-imageUrl" title={item.url}>{item.url}</div>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {others.length || !savings.length ? (
        <div className="sb-tableWrap" style={{ marginTop: optimized.length ? 14 : 0 }}>
          <table className="sb-table">
            <thead>
              <tr>
                <th scope="col">Image</th>
                <th scope="col" className="sb-cellNum">Transfer size</th>
                <th scope="col" className="sb-cellNum">Lighthouse est. savings</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {(savings.length ? others : report.images.map((image) => ({
                url: image.url,
                lighthouseBytes: image.totalBytes,
                lighthouseWastedBytes: image.wastedBytes,
                reason: "Measured savings are recorded for new audits.",
              }))).map((item) => (
                <tr key={item.url}>
                  <td><span className="sb-cellUrl" title={item.url}>{item.url}</span></td>
                  <td className="sb-cellNum">{item.lighthouseBytes !== null ? formatBytesToKiB(item.lighthouseBytes) : "—"}</td>
                  <td className="sb-cellNum">{item.lighthouseWastedBytes !== null ? formatBytesToKiB(item.lighthouseWastedBytes) : "—"}</td>
                  <td className="sb-muted">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="sb-footnote" style={{ marginTop: 12 }}>
        To serve the smaller version, the theme must request it: use <Link to="/app/optimize">Theme optimizer</Link> for
        lazy loading and responsive <code>image_url</code> widths, or ask your theme developer to add a matching{" "}
        <code>srcset</code>. Re-run the audit afterwards to confirm the gain.
      </p>
    </Card>
  );
}

function FieldData({ scan, report }: { scan: ScanView; report: LighthouseReport | null }) {
  const field = scan.fieldData as CruxFieldMetrics | null | undefined;
  if (!field || !scan.fieldDataSource) {
    return (
      <Card icon="chart" title="Discover what your real users are experiencing" subtitle="Chrome UX Report (CrUX) · 28-day collection period">
        <p className="sb-muted">
          There is insufficient real-user data for this URL and origin. PageSpeed Insights shows the same message for
          stores with low Chrome traffic. Values are never estimated.
        </p>
      </Card>
    );
  }
  const core = [field.lcpCategory, field.inpCategory, field.clsCategory].filter(Boolean);
  const passed = core.length >= 2 && core.every((category) => category === "FAST");
  const metrics = [
    { name: "Largest Contentful Paint (LCP)", value: fieldMs(field.lcpP75Ms), rating: fieldRating(field.lcpCategory), core: true },
    { name: "Interaction to Next Paint (INP)", value: fieldMs(field.inpP75Ms), rating: fieldRating(field.inpCategory), core: true },
    { name: "Cumulative Layout Shift (CLS)", value: field.clsP75 === undefined ? "—" : field.clsP75.toFixed(2), rating: fieldRating(field.clsCategory), core: true },
    { name: "First Contentful Paint (FCP)", value: fieldMs(field.fcpP75Ms), rating: fieldRating(field.fcpCategory), core: false },
    { name: "Time to First Byte (TTFB)", value: fieldMs(field.ttfbP75Ms), rating: fieldRating(field.ttfbCategory), core: false },
  ];
  return (
    <Card
      icon="chart"
      title="Discover what your real users are experiencing"
      subtitle={`${scan.fieldDataSource === "URL" ? "This URL" : "Origin (whole store)"} · Chrome UX Report · 75th percentile over 28 days`}
    >
      <div className="sb-assessment">
        Core Web Vitals Assessment:
        <Badge tone={passed ? "success" : "critical"} icon={passed ? "checkCircle" : "alert"}>
          {passed ? "Passed" : "Failed"}
        </Badge>
        {report?.fieldOverall ? <span className="sb-muted" style={{ fontWeight: 500, fontSize: 12.5 }}>Overall: {report.fieldOverall.toLowerCase()}</span> : null}
      </div>
      <div className="sb-field-data">
        {metrics.map((metric) => (
          <div className="sb-fieldMetric" key={metric.name}>
            <span><RatingShape rating={metric.rating} />{metric.name}</span>
            <strong className={`sb-text-${metric.rating}`}>{metric.value}</strong>
            <small>{metric.core ? "Core Web Vital" : "Other notable metric"}</small>
          </div>
        ))}
      </div>
    </Card>
  );
}

function LegacyScan({ scan }: { scan: ScanView }) {
  return (
    <Card title="Earlier audit format" subtitle="This run predates full Lighthouse report storage. Run a new audit to see the complete PageSpeed view.">
      <div className="sb-perfLead">
        <ScoreGauge score={scan.performance} label="Performance" size={110} />
      </div>
    </Card>
  );
}

function ScanReport({ scan, pageUrl }: { scan: ScanView; pageUrl: string }) {
  const report = scan.report;
  if (scan.status !== "COMPLETE") {
    return (
      <Banner tone="critical" title={`${scan.strategy === "mobile" ? "Mobile" : "Desktop"} run did not complete`}>
        {scan.error || scan.status}
      </Banner>
    );
  }
  if (!report) return <LegacyScan scan={scan} />;

  const performance = report.categories.find((category) => category.id === "performance");
  const groupOrder: string[] = [];
  const byGroup = new Map<string, ReportAudit[]>();
  for (const audit of report.audits) {
    const group = audit.group ?? "diagnostics";
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      groupOrder.push(group);
    }
    byGroup.get(group)!.push(audit);
  }

  return (
    <div className="sb-grid">
      <Card>
        <div className="sb-categoryRow">
          {report.categories.map((category) => (
            <ScoreGauge key={category.id} score={category.score} label={category.title} size={84} />
          ))}
        </div>
        <hr className="sb-divider" style={{ marginTop: 0 }} />
        <div className="sb-perfSummary">
          <div>
            <div className="sb-perfLead">
              <ScoreGauge score={performance?.score ?? scan.performance} size={128} />
              <h3>Performance</h3>
              <p>
                Values are estimated and may vary. The performance score is calculated directly from these metrics.{" "}
                <a href="https://developer.chrome.com/docs/lighthouse/performance/performance-scoring/" target="_blank" rel="noreferrer">
                  See calculator.
                </a>
              </p>
              <GaugeLegend />
            </div>
            <div className="sb-sectionLabel">
              Metrics
              <small>Lighthouse {report.lighthouseVersion ?? ""}</small>
            </div>
            <div className="sb-metrics">
              {report.metrics.map((metric) => (
                <div className="sb-metric" key={metric.id}>
                  <span className="sb-metricName"><RatingShape rating={metric.rating} />{metric.title}</span>
                  <span className={`sb-metricValue sb-text-${metric.rating}`}>{metric.displayValue}</span>
                </div>
              ))}
            </div>
          </div>
          {report.screenshot ? (
            <div className="sb-screenshot">
              <img src={report.screenshot} alt={`Final rendered ${scan.strategy} screenshot of ${pageUrl}`} />
            </div>
          ) : null}
        </div>
        {report.filmstrip.length ? (
          <>
            <div className="sb-sectionLabel">Page load filmstrip</div>
            <div className="sb-filmstrip">
              {report.filmstrip.map((frame) => (
                <figure key={frame.timing}>
                  <img src={frame.data} alt="" loading="lazy" />
                  <figcaption>{(frame.timing / 1000).toFixed(1)} s</figcaption>
                </figure>
              ))}
            </div>
          </>
        ) : null}
        <div className="sb-runMeta">
          <div><Icon name="clock" size={16} /><span>Captured <Time value={report.fetchTime ?? scan.createdAt} /></span></div>
          <div><Icon name={scan.strategy === "mobile" ? "mobile" : "desktop"} size={16} /><span>{report.device} with Lighthouse {report.lighthouseVersion}</span></div>
          <div><Icon name="timer" size={16} /><span>{report.network} · single page session</span></div>
        </div>
        {report.runWarnings.length ? (
          <div style={{ marginTop: 14 }}>
            <Banner tone="warning" title="Lighthouse run warnings">
              {report.runWarnings.map((warning) => <div key={warning}>{warning}</div>)}
            </Banner>
          </div>
        ) : null}
      </Card>

      <FieldData scan={scan} report={report} />

      <Card
        icon="gauge"
        title="Diagnose performance issues"
        subtitle={`${report.audits.length} item${report.audits.length === 1 ? "" : "s"} to review · ${report.passedAudits.length} passed audits. Titles and values are exactly as reported by Lighthouse.`}
      >
        {groupOrder.length === 0 ? (
          <p className="sb-muted">Lighthouse did not flag any performance issues on this run.</p>
        ) : (
          groupOrder.map((group) => (
            <div key={group}>
              <div className="sb-sectionLabel">{report.groups[group] ?? group}<small>{byGroup.get(group)!.length}</small></div>
              <ul className="sb-audits">
                {byGroup.get(group)!.map((audit) => <AuditRow key={audit.id} audit={audit} />)}
              </ul>
            </div>
          ))
        )}
        {report.passedAudits.length ? (
          <details className="sb-audit" style={{ marginTop: 14, borderBottom: 0 }}>
            <summary>
              <RatingShape rating="pass" />
              <span className="sb-auditTitle">Passed audits ({report.passedAudits.length})</span>
              <span />
              <Icon name="chevronDown" className="sb-chevron" />
            </summary>
            <ul className="sb-audits" style={{ marginLeft: 26 }}>
              {report.passedAudits.map((audit) => (
                <li key={audit.id} className="sb-audit" style={{ padding: "9px 0", fontSize: 13 }}>
                  {audit.title}
                  {audit.displayValue ? <span className="sb-text-pass"> — {audit.displayValue}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      <ImageSavings report={report} />
    </div>
  );
}

const STEPS = [
  { label: "Requesting Lighthouse", at: 0 },
  { label: "Loading page on device", at: 6 },
  { label: "Scoring metrics", at: 28 },
  { label: "Measuring images", at: 48 },
];

function ScanProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const active = STEPS.reduce((index, step, i) => (elapsed >= step.at ? i : index), 0);
  return (
    <Card>
      <div className="sb-progress" aria-live="polite">
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner /> Running Google Lighthouse on your storefront…</strong>
          <span className="sb-muted sb-num">{elapsed}s · usually 20–60s per device</span>
        </div>
        <div className="sb-progressBar"><span /></div>
        <ol className="sb-steps">
          {STEPS.map((step, index) => (
            <li key={step.label} data-state={index < active ? "done" : index === active ? "active" : "todo"}>
              <Icon name={index < active ? "checkCircle" : index === active ? "loader" : "clock"} size={16} className={index === active ? "sb-spin" : undefined} />
              {step.label}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

export default function ScanPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting" && navigation.formData?.get("intent") === "scan";
  const audit = (actionData && "audit" in actionData ? actionData.audit : null) ?? data.latestAudit;
  const scans = useMemo(() => audit?.scans ?? [], [audit]);
  const [tab, setTab] = useState<string | null>(null);
  const selected = scans.find((scan) => scan.id === tab) ?? scans.find((scan) => scan.status === "COMPLETE") ?? scans[0];
  const host = data.storefrontOrigin ? new URL(data.storefrontOrigin).host : "your-store.com";

  return (
    <s-page heading="Speed Audit">
      <main className="sb-app">
        <PageHeader
          icon="gauge"
          eyebrow="Google PageSpeed Insights · Lighthouse"
          title="Speed audit"
          description="Runs the same Lighthouse engine and settings as pagespeed.web.dev against your live storefront, then shows the report exactly as Lighthouse wrote it."
          actions={
            audit ? (
              <a className="sb-btn sb-btn-secondary" href={pageSpeedWebUrl(audit.pageUrl, selected?.strategy ?? "mobile")} target="_blank" rel="noreferrer">
                Open in PageSpeed Insights <Icon name="external" size={15} />
              </a>
            ) : null
          }
        />

        {!data.pageSpeedKeyConfigured ? (
          <Banner tone="warning" title="This server has no Google PageSpeed API key">
            The app process serving this page does not have <code>GOOGLE_PAGESPEED_API_KEY</code>, so audits fall back to
            Google&apos;s shared anonymous quota, which is usually exhausted. The key must be set where this server runs:
            on Render for the deployed app, or in a local <code>.env</code> file (or Codespaces secret) for{" "}
            <code>shopify app dev</code>. Restart the server after adding it.
          </Banner>
        ) : null}

        {!data.canScan ? (
          <Banner tone="warning" title="Auditing is locked">
            {!data.subscriptionVerified
              ? "Subscription status is not verified with Shopify yet."
              : "An active SpeedBoost subscription is required to run an audit."}{" "}
            <Link to="/app/billing">View billing</Link>
          </Banner>
        ) : null}

        <Card title="New audit" icon="play" subtitle="Choose any page of your online store. Mobile is what Google uses for ranking signals.">
          <Form method="post" className="sb-scanForm">
            <input type="hidden" name="intent" value="scan" />
            <div className="sb-field">
              <label className="sb-label" htmlFor="targetPath">Page</label>
              <div className="sb-inputGroup">
                <span className="sb-inputPrefix" title={host}><Icon name="store" size={15} /><span>{host}</span></span>
                <input
                  id="targetPath"
                  name="targetPath"
                  type="text"
                  defaultValue={audit?.targetPath ?? "/"}
                  maxLength={250}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="/products/handle"
                  required
                />
              </div>
            </div>
            <div className="sb-field">
              <span className="sb-label" id="device-label">Device</span>
              <div className="sb-segmented" role="radiogroup" aria-labelledby="device-label">
                <label><input type="radio" name="strategy" value="mobile" defaultChecked /><Icon name="mobile" size={15} />Mobile</label>
                <label><input type="radio" name="strategy" value="desktop" /><Icon name="desktop" size={15} />Desktop</label>
                <label><input type="radio" name="strategy" value="both" /><Icon name="devices" size={15} />Both</label>
              </div>
            </div>
            <button className="sb-btn sb-btn-primary sb-btn-lg" type="submit" disabled={!data.canScan || busy}>
              {busy ? <><Spinner /> Analyzing…</> : <><Icon name="bolt" size={16} /> Analyze</>}
            </button>
          </Form>
          <p className="sb-help" style={{ marginTop: 10 }}>
            Supported pages: <code>/</code>, <code>/products/…</code>, <code>/collections/…</code>, <code>/pages/…</code>,{" "}
            <code>/blogs/…/…</code>. Up to {MAX_AUDITS_PER_HOUR} audits per hour.
          </p>
        </Card>

        {actionData && !actionData.ok && !("audit" in actionData && actionData.audit) ? (
          <Banner tone="critical" title="The audit could not run">{actionData.error}</Banner>
        ) : null}

        {busy ? <ScanProgress /> : null}

        {!busy && audit ? (
          <>
            <Card>
              <div className="sb-cardHead" style={{ marginBottom: scans.length > 1 ? 12 : 0 }}>
                <div className="sb-cardHeadText">
                  <h2 className="sb-cardTitle" style={{ overflowWrap: "anywhere" }}>{audit.pageUrl}</h2>
                  <p className="sb-cardSubtitle">
                    {data.viewingHistory ? "Saved report from " : "Latest audit · "}<Time value={audit.createdAt} /> · {audit.template} template
                  </p>
                </div>
                <Badge tone={audit.status === "COMPLETE" ? "success" : audit.status === "PARTIAL" ? "warning" : "critical"}>
                  {audit.status === "COMPLETE" ? "Complete" : audit.status === "PARTIAL" ? "Partially complete" : audit.status === "RUNNING" ? "Running" : "Failed"}
                </Badge>
              </div>
              {scans.length > 1 ? (
                <div className="sb-segmented" role="tablist" aria-label="Device">
                  {scans.map((scan) => (
                    <button
                      key={scan.id}
                      type="button"
                      role="tab"
                      aria-selected={scan.id === selected?.id}
                      onClick={() => setTab(scan.id)}
                    >
                      <Icon name={scan.strategy === "mobile" ? "mobile" : "desktop"} size={15} />
                      {scan.strategy === "mobile" ? "Mobile" : "Desktop"}
                      {scan.status === "COMPLETE" ? (
                        <span className={`sb-scorePill sb-rate-${ratingForDisplayScore(scan.performance)}`} style={{ minWidth: 30, padding: "0 6px", fontSize: 12 }}>
                          {scan.performance}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </Card>
            {actionData && "cached" in actionData && actionData.cached ? (
              <Banner tone="info" title="Showing the audit from a few minutes ago">
                This page and device were audited <Time value={audit.createdAt} relative />, so the saved result is shown
                instead of spending Google quota on an identical measurement.
                <Form method="post" style={{ marginTop: 8 }}>
                  <input type="hidden" name="intent" value="scan" />
                  <input type="hidden" name="force" value="1" />
                  <input type="hidden" name="targetPath" value={audit.targetPath} />
                  <input type="hidden" name="strategy" value={audit.strategies.length > 1 ? "both" : audit.strategies[0]} />
                  <button type="submit" className="sb-btn sb-btn-secondary" disabled={!data.canScan || busy}>
                    <Icon name="refresh" size={15} /> Run a fresh audit anyway
                  </button>
                </Form>
              </Banner>
            ) : null}
            {selected?.report?.passwordProtected ? (
              <Banner tone="warning" title="Lighthouse measured your password page">
                The storefront is password-protected, so Google was redirected to <code>/password</code> and these scores
                describe that page, not your real storefront. Remove the password (Online Store → Preferences) to audit
                the actual pages.
              </Banner>
            ) : null}
            {selected ? <ScanReport scan={selected} pageUrl={audit.pageUrl} /> : null}
            <Banner tone="info" title="Why a new run on pagespeed.web.dev can differ by a few points">
              Every Lighthouse run is a fresh measurement, so network and server timing make scores move by a few points
              between runs. That is true on PageSpeed Insights itself. Every score, metric value and audit title above is
              copied unchanged from this run&apos;s Lighthouse report. Nothing is recalculated or reworded.
            </Banner>
          </>
        ) : null}

        {!busy && !audit ? (
          <Card>
            <EmptyState icon="gauge" title="No audits yet">
              Run your first audit above. Results include the four Lighthouse category scores, Core Web Vitals,
              screenshots, real-user CrUX data and measured image savings.
            </EmptyState>
          </Card>
        ) : null}
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
