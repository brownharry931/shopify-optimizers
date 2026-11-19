import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";
import uiStyles from "./styles/ui.css?url";
import billingStyles from "./styles/billing.css?url";

// Both stylesheets load on first render so client-side navigation between
// pages never flashes unstyled content while CSS is fetched.
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: uiStyles },
  { rel: "stylesheet", href: billingStyles },
];

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
