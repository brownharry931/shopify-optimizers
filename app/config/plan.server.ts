import { BillingInterval } from "@shopify/shopify-app-react-router/server";

export const PLAN_NAME = "Performance Pro";
export const PLAN_PRICE = 10;
export const PLAN_CURRENCY = "USD";

const configuredInterval = process.env.PLAN_INTERVAL?.trim() || "EVERY_30_DAYS";
if (configuredInterval !== "EVERY_30_DAYS") {
  throw new Error(
    "PLAN_INTERVAL must be EVERY_30_DAYS for the monthly Performance Pro plan",
  );
}
export const PLAN_INTERVAL = BillingInterval.Every30Days;

function nonNegativeDays(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("TRIAL_DAYS must be a non-negative integer");
  }
  return parsed;
}

// Development billing uses a seven-day test trial; test charges never collect
// real money. Production keeps the agreed no-trial default unless explicitly
// configured by the deployment owner.
export const PLAN_TRIAL_DAYS = nonNegativeDays(
  process.env.TRIAL_DAYS,
  process.env.NODE_ENV === "production" ? 0 : 7,
);

function billingTestMode(): boolean {
  const configured = process.env.BILLING_TEST_MODE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  if (configured !== undefined && configured !== "") {
    throw new Error("BILLING_TEST_MODE must be either true or false");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Set BILLING_TEST_MODE=true or false explicitly in production",
    );
  }
  return true;
}

// Development/test shops are safe by default; production cannot silently
// create live recurring charges without an explicit deployment decision.
export const BILLING_TEST_MODE = billingTestMode();
