# Architecture and Phased Implementation Plan

**Status:** Iterative implementation; the current re-audit and remaining gates are recorded in `PROJECT_AUDIT.md` and `SHOPIFY_APP_REVIEW.md`.
**Product:** Existing public SpeedBoost app identity; one Shopify-managed recurring plan intended at USD $10 per 30-day billing interval; trial defaults to zero days in the public offer.

## Current audit and implementation plan

The repository is a Shopify React Router TypeScript app (Shopify CLI/App Bridge, Admin GraphQL API `2026-10`), npm lockfile, Prisma/PostgreSQL, a Theme App Extension/App Embed, webhook routes, and a Render production URL. Current code also contains Shopify App Pricing/Partner API verification, a signed App Proxy heartbeat, and a persisted PageSpeed Insights mobile-homepage scan. There is no production worker, multi-page/desktop audit, optimizer engine, theme-preview/publish/rollback system, automated test suite, or verified production deployment.

The current Admin interface uses the `s-*` Shopify Admin UI web components provided by the current app template. Continue with that supported embedded UI stack rather than introducing legacy Polaris React dependencies unless the Shopify template guidance changes.

Implementation proceeds as gated phases: (1) verify app/config/database and add unit/integration tests; (2) finish a persistent audit/job/result domain with same-shop URL validation, selected URLs, mobile/desktop, retry/quota controls, and CrUX-vs-lab provenance; (3) implement one reversible, measurable extension-based image/media optimization at a time, with LCP/gallery exclusions and a global off switch; (4) add independent CSS/JS/font/script modules, history, preview and rollback; (5) production security, multiple-theme QA, observability and App Store review. Do not expose unimplemented modules as working navigation or report synthetic savings.

**Shopify constraint:** The app requests `read_products`, `read_themes`, and `write_themes` for planned product-media discovery and theme preview workflows. Shopify's current Admin GraphQL docs require `write_themes` plus a separate Shopify exemption for public-app theme-file writes such as `themeFilesUpsert`. The scope request does not mean the exemption is approved; do not call theme-write APIs or claim app-managed publishing until Shopify grants it. Theme App Extensions remain the safer integration path where they satisfy the feature.

## Current and planned data model

