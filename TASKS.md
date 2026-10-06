# Product task tracker

Tasks are marked complete only after implementation and the phase's applicable verification. Shopify-hosted behavior remains pending until tested against the merchant's development store.

## Phase 1 — Audit

- [x] Inspect the repository, Git state, package/config files, Shopify setup, app code, persistence, and tests.
- [x] Record baseline findings in `PROJECT_AUDIT.md`.

## Phase 2 — Architecture

- [x] Document system boundaries, data/security principles, billing design, and phase exit criteria in `ARCHITECTURE.md`.

## Phase 3 — Shopify foundation (in progress)

- [x] Start from Shopify's official React Router embedded app template.
- [x] Set the existing app identity and remove the product-creation demo.
- [x] Request only `read_products`, `read_themes`, and `write_themes` in the Shopify config and OAuth SDK list for planned catalog/theme workflows; Shopify public-app theme-write exemption and dev-store reauthorization remain pending.
- [x] Configure Prisma session persistence for PostgreSQL and provide secret-free `.env.example`.
- [x] Add authenticated store overview using real Admin GraphQL shop data (no sample metrics).
- [x] Configure uninstall, scope-update, and mandatory customer/shop privacy webhook routes with framework webhook authentication.
- [x] Add Theme App Extension App Embed foundation; it now loads a tiny asynchronous verifier without editing theme files or blocking rendering.
- [x] Add signed Shopify App Proxy heartbeat and persist real storefront visits for embed status; live verification on the merchant's published development theme remains pending.
- [x] Configure the `/apps/speedboost` App Proxy route in the app manifest; Shopify CLI config sync and live signature verification remain pending.
- [x] Pin October 2026 Admin API with the installed Shopify SDK and add the Shopify CLI as a project dependency.
- [x] Add a reproducible npm lockfile, a local PostgreSQL migration, and a GitHub Actions verification workflow.
- [x] Add a Codespaces dev container with private PostgreSQL for browser-based development.
- [x] Add the missing default locale file required by Shopify CLI's Theme App Extension scanner after the first Codespaces run reported `ENOENT`.
- [x] `npm run typecheck`, `npm run lint`, `npm run build`, and `npm audit` passed in this sandbox; audit reports zero known vulnerabilities.
- [x] Re-run `shopify app dev` in Codespaces and confirm the missing-locale Theme Check error is gone.
- [x] Use the existing public SpeedBoost app identity (no duplicate app); the Codespaces-only `performance-pro` config alias was linked to SpeedBoost. Keep that per-environment manifest and temporary URL out of Git.
- [x] Codespaces dev log confirmed the forwarded HTTPS app URL; manifest and server now request only `read_products`, `read_themes`, and `write_themes` for the planned optimization workflows. The scopes have not yet been re-approved on the dev store.
- [x] Add a concrete Shopify `shopify.web.toml` process config so Shopify CLI actually launches the React Router server; Codespaces logs now confirm the Prisma migration completes and the server starts on an ephemeral local port.
- [x] Diagnose the remaining blank preview: the Codespaces app URL pointed to forwarded port 3000 while Shopify CLI's proxy is on port 4040.
- [ ] Point the temporary Codespaces App URL/redirect to the public forwarded proxy address on port 4040, then confirm HTTP response, embedded dashboard, and real store GraphQL query.
- [ ] Validate Prisma schema/migration and Shopify app/extension TOML in an environment able to download Prisma engines and authenticate Shopify CLI.
- [ ] Link app to Shopify Dev Dashboard and start the HTTPS development tunnel through Shopify CLI.
- [ ] Install on the merchant's development store; verify authentication, actual GraphQL query, app embed visibility, webhook delivery/HMAC, and uninstall cleanup.

## Phase 4 — Billing (Shopify App Pricing migration in progress)

- [x] Remove legacy Billing API request/check/cancel flows for the existing public SpeedBoost app.
- [x] Redirect plan selection and management to Shopify's hosted App Pricing page.
- [x] Verify active status server-side through the Partner API and fail closed on errors.
- [x] Persist current-cycle, trial-end, and scheduled-cancellation metadata.
- [ ] Configure the Partner API client and private deployment variables; do not commit tokens.
- [ ] Apply the new migration and verify the hosted selection/return/active-state/manage flow on a development store.
- [x] Enforce live Partner API subscription verification before starting the mobile scan.
- [ ] Centralize entitlement checks for future optimization, monitoring, and reporting features.

## Phase 5 — Scanner (path/device audit v1; live verification pending)

- [x] Run Google PageSpeed Insights Lighthouse for mobile, desktop, or both strategies against a Shopify-reported primary-domain path; server-check the active subscription.
- [x] Allowlist same-store homepage, product, collection, page, and blog article path shapes; reject arbitrary hosts, query strings, fragments, and encoded paths.
- [x] Persist `AuditRun` groups and per-device `PerformanceScan` rows; keep synthetic lab and field INP claims distinct.
- [x] Add atomic per-shop audit quota, provider timeout/error handling, and 90-day pruning on subsequent audits.
- [x] Add automated unit tests for target paths, origin shape and strategy selection.
- [x] Map known Lighthouse findings to safe next steps and explicitly state whether SpeedBoost can act; do not claim an automatic fix where none is integrated.
- [ ] Validate migration, provider quota, cancellation/error cases, and output on a published development store.
- [ ] Move provider work to a durable PostgreSQL-backed worker with retries, cancellation, concurrency control and user-visible status polling.
- [x] Parse and persist eligible PageSpeed/CrUX field data only when returned; label URL-level versus origin-level fallback and keep it separate from synthetic lab metrics.

## Phase 6 — Optimization engines and storefront integration (in progress)

- [x] Add standalone CSS minification with `lightningcss`, an 8 MB input bound, real UTF-8 byte accounting, and syntax-error rejection.
- [x] Add standalone JavaScript minification with `esbuild`, retained legal comments, an 8 MB input bound, and no code execution/bundling.
- [x] Add unit tests proving measured output size and sample JavaScript behavior; these engines do not yet read or publish Shopify theme assets.
- [ ] Integrate transforms with a durable, shop-isolated job/artifact pipeline that preserves original bytes and records source/output hashes.
- [ ] Implement actual theme preview/apply/rollback only after Shopify approves the public-app theme-write exemption; do not expose inactive controls before then.
- [ ] Build independently configurable, measured image/media/lazy-load/LCP/font modules with above-the-fold exclusions and a global emergency disable.
- [ ] Add resource diagnostics, compatibility exclusions, conflict checks, and verified per-module rollback.

## Phase 7 — Monitoring and history (in progress)

- [x] Persist historical audits and field-data provenance, and compare sequential runs in Performance Reports.
- [ ] Implement scan timelines, regression alerts/evidence, scheduled monitoring, and third-party change monitoring using durable workers.

## Phase 9 — QA / release (not started)

- [ ] Test multiple themes/dev stores, mobile/desktop, core shopping flows, and analytics compatibility.
- [ ] Review security, privacy/terms, retention/deletion, deployment, and App Store listing readiness.
- [ ] Produce `FINAL_PRODUCTION_AUDIT.md` based only on completed tests and evidence.
