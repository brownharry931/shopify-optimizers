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

  if (isProduction ? amount !== 10 : amount !== 10 && amount !== 0) {
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
