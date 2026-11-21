import type { LoaderFunctionArgs } from "react-router";
import { login } from "../../shopify.server";

/**
 * No manual shop-domain entry (App Store requirement 2.3.1).
 * Shopify-managed installation and token exchange authenticate embedded
 * sessions. If the framework sends a request here with a valid ?shop=, hand
 * it to Shopify's login flow (which redirects); otherwise explain how to open
 * the app.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = new URL(request.url).searchParams.get("shop");
  if (shop && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    await login(request); // throws a redirect into Shopify's auth flow
  }
  return null;
};

export default function Auth() {
  return (
    <main style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", maxWidth: 520, margin: "15vh auto", padding: "0 20px", color: "#0b1220" }}>
      <h1 style={{ fontSize: 22 }}>Open SpeedBoost from your Shopify admin</h1>
      <p style={{ color: "#5e6a7d", lineHeight: 1.6 }}>
        In your Shopify admin, go to <strong>Apps</strong> and select <strong>SpeedBoost</strong>. If the app is not
        installed yet, install it from the Shopify App Store.
      </p>
    </main>
  );
}
