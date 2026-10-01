import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// At this foundation stage, the only merchant data persisted is Shopify's
// authentication session. Delete it after Shopify verifies the webhook.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await db.session.deleteMany({ where: { shop } });
  return new Response(null, { status: 200 });
};
