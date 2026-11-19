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
  assert.throws(() => validateAppPricingEntitlement(subscription("0"), true), /public offer/);
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
