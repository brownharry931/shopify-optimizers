import { useMemo, useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import prisma from "../db.server";
import { Icon } from "../components/icons";
import {
  Banner,
  Card,
  EmptyState,
  PageHeader,
  Time,
  TrendChart,
  type TrendSeries,
} from "../components/ui";
import {
  ratingForDisplayScore,
  type ReportMetric,
} from "../performance/lighthouse-report";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Read only the small JSON sub-trees (scores + metrics), never screenshots.
  const [access, scans] = await Promise.all([
    getVerifiedSubscription(admin, session.shop),
    prisma.$queryRaw<
      Array<{
        id: string;
        createdAt: Date;
        pageUrl: string;
        template: string;
        strategy: string;
        performance: number | null;
        lcpMs: number | null;
        fieldDataSource: string | null;
        categories: unknown;
        metrics: unknown;
        auditId: string | null;
        targetPath: string | null;
        auditTemplate: string | null;
      }>
    >`
      SELECT s.id, s."createdAt", s."pageUrl", s.template, s.strategy,
             s.performance, s."lcpMs", s."fieldDataSource",
             CASE WHEN s.report->>'version' = '2' THEN s.report->'categories' END AS categories,
             CASE WHEN s.report->>'version' = '2' THEN s.report->'metrics' END AS metrics,
             a.id AS "auditId", a."targetPath", a.template AS "auditTemplate"
      FROM "PerformanceScan" s
      LEFT JOIN "AuditRun" a ON a.id = s."auditRunId"
      WHERE s.shop = ${session.shop} AND s.status = 'COMPLETE'
      ORDER BY s."createdAt" DESC
      LIMIT 120
    `,
  ]);

  const rows = scans.map((scan) => {
    const metrics = Array.isArray(scan.metrics) ? (scan.metrics as ReportMetric[]) : [];
    const categories = Array.isArray(scan.categories)
      ? (scan.categories as Array<{ id: string; score: number | null }>)
      : [];
    const metric = (id: ReportMetric["id"]) =>
      metrics.find((item) => item.id === id) ?? null;
    const category = (id: string) =>
      categories.find((item) => item.id === id)?.score ?? null;
    const lcp = metric("largest-contentful-paint");
    const tbt = metric("total-blocking-time");
    const cls = metric("cumulative-layout-shift");
    let path = scan.targetPath;
    if (!path) {
      try {
        path = new URL(scan.pageUrl).pathname;
      } catch {
        path = scan.pageUrl;
      }
    }
    return {
      id: scan.id,
      auditId: scan.auditId,
      createdAt: scan.createdAt.toISOString(),
      path,
      template: scan.auditTemplate ?? scan.template,
      strategy: scan.strategy,
      performance: scan.performance,
      accessibility: category("accessibility"),
      bestPractices: category("best-practices"),
      seo: category("seo"),
      lcp: lcp
        ? { value: lcp.displayValue, rating: lcp.rating }
        : scan.lcpMs !== null
          ? { value: `${(scan.lcpMs / 1000).toFixed(1)} s`, rating: "informative" as const }
          : null,
      lcpMs: lcp?.numericValue ?? scan.lcpMs,
      tbt: tbt ? { value: tbt.displayValue, rating: tbt.rating } : null,
      cls: cls ? { value: cls.displayValue, rating: cls.rating } : null,
      hasField: Boolean(scan.fieldDataSource),
    };
  });

  return {
    hasAccess: access.isVerified && access.hasActiveSubscription,
    subscriptionVerified: access.isVerified,
    rows,
  };
};

type Row = Awaited<ReturnType<typeof loader>>["rows"][number];

function Delta({ value, unit = "", invert = false }: { value: number | null; unit?: string; invert?: boolean }) {
  if (value === null) return <span className="sb-delta sb-delta-flat">—</span>;
  if (value === 0) return <span className="sb-delta sb-delta-flat">0{unit}</span>;
  const good = invert ? value < 0 : value > 0;
  return (
    <span className={`sb-delta ${good ? "sb-delta-up" : "sb-delta-down"}`}>
      <Icon name={value > 0 ? "arrowUp" : "arrowDown"} size={13} />
      {Math.abs(value).toLocaleString()}
      {unit}
    </span>
  );
}

