-- Verbatim Lighthouse/PageSpeed presentation data (category scores, metric
-- display values, audits, screenshots) and measured image savings.
ALTER TABLE "PerformanceScan"
    ADD COLUMN "report" JSONB,
    ADD COLUMN "lighthouseVersion" TEXT;
