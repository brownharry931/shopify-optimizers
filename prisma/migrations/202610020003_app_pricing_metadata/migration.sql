-- Shopify App Pricing exposes trial/cancellation dates through the Partner API.
ALTER TABLE "Subscription"
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "cancelAtEndOfCycle" BOOLEAN NOT NULL DEFAULT false;
