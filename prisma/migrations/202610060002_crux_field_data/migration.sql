ALTER TABLE "PerformanceScan"
    ADD COLUMN "fieldDataSource" TEXT,
    ADD COLUMN "fieldData" JSONB;
