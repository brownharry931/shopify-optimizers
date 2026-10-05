import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../privacy/shop-data.server";

// Shopify may request shop data deletion after uninstall.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  await deleteShopData(shop);
  return new Response(null, { status: 200 });
};
