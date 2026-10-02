import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getVerifiedSubscription } from "../billing/billing.server";
import { PLAN_CURRENCY, PLAN_NAME, PLAN_PRICE } from "../config/plan.server";

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
  const [response, planAccess] = await Promise.all([
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
    subscriptionStatus: planAccess.hasActiveSubscription
      ? "ACTIVE"
      : "NOT_SUBSCRIBED",
    planName: PLAN_NAME,
    planPrice: PLAN_PRICE,
    planCurrency: PLAN_CURRENCY,
  };
};

function subscriptionLabel(status: string, active: boolean) {
  if (active) return "Active";
  if (status === "PENDING") return "Approval pending";
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
              Performance Pro brings your store connection, billing, and
              upcoming performance tools together in one place. Measurements
              will only appear after a real scan has run.
            </p>
            <div className={styles.actions}>
              <a className={styles.primaryAction} href="/app/billing">
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
            Core Web Vitals
          </h2>
          <div className={styles.meterGrid}>
            {[
              { name: "Largest Contentful Paint", code: "LCP" },
              { name: "Interaction to Next Paint", code: "INP" },
              { name: "Cumulative Layout Shift", code: "CLS" },
            ].map((metric) => (
              <article className={styles.metricCard} key={metric.code}>
                <div className={styles.metricTop}>
                  <span>{metric.name}</span>
                  <span className={styles.metricCode}>{metric.code}</span>
                </div>
                <p className={styles.metricValue}>Not measured</p>
                <p className={styles.metricFoot}>A real scan has not run yet</p>
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
              The app is connected. We show each capability honestly while the
              remaining product work is built and verified.
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
                <span className={styles.statusIcon} aria-hidden="true">
                  ↗
                </span>
                <span className={styles.statusName}>
                  Theme App Embed
                  <span className={styles.statusDetail}>
                    Activation still needs verification
                  </span>
                </span>
                <span className={styles.badge}>Not verified</span>
              </li>
              <li className={styles.statusItem}>
                <span className={styles.statusIcon} aria-hidden="true">
                  ⌁
                </span>
                <span className={styles.statusName}>
                  Store scanner
                  <span className={styles.statusDetail}>
                    No scan engine or results yet
                  </span>
                </span>
                <span className={styles.badge}>In development</span>
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
            No sample scores, estimated speed gains, or unverified storefront
            changes are shown. Synthetic and field data will be identified
            separately when scanning is available.
          </span>
        </div>
      </main>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
