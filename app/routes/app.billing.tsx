import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getVerifiedSubscription,
  recordBillingRequestFailure,
  reserveBillingRequest,
} from "../billing/billing.server";
import {
  BILLING_TEST_MODE,
  PLAN_CURRENCY,
  PLAN_INTERVAL,
  PLAN_NAME,
  PLAN_PRICE,
  PLAN_TRIAL_DAYS,
} from "../config/plan.server";
import prisma from "../db.server";

const styles = {
  actionCard: "pp-actionCard",
  actionText: "pp-actionText",
  actionTitle: "pp-actionTitle",
  badge: "pp-badge",
  badgeActive: "pp-badgeActive",
  badgePending: "pp-badgePending",
  billingPage: "pp-billingPage",
  cancelButton: "pp-cancelButton",
  card: "pp-card",
  cardTitle: "pp-cardTitle",
  columns: "pp-columns",
  debug: "pp-debug",
  error: "pp-error",
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
  const { admin, billing, session } = await authenticate.admin(request);
  const result = await getVerifiedSubscription(admin, billing, session.shop);

  return {
    shop: session.shop,
    ...result,
    plan: {
      name: PLAN_NAME,
      price: PLAN_PRICE,
      currency: PLAN_CURRENCY,
      interval: PLAN_INTERVAL,
      trialDays: PLAN_TRIAL_DAYS,
      testMode: BILLING_TEST_MODE,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "start") {
    const current = await getVerifiedSubscription(admin, billing, session.shop);
    if (current.hasActiveSubscription) return redirect("/app/billing");
    if (current.isVerified && current.subscription?.status === "PENDING") {
      return Response.json(
        {
          error:
            "There is already a pending Shopify approval for this shop. Complete or decline it in Shopify billing before starting another request.",
        },
        { status: 409 },
      );
    }

    const reservation = await reserveBillingRequest(session.shop);
    if (!reservation.reserved) {
      return Response.json(
        {
          error:
            "A billing request is already pending or being processed. Refresh Billing in a moment; a duplicate subscription was not created.",
        },
        { status: 409 },
      );
    }

    try {
      await billing.request({ plan: PLAN_NAME, isTest: BILLING_TEST_MODE });
    } catch (error) {
      // Shopify's framework throws a redirect response to its confirmation page.
      if (error instanceof Response) throw error;
      await recordBillingRequestFailure(session.shop);
      const errorRecord =
        typeof error === "object" && error !== null
          ? (error as { errorData?: unknown })
          : undefined;
      const shopifyMessages = Array.isArray(errorRecord?.errorData)
        ? errorRecord.errorData
            .map((item) =>
              typeof item === "object" && item !== null && "message" in item
                ? String((item as { message: unknown }).message)
                : "",
            )
            .filter(Boolean)
        : [];
      const rawMessage = [
        error instanceof Error ? error.message : "Unknown billing error",
        ...shopifyMessages,
      ].join(" — Shopify: ");
      const diagnosticMessage = rawMessage
        .replace(/https?:\/\/\S+/g, "[external URL omitted]")
        .replace(
          /(access[_-]?token|id[_-]?token|api[_-]?key|secret|hmac|signature)=([^&\s]+)/gi,
          "$1=[redacted]",
        )
        .slice(0, 500);
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("Shopify subscription request failed", {
        name: errorName,
        message: diagnosticMessage,
      });
      return Response.json(
        {
          error:
            "Shopify could not start the subscription approval. No payment details were stored. Please review the development diagnostic and retry.",
          ...(process.env.NODE_ENV !== "production"
            ? { debug: `${errorName}: ${diagnosticMessage}` }
            : {}),
        },
        { status: 502 },
      );
    }
  }

  if (intent === "cancel") {
    const current = await getVerifiedSubscription(admin, billing, session.shop);
    if (
      !current.hasActiveSubscription ||
      !current.subscription?.shopifySubscriptionId
    ) {
      return Response.json(
        { error: "No active Shopify subscription was found to cancel." },
        { status: 409 },
      );
    }

    let cancelled;
    try {
      cancelled = await billing.cancel({
        subscriptionId: current.subscription.shopifySubscriptionId,
        isTest: BILLING_TEST_MODE,
        prorate: false,
      });
    } catch (error) {
      console.error("Shopify subscription cancellation failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return Response.json(
        {
          error:
            "Shopify could not confirm the cancellation. Reload and verify the current billing status.",
        },
        { status: 502 },
      );
    }

    try {
      await prisma.subscription.update({
        where: { shop: session.shop },
        data: {
          shopifySubscriptionId: cancelled.id,
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
      });
    } catch {
      // The next server-side loader reconciles the durable snapshot from Shopify.
    }
    return redirect("/app/billing");
  }

  return new Response("Unsupported billing action", { status: 400 });
};

function statusLabel(status: string | undefined, verified: boolean) {
  if (!status) return "Not subscribed";
  if (status === "ACTIVE" && verified) return "Active";
  if (status === "PENDING" && verified) return "Pending Shopify approval";
  if (!verified) return "Not verified with Shopify";
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
  const actionData = useActionData<typeof action>() as
    { error?: string; debug?: string } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const subscription = data.subscription;
  const active = data.hasActiveSubscription && data.isVerified;
  const pending = subscription?.status === "PENDING" && data.isVerified;
  const unverifiedPending =
    subscription?.status === "PENDING" && !data.isVerified;
  const canStart = !active && !pending && !unverifiedPending;
  const shopSlug = data.shop.replace(/\.myshopify\.com$/i, "");
  const shopBillingUrl = `https://admin.shopify.com/store/${encodeURIComponent(shopSlug)}/settings/billing`;
  const statusText = statusLabel(subscription?.status, data.isVerified);
  const badgeClass = active
    ? `${styles.badge} ${styles.badgeActive}`
    : pending
      ? `${styles.badge} ${styles.badgePending}`
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
              Recurring subscription · {data.plan.trialDays}-day trial
            </p>
          </div>
          {data.plan.testMode ? (
            <p className={styles.testNote}>
              Development test mode is on. Shopify test approvals do not charge
              a real payment method.
            </p>
          ) : null}
        </header>

        {actionData?.error ? (
          <div className={styles.error} role="alert">
            <strong>We couldn’t complete that billing action.</strong>
            <br />
            {actionData.error}
            {actionData.debug ? (
              <details className={styles.debug}>
                <summary>Development diagnostic</summary>
                <code>{actionData.debug}</code>
              </details>
            ) : null}
          </div>
        ) : null}

        <div className={styles.columns}>
          <section className={styles.card} aria-labelledby="current-plan-title">
            <h2 className={styles.cardTitle} id="current-plan-title">
              Current subscription
            </h2>
            <div className={styles.statusRow}>
              <span className={styles.statusLabel}>Shopify status</span>
              <span className={badgeClass}>
                <span aria-hidden="true">
                  {active ? "●" : pending ? "◷" : "○"}
                </span>
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
                No subscription record is available for this shop yet.
              </p>
            )}
            {!data.isVerified && subscription ? (
              <p className={styles.explainer}>
                Shopify did not confirm this saved record in the latest check.
                It is not being treated as paid access.
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
                  No trial by default. Paid access requires a server-verified
                  active subscription.
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
                Shopify confirmed the active status. You can manage the
                recurring agreement in Shopify or cancel it here.
              </p>
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="cancel" />
              <button
                className={styles.cancelButton}
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Please wait…" : "Cancel subscription"}
              </button>
            </Form>
          </section>
        ) : pending || unverifiedPending ? (
          <section className={styles.actionCard} aria-label="Pending approval">
            <div>
              <h2 className={styles.actionTitle}>
                {pending ? "Approval pending" : "Billing check needed"}
              </h2>
              <p className={styles.actionText}>
                {pending
                  ? "Shopify reports a pending approval. We will not create a second subscription."
                  : "A prior approval attempt is recorded but not confirmed. Check Shopify before retrying; no duplicate request will be made here."}
              </p>
            </div>
            <a
              className={styles.primaryButton}
              href={shopBillingUrl}
              target="_blank"
              rel="noreferrer"
            >
              Check Shopify billing
            </a>
          </section>
        ) : (
          <section
            className={styles.actionCard}
            aria-label="Start subscription"
          >
            <div>
              <h2 className={styles.actionTitle}>Ready to continue?</h2>
              <p className={styles.actionText}>
                Shopify will show the approval screen before any subscription is
                activated.
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
                  ? "Opening Shopify approval…"
                  : subscription?.status === "CANCELLED"
                    ? "Reactivate Performance Pro"
                    : "Start Performance Pro"}
              </button>
            </Form>
          </section>
        )}

        <p className={styles.footnote}>
          Subscription status is checked against Shopify on the server. This
          page does not collect card details. Development test billing is not a
          real charge.
        </p>
      </main>
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
