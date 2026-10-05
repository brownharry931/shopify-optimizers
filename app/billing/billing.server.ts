import type { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { PLAN_INTERVAL, PLAN_NAME } from "../config/plan.server";

type AuthenticatedAdmin = Awaited<ReturnType<typeof authenticate.admin>>;
type AdminApi = AuthenticatedAdmin["admin"];

type ActiveAppPricingSubscription = {
  shop: { id: string; myshopifyDomain: string };
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: {
    startTime: string;
    endTime: string;
  } | null;
  items: Array<{
    handle: string;
    description: string;
    price: {
      __typename: string;
      active: boolean;
      currency: string;
      amount?: string;
    };
  }>;
  legacySubscriptionId: string | null;
};

type PartnerApiResponse = {
  data?: { activeSubscription: ActiveAppPricingSubscription | null };
  errors?: Array<{ message?: string }>;
};

const DEFAULT_PARTNER_ORG_ID = "2522432";
const DEFAULT_SHOPIFY_APP_GID = "gid://shopify/App/395164614657";
const DEFAULT_SHOPIFY_APP_HANDLE = "speedboost-v2-1";

function partnerConfiguration() {
  // These identifiers are not secrets. Defaults match the existing SpeedBoost app;
  // deployments can still override them for a separate environment.
  const organizationId =
    process.env.SHOPIFY_PARTNER_ORG_ID?.trim() || DEFAULT_PARTNER_ORG_ID;
  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN?.trim();
  const appGid = process.env.SHOPIFY_APP_GID?.trim() || DEFAULT_SHOPIFY_APP_GID;

  if (!organizationId || !/^\d+$/.test(organizationId)) {
    throw new Response(
      "Billing verification setup is incomplete: set SHOPIFY_PARTNER_ORG_ID.",
      { status: 503 },
    );
  }
  if (!accessToken) {
    throw new Response(
      "Billing verification setup is incomplete: configure the Partner API token with Manage apps permission.",
      { status: 503 },
    );
  }
  if (!appGid || !/^gid:\/\/shopify\/App\/\d+$/.test(appGid)) {
    throw new Response(
      "Billing verification setup is incomplete: set SHOPIFY_APP_GID to the public SpeedBoost app GID.",
      { status: 503 },
    );
  }
  return { organizationId, accessToken, appGid };
}

function configuredShopifyAppHandle() {
  return (
    process.env.SHOPIFY_APP_HANDLE?.trim().toLowerCase() ||
    DEFAULT_SHOPIFY_APP_HANDLE
  );
}

export function hasValidShopifyAppHandle() {
  return /^[a-z0-9-]+$/.test(configuredShopifyAppHandle());
}

export function getShopifyAppHandle() {
  const handle = configuredShopifyAppHandle();
  if (!hasValidShopifyAppHandle()) {
    throw new Response(
      "Billing setup is incomplete: set SHOPIFY_APP_HANDLE to the app's pricing-page handle.",
      { status: 503 },
    );
  }
  return handle;
}

export function getShopifyPlanSelectionUrl(shop: string) {
  const storeHandle = shop.replace(/\.myshopify\.com$/i, "");
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(storeHandle)) {
    throw new Error("The authenticated Shopify store domain is invalid.");
  }
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(getShopifyAppHandle())}/pricing_plans`;
}

async function getShopId(admin: AdminApi) {
  const response = await admin.graphql(`#graphql
    query ShopifyAppPricingShopId {
      shop { id }
    }
  `);
  const result = await response.json();
  const shopId = result.data?.shop?.id;
  if (typeof shopId !== "string" || !shopId.startsWith("gid://shopify/Shop/")) {
    throw new Response(
      "Shopify did not return a valid shop ID for billing verification.",
      { status: 502 },
    );
  }
  return shopId;
}

async function getPartnerActiveSubscription(shopId: string) {
  const { organizationId, accessToken, appGid } = partnerConfiguration();
  let response: Response;
  try {
    response = await fetch(
      `https://partners.shopify.com/${organizationId}/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: `query SpeedBoostActiveSubscription($appId: ID!, $shopId: ID!) {
            activeSubscription(appId: $appId, shopId: $shopId) {
              shop { id myshopifyDomain }
              billingPeriod
              cancelAtEndOfCycle
              trialEndsAt
              currentBillingCycle { startTime endTime }
              items {
                handle
                description
                price {
                  __typename
                  active
                  currency
                  ... on FlatRatePrice { amount }
                }
              }
              legacySubscriptionId
            }
          }`,
          variables: { appId: appGid, shopId },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (error) {
    console.error("Shopify Partner API request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    throw new Response(
      "Shopify subscription verification is temporarily unavailable. Paid access remains locked; retry shortly.",
      { status: 503 },
    );
  }

  let result: PartnerApiResponse;
  try {
    result = (await response.json()) as PartnerApiResponse;
  } catch {
    throw new Response(
      "Shopify Partner API returned an unreadable billing response.",
      { status: 502 },
    );
  }
  if (!response.ok || result.errors?.length || !result.data) {
    console.error("Shopify App Pricing verification failed", {
      status: response.status,
      errors: result.errors?.map(({ message }) => message).filter(Boolean),
    });
    throw new Response(
      "Shopify could not verify this subscription. Paid access remains locked; check the Partner API setup and retry.",
      { status: 502 },
    );
  }
  return result.data.activeSubscription;
}

export async function getVerifiedSubscription(admin: AdminApi, shop: string) {
  const hasPartnerConfiguration = Boolean(
    process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN?.trim(),
  );
  if (!hasPartnerConfiguration) {
    const message =
      "Partner API settings are not configured in this development environment. Subscription status is unverified and paid access remains locked.";
    if (process.env.NODE_ENV === "production") {
      throw new Response(message, { status: 503 });
    }
    return {
      subscription: null,
      isVerified: false,
      hasActiveSubscription: false,
      verificationError: message,
    };
  }

  const shopId = await getShopId(admin);
  const remote = await getPartnerActiveSubscription(shopId);

  if (
    remote &&
    (remote.shop.id !== shopId ||
      remote.shop.myshopifyDomain.toLowerCase() !== shop.toLowerCase())
  ) {
    throw new Response(
      "Shopify Partner API returned a subscription for a different shop.",
      { status: 502 },
    );
  }

  if (!remote) {
    return {
      subscription: null,
      isVerified: true,
      hasActiveSubscription: false,
    };
  }

  // activeSubscription already represents the current contract. Shopify can
  // return price.active=false for a valid active contract (for example, a
  // retired price still attached to the merchant's subscription), so this
  // field must not be used to decide whether the contract's item is current.
  const flatRateItems = remote.items.filter(
    (item) => item.price.__typename === "FlatRatePrice",
  );
  if (
    remote.items.length === 0 ||
    flatRateItems.length !== remote.items.length
  ) {
    const itemDetails = remote.items
      .map(
        ({ handle, price }) =>
          `${handle || "(no handle)"}:${price.__typename}:active=${price.active}`,
      )
      .join(", ");
    console.error("Unsupported Shopify App Pricing subscription items", {
      shop,
      items: itemDetails || "(no items)",
    });
    const message =
      "Shopify returned an active subscription outside the supported flat-rate plan configuration.";
    throw new Response(
      process.env.NODE_ENV === "production"
        ? message
        : `${message} Items: ${itemDetails || "(no items)"}`,
      { status: 502 },
    );
  }
  const currency = flatRateItems[0].price.currency;
  if (
    currency !== "USD" ||
    flatRateItems.some((item) => item.price.currency !== currency)
  ) {
    throw new Response(
      "Shopify returned an unexpected subscription currency; expected USD.",
      { status: 502 },
    );
  }
  const amount = flatRateItems.reduce((sum, item) => {
    if (
      typeof item.price.amount !== "string" ||
      item.price.amount.trim() === ""
    ) {
      throw new Response(
        "Shopify returned a flat-rate item without an amount.",
        { status: 502 },
      );
    }
    const itemAmount = Number(item.price.amount);
    if (!Number.isFinite(itemAmount) || itemAmount < 0) {
      throw new Response("Shopify returned an invalid subscription amount.", {
        status: 502,
      });
    }
    return sum + itemAmount;
  }, 0);
  const expiresAt = remote.currentBillingCycle?.endTime
    ? new Date(remote.currentBillingCycle.endTime)
    : null;
  const trialEndsAt = remote.trialEndsAt ? new Date(remote.trialEndsAt) : null;
  const isTestPlan = amount === 0 && process.env.NODE_ENV !== "production";

  const subscription = await prisma.subscription.upsert({
    where: { shop },
    create: {
      shop,
      shopifySubscriptionId: remote.legacySubscriptionId,
      planName: PLAN_NAME,
      price: amount,
      currency,
      interval: remote.billingPeriod || PLAN_INTERVAL,
      status: "ACTIVE",
      trialDays: 0,
      isTest: isTestPlan,
      shopifyCreatedAt: null,
      trialEndsAt,
      cancelledAt: null,
      expiresAt,
      cancelAtEndOfCycle: remote.cancelAtEndOfCycle,
    },
    update: {
      shopifySubscriptionId: remote.legacySubscriptionId,
      planName: flatRateItems[0].description || PLAN_NAME,
      price: amount,
      currency,
      interval: remote.billingPeriod || PLAN_INTERVAL,
      status: "ACTIVE",
      isTest: isTestPlan,
      trialEndsAt,
      cancelledAt: null,
      expiresAt,
      cancelAtEndOfCycle: remote.cancelAtEndOfCycle,
    },
  });

  return {
    subscription,
    isVerified: true,
    hasActiveSubscription: true,
  };
}

export async function requireActivePerformancePro(
  admin: AdminApi,
  shop: string,
) {
  const result = await getVerifiedSubscription(admin, shop);
  if (!result.hasActiveSubscription) {
    throw new Response(
      "An active SpeedBoost Shopify App Pricing subscription is required.",
      {
        status: 402,
      },
    );
  }
}
