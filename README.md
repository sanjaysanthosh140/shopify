# Shopify Order Management CRM

This project is a small order-operations CRM for the Shopify development store. It keeps a normalized copy of Shopify orders and line items in PostgreSQL, exposes a NestJS API, receives signed Shopify webhooks, and provides a React/Vite dashboard.

## Architecture

```text
Shopify Admin GraphQL API ──┐
                            ├─ ShopifyService ── OrderSyncService ── PostgreSQL
Shopify HTTPS webhooks ─────┘          │                 │
                                       └─ Orders API ─────┴─ React dashboard
```

- `src/shopify`: client-credentials authentication, token caching, GraphQL requests, rate-limit retries, and the connection test.
- `src/orders`: validated list/details API, GraphQL pagination, webhook payload mapping, transactional upserts, and idempotent line-item synchronization.
- `src/webhooks`: raw-body HMAC verification and durable delivery deduplication through `WebhookEvent`.
- `prisma/schema.prisma`: `Product` (existing), `Order`, `OrderItem`, and `WebhookEvent` models.
- `../shopify-frontend`: responsive React dashboard.

Shopify IDs are stored as strings because Shopify GraphQL IDs and numeric REST IDs must not be coerced into JavaScript numbers. Monetary values use PostgreSQL `DECIMAL(19,4)`.

## Prerequisites

- Windows PowerShell
- Node.js 22+
- PostgreSQL/Neon database
- Shopify development store and an installed app with the configured client-credentials flow

## Setup

From `C:\Users\91773\Desktop\shopify_setup\shopify-backend`:

```powershell
npm.cmd install
Copy-Item .env.example .env
```

Fill the local `.env` file with the existing values. Do not commit or paste it. `.env` is ignored by Git.

Required variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon/PostgreSQL connection string |
| `SHOPIFY_STORE_DOMAIN` | Store domain, for example `your-store.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Shopify app client ID |
| `SHOPIFY_CLIENT_SECRET` | Shopify app client secret and webhook HMAC secret |
| `SHOPIFY_API_VERSION` | Admin GraphQL API version |

Optional variables are `PORT`, `NODE_ENV`, `CORS_ORIGIN`, and `SYNC_ADMIN_KEY`. In development, `/orders/sync` is available without a key only when `SYNC_ADMIN_KEY` is absent. In production, it is always rejected unless a key is configured and supplied as `x-sync-key`.

## Database and Prisma

The project uses Prisma 7 with `prisma7.config.ts` and the generated client under `src/generated/prisma`.

```powershell
.\node_modules\.bin\prisma.cmd validate
.\node_modules\.bin\prisma.cmd generate
.\node_modules\.bin\prisma.cmd migrate deploy
```

The checked-in migration is `prisma/migrations/20261024180000_add_orders_and_webhooks/migration.sql`. Never run `prisma migrate reset` against this database.

On the development Windows environment used for this project, Prisma's Rust migration engine cannot complete the Neon TLS handshake and reports `P1011`, while the application's Node `pg` adapter connects successfully. The guarded fallback below applies the same checked-in SQL transactionally and records its checksum in `_prisma_migrations`:

```powershell
node scripts/apply-migration-with-pg.js
```

The fallback refuses to run if the migration is already recorded or if an `Order` table exists without a migration record.

## Run locally

Backend, from `shopify-backend`:

```powershell
npm.cmd run start:dev
```

Frontend, from `C:\Users\91773\Desktop\shopify_setup\shopify-frontend`:

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run dev
```

The dashboard opens at `http://localhost:5173`. It calls `http://localhost:3000` by default; set `VITE_API_URL` in the frontend `.env` when the backend is hosted elsewhere.

## Verified links and demo status

| Resource | Link or status |
| --- | --- |
| Shopify storefront | https://sanju-ecommerse.myshopify.com |
| Shopify Admin | https://admin.shopify.com/store/sanju-ecommerse |
| CRM frontend | `http://localhost:5173` (local only) |
| Backend API | `http://localhost:3000` (local only) |
| Public webhook URL | Not configured or verified; no public HTTPS URL is claimed |

The Shopify Admin link requires the appropriate Shopify authorization. The storefront URL is the configured store address; public catalog availability was not independently confirmed from this environment.

The current local verification found zero orders through the Shopify Admin API sync. The CRM contains one clearly marked synthetic development record, `#TEST-1001`, created by a signed local webhook smoke test so the dashboard and order-detail workflow can be demonstrated. It is not a Shopify-created order and must not be presented as one.

The dashboard labels itself `DEVELOPMENT DEMO DATA`. Its statistics come from the CRM database, and the `Sync Shopify` button runs the real backend sync endpoint. A successful connection test or an empty sync result does not prove that Shopify has delivered a webhook.

The current client-credentials token reports only the `read_orders` scope. A direct Shopify Admin GraphQL catalog check was rejected with `Access denied for products field`, so no Shopify products or Shopify-created demo orders were fabricated. The storefront URL is recorded above, but its public catalog was not independently verified from this environment.

