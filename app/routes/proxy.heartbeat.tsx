import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const { session } = await authenticate.public.appProxy(request);
  if (!session?.shop) {
    return new Response("Shopify app proxy session is unavailable", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }

  await prisma.themeEmbedHeartbeat.upsert({
    where: { shop: session.shop },
    create: { shop: session.shop },
    update: { lastSeenAt: new Date(), pageLoads: { increment: 1 } },
  });

  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
};
