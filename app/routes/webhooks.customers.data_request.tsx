import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// This app does not request or store customer records. Shopify still requires
// public apps to register and acknowledge privacy-compliance webhook topics.
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.webhook(request);
  return new Response(null, { status: 200 });
};
