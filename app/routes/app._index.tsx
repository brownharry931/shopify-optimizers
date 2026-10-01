import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getVerifiedSubscription } from "../billing/billing.server";
import { PLAN_CURRENCY, PLAN_NAME, PLAN_PRICE } from "../config/plan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
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
    getVerifiedSubscription(admin, billing, session.shop),
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
    subscriptionStatus: planAccess.isVerified
      ? (planAccess.subscription?.status ?? "UNKNOWN")
      : planAccess.subscription
        ? "UNKNOWN"
        : "NOT_SUBSCRIBED",
    planName: PLAN_NAME,
    planPrice: PLAN_PRICE,
    planCurrency: PLAN_CURRENCY,
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();
  const status = data.hasActiveSubscription
    ? "Active"
    : data.subscriptionStatus === "PENDING"
      ? "Approval pending"
      : data.subscriptionStatus === "NOT_SUBSCRIBED"
        ? "Not subscribed"
        : "Needs verification";

  return (
    <s-page heading="Performance Pro">
      <s-section heading="Your store">
        <s-paragraph>
          Connected to <strong>{data.shop.name}</strong> (
          {data.shop.myshopifyDomain}).
        </s-paragraph>
        {data.shop.primaryDomain?.url ? (
          <s-link href={data.shop.primaryDomain.url} target="_blank">
            Open storefront
          </s-link>
        ) : null}
      </s-section>

      <s-section heading="Performance Pro subscription">
        <s-paragraph>
          {data.planName} · ${data.planPrice.toFixed(2)} {data.planCurrency} /
          month
        </s-paragraph>
        <s-paragraph>
          Status: <strong>{status}</strong>
        </s-paragraph>
        <s-paragraph>
          Paid access is enabled only when Shopify confirms an active
          subscription on the server.
        </s-paragraph>
        <s-link href="/app/billing">Open Billing &amp; Subscription</s-link>
      </s-section>

      <s-section heading="Store performance">
        <s-paragraph>
          {data.hasActiveSubscription
            ? "No baseline scan has been run yet. Real measurements will appear after the scanner is implemented and run."
            : "Subscribe to Performance Pro to access paid performance features. A real scanner is the next product phase; no sample scores or Core Web Vitals are shown."}
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>
            LCP, INP, CLS, FCP, TBT, and Speed Index: no scan data yet
          </s-list-item>
          <s-list-item>
            Synthetic and field measurements will be labeled separately
          </s-list-item>
          <s-list-item>
            Before/after comparisons will use actual scans only
          </s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Setup status">
        <s-unordered-list>
          <s-list-item>
            Shopify authentication and store connection: verified for this
            session
          </s-list-item>
          <s-list-item>
            Theme App Embed: foundation is present; activation and verification
            are not complete
          </s-list-item>
          <s-list-item>
            Optimization scanner and storefront changes: not implemented yet
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
