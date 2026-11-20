# SpeedBoost QA report — 2026-11-20

Scope: full repository audit and fixes for PageSpeed quota errors, app-embed
detection, Speed Booster loading, billing resilience, compliance webhooks and
storefront runtime behaviour. Not deployed. Status keys: **PASSED** (tested
here), **FAILED**, **BLOCKED** (needs access I don't have), **NOT TESTED**.

## 1. Issues found and fixed

| # | Severity | Issue | Root cause | Fix |
|---|---|---|---|---|
| 1 | Critical | "API key not configured" / anonymous quota errors after adding the key | The screenshot came from the **local `shopify app dev` server in Codespaces**. Its process had no `GOOGLE_PAGESPEED_API_KEY` (verified from the process environment); the Render variable only affects the Render deployment. All 3 stored audits for the dev store failed with the anonymous-quota error. | `vite.config.ts` now loads a gitignored `.env` in development without overriding existing variables. Banner explains which server lacks the key. |
| 2 | High | Quota consumed by repeat/duplicate audits | Every click called Google; no de-duplication or queue | `pagespeed-client.server.ts`: shared in-flight requests per URL+device, max 3 concurrent Google calls, retries only for transient errors (per-minute quota, 5xx, network) with exponential backoff + jitter. Scan action reuses a completed audit of the same page/devices for 10 minutes (with a "Run a fresh audit anyway" button) and blocks a second concurrent run of the same page (transaction + advisory lock). |
| 3 | High | Generic "quota" message for every failure | Single regex | `pagespeed-errors.ts` classifies anonymous vs daily vs per-minute quota, invalid key, API not enabled, key restrictions (HTTP-referrer restricted keys block server calls), unreachable page, HTTP status of the page, 5xx, timeout. |
| 4 | Critical | App embed shown "Not detected" while enabled | Detection relied only on a storefront heartbeat from the last **24 h**. Enabling the embed in the editor sends no heartbeat; the script is skipped in the editor; quiet stores fall outside 24 h. | `embed-status(.server).ts` reads the **published theme's `config/settings_data.json`** via Admin GraphQL and finds the `shopify://apps/…/blocks/performance-pro-embed/…` block and its `disabled` flag (handles comment headers and preset-style settings). Heartbeat is a secondary "live" signal (7 days). A failed read shows "Checking unavailable", never "not enabled". |
| 5 | High | Speed Booster slow to appear | (a) internal buttons were plain `<a href>` → full document reload inside the admin iframe (JS re-download + re-auth); (b) parent `/app` loader re-authenticated on every navigation; (c) every page did 2–3 Partner/Admin API calls for billing before rendering. | `<Link>` client-side navigation (21 links), `shouldRevalidate=false` on the layout, theme check streamed with `<Suspense>/<Await>` + skeleton, top navigation progress bar, billing cache (#6). |
| 6 | High | Paying merchants locked out by a temporary Partner API error; slow pages | Live Partner API check on every page, throw on failure | ACTIVE plans verified in the last 10 min skip the network; on Partner API failure a plan verified within 72 h (and before its cycle end) keeps access. Cancelled/frozen/expired rows never grant access. Billing page and plan-selection action always verify live. |
| 7 | High | Compliance webhooks returned 404 | `shopify.app.toml` points to `/webhooks/compliance`, route did not exist | `webhooks.compliance.tsx` (HMAC-verified): shop/redact deletes shop data; customer topics acknowledged (no customer data stored). |
| 8 | High | Storefront inline script failed Shopify Theme Check (`LiquidHTMLSyntaxError`) | `i<list.length` parsed as an HTML tag inside `<script>` | Comparisons spaced; Theme Check now reports 0 errors. |
| 9 | Medium | One server request per storefront page view (heartbeat) | Ping on every page load for every store | Throttled to once per browser per day. |
| 10 | Medium | Audits of password-protected stores silently measure `/password` | Dev store redirects all pages to `/password` | Report flags `passwordProtected` and shows a warning. |
| 11 | Low | Font preload missed Horizon heading font | Only Dawn's `type_header_font` | Also `type_heading_font`. |

## 2. Files changed

New: `app/performance/pagespeed-client.server.ts`, `app/performance/pagespeed-errors.ts` (+test),
`app/optimization/embed-status.ts` (+test), `app/optimization/embed-status.server.ts`,
`app/optimization/embed-handle.ts`, `app/components/embed-status.tsx`,
`app/routes/webhooks.compliance.tsx`, `QA_REPORT.md`.
Modified: `app/performance/scan.server.ts`, `app/performance/lighthouse-report.ts`,
`app/routes/app.scan.tsx`, `app/routes/app.speed.tsx`, `app/routes/app._index.tsx`,
`app/routes/app.tsx`, `app/routes/app.reports.tsx`, `app/routes/app.optimize.tsx`,
`app/routes/app.billing.tsx`, `app/billing/billing.server.ts`, `app/billing/entitlement.ts` (+test),
`app/optimization/theme-editor.ts`, `app/styles/ui.css`, `vite.config.ts`,
`extensions/performance-pro-embed/assets/embed.js`, `extensions/performance-pro-embed/blocks/performance-pro-embed.liquid`.

## 3. Test results

| Area | Test | Status |
|---|---|---|
| Automated | 64 unit tests (`npm test`) | PASSED |
| Automated | `npm run typecheck`, `eslint`, `npm run build`, `prisma validate` | PASSED |
| Automated | `shopify theme check` on the app embed | PASSED (0 errors, 3 advisory `AssetPreload` warnings — same pattern Dawn uses) |
| PageSpeed | Root cause of quota error (process env + stored scan errors) | PASSED (diagnosed with evidence) |
| PageSpeed | Live audit with a real API key | BLOCKED — no key in this environment; anonymous quota exhausted |
| PageSpeed | Cache / duplicate-run / queue logic | PASSED (unit-tested classification & backoff; cache and lock are DB-level, not exercised against a live key) |
| App embed | Detection on the real dev store (Horizon, live theme) via Admin API | PASSED — returned `enabled`; old logic showed "Not detected" |
| App embed | Disabled / not-added / preset / comment-header parsing | PASSED (unit tests) |
| Storefront runtime | Chromium: trackers + app scripts held until interaction; theme, Shopify and PayPal scripts run immediately; released on mouse move and on scroll | PASSED |
| Storefront runtime | Chromium: lazy video embeds — player JS deferred until near viewport | PASSED (the iframe's first HTML request starts and is cancelled) |
| Storefront runtime | Boosters on the real storefront | BLOCKED — dev store is password-protected (`/` → 302 `/password`) |
| Real performance | Before/after PageSpeed on a real storefront | BLOCKED — needs an API key and a public (non-password) storefront |
| Themes | Dawn, Horizon parsing; Horizon live detection | PASSED (detection only) |
| Themes | Other free/paid/custom themes, runtime behaviour | NOT TESTED — need stores with those themes |
| Speed Booster | Navigation speed in the embedded admin | NOT TESTED in browser — root causes fixed in code |
| Billing | $10/month approve / cancel / reinstall on Shopify | BLOCKED — requires merchant actions in a store; price and plan unchanged |
| Billing | Cache/grace decision rules | PASSED (unit tests) |
| Webhooks | Compliance route exists and verifies HMAC | NOT TESTED end-to-end (`shopify app webhook trigger` needs the running app) |
| Uninstall / reinstall | Cleanup and restore | NOT TESTED — see behaviour below |
| Multi-store isolation | Code review of every Prisma query | PASSED — all reads/writes are scoped by the authenticated `session.shop` |

## 4. Uninstall / reinstall behaviour (by design)

- Boosters live in an **app-owned metafield** on the app installation and run from the **app embed**. On uninstall Shopify deletes the installation's metafields and stops rendering the embed, so the storefront returns to its original behaviour with nothing left in theme files.
- `app/uninstalled` deletes the shop's sessions, audits, heartbeat, theme-change history and subscription snapshot.
- Theme optimizer changes are only ever written to **unpublished/development themes** with stored originals; roll them back **before** uninstalling (after uninstall the app has no theme access).
- Reinstall: boosters start **off**; the embed must be switched on again in the theme editor (Shopify keeps or drops the embed setting according to its own rules). Billing is re-verified live with Shopify.

## 5. Known limitations

- Lighthouse scores vary run to run; the app shows Google's exact values but cannot make a new run on pagespeed.web.dev identical.
- "Preload LCP image" uses common image widths; if a theme requests different widths the browser may download two versions. Verify with an audit.
- Delaying scripts means visitors who never interact are not reported to delayed third-party tools (optional fallback timer in Advanced).
- Critical-CSS extraction is not offered (not safely possible from an app embed).
- `shopify.app.toml` requests scopes the code doesn't use (`read_files`, `write_files`, `write_metaobject_definitions`, `write_metaobjects`, `write_products`). Recommend removing them before app review — not changed here because it forces merchants to re-approve.

## 6. Before deploying

1. Local dev: create `.env` with `GOOGLE_PAGESPEED_API_KEY=…` (or add it as a Codespaces secret) and restart `npm run dev`.
2. Google Cloud: PageSpeed Insights API **enabled**; key restriction "API: PageSpeed Insights API", application restriction **None** (HTTP-referrer restrictions block server calls).
3. Render: `DATABASE_URL` working, `GOOGLE_PAGESPEED_API_KEY`, `SHOPIFY_PARTNER_API_ACCESS_TOKEN` set.
4. Remove the dev store password (or test on a public store) and run before/after audits.
5. `npm run deploy` to publish the updated app embed, then push the branch for Render.

## 7. App Store compliance pass (2026-11-20)

Verified against shopify.dev (App Store requirements, App Pricing, network access changelog of 19 Nov 2026).

| Requirement | Status | Notes |
|---|---|---|
| Embedded auth with session tokens, no 3rd-party cookies | PASS | `@shopify/shopify-app-react-router`, `authenticate.admin` on every route |
| Latest App Bridge | PASS | Loaded by the framework's `AppProvider` |
| GraphQL Admin API only, API 2026-10 | PASS | No REST calls in `app/` |
| Expiring offline access tokens | PASS | `future.expiringOfflineAccessTokens: true` |
| Minimum scopes | FIXED | Was 9 scopes; now `read_themes,write_themes,write_app_proxy` (the code uses nothing else) |
| `[network_access]` (required from 1 Dec 2026) | FIXED | `allowed_sources = []`; storefront contacts no external host. `shopify app config validate` passes |
| Compliance webhooks (3 topics) | FIXED earlier | `/webhooks/compliance`, HMAC verified by `authenticate.webhook` |
| Billing via Shopify App Pricing + Partner API | PASS | Matches docs; App Pricing sends no billing webhooks after 28 Apr 2026 |
| Reviewer/dev-store $0 no-charge plan | FIXED | Production rejected effective-$0 subscriptions → reviewers would be locked out |
| Theme changes only through theme app extensions (req. 5.1.1) | FAIL / decision | Theme optimizer writes files (unpublished themes only) with `write_themes`; see decision below |
| Lighthouse impact ≤ 10 points | MANUAL REQUIRED | Embed is small and inert by default; must be measured on a public store |
| Privacy policy URL | FIXED | Public page at `/privacy` (set `SUPPORT_EMAIL`) |
| Terms, icon, screenshots, screencast, support email | MANUAL REQUIRED | See `shopify-app-store-submission/assets-checklist.md` |
| Consistent app name | FAIL | "SpeedBoost" (toml/listing) vs "Performance Pro" (admin title, landing page) |
| Dependency vulnerabilities | FIXED / accepted | `npm audit fix`: production 9 → 6; remaining are in Prisma CLI config (`effect`) and route-file matching (`minimatch`), used at build/migrate time only; fixes require breaking downgrades |
| SQL injection / XSS / secret exposure | PASS | Parameterized tagged-template SQL only; no raw HTML injection; only a boolean about the API key reaches the browser |
