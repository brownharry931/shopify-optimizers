import prisma from "../db.server";

// Idempotent deletion shared by uninstall and GDPR shop-redact delivery.
export async function deleteShopData(shop: string) {
  await prisma.$transaction([
    prisma.performanceScan.deleteMany({ where: { shop } }),
    prisma.themeAssetChange.deleteMany({ where: { shop } }),
    prisma.auditRun.deleteMany({ where: { shop } }),
    prisma.themeEmbedHeartbeat.deleteMany({ where: { shop } }),
    prisma.subscription.deleteMany({ where: { shop } }),
    prisma.session.deleteMany({ where: { shop } }),
  ]);
}
