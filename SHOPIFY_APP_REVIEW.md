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

- [x] Configure `read_products` for planned product/media discovery and `read_themes` for theme inventory/source diagnostics in the existing app manifest and OAuth SDK.
- [x] Configure `write_themes` for the planned draft-theme workflow; Shopify must separately grant the public-app theme-write exemption before any file writes are possible.
- [ ] Sync the changed app version and confirm merchant consent/reinstall on a development store; scope configuration is not proof that access was granted.
- [x] Embed activation uses a signed Shopify App Proxy heartbeat and does not itself require `read_themes`.
- [x] Implement theme inventory/static CSS/JS minification preview and explicitly confirmed writes only to unpublished/development themes; store exact originals and hash checks before any restore. No live-theme write or app-driven publish operation is exposed.
- [ ] Validate the migration and confirm requested scope consent, public-app exemption, and theme-file GraphQL read/write behavior on a development store.
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
- [x] Billing-gated mobile/desktop audits support homepage, product, collection, page, and blog paths; real Lighthouse results are labeled synthetic lab data and CrUX is separate.
- [x] The Theme Optimization flow includes tested minifiers plus guarded draft-theme apply/rollback code; there are no claims of live performance improvement.
- [ ] Validate the audits and minifier theme read/write/rollback against an installed development store; scheduled monitoring and controlled before/after storefront measurement are not complete.

## Build, tests, and release

- [x] `npm test` passed unit tests for transforms, audit input, recommendation guidance, and safe theme-change policy.
- [x] `npm run typecheck` passed in the sandbox.
- [x] `npm run build` passed in the sandbox.
- [x] `npm run lint` passed in the sandbox.
- [x] `npm audit --omit=dev` reports zero production dependency vulnerabilities.
- [ ] Review 4 moderate findings currently reported by full `npm audit` in the development-only Shopify CLI dependency chain; do not downgrade the supported CLI blindly.
- [ ] Prisma engine validation/migrations and Shopify CLI config validation could not be completed in the sandbox because Prisma binary download was blocked and app has not been linked to a Dev Dashboard client ID.
- [ ] A Codespaces run confirmed the correct HTTPS app URL/scope and theme extension checks, but `app info` reported no web process and port 3000 had no listener. Added a concrete `shopify.web.toml`; rerun Shopify CLI and verify the web process/database migration before calling the embedded app working.
- [ ] Install/upgrade/reinstall/uninstall, billing edge cases, webhook delivery, and theme compatibility require real Shopify development-store QA.

## Known limitations / submission status

The current repository contains hosted billing code, multi-template mobile/desktop audit and CrUX/report history, safe standalone CSS/JS minifiers, and a Theme Optimization workflow that lists static theme files, previews minified output, and can explicitly apply/restore only on unpublished/development themes with saved originals and hash conflict checks. None of the new theme reads/writes, migration, scope grant, or rollback has been verified on a development store; a public-app theme-write exemption is still required. Image conversion/responsive markup/lazy loading, critical CSS, safe script/font/app optimization, app-driven theme duplication/publishing, durable background jobs, scheduled monitoring, multi-theme compatibility testing, and final support/legal/listing work remain incomplete. **Not ready for Shopify App Store submission.**
