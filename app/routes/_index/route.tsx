import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import styles from "./styles.module.css";

// Shopify App Store requirement 2.3.1: the app never asks merchants to type
// their shop domain. Installation and login are handled by Shopify; requests
// from the Shopify admin carry ?shop=… and go straight into the app.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function Index() {
  return (
    <main className={styles.index}>
      <section className={styles.content} aria-labelledby="page-title">
        <p className={styles.eyebrow}>Shopify storefront performance</p>
        <h1 className={styles.heading} id="page-title">
          SpeedBoost
        </h1>
        <p className={styles.text}>
          Measure your store&apos;s speed with Google Lighthouse, switch on
          reversible speed settings through a theme app embed, and get
          step-by-step recommendations for your theme.
        </p>
        <p className={styles.text}>
          Install SpeedBoost from the Shopify App Store, then open it from
          Apps in your Shopify admin.
          {/* TODO: link to the Shopify App Store listing once it is approved. */}
        </p>
        <p className={styles.text}>
          <a href="/privacy" target="_self">
            Privacy policy
          </a>
        </p>
      </section>
    </main>
  );
}
