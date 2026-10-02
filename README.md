# Performance Pro

An embedded Shopify app project for storefront performance diagnostics and reversible optimizations. The repository is being implemented in audited phases; unfinished features are not represented as active or verified.

## Current phase

Phase 4 (Shopify-managed billing) is implemented in code and awaiting verification in a Shopify development store. The single plan is Performance Pro at USD $10 every 30 days. Development test billing is configured with a seven-day test trial and never charges a real payment method; production defaults to zero trial days unless deliberately configured otherwise. Shopify handles subscription approval; the app uses Shopify's server-side billing checks before considering a subscription active. Production startup requires an explicit `BILLING_TEST_MODE=true` or `false` setting. Billing has not yet been verified against the connected development store. Scanning, Theme App Embed activation verification, storefront transformations, and monitoring are not implemented.

## Run in a browser-based cloud development environment

You do not need Shopify CLI installed on your personal computer. Use GitHub Codespaces (or another Node 22.12+ Linux development environment with terminal access):

1. Open this repository on GitHub and choose **Code → Codespaces → Create codespace**. Codespaces availability/billing depends on your GitHub plan.
2. Select **Create codespace** and wait for the repository's dev container to finish. It installs dependencies, starts a private PostgreSQL container, generates Prisma Client, and applies the migrations. The Shopify CLI is included in development dependencies; no computer-wide CLI install is needed.
3. In the Shopify Dev Dashboard, create the app **Performance Pro** if needed. In the Codespaces terminal, run `npx shopify app config link` and link this repository to that Dev Dashboard app. Complete Shopify login in the browser prompt.
4. Add the app's credentials to Codespaces secrets/environment (or let Shopify CLI provide them during development): `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`. Do not paste secrets in chat or commit them. The local PostgreSQL URL and `SCOPES=read_themes` are set by the dev container. Development billing uses `BILLING_TEST_MODE=true` and does not charge a real payment method.
5. Run `npm run dev -- --store your-development-store.myshopify.com`. Follow Shopify CLI's prompts and install only on your development store. Keep this process running while testing.
6. In Codespaces, Shopify CLI's proxy may listen on port `4040` while the React Router dev server uses a separate local port. Do not assume app traffic is served directly on port `3000`. For a Codespaces-hosted URL, expose the CLI proxy port `4040` temporarily as Public, use that exact forwarded HTTPS address as `application_url` and its `/auth/callback` as redirect URL in a local-only `shopify.app.codespaces.toml`, then run `npx shopify app dev --config codespaces --no-update --store your-development-store.myshopify.com`. The local Codespaces config is git-ignored; never commit the user-specific URL.
7. Verify that the dashboard displays your real store name/domain. Open **Billing**, review the Shopify-managed Performance Pro test approval, approve it, verify the app reflects Shopify's active status, then cancel and verify the updated status. These steps have not yet been performed in this workspace. No scanner metrics or storefront performance results are available yet.

A working public HTTPS endpoint must route requests to the Shopify CLI app proxy for embedded app pages and webhooks. Production deployment instead requires a stable HTTPS host, a production PostgreSQL database, secure environment variables, and a reviewed `shopify app deploy` version. Do not deploy a Codespaces URL to production.

## Project documents

- `PROJECT_AUDIT.md` — baseline repository audit.
- `ARCHITECTURE.md` — proposed architecture, security boundaries, and phase exit criteria.
- `SHOPIFY_APP_REVIEW.md` — self-review checklist (to be completed as features are implemented).

## Safety

No Shopify API secret, access token, database password, merchant/customer data, or production credentials belong in Git or chat. Never test billing or storefront changes against a live merchant store without explicit approval.