## API

| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/shopify/test` | Verifies Shopify authentication and returns safe shop metadata |
| `GET` | `/products` | Existing Product API, preserved |
| `POST` | `/products` | Existing Product API, preserved |
| `GET` | `/orders` | Paginated, searchable, filterable order list |
| `GET` | `/orders/:id` | Order details and line items; returns 404 when unknown |
| `POST` | `/orders/sync` | Fetches Shopify orders and upserts them; optionally requires `x-sync-key` |
| `POST` | `/shopify/webhooks` | Receives `orders/create` and `orders/updated` HTTPS webhooks |

`GET /orders` query parameters:

- `page`, `pageSize`
- `search` for order number or customer name
- `financialStatus`
- `fulfillmentStatus`
- `from`, `to` ISO dates
- `sort=asc|desc`

Responses use `{ success, data, meta }` for detail APIs. `GET /orders` also returns database-backed `stats` for total, paid, pending, fulfilled, and needs-attention counts. Decimal amounts are serialized as strings.

## Shopify setup and webhooks

The current app configuration has `read_orders` and the existing connection test succeeds. Shopify may restrict historical orders or customer data depending on the store/app approval, so an order sync must be verified against the installed app's actual permissions.

Configure two HTTPS subscriptions for the installed app:

- `orders/create`
- `orders/updated`

Use the Shopify Dev Dashboard/app configuration or Shopify CLI and point both topics to the publicly reachable URL:

```text
https://your-public-host.example.com/shopify/webhooks
```

Shopify cannot deliver to `localhost`. The handler requires `X-Shopify-Hmac-Sha256`, `X-Shopify-Webhook-Id`, `X-Shopify-Topic`, and `X-Shopify-Shop-Domain`. It validates the signature over Nest's raw request body before touching the database. `WebhookEvent.deliveryId` is unique, so duplicate deliveries return success without duplicating the order.

If the Shopify app does not yet have permission to manage shop-specific webhook subscriptions, add the topics in the Dev Dashboard or update the app configuration and reinstall/approve the required scopes. Do not claim webhook delivery is live until Shopify has delivered a test request to a public HTTPS endpoint.

### Exact external setup still required

No working authenticated tunnel or Shopify CLI is currently available in this Windows environment, and no public URL has been invented. To complete the external delivery check:

1. Install and authenticate a tunnel provider, then run this from the backend while the API is running:

   ```powershell
   ngrok http 3000
   ```

2. Copy the HTTPS forwarding URL and configure `orders/create` and `orders/updated` in the Shopify Dev Dashboard to `<https-url>/shopify/webhooks`. The temporary URL changes when the tunnel restarts.
3. Create a real test order in the Shopify Admin only after the app has the required order/product permissions. Confirm the webhook response and then verify the order through `GET /orders`.

The existing `read_orders` configuration is sufficient for read/sync checks but is not permission to create Shopify products or orders. Those permissions and any app reinstallation/approval must be handled in Shopify Admin/Dev Dashboard; the project does not silently change them.

## Tests and verification

```powershell
cd C:\Users\91773\Desktop\shopify_setup\shopify-backend
npm.cmd run build
npm.cmd test -- --runInBand

cd ..\shopify-frontend
npm.cmd run build
```

The backend tests cover normalization, exact decimal multiplication, GraphQL/webhook mapping, query filtering, HMAC rejection, and successful webhook processing. A local smoke test should also verify:

1. `GET /shopify/test` returns `success: true`.
2. `GET /products` still responds successfully.
3. `POST /orders/sync` can be run twice; the second run reports updates rather than new duplicates.
4. A valid signed webhook creates or updates one order, and replaying its delivery ID returns `duplicate: true`.
5. An invalid signature returns HTTP 401.

## Walkthrough plan

1. Show the NestJS, Prisma, and React sibling layout.
2. Open `/shopify/test` and show safe connection metadata.
3. Walk through `Product`, `Order`, `OrderItem`, and `WebhookEvent` in the Prisma schema.
4. Run the initial sync and show the summary.
5. Open the dashboard, search, filter, paginate, and open an order.
6. Run `Sync Shopify` and report the returned fetched/created/updated summary honestly.
7. For local-only verification, send a signed `orders/create` webhook and show the `#TEST-1001` development record.
8. Replay the same delivery and show durable duplicate prevention.
9. Send an invalid signature and show the 401 response without secret output.

## Known limitations

- This implementation is scoped to the configured development store and does not add a full user authentication system.
- Webhook registration requires a publicly reachable HTTPS deployment and the Shopify app's current subscription permissions; the backend intentionally does not pretend to register subscriptions with the current `read_orders`-only configuration.
- Historical order visibility and protected customer fields are governed by Shopify's approval state. Missing fields remain nullable rather than being fabricated.
- The optional CRM-to-Shopify order creation feature is intentionally not included until the required sync and webhook workflow is stable.
