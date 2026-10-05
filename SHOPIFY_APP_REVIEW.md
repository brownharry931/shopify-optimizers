# Shopify App Review — Working Self-Review

**Status:** In progress; not an App Store submission approval or completed review.
**Last reviewed:** 2026-10-05

Shopify's current App Review/AI Toolkit process must be checked again against the live Dev Dashboard and current Shopify documentation before submission. This checklist records code-level evidence only; unverified external behavior is explicitly marked pending.

## Authentication and embedded app

- [x] Based on Shopify's official React Router embedded app template (`Shopify/shopify-app-template-react-router`, source revision `93348fe7dbd8e1a33eea69e2bbba1990d136b0da`).
- [x] Shopify framework authentication guards the embedded app route; App Bridge provider is present.
- [x] Admin API access uses GraphQL; no REST/ScriptTag implementation.
- [ ] Link to Dev Dashboard and test install, auth/session-token behavior, refresh/reinstall, and embedded navigation on a real development store.

## APIs and scopes

- [ ] Request `read_products` for product/media discovery and `read_themes` for theme inventory/source diagnostics through the existing app's next Shopify configuration release.
- [ ] Request `write_themes` only for the planned draft-theme workflow; Shopify must separately grant the public-app theme-write exemption before any file writes are possible.
- [x] Embed activation uses a signed Shopify App Proxy heartbeat and does not itself require `read_themes`.
- [ ] Confirm the requested scopes, consent/reinstall flow, and app-proxy configuration through Shopify CLI on a development store.
- [ ] Do not request customer, order, payment, checkout, or unrelated file scopes; no implemented workflow currently needs them.
- [ ] Verify GraphQL query against a development shop.

## Billing

- [x] Hosted Shopify App Pricing selection, Partner API active-subscription verification, and a server-side subscription gate for the mobile scan are implemented in code.
- [ ] Confirm the $10 USD / 30-day offer and zero production trial in the Partner Dashboard; test subscription state, cancellation, errors, and paid gating on a development store.
- [ ] Do not submit or enable production paid access until billing phase tests pass.

## Webhooks and uninstall

- [x] Configured app uninstall and scope-update webhook handlers use the Shopify framework's authenticated webhook helper.
- [x] Configured the three mandatory customer/shop privacy compliance topics; app requests no customer data.
- [x] Uninstall and shop-redact handlers idempotently delete sessions, subscription snapshots, scan history, and embed-heartbeat records.
- [ ] Validate exact webhook subscriptions and HMAC/retry delivery in Dev Dashboard/development store.
- [ ] Verify 90-day scan retention cleanup and data deletion/replay behavior on a development database.

## Theme App Extension

- [x] Added a Theme App Extension App Embed that loads a tiny deferred storefront heartbeat; no theme files are modified and no render-blocking optimization code is injected.
- [x] Added a Shopify-signed App Proxy heartbeat so Admin readiness can reflect a real published-storefront visit instead of a hardcoded "not verified" state.
- [ ] Sync the app-proxy manifest, apply the database migration, and verify activation on a development store. Theme Editor preview does not count as proof of published storefront execution.
- [ ] Implement actual storefront optimizations only after verified paid entitlement, safety, exclusions, rollback, and before/after measurement are in place.

## Security and privacy

- [x] Secrets are represented only by placeholders in `.env.example`; `.env` is ignored.
- [x] PostgreSQL persistence is configured for Shopify session storage; parameterized ORM access is used.
- [x] No customer/order data is requested or intentionally collected.
- [ ] Complete production security review (CSP/headers, abuse/rate limits, logs, session retention, deployment TLS, database access/backup, secret rotation).
- [ ] Publish truthful Privacy Policy, Terms, data-retention/deletion disclosures, support contact, and developer details before listing.

## Storefront performance claims

- [x] Dashboard displays actual authenticated shop identity and explicitly shows no metrics until a real scanner runs.
- [x] No fake performance measurements, testimonials, or guaranteed score claims are present in the implemented dashboard.
- [x] A billing-gated mobile homepage scan uses Google PageSpeed Insights and persists real Lighthouse output, explicitly labeled synthetic lab data.
- [ ] Desktop and collection/product scans, matching before/after evidence, automatic optimization, rollback, and monitoring are not implemented or tested.

## Build, tests, and release

- [x] `npm run typecheck` passed in the sandbox.
- [x] `npm run build` passed in the sandbox.
- [x] `npm run lint` passed in the sandbox.
- [x] `npm audit` reported zero vulnerabilities after removing unused codegen dependencies and applying a patched deepmerge-ts override; re-run on every dependency update.
- [ ] Prisma engine validation/migrations and Shopify CLI config validation could not be completed in the sandbox because Prisma binary download was blocked and app has not been linked to a Dev Dashboard client ID.
- [ ] A Codespaces run confirmed the correct HTTPS app URL/scope and theme extension checks, but `app info` reported no web process and port 3000 had no listener. Added a concrete `shopify.web.toml`; rerun Shopify CLI and verify the web process/database migration before calling the embedded app working.
- [ ] Install/upgrade/reinstall/uninstall, billing edge cases, webhook delivery, and theme compatibility require real Shopify development-store QA.

## Known limitations / submission status

The current repository contains the hosted billing foundation, a first billing-gated mobile homepage scan, and code for signed Theme App Embed verification. The merchant screenshot shows an active billing status, but the new scan and app-proxy integrations have not yet been validated on a live development store in this sandbox. Product-level optimization features (image compression/resizing, responsive images, lazy loading, critical CSS, JS/CSS minification/deferral, preload/app control), multi-template and desktop scans, before/after evidence, rollback, monitoring, and final support/legal/public-listing requirements remain incomplete. The Prisma migration, App Proxy sync, Render production deployment, and real store QA are still pending. **Not ready for Shopify App Store submission.**
