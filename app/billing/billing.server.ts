import type { AppSubscription } from "@shopify/shopify-api";
import type { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  BILLING_TEST_MODE,
  PLAN_CURRENCY,
  PLAN_INTERVAL,
  PLAN_NAME,
  PLAN_PRICE,
  PLAN_TRIAL_DAYS,
} from "../config/plan.server";
import type { Prisma } from "@prisma/client";

type SubscriptionStatus =
  | "PENDING"
  | "ACTIVE"
  | "CANCELLED"
  | "DECLINED"
  | "EXPIRED"
  | "FROZEN"
  | "UNKNOWN";

type AuthenticatedAdmin = Awaited<ReturnType<typeof authenticate.admin>>;
type BillingApi = AuthenticatedAdmin["billing"];
type AdminApi = AuthenticatedAdmin["admin"];

function normalizeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "ACTIVE":
      return "ACTIVE";
    case "PENDING":
    case "ACCEPTED":
      return "PENDING";
    case "CANCELLED":
      return "CANCELLED";
    case "DECLINED":
      return "DECLINED";
    case "EXPIRED":
      return "EXPIRED";
    case "FROZEN":
      return "FROZEN";
    default:
      return "UNKNOWN";
  }
}

function newestSubscription(subscriptions: AppSubscription[]) {
  return subscriptions
    .filter((subscription) => subscription.name === PLAN_NAME)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

async function queryShopifySubscriptions(admin: AdminApi) {
  const response = await admin.graphql(`#graphql
    query PerformanceProSubscriptions {
      currentAppInstallation {
        allSubscriptions(first: 250, reverse: true) {
          nodes {
            id
            name
            status
            test
            trialDays
            createdAt
            currentPeriodEnd
          }
        }
      }
    }
  `);
  const result = await response.json();
  return (result.data?.currentAppInstallation?.allSubscriptions?.nodes ??
    []) as AppSubscription[];
}

export async function getVerifiedSubscription(
  admin: AdminApi,
  billing: BillingApi,
  shop: string,
) {
  const result = await billing.check({
    plans: [PLAN_NAME],
    isTest: BILLING_TEST_MODE,
  });
  let remote = newestSubscription(result.appSubscriptions);

  if (!remote) {
    try {
      const allSubscriptions = await queryShopifySubscriptions(admin);
      remote = newestSubscription(
        allSubscriptions.filter(
          (subscription) => BILLING_TEST_MODE || !subscription.test,
        ),
      );
    } catch {
      // A Shopify billing API failure must never grant access from local state.
    }
    if (!remote) {
      const stored = await prisma.subscription.findUnique({ where: { shop } });
      return {
        subscription: stored,
        isVerified: false,
        hasActiveSubscription: false,
      };
    }
  }

  const status = normalizeStatus(remote.status);
  const stored = await prisma.subscription.findUnique({ where: { shop } });
  const sameSubscription = stored?.shopifySubscriptionId === remote.id;
  const shopifyCreatedAt = new Date(remote.createdAt);
  const cancelledAt =
    status === "CANCELLED"
      ? sameSubscription
        ? (stored?.cancelledAt ?? new Date())
        : new Date()
      : null;
  const expiresAt = remote.currentPeriodEnd
    ? new Date(remote.currentPeriodEnd)
    : null;

  const subscription = await prisma.subscription.upsert({
    where: { shop },
    create: {
      shop,
      shopifySubscriptionId: remote.id,
      planName: PLAN_NAME,
      price: PLAN_PRICE,
      currency: PLAN_CURRENCY,
      interval: PLAN_INTERVAL,
      status,
      trialDays: remote.trialDays,
      isTest: remote.test,
      shopifyCreatedAt,
      cancelledAt,
      expiresAt,
    },
    update: {
      shopifySubscriptionId: remote.id,
      planName: PLAN_NAME,
      price: PLAN_PRICE,
      currency: PLAN_CURRENCY,
      interval: PLAN_INTERVAL,
      status,
      trialDays: remote.trialDays,
      isTest: remote.test,
      shopifyCreatedAt,
      cancelledAt,
      expiresAt,
    },
  });

  return {
    subscription,
    isVerified: true,
    hasActiveSubscription:
      status === "ACTIVE" &&
      remote.name === PLAN_NAME &&
      (BILLING_TEST_MODE || !remote.test),
  };
}

export async function reserveBillingRequest(shop: string) {
  return prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${shop}))`;
    const current = await transaction.subscription.findUnique({
      where: { shop },
    });
    if (current?.status === "PENDING") {
      return { reserved: false as const };
    }

    await transaction.subscription.upsert({
      where: { shop },
      create: {
        shop,
        planName: PLAN_NAME,
        price: PLAN_PRICE,
        currency: PLAN_CURRENCY,
        interval: PLAN_INTERVAL,
        status: "PENDING",
        trialDays: PLAN_TRIAL_DAYS,
        isTest: BILLING_TEST_MODE,
      },
      update: {
        shopifySubscriptionId: null,
        planName: PLAN_NAME,
        price: PLAN_PRICE,
        currency: PLAN_CURRENCY,
        interval: PLAN_INTERVAL,
        status: "PENDING",
        trialDays: PLAN_TRIAL_DAYS,
        isTest: BILLING_TEST_MODE,
        shopifyCreatedAt: null,
        cancelledAt: null,
        expiresAt: null,
      },
    });
    return { reserved: true as const };
  });
}

export async function recordBillingRequestFailure(shop: string) {
  await prisma.subscription.updateMany({
    where: { shop, status: "PENDING", shopifySubscriptionId: null },
    data: { status: "UNKNOWN" },
  });
}

export async function isPlanActive(billing: BillingApi) {
  const result = await billing.check({
    plans: [PLAN_NAME],
    isTest: BILLING_TEST_MODE,
  });
  return result.appSubscriptions.some(
    (subscription) =>
      subscription.name === PLAN_NAME && subscription.status === "ACTIVE",
  );
}

export async function requireActivePerformancePro(billing: BillingApi) {
  if (!(await isPlanActive(billing))) {
    throw new Response("An active Performance Pro subscription is required.", {
      status: 402,
    });
  }
}
