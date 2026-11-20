import assert from "node:assert/strict";
import test from "node:test";
import {
  validateAppPricingEntitlement,
  type EntitlementSubscription,
} from "./entitlement";

function subscription(
  amount: string,
  overrides: Partial<EntitlementSubscription> = {},
): EntitlementSubscription {
  return {
    billingPeriod: "EVERY_30_DAYS",
    cancelAtEndOfCycle: false,
    currentBillingCycle: {
      startTime: "2026-11-01T00:00:00Z",
      endTime: "2026-12-01T00:00:00Z",
    },
    items: [
      {
        handle: "speedboost",
        description: "SpeedBoost",
        price: {
          __typename: "FlatRatePrice",
          active: true,
          currency: "USD",
          amount,
        },
      },
    ],
    ...overrides,
  };
}

test("accepts only the $10 public offer and development test amount", () => {
  assert.equal(validateAppPricingEntitlement(subscription("10"), true).amount, 10);
  assert.equal(validateAppPricingEntitlement(subscription("10"), false).amount, 10);
  assert.equal(validateAppPricingEntitlement(subscription("0"), false).amount, 0);
  // Development stores (and Shopify's app reviewers) get no-charge $0 subscriptions.
  assert.equal(validateAppPricingEntitlement(subscription("0"), true).amount, 0);
  assert.throws(() => validateAppPricingEntitlement(subscription("5"), true), /public offer/);
  assert.throws(() => validateAppPricingEntitlement(subscription("25"), false), /public offer/);
});

test("rejects malformed, unsupported, and expired subscriptions", () => {
  assert.throws(() => validateAppPricingEntitlement(subscription("not-a-number"), false), /invalid amount/);
  assert.throws(
    () => validateAppPricingEntitlement(
      subscription("10", { billingPeriod: "MONTHLY" }),
      true,
    ),
    /billing period/,
  );
  assert.throws(
    () => validateAppPricingEntitlement(
      subscription("10", {
        currentBillingCycle: {
          startTime: "2026-10-01T00:00:00Z",
          endTime: "2026-11-01T00:00:00Z",
        },
      }),
      true,
      new Date("2026-11-19T00:00:00Z"),
    ),
    /expired/,
  );
});

import { cachedEntitlementState } from "./entitlement";

test("recently verified ACTIVE plans skip the live check; older ones only cover outages", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const row = (minutesAgo: number, status = "ACTIVE", expiresAt: Date | null = null) => ({
    status,
    updatedAt: new Date(now.getTime() - minutesAgo * 60_000),
    expiresAt,
  });
  assert.equal(cachedEntitlementState(row(5), now), "fresh");
  assert.equal(cachedEntitlementState(row(60), now), "grace");
  assert.equal(cachedEntitlementState(row(73 * 60), now), "none");
  assert.equal(cachedEntitlementState(null, now), "none");
});

test("cancelled, frozen or expired plans never grant cached access", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const recent = new Date(now.getTime() - 60_000);
  assert.equal(cachedEntitlementState({ status: "CANCELLED", updatedAt: recent, expiresAt: null }, now), "none");
  assert.equal(cachedEntitlementState({ status: "FROZEN", updatedAt: recent, expiresAt: null }, now), "none");
  assert.equal(
    cachedEntitlementState({ status: "ACTIVE", updatedAt: recent, expiresAt: new Date(now.getTime() - 1) }, now),
    "none",
  );
});
