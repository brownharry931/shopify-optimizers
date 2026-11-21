-- Image compressor: one row per compression applied to a store file, with
-- the original bytes kept so the merchant can restore it.
CREATE TABLE "ImageOptimization" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalBytes" INTEGER NOT NULL,
    "optimizedBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "quality" TEXT NOT NULL,
    "psnr" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "backup" BYTEA,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),
    CONSTRAINT "ImageOptimization_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImageOptimization_shop_createdAt_idx" ON "ImageOptimization"("shop", "createdAt");
CREATE INDEX "ImageOptimization_shop_fileId_idx" ON "ImageOptimization"("shop", "fileId");
