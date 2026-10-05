import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../privacy/shop-data.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);

  // The authenticated handler is idempotent and deletes all shop-owned state.
  await deleteShopData(shop);

  return new Response();
};
