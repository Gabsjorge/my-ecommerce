# my-ecommerce

A guided project that builds a simplified e-commerce application from start to finish using an AI-first approach. AI assists at every stage, from planning and design to implementation and testing.

The application will include the basics of an online store: a product catalog, a cart screen with its functionality, discount coupons, and order processing, all with a basic frontend.

## Current state

The scaffolding implements only the **Product Listing**, end to end (UI → nginx → API → PostgreSQL), with unit, integration and E2E tests. Cart, coupons and orders come in later Steps.

Further documentation (in Portuguese): [requirements](docs/high_level_requirements.md), [architecture](docs/system_architecture.md), [scaffolding specification](docs/scaffolding-specification.md), [blueprint](docs/scaffolding-blueprint.md) and [AGENTS.md](AGENTS.md).

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
- Backend: http://localhost:3000 (`/health` and `/api/products`)
- Database: `localhost:5433`

Quick check:

```bash
curl localhost:3000/health          # {"status":"ok"}
curl localhost:8080/api/products    # envelope with 6 products
```

## Useful commands

| Command                                 | What it does                                                  |
| --------------------------------------- | ------------------------------------------------------------- |
| `make up` / `make down`                 | Start / stop dev (keeps the database)                         |
| `make clean`                            | Stop dev and delete the database volume                       |
| `make logs SERVICE=backend`             | Follow logs (SERVICE is optional)                             |
| `make migrate` / `make seed`            | Run migrations / seed manually                                |
| `make test`                             | Full suite in containers (Docker only)                        |
| `make test-backend`                     | Vitest (unit + integration) against an ephemeral Postgres     |
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

| Variable                   | Default     | Controls                                                              |
| -------------------------- | ----------- | --------------------------------------------------------------------- |
| `POSTGRES_USER`            | `ecommerce` | Postgres user                                                         |
| `POSTGRES_PASSWORD`        | `change-me` | Postgres password (change it locally; URL-encode special characters)  |
| `POSTGRES_DB`              | `ecommerce` | Database name                                                         |
| `BACKEND_PORT`             | `3000`      | Express port. Do not change it without updating `frontend/nginx.conf` |
| `FRONTEND_PORT`            | `8080`      | Port nginx publishes in dev                                           |
| `DB_PORT`                  | `5433`      | Port Postgres publishes in dev                                        |
| `TEST_LOCAL_FRONTEND_PORT` | `8081`      | Frontend port in the debug test environment                           |

`.env.test` (committed, no real secrets) feeds the test environment, so `make test` works on a clean clone.

## Known `npm audit` warnings

The backend's **production** dependencies have no known vulnerabilities (`npm audit --omit=dev`). The remaining warnings are in development tooling only (`vitest`, `tinypool`, `esbuild`), which never reaches the production image. Fixing them requires Vitest 4 (a breaking change) and is left for a future update.
