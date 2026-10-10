# SpeedBoost

An embedded Shopify app project for storefront performance diagnostics and reversible optimizations. The existing public **SpeedBoost** app identity is reused; this repository must not be linked to a newly created duplicate app. Unfinished features are not represented as active or verified.

## Current phase

Shopify billing is being migrated to **Shopify App Pricing**. The public offer is intended to be USD $10/month, with no production trial by default. Price and trial terms are controlled in the existing SpeedBoost app's Partner Dashboard, not in code. Development stores should use Shopify's private no-charge testing plan; a trial configured on the public offer also affects production merchants. The app redirects merchants to Shopify's hosted plan-selection page and verifies active subscriptions through the Partner API. In development, the dashboard remains accessible without those credentials, but subscription status is marked unverified, plan selection is disabled, and paid access remains locked. Production fails closed until the Partner API credentials are configured. This migration is not verified until credentials are set and an end-to-end development-store test succeeds.

The app includes a signed Shopify App Proxy heartbeat; a billing-gated audit form for safe same-store home/product/collection/page/blog paths; mobile/desktop PageSpeed Lighthouse results; CrUX data stored separately with URL/origin provenance; and Performance Reports comparing sequential runs. Audits currently run synchronously in the web request, allow three runs per store per hour, and prune old history after 90 days on a later scan; a durable worker queue and live-store quota verification remain pending. The Optimization Center presents the latest saved Core Web Vitals scan and keeps CrUX field LCP/INP/CLS separate from synthetic lab values (TBT is never labeled INP). It reads this store's themes, previews measured CSS/JS minification, and offers narrow Liquid previews: `defer` only for compatible static first-party theme scripts, lazy loading only for Shopify `image_tag` expressions in a section/snippet the merchant confirms is below the fold, and eager/high fetch priority for one manually selected LCP image. It does not delay scripts until interaction, compress/convert image files, rewrite raw `<img>` markup, fix arbitrary CLS shifts, or guarantee improved scores. Any apply action is explicit and limited to an unpublished/development theme; the app saves the original file, verifies hashes, and offers rollback only if the file remains unchanged. The published MAIN theme is never modified or published by the app. Shopify scopes `read_products`, `read_themes`, and `write_themes` are configured, but consent/reinstall and Shopify's separate public-app theme-write exemption are not verified. The migration and GraphQL read/write operations still need development-store testing.

## Run in Codespaces

1. Open this repository in GitHub Codespaces (or another Node 22.12+ Linux environment with terminal access). The dev container installs dependencies, starts PostgreSQL, generates Prisma Client, and applies migrations.
2. Link the existing public **SpeedBoost** app in Shopify CLI with `npx shopify app config link`. Do not create another app. Keep the generated app config local and do not commit user-specific URLs.
3. Set `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` as Codespaces secrets. Never paste or commit them.
4. Create a Partner API client for the same Shopify organization with **Manage apps** permission. The provided organization ID, SpeedBoost app GID, and app handle are set as non-secret defaults in `.env.example`; override them only if needed. Privately configure `SHOPIFY_PARTNER_API_ACCESS_TOKEN` (secret). Do not put the access token in Git, client-side code, or chat.
5. In the existing SpeedBoost Partner Dashboard, verify the public plan is USD $10/month and has the intended production trial terms (zero by default). Use Shopify's private no-charge testing plan on a development store. App Pricing does not support a dev-only trial setting in this repository's code.
6. Pull the latest branch, then run the app against a development store, for example: `npm run dev -- --config performance-pro --store your-development-store.myshopify.com`. The config filename/CLI alias is not a new app identity. Review the requested `read_products`, `read_themes`, and `write_themes` scopes and approve/reinstall on the development store. A merchant's scope consent does not grant Shopify's separate public-app exemption for theme-file writes. Approve the App Proxy config update when Shopify CLI requests it.
7. Open Billing, follow Shopify's hosted plan-selection page, and verify active status after returning to the app. Then test managing/cancelling through Shopify. These steps have not yet been completed in this workspace.
8. Enable the Performance Pro embed in the development theme, publish/preview the storefront outside Theme Editor, visit its homepage, then reload the app dashboard. Only a verified Shopify App Proxy heartbeat marks the embed as active.
9. Open **Scan storefront** and run a mobile scan. A reachable, published storefront and Google PageSpeed quota are required. Optionally set `GOOGLE_PAGESPEED_API_KEY` privately to request a higher provider quota; never put a real key in Git.
10. Open **Optimization**, choose a theme, and inspect the latest Core Web Vitals data. Preview CSS/JS minification, compatible script `defer`, a single selected LCP image hint, or below-the-fold image lazy loading. These Liquid changes are narrow previews, not image conversion or interaction-based JS delay. Apply only to an unpublished/development theme after reviewing and confirming; the app stores the original and offers checksum-guarded rollback. Actual Shopify theme writes require both merchant scope consent and Shopify's separate public-app theme-write exemption.

The Partner API settings must also be configured as private Render environment variables for production. Render must separately deploy this repository to the existing `speedboost.onrender.com` service; Shopify CLI config linking does not deploy the Node server. Never deploy a Codespaces URL to production.

## Project documents

- `PROJECT_AUDIT.md` — baseline repository audit.
- `ARCHITECTURE.md` — proposed architecture, security boundaries, and phase exit criteria.
- `SHOPIFY_APP_REVIEW.md` — self-review checklist (to be completed as features are implemented).

## Safety

No Shopify API secret, Partner API access token, database password, merchant/customer data, or production credentials belong in Git or chat. Never test charges or storefront changes against a live merchant store without explicit approval.
