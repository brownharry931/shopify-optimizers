CREATE TABLE "ThemeEmbedHeartbeat" (
    "shop" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageLoads" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ThemeEmbedHeartbeat_pkey" PRIMARY KEY ("shop")
);

CREATE TABLE "PerformanceScan" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'mobile',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "performance" INTEGER,
    "lcpMs" INTEGER,
    "tbtMs" INTEGER,
    "cls" DOUBLE PRECISION,
    "fcpMs" INTEGER,
    "speedIndexMs" INTEGER,
    "findings" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "PerformanceScan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PerformanceScan_shop_createdAt_idx" ON "PerformanceScan"("shop", "createdAt");
CREATE INDEX "PerformanceScan_shop_status_idx" ON "PerformanceScan"("shop", "status");
