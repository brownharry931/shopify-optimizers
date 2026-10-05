# Project Audit

**Audit date:** 2026-10-01
**Repository:** `brownharry931/shopify-optimizers`
**Branch:** `arena/01a0f8e8-shopify-optimizers`
**Audited revision:** `7838815f61dec4012c18a86b6c22a78562013cde`

## Executive summary

This checkout is an empty Git repository apart from a 20-byte `README.md`. There is no application to extend or existing working behavior to protect. No Shopify app, server, storefront extension, database, or tests are present. This is a baseline inventory only—not evidence of a running or production-ready app.

## Inventory

| Area                            | Finding                                            |
| ------------------------------- | -------------------------------------------------- |
| Tracked files                   | `README.md` only                                   |
| Framework / language            | None configured                                    |
| Package manager / lockfile      | None                                               |
| Shopify CLI configuration       | None (`shopify.app.toml` absent)                   |
| Authentication / App Bridge     | None                                               |
| Admin API / scopes              | None                                               |
| Billing                         | None                                               |
| Routes / backend                | None                                               |
| Database / migrations           | None                                               |
| Theme App Extension / App Embed | None                                               |
| Webhooks / compliance           | None                                               |
| Environment configuration       | No `.env`, `.env.example`, or documented variables |
| Tests / lint / build            | No scripts or test files; cannot run project tests |
| Deployment configuration        | None                                               |
| Git state                       | Clean at audit start; on the required Arena branch |

The repository has one initial commit, `7838815` (`Initial commit`). No existing remote application setup is represented in tracked files.

## Consequences and constraints

1. No feature in the requested product currently exists. Shopify credentials, a development store, API access, and deployment secrets are not available in this checkout, so real install/billing/storefront behavior cannot be verified here.
2. A working production app cannot honestly be declared complete based on this repository state. External Shopify setup and real-store QA will be required in addition to code.
3. The requirements describe a broad product. Implementation should be phased, with server-verified Shopify billing and a real scan foundation ahead of premium optimization behavior.
4. Shopify platform APIs and CLI templates evolve. Before generating the foundation, pin/verify the current supported Shopify CLI template, API version, and package versions; do not copy obsolete REST/ScriptTag patterns.

## Recommended immediate sequence

1. Approve and implement the architecture in `ARCHITECTURE.md`.
2. Generate a Shopify-supported embedded TypeScript app foundation and capture exact runtime/package versions in the lockfile.
3. Add the Theme App Extension/App Embed, minimal scopes, authenticated route conventions, and Shopify compliance/uninstall webhooks.
4. Add persistence and server-side subscription verification, including duplicate-creation prevention and a zero-day default trial.
5. Add a real scanner using explicitly labeled synthetic and field data, with no fabricated metrics; then add guarded, reversible storefront optimizations.
6. Add operational checks, deployment documentation, and the final production audit only after applicable tests and real development-store verification.

## Validation performed

- Inspected repository files, tracked file list, directories, package/configuration candidates, Git history, branch, and working-tree status.
- No application tests/build could be run because no application or test configuration exists.

## Status

**Phase 1 (baseline repository audit): complete.** See the supplemental re-audit below for the current implementation state.

## Supplemental re-audit — 2026-10-06

The previous section is a historical baseline at commit `7838815`, not a description of the current branch. The current branch contains an official Shopify React Router embedded-app foundation, Prisma/PostgreSQL session persistence, Shopify App Pricing/Partner API billing verification, app/uninstall/privacy webhook routes, a Theme App Extension, a signed App Proxy heartbeat, and a persisted Google PageSpeed Insights mobile-homepage scan. Shopify SDK API version is `2026-10`; npm is the package manager; Node `>=22.12` is declared. Shopify CLI development uses `shopify.web.toml`; the production app URL is configured as `https://speedboost.onrender.com`, and production still requires a separately configured Render service.

Current constraints found in this re-audit:

- Product code now supports one same-store page path per persisted audit run, with mobile/desktop/both PageSpeed strategies and a strict allowlist for homepage, product, collection, page, and blog paths. Audits are still executed synchronously in the web request; there is no durable worker/job queue or CrUX field-data history.
- No image optimizer, CSS/JS/font/media optimizer, compatibility registry, preview/publish/rollback workflow, scheduled monitoring, or image-processing manifest exists. The App Embed currently sends only a lightweight heartbeat.
- The Admin app uses Shopify's Admin UI web components (`s-*`) from its current template; `@shopify/polaris-types` is present but the legacy Polaris React component package is not. Keep the UI aligned with Shopify's supported template rather than adding legacy Polaris blindly.
- The current manifest requests no Admin API scopes. Shopify's current `themeDuplicate` and `themeFilesUpsert` mutations require `write_themes` plus a Shopify exemption; do not add those protected mutations/scopes or claim app-managed theme preview/publishing until Shopify approves the exemption.
- The scanner makes synchronous PageSpeed requests from an authenticated route; it is bounded/rate-limited but not a persistent worker. A new scan migration and App Proxy config have not yet been validated against a live development store in this sandbox.
- A Node test-runner suite now covers safe audit-path normalization, allowed Shopify templates, origin validation, and device strategy parsing. Billing/webhook/database/provider integration and browser end-to-end tests are still missing. Prisma CLI schema validation is blocked in this sandbox because its engine download host is unreachable.
- No final Shopify App Store submission/legal/support checklist, production secrets, verified Render deployment, or multi-theme QA has been completed.

### Concise implementation plan

1. Preserve the public SpeedBoost app ID, App Pricing billing, existing migrations, and extension identity; validate the current development installation and migrations.
2. Build a tested audit domain: same-shop URL validation, mobile/desktop and selected storefront paths, persisted audit/run/results, asynchronous PostgreSQL-backed jobs, retries, quotas, and truthful field-vs-lab reporting.
3. Implement one conservative, reversible optimization at a time through the Theme App Extension; start with a real image/media pathway only after LCP, dimension, gallery and theme compatibility tests exist. Preserve a global disable and exclusions.
4. Add independently gated optimizer modules, asset manifests, change history, preview and rollback. Theme API based duplication/publication is blocked on Shopify's explicit `write_themes` exemption; until approved, do not write theme files or publish themes.
5. Complete multi-theme storefront tests, GDPR retention/deletion, production security and observability, Render deployment rehearsal, and the App Store legal/listing checklist. Submit only after these gates pass.
