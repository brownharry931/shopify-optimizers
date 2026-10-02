# SpeedBoost

An embedded Shopify app project for storefront performance diagnostics and reversible optimizations. The existing public **SpeedBoost** app identity is reused; this repository must not be linked to a newly created duplicate app. Unfinished features are not represented as active or verified.

## Current phase

Shopify billing is being migrated to **Shopify App Pricing**. The public offer is intended to be USD $10/month, with no production trial by default. Price and trial terms are controlled in the existing SpeedBoost app's Partner Dashboard, not in code. Development stores should use Shopify's private no-charge testing plan; a trial configured on the public offer also affects production merchants. The app redirects merchants to Shopify's hosted plan-selection page and verifies active subscriptions through the Partner API. In development, the dashboard remains accessible without those credentials, but subscription status is marked unverified, plan selection is disabled, and paid access remains locked. Production fails closed until the Partner API credentials are configured. This migration is not verified until credentials are set and an end-to-end development-store test succeeds.

The app currently does not implement the performance scanner, Theme App Embed activation verification, storefront transformations, or monitoring.

## Run in Codespaces

1. Open this repository in GitHub Codespaces (or another Node 22.12+ Linux environment with terminal access). The dev container installs dependencies, starts PostgreSQL, generates Prisma Client, and applies migrations.
2. Link the existing public **SpeedBoost** app in Shopify CLI with `npx shopify app config link`. Do not create another app. Keep the generated app config local and do not commit user-specific URLs.
3. Set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` as Codespaces secrets. Never paste or commit them.
4. Create a Partner API client for the same Shopify organization with **Manage apps** permission. The provided organization ID, SpeedBoost app GID, and app handle are set as non-secret defaults in `.env.example`; override them only if needed. Privately configure `SHOPIFY_PARTNER_API_ACCESS_TOKEN` (secret). Do not put the access token in Git, client-side code, or chat.
5. In the existing SpeedBoost Partner Dashboard, verify the public plan is USD $10/month and has the intended production trial terms (zero by default). Use Shopify's private no-charge testing plan on a development store. App Pricing does not support a dev-only trial setting in this repository's code.
6. Run the app against a development store, for example: `npm run dev -- --config performance-pro --store your-development-store.myshopify.com`. The config filename/CLI alias is not a new app identity. If Shopify CLI asks to override the app URL for the development store, that only changes the dev-store URL; it does not replace the public app's production URL.
7. Open Billing, follow Shopify's hosted plan-selection page, and verify active status after returning to the app. Then test managing/cancelling through Shopify. These steps have not yet been completed in this workspace.

The Partner API settings must also be configured as private Render environment variables for production. Render must separately deploy this repository to the existing `speedboost.onrender.com` service; Shopify CLI config linking does not deploy the Node server. Never deploy a Codespaces URL to production.

## Project documents

- `PROJECT_AUDIT.md` — baseline repository audit.
- `ARCHITECTURE.md` — proposed architecture, security boundaries, and phase exit criteria.
- `SHOPIFY_APP_REVIEW.md` — self-review checklist (to be completed as features are implemented).

## Safety

No Shopify API secret, Partner API access token, database password, merchant/customer data, or production credentials belong in Git or chat. Never test charges or storefront changes against a live merchant store without explicit approval.
