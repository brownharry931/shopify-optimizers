import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";
import dashboardStyles from "./styles/dashboard.css?url";
import billingStyles from "./styles/billing.css?url";
import scanStyles from "./styles/scan.css?url";
import optimizationStyles from "./styles/optimization.css?url";

// Keep both small app stylesheets available on first render so dashboard ↔
// billing navigation never flashes unstyled content while CSS is fetched.
export const links: LinksFunction = () => [
  { rel: "stylesheet", href: dashboardStyles },
  { rel: "stylesheet", href: billingStyles },
  { rel: "stylesheet", href: scanStyles },
  { rel: "stylesheet", href: optimizationStyles },
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
