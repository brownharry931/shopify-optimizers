import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getVerifiedSubscription } from "../billing/billing.server";
import { PLAN_CURRENCY, PLAN_NAME, PLAN_PRICE } from "../config/plan.server";
import prisma from "../db.server";
import { Icon, type IconName } from "../components/icons";
import {
  Badge,
  Card,
  EmptyState,
  GaugeLegend,
  PageHeader,
  RatingShape,
  ScoreGauge,
  Time,
} from "../components/ui";
import { readStoredReport } from "../performance/lighthouse-report";
import { loadSpeedSettings } from "../optimization/speed-settings.server";
import { enabledCount, SPEED_BOOLEAN_KEYS } from "../optimization/speed-settings";
import { themeEditorEmbedUrl } from "../optimization/theme-editor";
import { getEmbedStatus } from "../optimization/embed-status.server";
import { embedIsActive } from "../optimization/embed-status";
import { DeferredEmbedStatus, embedBadge, embedDetail } from "../components/embed-status";

const latestScanSelect = {
  id: true,
  auditRunId: true,
  strategy: true,
  pageUrl: true,
  performance: true,
  createdAt: true,
  report: true,
} as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const embed = getEmbedStatus(admin, session.shop);
  const [response, planAccess, mobile, desktop, recent, speed] =
    await Promise.all([
      admin.graphql(`#graphql
        query StoreOverview { shop { name myshopifyDomain primaryDomain { url } } }
      `),
      getVerifiedSubscription(admin, session.shop),
      prisma.performanceScan.findFirst({
        where: { shop: session.shop, status: "COMPLETE", strategy: "mobile" },
        orderBy: { createdAt: "desc" },
        select: latestScanSelect,
      }),
      prisma.performanceScan.findFirst({
        where: { shop: session.shop, status: "COMPLETE", strategy: "desktop" },
        orderBy: { createdAt: "desc" },
        select: { performance: true, createdAt: true },
      }),
      prisma.performanceScan.findMany({
        where: { shop: session.shop },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, auditRunId: true, pageUrl: true, strategy: true, status: true, performance: true, createdAt: true },
      }),
      loadSpeedSettings(admin).catch(() => null),
    ]);
  const result = await response.json();
  const shop = result.data?.shop;
  if (!shop) {
    throw new Response("Unable to load the authenticated Shopify store.", { status: 502 });
  }

  const report = mobile ? readStoredReport(mobile.report) : null;
  return {
    shop,
    hasActiveSubscription: planAccess.hasActiveSubscription,
    subscriptionStatus: planAccess.subscriptionStatus,
    planName: PLAN_NAME,
    planPrice: PLAN_PRICE,
    planCurrency: PLAN_CURRENCY,
    pageSpeedKeyConfigured: Boolean(process.env.GOOGLE_PAGESPEED_API_KEY?.trim()),
    embedUrl: themeEditorEmbedUrl(shop.myshopifyDomain),
    embed,
    boostersEnabled: speed ? enabledCount(speed.settings) : 0,
    boostersTotal: SPEED_BOOLEAN_KEYS.length,
    mobile: mobile
      ? {
          auditRunId: mobile.auditRunId,
          pageUrl: mobile.pageUrl,
          performance: mobile.performance,
          createdAt: mobile.createdAt.toISOString(),
          categories: report?.categories ?? [],
          metrics: report?.metrics ?? [],
        }
      : null,
    desktop: desktop
      ? { performance: desktop.performance, createdAt: desktop.createdAt.toISOString() }
      : null,
    recent: recent.map((scan) => ({ ...scan, createdAt: scan.createdAt.toISOString() })),
  };
};

function subscriptionLabel(status: string, active: boolean) {
  if (active) return "Active";
  if (status === "PENDING") return "Approval pending";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "FROZEN") return "Frozen";
  if (status === "EXPIRED") return "Expired";
  if (status === "DECLINED") return "Declined";
  if (status === "NOT_SUBSCRIBED") return "Not subscribed";
  return "Needs verification";
}

