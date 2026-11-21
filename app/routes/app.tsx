import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

// The layout only supplies the constant API key; every child route
// authenticates itself, so re-running this on each navigation is wasted work.
export const shouldRevalidate = () => false;

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  // Immediate feedback while the next page's data loads.
  const navigating = navigation.state === "loading" && !navigation.formMethod;

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/setup">Setup guide</s-link>
        <s-link href="/app/scan">Speed audit</s-link>
        <s-link href="/app/speed">Speed boosters</s-link>
        <s-link href="/app/optimize">Theme audit</s-link>
        <s-link href="/app/images">Image compressor</s-link>
        <s-link href="/app/reports">Reports</s-link>
        <s-link href="/app/billing">Billing</s-link>
      </s-app-nav>
      {navigating ? (
        <div className="sb-navProgress" role="progressbar" aria-label="Loading page">
          <span />
        </div>
      ) : null}
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
