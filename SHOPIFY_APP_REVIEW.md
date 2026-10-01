# Shopify App Review — Working Self-Review

**Status:** In progress; not an App Store submission approval or completed review.
**Last reviewed:** 2026-10-02

Shopify's current App Review/AI Toolkit process must be checked again against the live Dev Dashboard and current Shopify documentation before submission. This checklist records code-level evidence only; unverified external behavior is explicitly marked pending.

## Authentication and embedded app

- [x] Based on Shopify's official React Router embedded app template (`Shopify/shopify-app-template-react-router`, source revision `93348fe7dbd8e1a33eea69e2bbba1990d136b0da`).
- [x] Shopify framework authentication guards the embedded app route; App Bridge provider is present.
- [x] Admin API access uses GraphQL; no REST/ScriptTag implementation.
- [ ] Link to Dev Dashboard and test install, auth/session-token behavior, refresh/reinstall, and embedded navigation on a real development store.

## APIs and scopes

- [x] Requested scope is `read_themes` only, for planned theme-aware onboarding. No customers, orders, payment, or checkout scopes are requested.
- [x] Admin GraphQL store overview is implemented; API version is set to Shopify's October 2026 version supported by the installed SDK.
- [ ] Validate actual required theme access and app-embed verification path; remove any scope found unnecessary.
- [ ] Verify GraphQL query against a development shop.

## Billing

- [ ] Shopify recurring subscription flow, $10 USD / 30-day interval, zero default trial, server-side verification, event reconciliation, and feature gating are not implemented.
- [ ] Do not submit or enable paid access until billing phase tests pass.

## Webhooks and uninstall

- [x] Configured app uninstall and scope-update webhook handlers use the Shopify framework's authenticated webhook helper.
- [x] Configured the three mandatory customer/shop privacy compliance topics; app requests no customer data.
- [x] Uninstall deletion is idempotent for current session records.
- [ ] Validate exact webhook subscriptions and HMAC/retry delivery in Dev Dashboard/development store.
- [ ] Implement data deletion for future app data models and test replay/retention when those models are introduced.

## Theme App Extension

- [x] Added a Theme App Extension App Embed block foundation. It does not modify theme files and currently injects no storefront script.
- [ ] Generate/validate the extension with Shopify CLI, deploy it, and inspect it in Theme Editor on a development theme.
- [ ] Implement actual storefront behavior only after paid entitlement, safety, exclusions, rollback, and performance measurement are in place.

## Security and privacy

- [x] Secrets are represented only by placeholders in `.env.example`; `.env` is ignored.
- [x] PostgreSQL persistence is configured for Shopify session storage; parameterized ORM access is used.
- [x] No customer/order data is requested or intentionally collected.
- [ ] Complete production security review (CSP/headers, abuse/rate limits, logs, session retention, deployment TLS, database access/backup, secret rotation).
- [ ] Publish truthful Privacy Policy, Terms, data-retention/deletion disclosures, support contact, and developer details before listing.

## Storefront performance claims

- [x] Dashboard displays actual authenticated shop identity and explicitly shows no metrics until a real scanner runs.
- [x] No fake performance measurements, testimonials, or guaranteed score claims are present in the implemented dashboard.
- [ ] Scanner, before/after evidence, optimization engine, rollback, and monitoring are not implemented.

## Build, tests, and release

- [x] `npm run typecheck` passed in the sandbox.
- [x] `npm run build` passed in the sandbox.
- [x] `npm run lint` passed in the sandbox.
- [x] `npm audit` reported zero vulnerabilities after removing unused codegen dependencies and applying a patched deepmerge-ts override; re-run on every dependency update.
- [ ] Prisma engine validation/migrations and Shopify CLI config validation could not be completed in the sandbox because Prisma binary download was blocked and app has not been linked to a Dev Dashboard client ID.
- [ ] Install/upgrade/reinstall/uninstall, billing edge cases, webhook delivery, and theme compatibility require real Shopify development-store QA.

## Known limitations / submission status

The current repository is an early app foundation, not a complete paid performance app. Billing, scanner, optimizations, monitoring, reports, readiness checks, support/legal pages, and production deployment are incomplete. **Not ready for Shopify App Store submission.**
