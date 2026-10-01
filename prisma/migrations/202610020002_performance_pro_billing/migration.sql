CREATE TYPE "SubscriptionStatus" AS ENUM (
  'PENDING',
  'ACTIVE',
  'CANCELLED',
  'DECLINED',
  'EXPIRED',
  'FROZEN',
  'UNKNOWN'
);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "shopifySubscriptionId" TEXT,
  "planName" TEXT NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "interval" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'UNKNOWN',
  "trialDays" INTEGER NOT NULL DEFAULT 0,
  "isTest" BOOLEAN NOT NULL DEFAULT false,
  "shopifyCreatedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_shop_key" ON "Subscription"("shop");
CREATE UNIQUE INDEX "Subscription_shopifySubscriptionId_key" ON "Subscription"("shopifySubscriptionId");
CREATE INDEX "Subscription_status_updatedAt_idx" ON "Subscription"("status", "updatedAt");
