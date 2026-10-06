# Production deployment guide (existing SpeedBoost service)

This document describes deployment to the **existing** `speedboost.onrender.com` service. It does not create a second Shopify app or a second Render service. Do not point production at Codespaces or run a deployment until the development-store gates in `SHOPIFY_APP_REVIEW.md` pass.

## Required infrastructure

- Existing Render Node/Docker web service with a persistent PostgreSQL database.
- Node 22.12+ (the repository Dockerfile uses Node 22 Bookworm Slim).
- HTTPS public app URL and a Shopify CLI app version linked to the existing SpeedBoost app.
- Private Partner API client for the same organization with **Manage apps** permission.
- A Shopify-configured App Pricing plan. Confirm USD $10/month and production trial terms in Partner Dashboard; these values are not deploy-time variables.

## Runtime configuration

Configure these as private Render environment variables; never put values in Git, a browser bundle, or chat:

| Variable                           | Required | Purpose                                                                                     |
| ---------------------------------- | -------: | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                     |      Yes | PostgreSQL connection string with TLS settings appropriate to Render.                       |
| `SHOPIFY_API_KEY`                  |      Yes | Existing SpeedBoost app client ID.                                                          |
| `SHOPIFY_API_SECRET`               |      Yes | Existing SpeedBoost app secret.                                                             |
| `SHOPIFY_APP_URL`                  |      Yes | Production HTTPS app origin, `https://speedboost.onrender.com`.                             |
| `SHOPIFY_PARTNER_API_ACCESS_TOKEN` |      Yes | Server-only Partner API access token with Manage apps permission.                           |
| `SHOPIFY_PARTNER_ORG_ID`           |       No | Defaults to the existing organization ID in `.env.example`.                                 |
| `SHOPIFY_APP_GID`                  |       No | Defaults to the existing SpeedBoost app GID.                                                |
| `SHOPIFY_APP_HANDLE`               |       No | Defaults to `speedboost-v2-1`.                                                              |
| `GOOGLE_PAGESPEED_API_KEY`         |       No | Optional PageSpeed quota key. Keep private; provider quota may constrain audits without it. |
| `PORT`                             |       No | Supplied by the hosting platform. The container listens on `0.0.0.0`.                       |

Production startup fails fast if the database, Shopify app credentials, app URL, or Partner API token is missing. Do not switch on live plan charges as a deployment test.

## Existing Render service settings

Use the existing service's Git-connected Docker deployment. The checked-in multi-stage `Dockerfile` installs build tooling in its builder stage, generates Prisma Client, builds React Router, and keeps the migration CLI and generated Prisma engine in the runtime image.

- Health check path: `/healthz` (checks PostgreSQL and returns no secrets).
- Runtime command: the Dockerfile runs `npm run docker-start`, which generates Prisma Client, runs `prisma migrate deploy`, then starts the React Router server.
- Attach the existing production PostgreSQL database. Back it up before applying a new migration.
- Preserve the existing Render service name, custom domain, and environment group. Do not create a new Render service from a Blueprint for this repository.

If deploying without Docker, use Node 22.12+, run `npm ci`, `npx prisma generate`, and `npm run build` as the build command, and `npm run docker-start` as the start command. Ensure the production environment has the `prisma` CLI dependency available because startup applies migrations.

## Shopify configuration release

`shopify.app.toml` configures the App Proxy path and requests `read_products`, `read_themes`, and `write_themes` for product-media discovery and isolated theme-preview workflows. The server's OAuth scope list matches that manifest. Shopify must approve the public-app `write_themes` exemption before theme-file write operations can work; listing the scope does not grant that exemption. Validate the linked config against the existing app in Shopify CLI, review the diff carefully, and release an app version only after development-store verification. Shopify CLI config linking or app version release does **not** deploy the Render server. Conversely, Render deployment does not publish the Shopify App Proxy/extension configuration.

The App Embed is not an optimizer yet. Never claim the dashboard's theme status is verified until a published development storefront request has successfully reached the signed App Proxy endpoint.

## Data migrations and rollback

Prisma migrations are additive and applied by `prisma migrate deploy` on startup. Before a production release:

1. Verify current database backups and restore procedure.
2. Apply and verify the migration on the development database.
3. Deploy the web service and check `/healthz`, structured logs, authentication, Partner API verification, webhook delivery, App Proxy, and scan error paths.
4. Keep the previous Render image/deployment available for code rollback. A code rollback does not reverse an already-applied database migration; write a forward migration for schema rollback or restore a tested database backup.

## Not yet available

There is no background-worker service/queue, scheduled audit/monitoring process, image asset processor, full theme duplicator/publisher, or production-ready theme rollback service. The Theme Optimization route now contains an explicitly confirmed static CSS/JS write flow restricted to unpublished/development themes; it records original bytes and hash-checks rollback. It has not been verified on a development store. Shopify's `themeFilesUpsert` requires the configured `write_themes` scope plus Shopify's separate public-app exemption; without that grant, the route must fail closed. The app never publishes a theme.
