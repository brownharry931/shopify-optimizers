export type EntitlementPrice = {
  __typename: string;
  active: boolean;
  currency: string;
  amount?: string;
};

export type EntitlementItem = {
  handle: string;
  description: string;
  price: EntitlementPrice;
};

export type EntitlementSubscription = {
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  currentBillingCycle: { startTime: string; endTime: string } | null;
  items: EntitlementItem[];
};

export function validateAppPricingEntitlement(
  subscription: EntitlementSubscription,
  isProduction: boolean,
  now = new Date(),
) {
  if (subscription.items.length === 0) {
    throw new Error("The Shopify App Pricing subscription has no plan items.");
  }

  if (
    subscription.billingPeriod !== "EVERY_30_DAYS"
  ) {
    throw new Error("The Shopify App Pricing subscription has an unsupported billing period.");
  }

  if (
    subscription.items.some(
      (item) => item.price.__typename !== "FlatRatePrice",
    )
  ) {
    throw new Error("The Shopify App Pricing subscription has unsupported item types.");
  }

  if (
    subscription.items.some(
      (item) => item.price.currency !== "USD",
    )
  ) {
    throw new Error("The Shopify App Pricing subscription must use USD.");
  }

  let amount = 0;
  for (const item of subscription.items) {
    if (
      typeof item.price.amount !== "string" ||
      item.price.amount.trim() === ""
    ) {
      throw new Error("The Shopify App Pricing subscription has no valid amount.");
    }
    const itemAmount = Number(item.price.amount);
    if (!Number.isFinite(itemAmount) || itemAmount < 0) {
      throw new Error("The Shopify App Pricing subscription has an invalid amount.");
    }
    amount += itemAmount;
  }

  // $10 is the public offer. Shopify App Pricing creates no-charge
  // subscriptions (effective price $0) only for development stores — which is
  // how Shopify's app reviewers test — or for private plans the Partner
  // creates, so $0 is accepted in every environment. `isProduction` is kept
  // for callers; it no longer changes which amounts are valid.
  void isProduction;
  if (amount !== 10 && amount !== 0) {
    throw new Error("The Shopify App Pricing subscription is not the SpeedBoost public offer.");
  }

  const cycleEnd = subscription.currentBillingCycle?.endTime
    ? new Date(subscription.currentBillingCycle.endTime)
    : null;
  if (
    cycleEnd &&
    (!Number.isFinite(cycleEnd.getTime()) || cycleEnd.getTime() <= now.getTime())
  ) {
    throw new Error("The Shopify App Pricing subscription billing cycle has expired.");
  }

  return { amount };
}

export type CachedSubscriptionRow = {
  status: string;
  updatedAt: Date;
  expiresAt: Date | null;
};

/** How long a live Shopify verification of an ACTIVE plan is trusted. */
export const VERIFIED_CACHE_MS = 10 * 60 * 1000;
/** How long an ACTIVE plan survives a Partner API outage. */
export const OUTAGE_GRACE_MS = 72 * 60 * 60 * 1000;

/**
 * Decide whether a stored ACTIVE subscription can stand in for a live
 * Partner API check. "fresh": skip the network call. "grace": use only if
 * the live check fails. "none": the live result is required.
 * Non-active or expired rows never grant access.
 */
export function cachedEntitlementState(
  row: CachedSubscriptionRow | null,
  now: Date,
  freshMs = VERIFIED_CACHE_MS,
  graceMs = OUTAGE_GRACE_MS,
): "fresh" | "grace" | "none" {
  if (!row || row.status !== "ACTIVE") return "none";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "none";
  const age = now.getTime() - row.updatedAt.getTime();
  if (age < 0) return "none";
  if (age < freshMs) return "fresh";
  if (age < graceMs) return "grace";
  return "none";
}
