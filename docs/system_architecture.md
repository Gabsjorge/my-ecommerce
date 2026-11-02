# System Architecture Documentation

## Frontend
Simple application, no UI framework (React, Vue, etc.), no design system. The objective is to demonstrate layer separation and allow basic data visualization.

Three layers:

| Layer            | Directory            | Responsibility |
| ---------------- |:--------------------:|----------|
| **Presentation** | `views/` or `pages/` | HTML + JS rendering and DOM manipulation |
| **Domain**       | `domain/`            | Business logic/frontend application (local calculations, UX validations) |
| **API**          | `api/`               | JS Modules that make `fetch()` to backend endpoints |

## Backend
* API REST with JSON endpoints
* Layer pattern: **Controller → Service → Repository**
* Controllers receive HTTP requests and delegate to Services
* Services contain business logic and delegate persistency to Repositories
* Repositories abstract database access

## Infrastructure
* Dockerized: `docker-compose.yml` with frontend, backend and database containers
* Endpoint `/health` for health check

## Decisions Intentionally Left Open
The following decisions will be made by the developer in Step 1 (scaffolding brainstorm), with AI assistance:

| Decision | Suggested Options | Will Be Resolved In |
| ---- | ---- | ---- |
| Backend stack | Node+Express, Python+FastAPI, other | Step 1.1 |
| ORM or direct queries | Prisma, SQLAlchemy, TypeORM, SQL queries | Step 1.1 |
| Database | SQLite (simple) or PostgreSQL (realistic) | Step 1.1 |
| Testing framework | Jest, Pytest, Vitest, other | Step 1.1 |
| Stock decrement strategy | Optimistic, pessimistic, event-based | Step 2 — **resolved: pessimistic** (see below) |

## Decisions Resolved in Step 2 (Cart)
* **Stock decrement: pessimistic.** Adding to a cart neither reserves nor returns stock. On order confirmation, a single transaction locks the product rows (`SELECT ... FOR UPDATE`, ordered by id), checks stock, creates the order, decrements stock, marks the coupon as used and moves the cart to its final state. Any failure rolls everything back.
* **Frontend with the cart:** the same three layers. `api/` has the cart HTTP client, `domain/` holds the cart rules mirrored from the server (allowed actions per state, quantity parsing, error messages, cart session in `localStorage`, hash routes) and `views/` renders the list, the cart and the order summary. Frontend unit tests use `node:test`.