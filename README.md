# Performance Pro

An embedded Shopify app project for storefront performance diagnostics and reversible optimizations. The repository is being implemented in audited phases; unfinished features are not represented as active or verified.

## Current phase

Phase 3 (Shopify foundation) is in progress. The source uses Shopify's official React Router app template, Shopify-managed embedded authentication/App Bridge, the Admin GraphQL API, Prisma session storage, PostgreSQL configuration, and Shopify webhook authentication. Billing, scanning, and storefront transformations are not implemented yet.

## Run in a browser-based cloud development environment

You do not need Shopify CLI installed on your personal computer. Use GitHub Codespaces (or another Node 22.12+ Linux development environment with terminal access):

1. Open this repository on GitHub and choose **Code → Codespaces → Create codespace**. Codespaces availability/billing depends on your GitHub plan.
2. Select **Create codespace** and wait for the repository's dev container to finish. It installs dependencies, starts a private PostgreSQL container, generates Prisma Client, and applies the initial session migration. The Shopify CLI is included in development dependencies; no computer-wide CLI install is needed.
3. In the Shopify Dev Dashboard, create the app **Performance Pro** if needed. In the Codespaces terminal, run `npx shopify app config link` and link this repository to that Dev Dashboard app. Complete Shopify login in the browser prompt.
4. Add the app's credentials to Codespaces secrets/environment (or let Shopify CLI provide them during development): `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET`. Do not paste secrets in chat or commit them. The local PostgreSQL URL and `SCOPES=read_themes` are set by the dev container.
5. Run `npm run dev -- --store your-development-store.myshopify.com`. Follow Shopify CLI's prompts and install only on your development store. Shopify CLI will provide a temporary HTTPS development URL and update the development app URLs.
6. Verify that the authenticated dashboard displays your real store name/domain. Billing and optimization behavior are not available at this foundation stage.

Shopify CLI provides the temporary HTTPS development tunnel and updates development URLs. Production deployment requires a stable HTTPS host, a production PostgreSQL database, secure environment variables, and `shopify app deploy` to release app configuration/extensions. The exact commands may vary slightly by Shopify CLI release; consult the linked current Shopify docs before deployment.

## Project documents

- `PROJECT_AUDIT.md` — baseline repository audit.
- `ARCHITECTURE.md` — proposed architecture, security boundaries, and phase exit criteria.
- `SHOPIFY_APP_REVIEW.md` — self-review checklist (to be completed as features are implemented).

## Safety

No Shopify API secret, access token, database password, merchant/customer data, or production credentials belong in Git or chat. Never test billing or storefront changes against a live merchant store without explicit approval.
