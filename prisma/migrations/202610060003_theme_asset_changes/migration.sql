CREATE TABLE "ThemeAssetChange" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "themeName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "activeKey" TEXT,
    "originalContent" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "optimizedHash" TEXT NOT NULL,
    "originalBytes" INTEGER NOT NULL,
    "optimizedBytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "shopifyJobId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "ThemeAssetChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThemeAssetChange_activeKey_key" ON "ThemeAssetChange"("activeKey");
CREATE INDEX "ThemeAssetChange_shop_createdAt_idx" ON "ThemeAssetChange"("shop", "createdAt");
CREATE INDEX "ThemeAssetChange_shop_themeId_filename_idx" ON "ThemeAssetChange"("shop", "themeId", "filename");
CREATE INDEX "ThemeAssetChange_shop_status_idx" ON "ThemeAssetChange"("shop", "status");