function SetupItem({
  done,
  icon,
  title,
  detail,
  action,
}: {
  done: boolean;
  icon: IconName;
  title: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <li className="sb-listItem">
      <span className={`sb-listIcon ${done ? "sb-listIcon-done" : "sb-listIcon-todo"}`}>
        <Icon name={done ? "check" : icon} size={18} />
      </span>
      <span className="sb-listText">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      {action ?? <Badge tone={done ? "success" : "warning"}>{done ? "Done" : "To do"}</Badge>}
    </li>
  );
}

const QUICK_ACTIONS: Array<{ href: string; icon: IconName; title: string; text: string }> = [
  { href: "/app/scan", icon: "gauge", title: "Speed audit", text: "Lighthouse report for any page, on mobile and desktop." },
  { href: "/app/speed", icon: "bolt", title: "Speed boosters", text: "Delay scripts, instant page loads, LCP preload, fonts and more." },
  { href: "/app/optimize", icon: "code", title: "Theme optimizer", text: "Minify CSS/JS, defer scripts and lazy-load images on a draft theme." },
  { href: "/app/reports", icon: "chart", title: "Reports", text: "Score trends and before/after comparisons over time." },
];

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const subscriptionState = subscriptionLabel(data.subscriptionStatus, data.hasActiveSubscription);
  const metricsToShow = data.mobile?.metrics ?? [];

  return (
    <s-page heading="SpeedBoost">
      <main className="sb-app">
        <PageHeader
          eyebrow={data.shop.name}
          title="Store speed overview"
          description="Measure your storefront with Google Lighthouse, switch on speed boosters, and track the results."
          actions={
            <>
              {data.shop.primaryDomain?.url ? (
                <a className="sb-btn sb-btn-secondary" href={data.shop.primaryDomain.url} target="_blank" rel="noreferrer">
                  View store <Icon name="external" size={15} />
                </a>
              ) : null}
              <Link className="sb-btn sb-btn-primary" to="/app/scan"><Icon name="bolt" size={16} />Run speed audit</Link>
            </>
          }
        />

        <div className="sb-grid sb-grid-main">
          <Card
            icon="gauge"
            title="Current speed score"
            subtitle={
              data.mobile ? (
                <>Homepage and pages you audit · latest mobile run <Time value={data.mobile.createdAt} relative /></>
              ) : (
                "No audit has run yet"
              )
            }
            actions={data.mobile?.auditRunId ? <Link className="sb-btn sb-btn-ghost" to={`/app/scan?audit=${data.mobile.auditRunId}`}>Full report <Icon name="arrowRight" size={14} /></Link> : null}
          >
            {data.mobile ? (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 28, justifyContent: "space-around", alignItems: "center", paddingBottom: 6 }}>
                  <ScoreGauge score={data.mobile.performance} label="Mobile" size={120} />
                  <ScoreGauge score={data.desktop?.performance ?? null} label="Desktop" size={120} />
                  {data.mobile.categories
                    .filter((category) => category.id !== "performance")
                    .map((category) => (
                      <ScoreGauge key={category.id} score={category.score} label={category.title} size={72} />
                    ))}
                </div>
                <GaugeLegend />
                {metricsToShow.length ? (
                  <>
                    <div className="sb-sectionLabel">Mobile lab metrics<small>Values exactly as reported by Lighthouse</small></div>
                    <div className="sb-metrics">
                      {metricsToShow.map((metric) => (
                        <div className="sb-metric" key={metric.id}>
                          <span className="sb-metricName"><RatingShape rating={metric.rating} />{metric.title}</span>
                          <span className={`sb-metricValue sb-text-${metric.rating}`}>{metric.displayValue}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              <EmptyState
                icon="gauge"
                title="Measure your store"
                action={<Link className="sb-btn sb-btn-primary" to="/app/scan"><Icon name="bolt" size={16} />Run first audit</Link>}
              >
                Your first audit takes about a minute. It shows your PageSpeed score, Core Web Vitals and the issues
                slowing your store down.
              </EmptyState>
            )}
          </Card>

          <Card icon="checkCircle" title="Setup" subtitle="Complete these steps to get the most out of SpeedBoost.">
            <ul className="sb-list">
              <SetupItem
                done={data.hasActiveSubscription}
                icon="card"
                title={`${data.planName} plan`}
                detail={`$${data.planPrice.toFixed(2)} ${data.planCurrency} every 30 days · ${subscriptionState}`}
                action={data.hasActiveSubscription ? undefined : <Link className="sb-btn sb-btn-secondary" to="/app/billing">Choose plan</Link>}
              />
              <DeferredEmbedStatus status={data.embed}>
                {(status) => (
                  <SetupItem
                    done={embedIsActive(status)}
                    icon="layers"
                    title="App embed"
                    detail={embedDetail(status)}
                    action={
                      embedIsActive(status) ? undefined : status.theme === "unknown" ? (
                        embedBadge(status)
                      ) : (
                        <a className="sb-btn sb-btn-secondary" href={data.embedUrl} target="_top">Enable</a>
                      )
                    }
                  />
                )}
              </DeferredEmbedStatus>
              <SetupItem
                done={data.boostersEnabled > 0}
                icon="bolt"
                title="Speed boosters"
                detail={`${data.boostersEnabled} of ${data.boostersTotal} enabled`}
                action={<Link className="sb-btn sb-btn-secondary" to="/app/speed">{data.boostersEnabled ? "Manage" : "Set up"}</Link>}
              />
              <SetupItem
                done={data.pageSpeedKeyConfigured}
                icon="shield"
                title="PageSpeed API key"
                detail={data.pageSpeedKeyConfigured ? "Dedicated Google quota configured" : "Server uses Google's shared quota; scans may be rate-limited."}
              />
              <SetupItem
                done={Boolean(data.mobile)}
                icon="gauge"
                title="First audit"
                detail={data.mobile ? "Baseline captured" : "Capture a baseline before changing anything."}
              />
            </ul>
          </Card>
        </div>

        <div className="sb-actionsGrid">
          {QUICK_ACTIONS.map((action) => (
            <a key={action.href} className="sb-actionTile" href={action.href}>
              <span><Icon name={action.icon} size={18} /></span>
              <strong>{action.title}<Icon name="arrowRight" size={15} /></strong>
              <p>{action.text}</p>
            </a>
          ))}
        </div>

        <Card
          icon="history"
          title="Recent audits"
          actions={<Link className="sb-btn sb-btn-ghost" to="/app/reports">All reports <Icon name="arrowRight" size={14} /></Link>}
        >
          {data.recent.length ? (
            <div className="sb-tableWrap">
              <table className="sb-table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Page</th>
                    <th scope="col">Device</th>
                    <th scope="col" className="sb-cellNum">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((scan) => (
                    <tr key={scan.id}>
                      <td style={{ whiteSpace: "nowrap" }}><Time value={scan.createdAt} /></td>
                      <td>
                        {scan.auditRunId ? (
                          <Link to={`/app/scan?audit=${scan.auditRunId}`}><span className="sb-cellUrl">{scan.pageUrl}</span></Link>
                        ) : (
                          <span className="sb-cellUrl">{scan.pageUrl}</span>
                        )}
                      </td>
                      <td style={{ textTransform: "capitalize" }}>{scan.strategy}</td>
                      <td className="sb-cellNum">
                        {scan.status === "COMPLETE" ? (
                          <span className={`sb-scorePill sb-rate-${(scan.performance ?? 0) >= 90 ? "pass" : (scan.performance ?? 0) >= 50 ? "average" : "fail"}`}>{scan.performance}</span>
                        ) : (
                          <Badge tone={scan.status === "FAILED" ? "critical" : "neutral"}>{scan.status === "FAILED" ? "Failed" : "Running"}</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="sb-muted">Audits you run appear here.</p>
          )}
        </Card>

        <p className="sb-footnote">
          Lighthouse scores are lab measurements on an emulated device. Real-visitor Core Web Vitals (CrUX) appear in
          each audit when Google has enough traffic data for your store.
        </p>
      </main>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
