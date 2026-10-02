# Product task tracker

Tasks are marked complete only after implementation and the phase's applicable verification. Shopify-hosted behavior remains pending until tested against the merchant's development store.

## Phase 1 — Audit
- [x] Inspect the repository, Git state, package/config files, Shopify setup, app code, persistence, and tests.
- [x] Record baseline findings in `PROJECT_AUDIT.md`.

## Phase 2 — Architecture
- [x] Document system boundaries, data/security principles, billing design, and phase exit criteria in `ARCHITECTURE.md`.

## Phase 3 — Shopify foundation (in progress)
- [x] Start from Shopify's official React Router embedded app template.
- [x] Set app identity and minimum initial scope (`read_themes`); remove the product-creation demo.
- [x] Configure Prisma session persistence for PostgreSQL and provide secret-free `.env.example`.
- [x] Add authenticated store overview using real Admin GraphQL shop data (no sample metrics).
- [x] Configure uninstall, scope-update, and mandatory customer/shop privacy webhook routes with framework webhook authentication.
- [x] Add Theme App Extension App Embed foundation that does not modify theme files or inject runtime code.
- [x] Pin October 2026 Admin API with the installed Shopify SDK and add the Shopify CLI as a project dependency.
- [x] Add a reproducible npm lockfile, a local PostgreSQL migration, and a GitHub Actions verification workflow.
- [x] Add a Codespaces dev container with private PostgreSQL for browser-based development.
- [x] Add the missing default locale file required by Shopify CLI's Theme App Extension scanner after the first Codespaces run reported `ENOENT`.
- [x] `npm run typecheck`, `npm run lint`, `npm run build`, and `npm audit` passed in this sandbox; audit reports zero known vulnerabilities.
- [x] Re-run `shopify app dev` in Codespaces and confirm the missing-locale Theme Check error is gone.
- [x] Use the existing public SpeedBoost app identity (no duplicate app); the Codespaces-only `performance-pro` config alias was linked to SpeedBoost. Keep that per-environment manifest and temporary URL out of Git.
- [x] Codespaces dev log now shows the real forwarded HTTPS app URL and only `read_themes` as the granted app scope.
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
- [ ] Enforce the shared verified-subscription gate on future premium features; no scanner/optimizer is implemented yet.

## Phase 5 — Scanner (blocked on working foundation and billing gate)
- [ ] Scan real home, collection, and product storefront URLs.
- [ ] Keep mobile/desktop and synthetic/field results distinct; preserve provenance and missing data.
- [ ] Add SSRF protection, bounded execution, timeout/retry handling, and no-fabricated-metrics tests.

## Phases 6–8 — Optimizations, safety, monitoring (not started)
- [ ] Implement measured, safe image/media/LCP/font improvements incrementally.
- [ ] Add resource diagnostics and guarded CSS/JavaScript/third-party experiments.
- [ ] Implement exclusions, conflict checks, rollback, and audit history.
- [ ] Implement scan timelines, regression evidence, and third-party change monitoring.

## Phase 9 — QA / release (not started)
- [ ] Test multiple themes/dev stores, mobile/desktop, core shopping flows, and analytics compatibility.
- [ ] Review security, privacy/terms, retention/deletion, deployment, and App Store listing readiness.
- [ ] Produce `FINAL_PRODUCTION_AUDIT.md` based only on completed tests and evidence.
