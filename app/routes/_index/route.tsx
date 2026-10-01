import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (shop) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showLogin: Boolean(login) };
};

export default function Index() {
  const { showLogin } = useLoaderData<typeof loader>();

  return (
    <main className={styles.index}>
      <section className={styles.content} aria-labelledby="page-title">
        <p className={styles.eyebrow}>Shopify storefront performance</p>
        <h1 className={styles.heading} id="page-title">
          Performance Pro
        </h1>
        <p className={styles.text}>
          Sign in securely through Shopify to connect your store. Store
          measurements and optimization controls will be shown only when they
          are implemented and backed by real store data.
        </p>
        {showLogin ? (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label} htmlFor="shop-domain">
              Shopify store domain
            </label>
            <input
              className={styles.input}
              id="shop-domain"
              type="text"
              name="shop"
              placeholder="your-store.myshopify.com"
              autoComplete="url"
              required
            />
            <button className={styles.button} type="submit">
              Continue with Shopify
            </button>
          </Form>
        ) : (
          <p role="status">Shopify sign-in is not configured on this server.</p>
        )}
      </section>
    </main>
  );
}
