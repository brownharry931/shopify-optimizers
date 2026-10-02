import { Form, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getShopifyPlanSelectionUrl,
  getVerifiedSubscription,
} from "../billing/billing.server";
import {
  PLAN_CURRENCY,
  PLAN_INTERVAL,
  PLAN_NAME,
  PLAN_PRICE,
} from "../config/plan.server";

const styles = {
  actionCard: "pp-actionCard",
  actionText: "pp-actionText",
  actionTitle: "pp-actionTitle",
  badge: "pp-badge",
  badgeActive: "pp-badgeActive",
  billingPage: "pp-billingPage",
  cancelButton: "pp-cancelButton",
  card: "pp-card",
  cardTitle: "pp-cardTitle",
  columns: "pp-columns",
  explainer: "pp-explainer",
  eyebrow: "pp-eyebrow",
  feature: "pp-feature",
  featureIcon: "pp-featureIcon",
  featureList: "pp-featureList",
  footnote: "pp-footnote",
  heroCopy: "pp-heroCopy",
  link: "pp-link",
  planHero: "pp-planHero",
  price: "pp-price",
  priceBlock: "pp-priceBlock",
  priceNote: "pp-priceNote",
  primaryButton: "pp-primaryButton",
  statusLabel: "pp-statusLabel",
  statusRow: "pp-statusRow",
  statusValue: "pp-statusValue",
  subtitle: "pp-subtitle",
  testNote: "pp-testNote",
  title: "pp-title",
} as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const result = await getVerifiedSubscription(admin, session.shop);

  return {
    shop: session.shop,
    ...result,
    plan: {
      name: PLAN_NAME,
      price: PLAN_PRICE,
      currency: PLAN_CURRENCY,
      interval: PLAN_INTERVAL,
    },
    planSelectionConfigured: Boolean(process.env.SHOPIFY_APP_HANDLE?.trim()),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, redirect, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "start") {
    const current = await getVerifiedSubscription(admin, session.shop);
    if (!current.isVerified) {
      throw new Response(
        "Subscription verification is not configured; Shopify plan selection is disabled until Partner API settings are added.",
        { status: 503 },
      );
    }
    if (current.hasActiveSubscription) return redirect("/app/billing");
    return redirect(getShopifyPlanSelectionUrl(session.shop), {
      target: "_top",
    });
  }

  if (intent === "manage" || intent === "cancel") {
    return redirect(getShopifyPlanSelectionUrl(session.shop), {
      target: "_top",
    });
  }

  return new Response("Unsupported billing action", { status: 400 });
};

