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
      console.error("Shopify subscription request failed", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
      return Response.json(
        {
          error:
            "Shopify could not start the subscription approval. No payment details were stored. Please retry or try again later.",
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
    { error?: string } | undefined;
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

  return (
    <s-page heading="Billing & Subscription">
      <s-section heading={data.plan.name}>
        <s-paragraph>
          <strong>
            ${data.plan.price.toFixed(2)} {data.plan.currency}
          </strong>{" "}
          / month, billed every 30 days through Shopify.
        </s-paragraph>
        <s-paragraph>
          Trial: {data.plan.trialDays} days. Payment approval and payment
          details are handled by Shopify.
        </s-paragraph>
        {data.plan.testMode ? (
          <s-paragraph>
            Development billing test mode is on. Shopify test approvals do not
            charge a real payment method.
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Current subscription">
        <s-paragraph>
          Status:{" "}
          <strong>{statusLabel(subscription?.status, data.isVerified)}</strong>
        </s-paragraph>
        {subscription ? (
          <>
            <s-paragraph>Plan: {subscription.planName}</s-paragraph>
            <s-paragraph>
              Shopify subscription created:{" "}
              {dateLabel(subscription.shopifyCreatedAt)}
            </s-paragraph>
            <s-paragraph>
              Current billing period ends: {dateLabel(subscription.expiresAt)}
            </s-paragraph>
          </>
        ) : (
          <s-paragraph>
            No subscription record is currently available for this shop.
          </s-paragraph>
        )}
        {!data.isVerified && subscription ? (
          <s-paragraph>
            The saved record is not being treated as paid access; Shopify did
            not return a matching subscription in this check.
          </s-paragraph>
        ) : null}
        <s-link href={shopBillingUrl} target="_blank">
          Manage Shopify billing
        </s-link>
      </s-section>

      {actionData?.error ? (
        <s-section heading="Billing action needs attention">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-section>
      ) : null}

      {active ? (
        <s-section heading="Subscription actions">
          <s-paragraph>
            Performance Pro is active according to a server-side Shopify billing
            check.
          </s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Working…" : "Cancel subscription"}
            </button>
          </Form>
        </s-section>
      ) : pending || unverifiedPending ? (
        <s-section
          heading={pending ? "Approval pending" : "Billing check required"}
        >
          <s-paragraph>
            {pending
              ? "Shopify reports a pending subscription. No second subscription will be created."
              : "A previous approval attempt is recorded, but Shopify has not confirmed its state. No duplicate subscription will be created from this screen."}
          </s-paragraph>
          <s-link href={shopBillingUrl} target="_blank">
            Check Shopify billing settings
          </s-link>
        </s-section>
      ) : (
        <s-section heading="Start Performance Pro">
          <s-paragraph>
            Subscribe through Shopify’s secure approval flow. You can review the
            recurring charge before approving.
          </s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="start" />
            <button type="submit" disabled={!canStart || isSubmitting}>
              {isSubmitting
                ? "Opening Shopify approval…"
                : subscription?.status === "CANCELLED"
                  ? "Reactivate Performance Pro"
                  : "Start Performance Pro"}
            </button>
          </Form>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs: Parameters<typeof boundary.headers>[0]) =>
  boundary.headers(headersArgs);
