import { useLoaderData } from "react-router";
import type { MetaFunction } from "react-router";

export const meta: MetaFunction = () => [{ title: "SpeedBoost privacy policy" }];

export const loader = async () => ({
  supportEmail: process.env.SUPPORT_EMAIL?.trim() || null,
});

/**
 * Public privacy policy (linked from the Shopify App Store listing).
 * Describes exactly what the code stores; update it with any data change.
 */
export default function PrivacyPolicy() {
  const { supportEmail } = useLoaderData<typeof loader>();
  return (
    <main className="sb-app" style={{ maxWidth: 760 }}>
      <h1 className="sb-pageTitle">SpeedBoost privacy policy</h1>
      <p className="sb-muted">Last updated: 20 November 2026</p>

      <h2>What SpeedBoost is</h2>
      <p>
        SpeedBoost is a Shopify app that measures storefront speed with Google PageSpeed Insights and applies
        optional speed settings through a theme app embed.
      </p>

      <h2>Data we store</h2>
      <ul>
        <li>
          <strong>Store and session data:</strong> your shop&apos;s myshopify domain and the access token Shopify
          issues when the app is installed, used only to call Shopify APIs on your behalf.
        </li>
        <li>
          <strong>Speed audit results:</strong> the public storefront URL audited, Google Lighthouse scores, metrics,
          diagnostics and page screenshots of your public storefront. Kept for 90 days.
        </li>
        <li>
          <strong>Speed booster settings:</strong> stored by Shopify as app data on your store.
        </li>
        <li>
          <strong>Theme files:</strong> read on demand to produce the theme audit and never stored or changed.
          Records of theme changes made by earlier versions of the app are kept until you uninstall.
        </li>
        <li>
          <strong>Subscription status:</strong> your plan status as reported by Shopify. Payments are handled by
          Shopify; we never receive card details.
        </li>
        <li>
          <strong>App embed check-in:</strong> the time the storefront app embed last reported in, and a count of
          check-ins. No visitor identifiers are stored.
        </li>
      </ul>

      <h2>Customer data</h2>
      <p>
        SpeedBoost does not collect, store or process personal data about your customers or storefront visitors.
      </p>

      <h2>Third parties</h2>
      <p>
        Your public storefront URL is sent to Google PageSpeed Insights to run audits (see{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google&apos;s privacy policy</a>).
        The app is hosted on Render. We do not sell or share data for advertising.
      </p>

      <h2>Deletion</h2>
      <p>
        When you uninstall SpeedBoost, all data above is deleted from our database. Shopify&apos;s data deletion
        requests (shop and customer redaction) are processed automatically.
      </p>

      <h2>Contact</h2>
      <p>
        {supportEmail ? (
          <>Questions or requests: {supportEmail}</>
        ) : (
          "Questions or requests: contact us through the support details on our Shopify App Store listing."
        )}
      </p>
    </main>
  );
}