| Model                                        | State                              | Purpose / invariant                                                                                                                                                                            |
| -------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Session`                                    | Implemented                        | Shopify-managed session storage; shop-scoped.                                                                                                                                                  |
| `Subscription`                               | Implemented                        | Minimal latest Partner API snapshot; Shopify remains authoritative.                                                                                                                            |
| `ThemeEmbedHeartbeat`                        | Implemented                        | Aggregate last-seen/page-load signal only; no visitor identifiers or paths.                                                                                                                    |
| `PerformanceScan`                            | Implemented (v1)                   | One real same-store page/device Lighthouse result, explicit `COMPLETE`/`FAILED`, lab provenance, findings, and shop-scoped history.                                                            |
| `AuditRun`                                   | Implemented (v1)                   | Groups mobile/desktop strategies for one allowlisted same-store path, carries template metadata, enforces a per-shop hourly quota, and is pruned with scans after 90 days on a subsequent run. |
| `BackgroundJob` + `JobAttempt`               | Planned next                       | PostgreSQL-backed durable queue with leases, idempotency, retry/backoff, cancellation, concurrency quotas and dead-letter state. Current provider requests remain synchronous.                 |
| `OptimizationSetting` + `OptimizationChange` | Planned                            | Per-shop/module config and versioned changes with exclusions, before/after scan references, manifest/hash and rollback metadata.                                                               |
| `AssetOptimization`                          | Planned                            | Idempotent original/derived asset mapping, sizes, format, quality, status and verified restore path.                                                                                           |
| `ThemeSnapshot` / `ThemeChange`              | Blocked for app-managed publishing | Only add after Shopify grants the required protected `write_themes` exemption; never store or overwrite an unverified merchant baseline.                                                       |

All merchant-owned rows include `shop` or are reachable only through a shop-owned parent. Every read/write must derive that shop from the authenticated Shopify session or a Shopify-verified App Proxy request; never from a browser-supplied shop ID.

## Architectural principles

- Shopify is the authority for merchant identity, billing state, installation lifecycle, and shop data. Verify these server-side; never accept a browser-provided subscription state.
- Use Shopify's supported embedded-app authentication/session-token model and GraphQL Admin API. Keep Admin API tokens and all secrets server-only.
- Use a Theme App Extension with an App Embed as the storefront integration. Never depend on ScriptTag or write directly to merchant theme files.
- Make each optimization opt-in/configurable, narrowly scoped, observable, and reversible. Exclusions override automatic actions. Do not promise a score or improvement.
- Store only data needed to operate and report. Do not request protected customer data or collect customer-identifying data in optional RUM.
- Distinguish synthetic laboratory measurements from field/RUM measurements in storage, APIs, and UI. An unavailable measurement is absent, not fabricated.

## Proposed system

### Embedded admin frontend

The Shopify-supported React Router TypeScript template (`Shopify/shopify-app-template-react-router`, source revision `93348fe7dbd8e1a33eea69e2bbba1990d136b0da`) provides App Bridge integration and the authenticated application shell. Shopify Admin API version is pinned to `2026-10`, supported by the installed Shopify SDK. Authenticated navigation will expose only implemented routes; onboarding, billing/paywall, scans, reports, settings, exclusions, and history remain phased work. The frontend requests data from same-origin authenticated application routes and never decides authorization itself.

Initial navigation can expose only implemented capabilities. Readiness checks report evidence and `WARNING`/`ACTION REQUIRED` for checks that depend on external deployment configuration; they must not report fabricated `PASS` results.

### Backend and authentication

Use the official Shopify app framework/authentication helpers generated by the supported CLI template. Validate session tokens for embedded requests, resolve the shop from verified claims/session, enforce shop-scoped authorization on every route, and use schema validation, safe output encoding, request size/rate limits, and secure headers. Use GraphQL Admin API with the least scopes possible. Avoid customer/order/checkout scopes.

Background work (scans, report generation, retention cleanup) must be retryable, idempotent, bounded, and observable. External scan targets must be restricted to the authenticated shop's verified storefront domain to prevent SSRF; DNS resolution and redirect destinations require validation.

### Persistence

Use a production relational database and migrations; Prisma is a candidate if compatible with the selected official template. Persist Shopify sessions using the template's supported adapter. Add shop ownership and indexes to all merchant data. Planned records: Store/Installation, Theme, Scan/ScanResult/Metric/Resource, Optimization/Run/History, ThirdPartyScript, Exclusion, MonitoringEvent, WebhookEvent, Subscription, AuditLog, and AppSetting.

Keep minimal current subscription state locally for efficient authorization, but refresh it from Shopify before premium authorization-sensitive actions and reconcile through callbacks/webhooks. Never store payment credentials. Define retention and deletion rules before collecting scan/RUM records.

### Billing

The existing public SpeedBoost app uses Shopify App Pricing, so subscription plans, prices, and trial terms live in the Partner Dashboard. The intended public offer is USD $10/month with no trial by default. Do not use legacy `billing.request`, `appSubscriptionCreate`, `billing.check`, or `billing.cancel` for this app. Redirect merchants to Shopify's hosted `/charges/{appHandle}/pricing_plans` page with top-level navigation. Verify current status through the Partner API `activeSubscription(appId:, shopId:)` query using a Partner API client with Manage apps permission; fail closed on unavailable or inactive state. Shopify App Pricing does not send subscription-change webhooks (current docs direct apps to verify redirect parameters and query Partner API for cancellations/freezes/expiry), so do not add a deprecated `APP_SUBSCRIPTIONS_UPDATE` webhook. Use the Partner API historical `events` query for diagnostics/history where needed, never as an access grant over `activeSubscription`. Use Shopify's private no-charge plan for development-store tests; do not mistake that for a dev-only trial on the public offer. Keep only a minimal local snapshot, including current-cycle/trial end and scheduled cancellation metadata; the Partner API is authoritative.

### Shopify lifecycle and compliance

Register mandatory privacy/compliance webhooks and uninstall handling using the official framework registration mechanism. Verify webhook HMAC with the raw request body, persist delivery identifiers for idempotency, return promptly, and defer nontrivial work. On uninstall, stop monitoring, mark the installation inactive, revoke/delete data according to Shopify requirements and documented retention, and ensure the extension stops operating when app embed configuration is removed. Verify actual extension cleanup behavior on a development store.

### Theme App Extension and storefront runtime

The extension contains an App Embed and a small asynchronous runtime/config endpoint. It must not block rendering, poll, or perform broad DOM scans. Its configuration is shop/theme scoped and validated. Optimization modes are conservative by default; all resource matching honors exclusions. Avoid rewriting merchant source. Include Theme Editor preview safeguards and ensure disabling/uninstalling the embed disables app behavior.

The initial safe implementation should focus on measurable, defensible transformations (image dimensions/loading/fetch priority where safely inferred, below-fold lazy loading while preserving likely LCP images, and deferred offscreen media). Never blindly defer all scripts or alter merchant markup in a destructive way. Critical CSS and aggressive script scheduling require separate experiments, explicit warnings, and rollback.

### Performance scanning and data semantics

Start with home, collection, and product URLs supplied/verified for the shop. A scan worker runs controlled mobile and desktop synthetic tests and records tool/version, timestamp, URL/template, device profile, and raw measurement provenance. Field data/RUM is separate, explicitly optional, privacy-safe, and retention limited. Metrics include LCP, INP, CLS, FCP, TBT, Speed Index, TTFB, and resource diagnostics only when the underlying measurement supplies them. Do not present unavailable metrics as zero or substitute synthetic values for field values.

Track baseline/current snapshots and optimization runs so “before/after” statements have actual matching measurements, date, and device. Report “No measurable improvement detected” where appropriate. Shopify storefront, Lighthouse/PageSpeed providers, browser tooling, and merchant settings can change; timeouts and incomplete scans must be explicit.

### Feature access control

A centralized server-side feature registry maps premium capabilities to verified active subscription requirements. All premium mutation/scan/report routes enforce this policy server-side. The UI may reflect access but is not an authority. Billing and essential data-deletion/uninstall operations remain reachable without an active subscription.

### Security, privacy, and operations

Use HTTPS in production, secure cookies as appropriate to the framework, HSTS and content security policies compatible with embedded Shopify, CSRF/origin defenses where relevant, input validation, parameterized database access, rate limiting, secret management, and redacted structured audit logs. Do not log access tokens, secrets, customer PII, or webhook payloads indiscriminately. Include health checks, migration/backup guidance, error monitoring, webhook retry visibility, and retention jobs in deployment docs.

## Delivery phases and exit criteria

1. **Audit — complete:** repository inventory in `PROJECT_AUDIT.md`.
2. **Architecture — documented:** this proposal; update it to reflect actual generated choices.
3. **Shopify foundation:** supported CLI app, embedded authentication, App Bridge, GraphQL, scopes, extension/App Embed, verified compliance/uninstall webhooks. Pass unit/integration checks and development-store install/uninstall.
4. **Billing:** centralized plan configuration; Shopify confirmation and server verification; status/error paths and duplicate prevention. Test active, pending, declined, cancelled, frozen/expired where supported, reinstall, callback replay, and API errors against Shopify test/development configuration. Do not unlock premium functionality before this gate.
5. **Scanner:** real, provenance-labeled scans for home/collection/product and mobile/desktop. Test SSRF defenses, failure/timeout handling, and no-data behavior.
6. **Optimization engine:** deliver transformations in discrete, tested increments: safe images/media, LCP/preload, fonts, script classification/deferral, third-party diagnostics, CSS/critical CSS experiments, CLS/INP diagnostics. Measure and avoid guarantees.
7. **Safety:** exclusions, validation/conflict checks, per-change/category/global rollback, audit history; verify rollback and extension-off behavior.
8. **Monitoring:** historical scans, regression evidence, resource changes, and third-party change detection with bounded scheduling.
9. **QA and release:** responsive UI/theme compatibility, cart/variant/search/navigation/analytics checks, security/privacy review, deployment rehearsal, final audit. Mark external tests unverified until actually run on real Shopify development stores.

## Initial configuration and environment contract (to establish during foundation)

- Shopify app credentials and app URL via deployment secret manager.
- Admin API scopes limited to those actually needed; no customer/order scopes by default.
- Database URL and secure session storage.
- Shopify CLI-managed webhook/app configuration and any required webhook secrets.
- Shopify App Pricing plan configured in the existing SpeedBoost Partner Dashboard: USD $10/month, production trial disabled by default. Keep Partner API org ID, access token, SpeedBoost app GID, and app handle in deployment secrets; use a private no-charge development plan for tests.
- Scanner/provider settings and strict timeouts/rate limits, if an external provider is selected.
- Optional RUM configuration disabled by default, with documented consent/notice, data minimization, and retention.

Never commit real credentials or production data. Provide an `.env.example` containing placeholders only after the selected template establishes exact variable names.

## Open decisions before foundation

- Shopify-supported starter template and exact supported Node/package versions at implementation time.
- Hosting/database/job mechanism appropriate for the selected deployment target.
- Whether synthetic testing uses an external measurement provider or a controlled browser worker; its credentials, costs, and mobile/desktop fidelity must be evaluated.
- Data retention period and merchant-facing privacy/terms/support contact details.
- Which theme/app-embed state can be reliably queried under the selected least-privilege API scopes; do not infer installation/activation when unavailable.