function statusLabel(status: string | undefined, verified: boolean) {
  if (!verified) return "Not verified with Shopify";
  if (!status) return "Not subscribed";
  if (status === "ACTIVE") return "Active";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function dateLabel(value: Date | string | null | undefined) {
  if (!value) return "Not provided by Shopify";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not provided by Shopify";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

export default function BillingPage() {
  const data = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const subscription = data.subscription;
  const active = data.hasActiveSubscription && data.isVerified;
  const canStart = data.isVerified && data.planSelectionConfigured && !active;
  const shopSlug = data.shop.replace(/\.myshopify\.com$/i, "");
  const shopBillingUrl = `https://admin.shopify.com/store/${encodeURIComponent(shopSlug)}/settings/billing`;
  const statusText = statusLabel(subscription?.status, data.isVerified);
  const badgeClass = active
    ? `${styles.badge} ${styles.badgeActive}`
    : styles.badge;

  return (
    <s-page heading="Billing & Subscription">
      <main className={styles.billingPage}>
        <header className={styles.planHero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Shopify-managed subscription</p>
            <h1 className={styles.title}>{data.plan.name}</h1>
            <p className={styles.subtitle}>
              A straightforward recurring plan. Review and approve the charge
              securely in Shopify; Performance Pro never handles or stores
              payment details.
            </p>
          </div>
          <div className={styles.priceBlock}>
            <p className={styles.price}>
              ${data.plan.price.toFixed(2)} {data.plan.currency}
              <small> / 30 days</small>
            </p>
            <p className={styles.priceNote}>
              Monthly recurring subscription · terms shown by Shopify
            </p>
          </div>
          <p className={styles.testNote}>
            Plan price and trial terms are configured in Shopify App Pricing.
            Development stores can use a private no-charge test plan.
          </p>
        </header>

        {!data.isVerified ? (
          <p className={styles.testNote} role="status">
            Partner API billing settings are not configured in this development
            environment. You can continue exploring the app, but subscription
            status cannot be confirmed and paid access stays locked.
          </p>
        ) : !data.planSelectionConfigured ? (
          <p className={styles.testNote} role="status">
            Subscription verification is configured, but SHOPIFY_APP_HANDLE is
            still needed to open Shopify&apos;s plan-selection page.
          </p>
        ) : null}

        <div className={styles.columns}>
          <section className={styles.card} aria-labelledby="current-plan-title">
            <h2 className={styles.cardTitle} id="current-plan-title">
              Current subscription
            </h2>
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Shopify status</span>
              <span className={badgeClass}>
                <span aria-hidden="true">{active ? "●" : "○"}</span>
                {statusText}
              </span>
            </div>
            {subscription ? (
              <>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>Plan</span>
                  <span className={styles.statusValue}>
                    {subscription.planName}
                  </span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>
                    Subscription created
                  </span>
                  <span className={styles.statusValue}>
                    {dateLabel(subscription.shopifyCreatedAt)}
                  </span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>
                    Current period ends
                  </span>
                  <span className={styles.statusValue}>
                    {dateLabel(subscription.expiresAt)}
                  </span>
                </div>
              </>
            ) : (
              <p className={styles.explainer}>
                {data.isVerified
                  ? "Shopify reports no active subscription for this store."
                  : "Subscription status is unavailable until Partner API settings are configured."}
              </p>
            )}
            {subscription?.trialEndsAt ? (
              <div className={styles.statusRow}>
                <span className={styles.statusLabel}>Trial ends</span>
                <span className={styles.statusValue}>
                  {dateLabel(subscription.trialEndsAt)}
                </span>
              </div>
            ) : null}
            {subscription?.cancelAtEndOfCycle ? (
              <p className={styles.explainer}>
                Shopify has scheduled this subscription to end after the current
                billing period.
              </p>
            ) : null}
            <a
              className={styles.link}
              href={shopBillingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open Shopify billing settings ↗
            </a>
          </section>

          <aside className={styles.card} aria-labelledby="plan-details-title">
            <h2 className={styles.cardTitle} id="plan-details-title">
              Plan details
            </h2>
            <ul className={styles.featureList}>
              <li className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  ✓
                </span>
                <span>
                  Recurring charge is presented and managed by Shopify.
                </span>
              </li>
              <li className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  ✓
                </span>
                <span>
                  Shopify controls any trial terms. Paid access requires a
                  server-verified active subscription.
                </span>
              </li>
              <li className={styles.feature}>
                <span className={styles.featureIcon} aria-hidden="true">
                  i
                </span>
                <span>
                  The scanner and optimization controls are not available yet;
                  no results are being claimed.
                </span>
              </li>
            </ul>
          </aside>
        </div>

        {active ? (
          <section
            className={styles.actionCard}
            aria-label="Subscription actions"
          >
            <div>
              <h2 className={styles.actionTitle}>
                Your subscription is active
              </h2>
              <p className={styles.actionText}>
                Shopify confirmed the active status. Manage or cancel the
                recurring agreement on Shopify’s hosted pricing page.
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="manage" />
              <button
                className={styles.cancelButton}
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Opening Shopify…"
                  : "Manage or cancel in Shopify"}
              </button>
            </Form>
          </section>
        ) : (
          <section
            className={styles.actionCard}
            aria-label="Start subscription"
          >
            <div>
              <h2 className={styles.actionTitle}>
                {!data.isVerified
                  ? "Billing setup required"
                  : data.planSelectionConfigured
                    ? "Ready to continue?"
                    : "Plan page setup required"}
              </h2>
              <p className={styles.actionText}>
                {!data.isVerified
                  ? "The app dashboard remains available, but plan selection is disabled until the Partner API token is configured."
                  : data.planSelectionConfigured
                    ? "Shopify will open the hosted plan-selection page. No charge is made until you approve a plan there."
                    : "Set SHOPIFY_APP_HANDLE in this environment to enable Shopify's hosted plan-selection page."}
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="start" />
              <button
                className={styles.primaryButton}
                type="submit"
                disabled={!canStart || isSubmitting}
              >
                {isSubmitting
                  ? "Opening Shopify plans…"
                  : !data.isVerified
                    ? "Billing setup required"
                    : !data.planSelectionConfigured
                      ? "Set app handle"
                      : subscription?.status === "CANCELLED"
                        ? "Reactivate Performance Pro"
                        : "Start Performance Pro"}
              </button>
            </Form>
          </section>
        )}

        <p className={styles.footnote}>
          Subscription status is verified against Shopify’s Partner API when
          configured. This page does not collect payment details; Shopify App
          Pricing handles approval and charges.
        </p>
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
