import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // This webhook is authenticated by the Shopify framework and is safe to replay.
  // Delete sessions even if Shopify already removed them on a previous delivery.
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
