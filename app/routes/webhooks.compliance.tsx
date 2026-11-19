import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deleteShopData } from "../privacy/shop-data.server";

/**
 * Mandatory compliance webhooks (shopify.app.toml → /webhooks/compliance).
 * authenticate.webhook verifies the HMAC and rejects forged requests.
 * SpeedBoost stores no customer personal data: customer requests are
 * acknowledged; shop/redact deletes all shop-owned records idempotently.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  switch (topic) {
    case "SHOP_REDACT":
      await deleteShopData(shop);
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // No customer-level data is collected or stored by this app.
      break;
    default:
      console.warn("Unexpected compliance webhook topic", { topic });
  }
  return new Response(null, { status: 200 });
};
