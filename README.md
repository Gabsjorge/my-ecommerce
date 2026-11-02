# my-ecommerce

A guided project that builds a simplified e-commerce application from start to finish using an AI-first approach. AI assists at every stage, from planning and design to implementation and testing.

The application includes the basics of an online store: a product catalog, a shopping cart with its own state machine, discount coupons, and order creation, all with a basic frontend.

## Current state

Implemented end to end (UI → nginx → API → PostgreSQL), with unit, integration and E2E tests:

- **Product Listing**, with an "add to cart" button per product.
- **Shopping Cart**: a state machine (empty, with items, in checkout, order created, abandoned), items with frozen unit prices, and abandonment after a configurable inactivity timeout.
- **Coupons**: percentage or fixed, single-use, with expiry and minimum order; registered by seed.
- **Order creation**: confirming a cart in checkout atomically creates the order, decrements stock (pessimistic row locks) and consumes the coupon.

Out of scope: the order lifecycle after creation (confirmed, shipped, delivered, cancelled), authentication, real payment, notifications and pagination.

Further documentation (in Portuguese): [requirements](docs/high_level_requirements.md), [architecture](docs/system_architecture.md), [scaffolding specification](docs/scaffolding-specification.md), [scaffolding blueprint](docs/scaffolding-blueprint.md), [cart FRD](docs/cart/frd-cart.md), [cart blueprint](docs/cart/blueprint-cart.md) and [AGENTS.md](AGENTS.md).

## Prerequisites

- Docker with Compose v2 (enough for `make up` and `make test`).
- Node 22 (see `.nvmrc`) for lint, format and `make test-e2e-local`: `nvm use`.
- `make`.

## Setup

```bash
git clone <repository-url> && cd my-ecommerce
nvm use                 # Node 22
make install            # npm ci in the root and in the 3 packages, and installs the Husky hooks
make up                 # creates .env from .env.example and starts db, migrate, backend and frontend
```

After `make up`:

- Frontend: http://localhost:8080
- Backend: http://localhost:3000 (`/health`, `/api/products` and `/api/carts`)
- Database: `localhost:5433`

Quick check:

```bash
curl localhost:3000/health          # {"status":"ok"}
curl localhost:8080/api/products    # envelope with 10 products
curl -X POST localhost:8080/api/carts   # creates an empty cart: {"id":1,"status":"empty",...}
```

The seed is idempotent per row: running it again only inserts the products and coupons that are missing. It provides 10 products and the coupons used by the tests (percentage, fixed, expired, with minimum order and already used, plus single-use ones consumed by the E2E suite).

## API

Business routes live under `/api`; `/health` is outside the prefix. Prices are always integer cents. A single resource is returned as a plain object (no `data` envelope); `GET /api/products` keeps the `{ "data": [...], "total": n }` envelope.

| Method and route                             | Success | What it does                                                                |
| -------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `POST /api/carts`                            | 201     | Create an empty cart                                                        |
| `GET /api/carts/:cartId`                     | 200     | View the cart (applies the inactivity timeout, does not renew the activity) |
| `POST /api/carts/:cartId/items`              | 200     | Add `{ productId, quantity }` (same product sums the quantity)              |
| `PATCH /api/carts/:cartId/items/:productId`  | 200     | Set `{ quantity }` of an item                                               |
| `DELETE /api/carts/:cartId/items/:productId` | 200     | Remove an item                                                              |
| `POST /api/carts/:cartId/coupon`             | 200     | Apply `{ code }`                                                            |
| `DELETE /api/carts/:cartId/coupon`           | 200     | Remove the coupon                                                           |
| `POST /api/carts/:cartId/checkout`           | 200     | Start checkout (items locked)                                               |
| `POST /api/carts/:cartId/edit`               | 200     | Back to editing (coupon kept)                                               |
| `POST /api/carts/:cartId/abandon`            | 200     | Abandon the cart                                                            |
| `POST /api/carts/:cartId/confirm`            | 201     | Atomically create the order: `{ order, cart }`                              |

Cart statuses: `empty`, `with_items`, `in_checkout`, `order_created`, `abandoned`.

