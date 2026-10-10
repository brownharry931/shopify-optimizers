import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getVerifiedSubscription } from "../billing/billing.server";
import { PLAN_CURRENCY, PLAN_NAME, PLAN_PRICE } from "../config/plan.server";
import prisma from "../db.server";

const styles = {
  actions: "pp-actions",
  badge: "pp-badge",
  badgeGood: "pp-badgeGood",
  badgePending: "pp-badgePending",
  dashboard: "pp-dashboard",
  eyebrow: "pp-eyebrow",
  hero: "pp-hero",
  heroCopy: "pp-heroCopy",
  heroSummary: "pp-heroSummary",
  heroText: "pp-heroText",
  heroTitle: "pp-heroTitle",
  liveDot: "pp-liveDot",
  lowerGrid: "pp-lowerGrid",
  meterGrid: "pp-meterGrid",
  metricCard: "pp-metricCard",
  metricCode: "pp-metricCode",
  metricFoot: "pp-metricFoot",
  metricTop: "pp-metricTop",
  metricValue: "pp-metricValue",
  notice: "pp-notice",
  noticeMark: "pp-noticeMark",
  panel: "pp-panel",
  panelDescription: "pp-panelDescription",
  panelLink: "pp-panelLink",
  primaryAction: "pp-primaryAction",
  secondaryAction: "pp-secondaryAction",
  sectionHeading: "pp-sectionHeading",
  statusDetail: "pp-statusDetail",
  statusIcon: "pp-statusIcon",
  statusItem: "pp-statusItem",
  statusList: "pp-statusList",
  statusName: "pp-statusName",
  storeDomain: "pp-storeDomain",
  summaryLabel: "pp-summaryLabel",
  summaryPrice: "pp-summaryPrice",
  summaryStatus: "pp-summaryStatus",
} as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [response, planAccess, embedHeartbeat, latestScan] = await Promise.all([
    admin.graphql(`#graphql
      query StoreOverview {
        shop {
          name
          myshopifyDomain
          primaryDomain { url }
        }
      }
    `),
    getVerifiedSubscription(admin, session.shop),
    prisma.themeEmbedHeartbeat.findUnique({ where: { shop: session.shop } }),
    prisma.performanceScan.findFirst({
      where: { shop: session.shop, status: "COMPLETE" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const result = await response.json();
  const shop = result.data?.shop;

  if (!shop) {
    throw new Response("Unable to load the authenticated Shopify store.", {
      status: 502,
    });
  }

  return {
    shop,
    hasActiveSubscription: planAccess.hasActiveSubscription,
    subscriptionStatus: planAccess.subscriptionStatus,
    planName: PLAN_NAME,
    planPrice: PLAN_PRICE,
    planCurrency: PLAN_CURRENCY,
    themeEmbedVerified: Boolean(
      embedHeartbeat &&
      embedHeartbeat.lastSeenAt.getTime() > Date.now() - 24 * 60 * 60 * 1000,
    ),
    themeEmbedLastSeenAt: embedHeartbeat?.lastSeenAt.toISOString() || null,
    latestScan: latestScan
      ? {
          performance: latestScan.performance,
          lcpMs: latestScan.lcpMs,
          tbtMs: latestScan.tbtMs,
          cls: latestScan.cls,
          createdAt: latestScan.createdAt.toISOString(),
        }
      : null,
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

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const subscriptionState = subscriptionLabel(
    data.subscriptionStatus,
    data.hasActiveSubscription,
  );
  const badgeClass = data.hasActiveSubscription
    ? `${styles.badge} ${styles.badgeGood}`
    : data.subscriptionStatus === "PENDING"
      ? `${styles.badge} ${styles.badgePending}`
      : styles.badge;

  return (
    <s-page heading="Performance Pro">
      <main className={styles.dashboard}>
        <section className={styles.hero} aria-labelledby="dashboard-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>
              <span className={styles.liveDot} aria-hidden="true" />
              Store connected
            </p>
            <h1 className={styles.heroTitle} id="dashboard-title">
              A clearer view of your storefront speed.
            </h1>
            <p className={styles.heroText}>
              Run a mobile storefront measurement, review real Lighthouse
              opportunities, and verify that the Theme App Embed has executed on
              your published store.
            </p>
            <div className={styles.actions}>
              <a className={styles.primaryAction} href="/app/scan">
                Run storefront scan
              </a>
              <a className={styles.secondaryAction} href="/app/reports">
                Performance reports
              </a>
              <a className={styles.secondaryAction} href="/app/optimize">
                Open Optimization Center
              </a>
              <a className={styles.secondaryAction} href="/app/billing">
                {data.hasActiveSubscription
                  ? "Manage subscription"
                  : "Explore Performance Pro"}
              </a>
              {data.shop.primaryDomain?.url ? (
                <a
                  className={styles.secondaryAction}
                  href={data.shop.primaryDomain.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View storefront <span aria-hidden="true">↗</span>
                </a>
              ) : null}
            </div>
          </div>

          <aside
            className={styles.heroSummary}
            aria-label="Subscription summary"
          >
            <p className={styles.summaryLabel}>Your plan</p>
            <p className={styles.summaryPrice}>
              ${data.planPrice.toFixed(2)} {data.planCurrency}{" "}
              <span>/ every 30 days</span>
            </p>
            <span className={styles.summaryStatus}>
              <span aria-hidden="true">●</span> {subscriptionState}
            </span>
          </aside>
        </section>

        <section aria-labelledby="metrics-title">
          <h2 className={styles.sectionHeading} id="metrics-title">
            Mobile Lighthouse diagnostics
          </h2>
          <div className={styles.meterGrid}>
            {[
              {
                name: "Largest Contentful Paint",
                code: "LCP",
                value:
                  data.latestScan?.lcpMs === null ||
                  data.latestScan?.lcpMs === undefined
                    ? "Not measured"
                    : data.latestScan.lcpMs >= 1000
                      ? `${(data.latestScan.lcpMs / 1000).toFixed(2)} s`
                      : `${data.latestScan.lcpMs} ms`,
              },
              {
                name: "Total Blocking Time",
                code: "TBT",
                value:
                  data.latestScan?.tbtMs === null ||
                  data.latestScan?.tbtMs === undefined
                    ? "Not measured"
                    : `${data.latestScan.tbtMs} ms`,
              },
              {
                name: "Cumulative Layout Shift",
                code: "CLS",
                value:
                  data.latestScan?.cls === null ||
                  data.latestScan?.cls === undefined
                    ? "Not measured"
                    : data.latestScan.cls.toFixed(3),
              },
            ].map((metric) => (
              <article className={styles.metricCard} key={metric.code}>
                <div className={styles.metricTop}>
                  <span>{metric.name}</span>
                  <span className={styles.metricCode}>{metric.code}</span>
                </div>
                <p className={styles.metricValue}>{metric.value}</p>
                <p className={styles.metricFoot}>
                  {data.latestScan
                    ? `Synthetic mobile · score ${data.latestScan.performance ?? "—"}/100`
                    : "Run a mobile scan to measure"}
                </p>
              </article>
            ))}
          </div>
        </section>

        <div className={styles.lowerGrid}>
          <section className={styles.panel} aria-labelledby="readiness-title">
            <h2 className={styles.sectionHeading} id="readiness-title">
              Product readiness
            </h2>
            <p className={styles.panelDescription}>
              SpeedBoost now offers measured Core Web Vitals guidance plus
              reviewed CSS/JS, compatible script-deferral, and Shopify image
              loading previews. Applying still requires Shopify&apos;s separate
              public-app theme-write exemption and a development-theme test.
            </p>
            <ul className={styles.statusList}>
              <li className={styles.statusItem}>
                <span
                  className={`${styles.statusIcon} ${styles.badgeGood}`}
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className={styles.statusName}>
                  Shopify connection
                  <span className={styles.statusDetail}>
                    Store data loaded for this session
                  </span>
                </span>
                <span className={`${styles.badge} ${styles.badgeGood}`}>
                  Connected
                </span>
              </li>
              <li className={styles.statusItem}>
                <span className={styles.statusIcon} aria-hidden="true">
                  $
                </span>
                <span className={styles.statusName}>
                  {data.planName} billing
                  <span className={styles.statusDetail}>
                    Shopify-verified subscription status
                  </span>
                </span>
                <span className={badgeClass}>{subscriptionState}</span>
              </li>
              <li className={styles.statusItem}>
                <span
                  className={`${styles.statusIcon} ${data.themeEmbedVerified ? styles.badgeGood : ""}`}
                  aria-hidden="true"
                >
                  {data.themeEmbedVerified ? "✓" : "↗"}
                </span>
                <span className={styles.statusName}>
                  Theme App Embed
                  <span className={styles.statusDetail}>
                    {data.themeEmbedVerified && data.themeEmbedLastSeenAt
                      ? `Live storefront ping received ${new Date(data.themeEmbedLastSeenAt).toLocaleString()}`
                      : "Not confirmed yet. Visit the published storefront after enabling the embed."}
                    {!data.themeEmbedVerified &&
                    data.shop.primaryDomain?.url ? (
                      <>
                        {" "}
                        <a
                          href={data.shop.primaryDomain.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open storefront to verify ↗
                        </a>
                      </>
                    ) : null}
                  </span>
                </span>
                <span
                  className={`${styles.badge} ${data.themeEmbedVerified ? styles.badgeGood : ""}`}
                >
                  {data.themeEmbedVerified
                    ? "Verified"
                    : "Needs storefront visit"}
                </span>
              </li>
              <li className={styles.statusItem}>
                <span className={styles.statusIcon} aria-hidden="true">
                  ⌁
                </span>
                <span className={styles.statusName}>
                  Store scanner
                  <span className={styles.statusDetail}>
                    {data.latestScan
                      ? `Latest mobile Lighthouse scan: ${new Date(data.latestScan.createdAt).toLocaleString()}`
                      : "Run a real mobile Lighthouse scan to see results."}{" "}
                    <a href="/app/scan">Open scanner →</a>
                  </span>
                </span>
                <span
                  className={`${styles.badge} ${data.latestScan ? styles.badgeGood : ""}`}
                >
                  {data.latestScan ? "Scan available" : "Ready to scan"}
                </span>
              </li>
            </ul>
          </section>

          <aside className={styles.panel} aria-labelledby="store-title">
            <h2 className={styles.sectionHeading} id="store-title">
              Connected store
            </h2>
            <p className={styles.panelDescription}>
              This Shopify session is connected to:
            </p>
            <p className={styles.storeDomain}>
              <strong>{data.shop.name}</strong>
              <br />
              {data.shop.myshopifyDomain}
            </p>
            <a className={styles.panelLink} href="/app/billing">
              {data.hasActiveSubscription
                ? "View billing details →"
                : "See plan and billing options →"}
            </a>
          </aside>
        </div>

        <div className={styles.notice} role="note">
          <span className={styles.noticeMark} aria-hidden="true">
            i
          </span>
          <span>
            Mobile Lighthouse values are synthetic lab measurements, not field
            Core Web Vitals. The app does not make theme changes automatically;
            review real scan findings and retest before claiming an improvement.
          </span>
        </div>
      </main>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
