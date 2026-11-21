import { useMemo, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import { readStoredReport } from "../performance/lighthouse-report";
import {
  listThemes,
  runThemeAudit,
  validateThemeId,
  type ThemeSummary,
} from "../optimization/theme-audit.server";
import { CATEGORY_LABEL, type Category, type Finding, type Severity } from "../optimization/theme-audit";
import { Icon, type IconName } from "../components/icons";
import {
  Badge,
  Banner,
  Card,
  CodeBlock,
  EmptyState,
  GaugeLegend,
  PageHeader,
  RatingShape,
  ScoreGauge,
  Spinner,
  Time,
  formatBytes,
} from "../components/ui";

/**
 * Theme audit — strictly read-only (read_themes). SpeedBoost never writes theme
 * files (Shopify App Store requirement 5.1.1); it explains each fix so the
 * merchant or their developer can apply it.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await getVerifiedSubscription(admin, session.shop);
  const canAudit = access.isVerified && access.hasActiveSubscription;
  const [themes, latestScan] = await Promise.all([
    canAudit
      ? listThemes(admin).catch((error: unknown) => (error instanceof Error ? error.message : "Themes could not be read."))
      : Promise.resolve([] as ThemeSummary[]),
    prisma.performanceScan.findFirst({
      where: { shop: session.shop, status: "COMPLETE" },
      orderBy: { createdAt: "desc" },
      select: { auditRunId: true, report: true, pageUrl: true, strategy: true, performance: true, createdAt: true },
    }),
  ]);
  const report = latestScan ? readStoredReport(latestScan.report) : null;
  return {
    shop: session.shop,
    canAudit,
    subscriptionVerified: access.isVerified,
    themes: typeof themes === "string" ? [] : themes,
    themeError: typeof themes === "string" ? themes : null,
    latestScan: latestScan
      ? {
          auditRunId: latestScan.auditRunId,
          pageUrl: latestScan.pageUrl,
          strategy: latestScan.strategy,
          performance: latestScan.performance,
          createdAt: latestScan.createdAt.toISOString(),
          categories: report?.categories ?? [],
          metrics: report?.metrics ?? [],
        }
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const access = await getVerifiedSubscription(admin, session.shop);
  if (!access.isVerified || !access.hasActiveSubscription) {
    return { ok: false as const, intent: "error" as const, error: "An active SpeedBoost plan is required for theme audits." };
  }
  const form = await request.formData();
  const intent = form.get("intent");
  try {
    const themeId = validateThemeId(form.get("themeId"));
    if (intent === "audit") {
      return { ok: true as const, intent: "audit" as const, audit: await runThemeAudit(admin, themeId) };
    }
    return { ok: false as const, intent: "error" as const, error: "Unsupported action." };
  } catch (error) {
    return {
      ok: false as const,
      intent: "error" as const,
      error: error instanceof Error ? error.message : "The theme audit could not run. Please try again.",
    };
  }
};

const SEVERITY_TONE: Record<Severity, "critical" | "warning" | "info"> = {
  high: "critical",
  medium: "warning",
  low: "info",
};
const SEVERITY_LABEL: Record<Severity, string> = { high: "High impact", medium: "Medium impact", low: "Low impact" };
const CATEGORY_ICON: Record<Category, IconName> = {
  javascript: "code",
  css: "layers",
  images: "image",
  fonts: "font",
  cleanup: "stack",
};

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <li>
      <details className="sb-finding">
        <summary>
          <span className={`sb-listIcon sb-sev-${finding.severity}`}><Icon name={CATEGORY_ICON[finding.category]} size={17} /></span>
          <span className="sb-findingHead">
            <strong>{finding.title}</strong>
            <span className="sb-findingMeta">
              <Badge tone={SEVERITY_TONE[finding.severity]}>{SEVERITY_LABEL[finding.severity]}</Badge>
              <code>{finding.file}{finding.line ? `:${finding.line}` : ""}</code>
              {finding.bytes ? (
                <span className="sb-chip">{formatBytes(finding.bytes.before)} → {formatBytes(finding.bytes.after)}</span>
              ) : null}
            </span>
          </span>
          <Icon name="chevronDown" className="sb-chevron" />
        </summary>
        <div className="sb-findingBody">
          <div>
            <h4>Why this matters</h4>
            <p>{finding.why}</p>
          </div>
          {finding.bytes ? (
            <div className="sb-sizeCompare" aria-label="File size before and after">
              <div><span>Now</span><strong>{formatBytes(finding.bytes.before)}</strong><i style={{ width: "100%" }} /></div>
              <div>
                <span>Minified</span><strong className="sb-text-pass">{formatBytes(finding.bytes.after)}</strong>
                <i className="sb-barGood" style={{ width: `${Math.max(4, (finding.bytes.after / finding.bytes.before) * 100)}%` }} />
              </div>
            </div>
          ) : null}
          <div>
            <h4>What you can do</h4>
            <ol className="sb-steps-list">
              {finding.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
          {finding.resolution.type === "booster" ? (
            <div className="sb-cardActions">
              <Link className="sb-btn sb-btn-primary" to="/app/speed">
                <Icon name="bolt" size={15} /> Turn on “{finding.resolution.label}”
              </Link>
            </div>
          ) : finding.resolution.type === "settings" ? (
            <div className="sb-cardActions">
              <Link className="sb-btn sb-btn-secondary" to="/app/images">
                <Icon name="image" size={15} /> Open Image compressor
              </Link>
            </div>
          ) : finding.current || finding.fix ? (
            <details className="sb-techDetail">
              <summary>Technical detail for your theme developer</summary>
              <div className="sb-grid" style={{ gap: 10, marginTop: 10 }}>
                <p className="sb-help">
                  Location: <code>{finding.file}{finding.line ? `, line ${finding.line}` : ""}</code>. SpeedBoost doesn&apos;t
                  change theme code; this is information for whoever maintains your theme.
                </p>
                {finding.current ? <CodeBlock code={finding.current} label="Found in the theme" tone="muted" copyable={false} /> : null}
                {finding.fix ? <CodeBlock code={finding.fix} label="Suggested change" copyable={false} /> : null}
              </div>
            </details>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export default function ThemeAuditPage() {
  const data = useLoaderData<typeof loader>();
  const auditFetcher = useFetcher<typeof action>();
  const [themeId, setThemeId] = useState<string>(data.themes[0]?.id ?? "");
  const [filter, setFilter] = useState<Category | "all">("all");
  const running = auditFetcher.state !== "idle";
  const audit = auditFetcher.data?.ok && auditFetcher.data.intent === "audit" ? auditFetcher.data.audit : null;
  const auditError = auditFetcher.data && !auditFetcher.data.ok ? auditFetcher.data.error : null;

  const counts = useMemo(() => {
    const result = { high: 0, medium: 0, low: 0 } as Record<Severity, number>;
    for (const finding of audit?.findings ?? []) result[finding.severity] += 1;
    return result;
  }, [audit]);
  const categories = useMemo(
    () => Array.from(new Set((audit?.findings ?? []).map((finding) => finding.category))),
    [audit],
  );
  const visible = (audit?.findings ?? []).filter((finding) => filter === "all" || finding.category === filter);
  const savings = (audit?.findings ?? []).reduce((sum, finding) => sum + (finding.bytes ? finding.bytes.before - finding.bytes.after : 0), 0);
  const scan = data.latestScan;

  return (
    <s-page heading="Theme audit">
      <main className="sb-app">
        <PageHeader
          icon="code"
          eyebrow="Read-only · your theme is never changed"
          title="Theme audit"
          description="SpeedBoost reads your theme and explains, in plain language, what slows it down. Many findings can be fixed with a Speed booster in one click; the rest are reported for your theme developer or theme provider."
          actions={
            <>
              <Link className="sb-btn sb-btn-secondary" to="/app/speed"><Icon name="bolt" size={16} />Speed boosters</Link>
              <Link className="sb-btn sb-btn-primary" to="/app/scan"><Icon name="gauge" size={16} />Run a speed audit</Link>
            </>
          }
        />

        {scan ? (
          <Card
            icon="gauge"
            title="Where your store stands"
            subtitle={<>Latest {scan.strategy} PageSpeed run · <Time value={scan.createdAt} /></>}
            actions={scan.auditRunId ? <Link className="sb-btn sb-btn-ghost" to={`/app/scan?audit=${scan.auditRunId}`}>Full report <Icon name="arrowRight" size={14} /></Link> : null}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 24, justifyContent: "space-around", alignItems: "center" }}>
              {scan.categories.length ? (
                scan.categories.map((category) => (
                  <ScoreGauge key={category.id} score={category.score} label={category.title} size={category.id === "performance" ? 104 : 72} />
                ))
              ) : (
                <ScoreGauge score={scan.performance} label="Performance" size={104} />
              )}
            </div>
            <GaugeLegend />
            {scan.metrics.length ? (
              <div className="sb-metrics" style={{ marginTop: 8 }}>
                {scan.metrics.map((metric) => (
                  <div className="sb-metric" key={metric.id}>
                    <span className="sb-metricName"><RatingShape rating={metric.rating} />{metric.title}</span>
                    <span className={`sb-metricValue sb-text-${metric.rating}`}>{metric.displayValue}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        ) : null}

        {!data.canAudit ? (
          <Banner tone="warning" title="Theme audit is locked">
            {data.subscriptionVerified ? "An active SpeedBoost plan is required." : "Your subscription couldn't be verified yet."}{" "}
            <Link to="/app/billing">View billing</Link>
          </Banner>
        ) : data.themeError ? (
          <Banner tone="critical" title="Themes couldn't be loaded">{data.themeError}</Banner>
        ) : (
          <Card icon="store" title="1. Choose a theme" subtitle="Audit your live theme, or a draft you're preparing. Nothing is modified.">
            {data.themes.length === 0 ? (
              <p className="sb-muted">No themes were found in this store.</p>
            ) : (
              <auditFetcher.Form method="post">
                <input type="hidden" name="intent" value="audit" />
                <div className="sb-themePicker" role="radiogroup" aria-label="Theme">
                  {data.themes.map((theme) => (
                    <label key={theme.id} className="sb-themeOption" data-selected={theme.id === themeId}>
                      <input type="radio" name="themeId" value={theme.id} checked={theme.id === themeId} onChange={() => setThemeId(theme.id)} />
                      <span className="sb-themeName">{theme.name}</span>
                      {theme.role === "MAIN" ? <Badge tone="success">Live</Badge> : <Badge tone="neutral">{theme.role === "DEVELOPMENT" ? "Development" : "Draft"}</Badge>}
                    </label>
                  ))}
                </div>
                <div style={{ marginTop: 14 }}>
                  <button type="submit" className="sb-btn sb-btn-primary sb-btn-lg" disabled={!themeId || running}>
                    {running ? <><Spinner /> Reading theme files…</> : <><Icon name="play" size={16} /> Run theme audit</>}
                  </button>
                </div>
              </auditFetcher.Form>
            )}
          </Card>
        )}

        {auditError ? <Banner tone="critical" title="The audit couldn't run">{auditError}</Banner> : null}

        {running ? (
          <Card>
            <div className="sb-progress" aria-live="polite">
              <strong style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner /> Reading your theme and measuring files…</strong>
              <div className="sb-progressBar"><span /></div>
              <p className="sb-help">Large themes can take 10–30 seconds. Your theme is only read, never changed.</p>
            </div>
          </Card>
        ) : null}

        {audit && !running ? (
          <>
            <div className="sb-stats">
              <div className="sb-stat"><span><span className="sb-dot sb-dot-high" />High impact</span><strong className="sb-num">{counts.high}</strong><small>Fix these first</small></div>
              <div className="sb-stat"><span><span className="sb-dot sb-dot-medium" />Medium impact</span><strong className="sb-num">{counts.medium}</strong><small>Worth fixing</small></div>
              <div className="sb-stat"><span><span className="sb-dot sb-dot-low" />Low impact</span><strong className="sb-num">{counts.low}</strong><small>Tidy-ups</small></div>
              <div className="sb-stat"><span><Icon name="layers" size={15} />Files checked</span><strong className="sb-num">{audit.filesChecked}</strong><small>{savings > 0 ? `${formatBytes(savings)} could be saved by minifying` : `of ${audit.totalFiles} in ${audit.theme.name}`}</small></div>
            </div>

            <Card
              icon="checkCircle"
              title={`2. Recommendations for ${audit.theme.name}`}
              subtitle="Open a finding to see why it matters and what you can do. The list is sorted by impact."
            >
              {audit.findings.length === 0 ? (
                <EmptyState icon="checkCircle" title="No issues found">
                  This theme passed every check SpeedBoost runs. Use Speed boosters for further runtime optimizations.
                </EmptyState>
              ) : (
                <>
                  <div className="sb-segmented" role="tablist" aria-label="Filter by type" style={{ marginBottom: 14 }}>
                    <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>All ({audit.findings.length})</button>
                    {categories.map((category) => (
                      <button key={category} type="button" role="tab" aria-selected={filter === category} onClick={() => setFilter(category)}>
                        {CATEGORY_LABEL[category]} ({audit.findings.filter((finding) => finding.category === category).length})
                      </button>
                    ))}
                  </div>
                  <ul className="sb-findings">
                    {visible.map((finding) => <FindingCard key={finding.id} finding={finding} />)}
                  </ul>
                </>
              )}
              {audit.truncated ? <p className="sb-help" style={{ marginTop: 10 }}>This theme has more than 2,000 files; only the first 2,000 were checked.</p> : null}
            </Card>

            <Banner tone="info" title="SpeedBoost never edits your theme">
              Use Speed boosters for fixes that need no code. Findings in your theme&apos;s own code are for your theme
              developer or provider, and theme updates often include them. Run a Speed audit before and after any change.
            </Banner>
          </>
        ) : null}
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
