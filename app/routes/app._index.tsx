import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(`#graphql
    query StoreOverview {
      shop {
        name
        myshopifyDomain
        primaryDomain { url }
      }
    }
  `);
  const result = await response.json();
  const shop = result.data?.shop;

  if (!shop) {
    throw new Response("Unable to load the authenticated Shopify store.", {
      status: 502,
    });
  }

  return { shop };
};

export default function Dashboard() {
  const { shop } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Performance Pro">
      <s-section heading="Store connection">
        <s-paragraph>
          Connected to <strong>{shop.name}</strong> ({shop.myshopifyDomain}).
        </s-paragraph>
        <s-paragraph>
          Storefront performance measurements will appear here after the scanner
          is implemented and run. No sample or estimated metrics are shown.
        </s-paragraph>
        {shop.primaryDomain?.url ? (
          <s-link href={shop.primaryDomain.url} target="_blank">
            Open storefront
          </s-link>
        ) : null}
      </s-section>
      <s-section heading="Setup progress">
        <s-unordered-list>
          <s-list-item>Shopify app authentication is required to view this page.</s-list-item>
          <s-list-item>Theme embed and storefront scanning are not configured yet.</s-list-item>
          <s-list-item>Subscription billing has not been implemented yet.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
