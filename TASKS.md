# Product task tracker

Tasks are marked complete only after implementation and the phase's applicable verification. Shopify-hosted behavior remains pending until tested against the merchant's development store.

## Current release blocker — Optimization UI is not in the screenshot build

- [x] Source on this branch contains `/app/optimize` and a visible `Optimization` navigation link; the screenshot is from an older running build. `.env` API keys can change PageSpeed quota, but cannot add new app code or menus.
- [x] The workbench source now includes real latest-scan LCP/INP/CLS/TBT display, CSS/JS minification preview, limited static-theme-script `defer`, selected Shopify `image_tag` lazy-loading/LCP hints, and guarded rollback paths. Local unit/lint/type/build verification is recorded below; Shopify behavior is not verified yet.
- [ ] Pull this branch in Codespaces and restart Shopify CLI, then open `/app/optimize` in the existing dev-store app to verify the navigation and UI. This is not a Render production deployment.
- [ ] Verify `read_themes`, theme inventory, active test-plan entitlement, and GraphQL reads in the existing development store. Applying still requires Shopify's public-app `write_themes` exemption and an unpublished/development theme.
- [ ] Re-run the screenshot's failed PageSpeed audit after the provider rate limit clears; it is a separate Google quota issue.
- [ ] Complete migration/development-store checks before production deployment or App Store submission.
- [ ] Full image conversion/resizing, raw `<img>` rewriting, interaction-triggered JS delay, general CLS repair, font optimization, and durable monitored rollout are not implemented; do not show these as working controls or claim an automatic Core Web Vitals fix.

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
- [x] Latest local verification: `npm test` (28 tests), `npm run typecheck`, `npm run lint`, and `npm run build` pass in the sandbox.
- [ ] Revalidate Prisma schema/migrations on a machine with the Prisma engine. `npm audit --omit=dev` is clean; full `npm audit` currently reports 4 moderate findings in the development-only Shopify CLI dependency chain and needs review.
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
- [x] Add unit tests proving measured output size and sample JavaScript behavior.
- [x] Add paid-gated theme inventory and static CSS/JS minification preview with raw byte counts and a 1 MB interactive-preview limit; applying is a separate explicit confirmation.
- [x] Add a Core Web Vitals workbench based on the latest stored audit; show CrUX p75 LCP/INP/CLS only when returned, distinguish synthetic lab metrics, and never label TBT as INP.
- [x] Add a narrow `defer` preview for explicit static theme-asset script tags in `layout/theme.liquid`; skips app/remote/inline/dynamic/async/module scripts and does not claim interaction-based delay.
- [x] Add Liquid section/snippet inspection, below-the-fold-only `image_tag` lazy hints, and an exact single-image LCP eager/fetch-priority preview; dynamic options and raw `<img>` markup are left unchanged.
- [x] Gate all new theme-file applies to unpublished/development roles, require review/confirmation, retain original contents and SHA-256 checks, and reuse conflict-checked rollback; never publish a theme.
- [x] Add unit coverage for defer exclusions, Liquid comment handling, selective image loading hints, exact LCP selection, and dynamic-value safety.
- [ ] Verify `read_themes` access, Liquid theme-file GraphQL queries, inventory/preview rendering, and active test-plan entitlement on the installed development store.
- [ ] Validate the migration and exercise CSS/JS/Liquid read/write, async completion, conflict protection, and rollback after Shopify grants the public-app `write_themes` exemption.
- [ ] Implement image-file conversion/resizing/responsive CDN rewriting, raw `<img>` handling, fonts, arbitrary CLS fixes, and true delay-until-interaction only with theme-specific compatibility analysis and safe previews; these are not available controls now.
- [ ] Add resource diagnostics, compatibility exclusions, monitored LCP/image changes, durable jobs, and verified per-module rollback beyond the current file-level history.

## Phase 7 — Monitoring and history (in progress)

- [x] Persist historical audits and field-data provenance, and compare sequential runs in Performance Reports.
- [ ] Implement scan timelines, regression alerts/evidence, scheduled monitoring, and third-party change monitoring using durable workers.

## Phase 9 — QA / release (not started)

- [ ] Test multiple themes/dev stores, mobile/desktop, core shopping flows, and analytics compatibility.
- [ ] Review security, privacy/terms, retention/deletion, deployment, and App Store listing readiness.
- [ ] Produce `FINAL_PRODUCTION_AUDIT.md` based only on completed tests and evidence.
