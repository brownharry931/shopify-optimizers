CREATE TABLE "AuditRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "strategies" TEXT[] NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AuditRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PerformanceScan"
    ADD COLUMN "auditRunId" TEXT,
    ADD COLUMN "template" TEXT NOT NULL DEFAULT 'home';

CREATE INDEX "AuditRun_shop_createdAt_idx" ON "AuditRun"("shop", "createdAt");
CREATE INDEX "AuditRun_shop_status_idx" ON "AuditRun"("shop", "status");
CREATE INDEX "PerformanceScan_auditRunId_strategy_idx" ON "PerformanceScan"("auditRunId", "strategy");

ALTER TABLE "PerformanceScan"
    ADD CONSTRAINT "PerformanceScan_auditRunId_fkey"
    FOREIGN KEY ("auditRunId") REFERENCES "AuditRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