function ScorePill({ score }: { score: number | null }) {
  return <span className={`sb-scorePill sb-rate-${ratingForDisplayScore(score)}`}>{score ?? "—"}</span>;
}

export default function ReportsPage() {
  const data = useLoaderData<typeof loader>();
  const paths = useMemo(() => Array.from(new Set(data.rows.map((row) => row.path))), [data.rows]);
  const [path, setPath] = useState<string>("all");
  const [device, setDevice] = useState<string>("all");

  const filtered = data.rows.filter(
    (row) => (path === "all" || row.path === path) && (device === "all" || row.strategy === device),
  );

  // Rows are newest-first; compare each with the *older* run of the same page + device.
  const withDelta = filtered.map((row, index) => {
    const previous = filtered
      .slice(index + 1)
      .find((candidate) => candidate.path === row.path && candidate.strategy === row.strategy);
    return {
      row,
      scoreDelta:
        previous && previous.performance !== null && row.performance !== null
          ? row.performance - previous.performance
          : null,
      lcpDelta:
        previous && previous.lcpMs !== null && row.lcpMs !== null
          ? Math.round(row.lcpMs - previous.lcpMs)
          : null,
    };
  });

  const series: TrendSeries[] = (["mobile", "desktop"] as const)
    .filter((strategy) => device === "all" || device === strategy)
    .map((strategy, index) => ({
      name: strategy === "mobile" ? "Mobile" : "Desktop",
      tone: index === 0 ? ("a" as const) : ("b" as const),
      points: filtered
        .filter((row) => row.strategy === strategy && row.performance !== null)
        .map((row) => ({
          x: new Date(row.createdAt).getTime(),
          y: row.performance as number,
          label: `${row.performance} · ${row.path} · ${new Date(row.createdAt).toLocaleString()}`,
        })),
    }))
    .filter((item) => item.points.length > 0);

  const latestMobile = filtered.find((row) => row.strategy === "mobile");
  const latestDesktop = filtered.find((row) => row.strategy === "desktop");
  const scores = filtered.map((row) => row.performance).filter((score): score is number => score !== null);
  const best = scores.length ? Math.max(...scores) : null;
  const oldestComparable = (strategy: string) =>
    [...filtered].reverse().find((row) => row.strategy === strategy && row.performance !== null);
  const firstMobile = oldestComparable("mobile");
  const mobileChange =
    latestMobile && firstMobile && latestMobile.id !== firstMobile.id && latestMobile.performance !== null && firstMobile.performance !== null
      ? latestMobile.performance - firstMobile.performance
      : null;

  return (
    <s-page heading="Performance reports">
      <main className="sb-app">
        <PageHeader
          icon="chart"
          eyebrow="Measured history"
          title="Performance reports"
          description="Every completed PageSpeed run, with score trends and run-over-run changes for the same page and device."
          actions={<Link className="sb-btn sb-btn-primary" to="/app/scan"><Icon name="bolt" size={16} />New audit</Link>}
        />

        {!data.hasAccess ? (
          <Banner tone="warning" title="Reports are locked">
            {!data.subscriptionVerified
              ? "Shopify subscription status is not verified."
              : "An active subscription is required to view reports."}{" "}
            <Link to="/app/billing">View billing</Link>
          </Banner>
        ) : data.rows.length === 0 ? (
          <Card>
            <EmptyState
              icon="chart"
              title="No reports yet"
              action={<Link className="sb-btn sb-btn-primary" to="/app/scan"><Icon name="bolt" size={16} />Run your first audit</Link>}
            >
              Reports fill in automatically after each Speed Audit. Run one now, apply a booster, then run it again to
              see the change. Sample or estimated data is never shown.
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="sb-stats">
              <div className="sb-stat">
                <span><Icon name="mobile" size={15} />Latest mobile</span>
                <strong><ScorePill score={latestMobile?.performance ?? null} /></strong>
                <small>{latestMobile ? <Time value={latestMobile.createdAt} relative /> : "No mobile run"}</small>
              </div>
              <div className="sb-stat">
                <span><Icon name="desktop" size={15} />Latest desktop</span>
                <strong><ScorePill score={latestDesktop?.performance ?? null} /></strong>
                <small>{latestDesktop ? <Time value={latestDesktop.createdAt} relative /> : "No desktop run"}</small>
              </div>
              <div className="sb-stat">
                <span><Icon name="arrowUp" size={15} />Mobile change</span>
                <strong><Delta value={mobileChange} /></strong>
                <small>First vs latest run in view</small>
              </div>
              <div className="sb-stat">
                <span><Icon name="history" size={15} />Runs</span>
                <strong className="sb-num">{filtered.length}</strong>
                <small>Best score {best ?? "—"}</small>
              </div>
            </div>

            <Card
              icon="chart"
              title="Performance score over time"
              subtitle="Lighthouse performance category, 0–100. Compare runs of the same page and device only."
              actions={
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select className="sb-select" value={path} onChange={(event) => setPath(event.target.value)} aria-label="Filter by page" style={{ width: "auto", minWidth: 180 }}>
                    <option value="all">All pages</option>
                    {paths.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <div className="sb-segmented" role="tablist" aria-label="Device">
                    {["all", "mobile", "desktop"].map((item) => (
                      <button key={item} type="button" role="tab" aria-selected={device === item} onClick={() => setDevice(item)}>
                        {item === "all" ? "All" : item === "mobile" ? "Mobile" : "Desktop"}
                      </button>
                    ))}
                  </div>
                </div>
              }
            >
              {series.length ? <TrendChart series={series} /> : <p className="sb-muted">No runs match these filters.</p>}
            </Card>

            <Card icon="history" title="Audit history" subtitle="Lab metrics are shown exactly as Lighthouse reported them. Changes compare with the previous run of the same page and device.">
              <div className="sb-tableWrap">
                <table className="sb-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Page</th>
                      <th scope="col">Device</th>
                      <th scope="col" className="sb-cellNum">Perf.</th>
                      <th scope="col" className="sb-cellNum">Change</th>
                      <th scope="col" className="sb-cellNum">LCP</th>
                      <th scope="col" className="sb-cellNum">LCP change</th>
                      <th scope="col" className="sb-cellNum">TBT</th>
                      <th scope="col" className="sb-cellNum">CLS</th>
                      <th scope="col" className="sb-cellNum">A11y · BP · SEO</th>
                      <th scope="col"><span className="sb-visually-hidden">Open</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {withDelta.map(({ row, scoreDelta, lcpDelta }) => (
                      <HistoryRow key={row.id} row={row} scoreDelta={scoreDelta} lcpDelta={lcpDelta} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="sb-footnote" style={{ marginTop: 12 }}>
                The latest 120 runs are listed and history is kept for 90 days. A score change shows correlation, not
                cause. Lighthouse varies by a few points between identical runs.
              </p>
            </Card>
          </>
        )}
      </main>
    </s-page>
  );
}

function HistoryRow({ row, scoreDelta, lcpDelta }: { row: Row; scoreDelta: number | null; lcpDelta: number | null }) {
  return (
    <tr>
      <td style={{ whiteSpace: "nowrap" }}><Time value={row.createdAt} /></td>
      <td><strong style={{ fontFamily: "var(--sb-mono)", fontSize: 12 }}>{row.path}</strong><span className="sb-cellLabel">{row.template}</span></td>
      <td><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={row.strategy === "mobile" ? "mobile" : "desktop"} size={15} />{row.strategy === "mobile" ? "Mobile" : "Desktop"}</span></td>
      <td className="sb-cellNum"><ScorePill score={row.performance} /></td>
      <td className="sb-cellNum"><Delta value={scoreDelta} /></td>
      <td className={`sb-cellNum sb-text-${row.lcp?.rating ?? "informative"}`}>{row.lcp?.value ?? "—"}</td>
      <td className="sb-cellNum"><Delta value={lcpDelta} unit=" ms" invert /></td>
      <td className={`sb-cellNum sb-text-${row.tbt?.rating ?? "informative"}`}>{row.tbt?.value ?? "—"}</td>
      <td className={`sb-cellNum sb-text-${row.cls?.rating ?? "informative"}`}>{row.cls?.value ?? "—"}</td>
      <td className="sb-cellNum">{[row.accessibility, row.bestPractices, row.seo].map((score) => score ?? "—").join(" · ")}</td>
      <td>
        {row.auditId ? (
          <Link className="sb-btn sb-btn-ghost" to={`/app/scan?audit=${encodeURIComponent(row.auditId)}`} style={{ minHeight: 28, padding: "4px 8px" }}>
            View <Icon name="arrowRight" size={14} />
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