Errors use `{ "error": { "code", "message", "details"? } }`; `details` is optional (for example, `INSUFFICIENT_STOCK` on confirm lists `details.items`).

| Status | Codes                                                                                      |
| ------ | ------------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR` (413 for an oversized body)                                             |
| 404    | `CART_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `COUPON_NOT_FOUND`           |
| 409    | `INVALID_CART_STATE`, `INSUFFICIENT_STOCK`, `COUPON_ALREADY_APPLIED`, `COUPON_NOT_APPLIED` |
| 422    | `COUPON_EXPIRED`, `COUPON_ALREADY_USED`, `COUPON_MIN_ORDER_NOT_MET`                        |
| 500    | `INTERNAL_ERROR` (no details)                                                              |

## Web UI

Hash routes: `#/` (product list) and `#/cart` (cart, including the order summary right after confirming). The cart id is kept in `localStorage`, so reloading restores the cart in any state; "Novo carrinho" discards it. The UI hides or disables controls according to the cart status, but the server is always the authority.

## Useful commands

| Command                                 | What it does                                                  |
| --------------------------------------- | ------------------------------------------------------------- |
| `make up` / `make down`                 | Start / stop dev (keeps the database)                         |
| `make clean`                            | Stop dev and delete the database volume                       |
| `make logs SERVICE=backend`             | Follow logs (SERVICE is optional)                             |
| `make migrate` / `make seed`            | Run migrations / seed manually                                |
| `make test`                             | Full suite in containers (Docker only)                        |
| `make test-backend`                     | Vitest (unit + integration) against an ephemeral Postgres     |
| `make test-frontend`                    | `node:test` unit tests of the frontend (containerized)        |
| `make test-e2e`                         | Playwright (API + UI) against the test stack                  |
| `make test-env-up`                      | Start the debug environment (frontend on localhost:8081)      |
| `make test-e2e-local`                   | Playwright on the host against that environment               |
| `make test-env-reset` / `test-env-down` | Recreate / stop the debug environment                         |
| `make lint`                             | ESLint, Prettier (check) and `tsc --noEmit` in the 3 packages |
| `make format`                           | Prettier `--write`                                            |
| `make check`                            | `lint` + `test`                                               |

The first time you run the E2E suite on the host: `cd e2e && npx playwright install chromium`.

Migrations: edit `backend/src/db/schema.ts`, run `npm run db:generate` in `backend/` and commit the `.sql` files. Never edit a migration that was already applied.

## Environment variables

`.env.example` documents everything. `make up` copies it to `.env` (not committed).

| Variable                          | Default     | Controls                                                               |
| --------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `POSTGRES_USER`                   | `ecommerce` | Postgres user                                                          |
| `POSTGRES_PASSWORD`               | `change-me` | Postgres password (change it locally; URL-encode special characters)   |
| `POSTGRES_DB`                     | `ecommerce` | Database name                                                          |
| `BACKEND_PORT`                    | `3000`      | Express port. Do not change it without updating `frontend/nginx.conf`  |
| `FRONTEND_PORT`                   | `8080`      | Port nginx publishes in dev                                            |
| `DB_PORT`                         | `5433`      | Port Postgres publishes in dev                                         |
| `TEST_LOCAL_FRONTEND_PORT`        | `8081`      | Frontend port in the debug test environment                            |
| `CART_INACTIVITY_TIMEOUT_SECONDS` | `600`       | Seconds of inactivity before a cart is abandoned (`10` in `.env.test`) |

`.env.test` (committed, no real secrets) feeds the test environment, so `make test` works on a clean clone.

## Known `npm audit` warnings

Production dependencies have no known vulnerabilities in any package (`npm audit --omit=dev` reports 0). The remaining warnings are in development tooling only and never reach the production image:

- root: `minimatch` via ESLint / typescript-eslint (moderate);
- backend: `vitest` / `@vitest/mocker` / `tinypool` (the latter flagged critical, but only exploitable if an attacker controls the test runner's worker options) and `esbuild` via `drizzle-kit` (moderate).

Do not run `npm audit fix --force`: it proposes downgrades. The proper fix is upgrading Vitest to 5.x and `drizzle-kit`, a breaking change left for a future update.
