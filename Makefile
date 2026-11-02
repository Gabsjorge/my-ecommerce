COMPOSE_DEV        = docker compose -p ecommerce            --env-file .env      -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_TEST       = docker compose -p ecommerce-test       --env-file .env.test -f docker-compose.yml -f docker-compose.test.yml
COMPOSE_TEST_LOCAL = docker compose -p ecommerce-test-local --env-file .env.test -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.test.local.yml

PACKAGES = backend frontend e2e

.DEFAULT_GOAL := help

.PHONY: help install up down clean logs migrate seed test test-backend test-frontend test-e2e \
	test-env-up test-env-down test-env-reset test-e2e-local lint format check

help: ## List the available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## npm ci in the root and in every package, and install the Husky hooks
	npm ci
	@for pkg in $(PACKAGES); do (cd $$pkg && npm ci) || exit 1; done

up: ## Create .env if missing and start the dev stack
	test -f .env || cp .env.example .env
	$(COMPOSE_DEV) up --build -d --wait

down: ## Stop the dev stack (keeps the database volume)
	$(COMPOSE_DEV) down

clean: ## Stop the dev stack and remove volumes (empty database)
	$(COMPOSE_DEV) down -v

logs: ## Follow dev logs (optional: SERVICE=backend)
	$(COMPOSE_DEV) logs -f $(SERVICE)

migrate: ## Run migrations manually in dev
	$(COMPOSE_DEV) run --rm migrate sh -c "npm run db:migrate"

seed: ## Run the seed manually in dev
	$(COMPOSE_DEV) run --rm migrate sh -c "npm run db:seed"

test: test-backend test-frontend test-e2e ## Full suite (Docker only)

test-backend: ## Vitest (unit + integration) against an ephemeral Postgres
	$(COMPOSE_TEST) --profile tools build
	$(COMPOSE_TEST) run --rm backend-test; rc=$$?; $(COMPOSE_TEST) down -v; exit $$rc

test-frontend: ## node:test unit tests of the frontend (containerized)
	$(COMPOSE_TEST) --profile tools run --rm frontend-test

test-e2e: ## Playwright (api + ui) against the full test stack
	mkdir -p e2e/playwright-report e2e/test-results
	$(COMPOSE_TEST) --profile tools build
	$(COMPOSE_TEST) run --rm e2e; rc=$$?; $(COMPOSE_TEST) down -v; exit $$rc

test-env-up: ## Start the debug test environment (frontend on TEST_LOCAL_FRONTEND_PORT)
	$(COMPOSE_TEST_LOCAL) up --build -d --wait

test-env-down: ## Stop the debug test environment
	$(COMPOSE_TEST_LOCAL) down -v

test-env-reset: test-env-down test-env-up ## Recreate the debug environment (fresh database and seed)

test-e2e-local: ## Run Playwright on the host against the debug environment
	set -a; . ./.env.test; set +a; \
	cd e2e && BASE_URL=http://localhost:$$TEST_LOCAL_FRONTEND_PORT npx playwright test

lint: ## ESLint, Prettier (check) and tsc --noEmit in all packages
	npm run lint
	npm run format:check
	@for pkg in $(PACKAGES); do npm --prefix $$pkg run typecheck || exit 1; done

format: ## Prettier --write
	npm run format

check: lint test ## lint + test
