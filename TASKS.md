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
- [x] Link the checked-in manifest to the user-provided public Shopify client ID; make its requested scopes (`read_themes`) and webhook API version (`2026-10`) explicit so Shopify CLI can apply the project configuration.
- [x] Codespaces dev log now shows the real forwarded HTTPS app URL and only `read_themes` as the granted app scope.
- [ ] Verify the local server responds on port 3000 and complete embedded app authentication/store GraphQL query after adding the concrete `shopify.web.toml` web process config.
- [ ] Validate Prisma schema/migration and Shopify app/extension TOML in an environment able to download Prisma engines and authenticate Shopify CLI.
- [ ] Link app to Shopify Dev Dashboard and start the HTTPS development tunnel through Shopify CLI.
- [ ] Install on the merchant's development store; verify authentication, actual GraphQL query, app embed visibility, webhook delivery/HMAC, and uninstall cleanup.

## Phase 4 — Billing (blocked on Phase 3 development-store verification)
- [ ] Centralize plan defaults: Performance Pro / USD 10 / EVERY_30_DAYS / zero trial days.
- [ ] Implement Shopify-managed recurring subscription creation and confirmation redirect.
- [ ] Verify subscription server-side and prevent duplicate active/pending subscriptions.
- [ ] Implement and test pending, active, declined, cancelled, expired, frozen, and error states.
- [ ] Enforce premium access on server routes; never trust client billing status.

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
