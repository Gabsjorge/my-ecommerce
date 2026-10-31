# Especificação do Scaffolding — my-ecommerce

Este documento especifica o boilerplate inicial do projeto, suficiente para criá-lo do zero. Ele cobre o fluxo **Listagem de Produtos** de ponta a ponta (tela → `fetch` → endpoint → service → repository → PostgreSQL), com testes E2E de endpoint e de frontend como prova da saúde do fluxo. Ele não contém cronograma nem planejamento de execução.

Documentos de origem: [high_level_requirements.md](high_level_requirements.md) e [system_architecture.md](system_architecture.md).

---

## 1. Visão geral

E-commerce simplificado para fins educacionais. O scaffolding entrega só a listagem de produtos, mas já fixa a estrutura que carrinho, cupons e pedidos (Steps seguintes) vão reutilizar.

### Decisões centrais

| Tema | Decisão |
|---|---|
| Backend | Node 22 + Express 5 + TypeScript (`strict`), padrão Controller → Service → Repository, organizado **por módulo** |
| Banco | PostgreSQL 16 (`postgres:16-alpine`) |
| ORM | Drizzle ORM (`drizzle-kit` gera migrations `.sql` versionadas) |
| Frontend | JS puro com ES modules, sem build. Tipagem via JSDoc + `// @ts-check` (`tsc --noEmit` com `checkJs`). Camadas `views/`, `domain/`, `api/` |
| Servidor do frontend | nginx (container), servindo estáticos e fazendo proxy de `/api/` para o backend (mesma origem, sem CORS) |
| Testes de backend | Vitest (unitário e integração) em `backend/` |
| Testes E2E | Playwright Test em `e2e/` (endpoint e frontend), caixa-preta via HTTP |
| Containers | `db`, `migrate` (one-shot), `backend`, `frontend` e `e2e`/`backend-test` (só em teste) |
| Ambientes Compose | base + `dev` + `test` + `test.local`, com projetos Compose separados |
| Config | `.env` (não commitado) + `.env.example`, validação com Zod |
| Qualidade | ESLint (flat config) + Prettier + `tsc --noEmit`; Husky + lint-staged |
| Orquestração | Makefile na raiz |

### Escopo do fluxo entregue

- `GET /api/products` retorna todos os produtos (sem paginação), em envelope `{ data, total }`.
- `GET /health` verifica o backend e o banco.
- A tela lista os produtos e trata os estados de carregamento, lista vazia e erro.

Fora do scaffolding: carrinho, cupons, pedidos, paginação, autenticação, CI/CD, compose de produção (`docker-compose.prod.yml`), testes unitários de frontend.

---

## 2. Estrutura de diretórios

```
my-ecommerce/
├── AGENTS.md                         # Instruções para agentes de IA
├── Makefile                          # Comandos de orquestração (seção 9)
├── README.md                         # Visão geral e quick start
├── package.json                      # Só tooling: eslint, prettier, husky, lint-staged
├── eslint.config.js                  # ESLint flat config para backend, frontend e e2e
├── .prettierrc                       # Config única do Prettier
├── .prettierignore
├── .gitignore
├── .nvmrc                            # 22
├── .husky/
│   └── pre-commit                    # npx lint-staged
├── .env.example                      # Variáveis documentadas (commitado)
├── .env                              # Valores locais (NÃO commitado)
├── .env.test                         # Valores fixos e descartáveis do ambiente de teste (commitado)
├── docker-compose.yml                # Base: db, migrate, backend, frontend
├── docker-compose.dev.yml            # Dev: bind mounts, hot reload, portas, volume do banco
├── docker-compose.test.yml           # Teste: banco efêmero, serviços backend-test e e2e
├── docker-compose.test.local.yml     # Depuração: publica a porta do frontend de teste
│
├── docs/
│   ├── high_level_requirements.md
│   ├── system_architecture.md
│   └── scaffolding-specification.md  # Este documento
│
├── backend/
│   ├── Dockerfile                    # Multi-stage: base, dev, build, production
│   ├── .dockerignore
│   ├── package.json
│   ├── tsconfig.json                 # strict, noEmit para typecheck e vitest
│   ├── tsconfig.build.json           # Compila src/ para dist/ (exclui *.test.ts)
│   ├── vitest.config.ts              # Projetos "unit" e "integration"
│   ├── drizzle.config.ts             # Config do drizzle-kit (schema, out: ./drizzle)
│   ├── drizzle/                      # Migrations .sql geradas e commitadas
│   └── src/
│       ├── server.ts                 # Bootstrap: lê config, cria app, chama listen
│       ├── app.ts                    # createApp(deps): monta Express sem listen (testável)
│       ├── config/
│       │   ├── env.ts                # Valida process.env com Zod, falha rápido
│       │   └── env.test.ts
│       ├── db/
│       │   ├── client.ts             # Pool pg + instância Drizzle
│       │   ├── schema.ts             # Tabelas Drizzle (products)
│       │   ├── migrate.ts            # Aplica migrations programaticamente
│       │   └── seed.ts               # Seed idempotente (só se products estiver vazia)
│       ├── shared/
│       │   ├── errors.ts             # AppError, NotFoundError
│       │   └── error-handler.middleware.ts   # Handler 404 e de erro no formato padrão
│       └── modules/
│           ├── health/
│           │   ├── health.routes.ts
│           │   └── health.controller.ts
│           └── products/
│               ├── product.routes.ts
│               ├── product.controller.ts
│               ├── product.service.ts
│               ├── product.repository.ts
│               ├── product.types.ts
│               ├── product.service.test.ts                # unitário (repository mockado)
│               ├── product.repository.integration.test.ts # DB real
│               └── product.routes.integration.test.ts     # supertest + DB real
│
├── frontend/
│   ├── Dockerfile                    # nginx-unprivileged + estáticos
│   ├── .dockerignore
│   ├── nginx.conf                    # Estáticos + proxy de /api/
│   ├── package.json                  # Só devDependencies (typescript) para o typecheck
│   ├── tsconfig.json                 # allowJs, checkJs, noEmit, strict
│   └── src/
│       ├── index.html
│       ├── main.js                   # Entry point: liga views e api
│       ├── styles.css                # CSS mínimo
│       ├── views/
│       │   └── product-list.view.js  # Presentation: HTML e DOM, estados da tela
│       ├── domain/
│       │   └── product.js            # Domain: formatPrice(cents), isOutOfStock(product)
│       └── api/
│           ├── http-client.js        # Wrapper de fetch (erro, JSON)
│           └── products.api.js       # fetchProducts()
│
└── e2e/
    ├── Dockerfile                    # Imagem oficial do Playwright, versão fixada
    ├── .dockerignore
    ├── package.json                  # @playwright/test em versão EXATA
    ├── tsconfig.json
    ├── playwright.config.ts          # Projetos "api" e "ui", baseURL via BASE_URL
    └── tests/
        ├── api/
        │   └── products.api.spec.ts
        └── ui/
            └── product-list.ui.spec.ts
```

Artefatos gerados e ignorados pelo Git: `e2e/playwright-report/`, `e2e/test-results/`, `backend/dist/`, `node_modules/`, `.env`.

---

## 3. Stack e dependências

Versões exatas ficam nos `package.json` e `package-lock.json` (commitado), instaladas com `npm ci`. O runtime é Node 22 (LTS) em todos os containers e no `.nvmrc`.

### backend (`backend/package.json`)

| Dependência | Tipo | Motivo |
|---|---|---|
| `express` (5.x) | runtime | Framework HTTP minimalista. O Express 5 propaga erros de handlers async sem wrapper |
| `drizzle-orm`, `pg` | runtime | ORM próximo do SQL e driver Postgres |
| `zod` | runtime | Validação do env agora e de input no Step 2 |
| `typescript`, `tsx` | dev | Type check, build (`tsc`) e dev com watch (`tsx watch`) |
| `drizzle-kit` | dev | Geração das migrations `.sql` (`drizzle-kit generate`) |
| `vitest`, `supertest` | dev | Runner de testes e chamadas HTTP in-process |
| `@types/node`, `@types/express`, `@types/pg`, `@types/supertest` | dev | Tipos |

### frontend (`frontend/package.json`)

Só `typescript` (dev), para `tsc --noEmit` com `checkJs`. Não há dependência de runtime nem build.

### e2e (`e2e/package.json`)

`@playwright/test` (dev, **versão exata, sem `^`**, igual à tag da imagem Docker), `typescript` e `@types/node`.

### raiz (`package.json`, só tooling)

`eslint`, `typescript-eslint`, `eslint-config-prettier`, `globals`, `prettier`, `husky`, `lint-staged`.

### Imagens Docker (versões fixadas, nunca `:latest`)

| Serviço | Imagem |
|---|---|
| `db` | `postgres:16-alpine` |
| `backend`, `migrate`, `backend-test` | `node:22-alpine` (multi-stage) |
| `frontend` | `nginxinc/nginx-unprivileged:1.27-alpine` (roda como não-root na porta 8080) |
| `e2e` | `mcr.microsoft.com/playwright:v<VERSÃO>-noble`, com `<VERSÃO>` igual à de `@playwright/test` |

---

## 4. Contrato da API

### Convenções

- Rotas de negócio sob `/api`. O `/health` fica fora do prefixo.
- O nginx faz proxy apenas de `/api/`. O `/health` do backend é verificado pelo healthcheck do Compose (direto no container) e pelos testes de integração do backend.
- Campos em JSON usam `camelCase`. Preço trafega em **centavos, inteiro** (`priceCents`).

### `GET /api/products`

Resposta `200`:

```json
{
  "data": [
    { "id": 1, "name": "Camiseta Básica Algodão", "description": "...", "priceCents": 4990, "stock": 25 }
  ],
  "total": 6
}
```

- Ordenada por `id` crescente (determinística).
- Sem paginação. `total` é o número de itens retornados.
- Lista vazia retorna `{ "data": [], "total": 0 }` com status `200`.

### `GET /health`

- `200 { "status": "ok" }` quando o processo responde e `SELECT 1` no banco funciona.
- `503 { "status": "unavailable" }` se o banco não responde.

### Formato de erro (todo o backend)

```json
{ "error": { "code": "NOT_FOUND", "message": "Route not found" } }
```

- Rota inexistente: `404`, `NOT_FOUND`.
- Erro inesperado: `500`, `INTERNAL_ERROR`, com mensagem genérica (sem vazar detalhes ou stack).
- Erros de negócio futuros estendem `AppError(code, message, status)`.

---

## 5. Modelo de dados

Tabela `products` (Drizzle em `src/db/schema.ts`; colunas em `snake_case`, propriedades TS em `camelCase`):

| Coluna | Tipo | Restrições |
|---|---|---|
| `id` | `integer` | `generated always as identity`, PK |
| `name` | `varchar(120)` | `not null` |
| `description` | `text` | `not null` |
| `price_cents` | `integer` | `not null`, `check (price_cents >= 0)` |
| `stock` | `integer` | `not null`, `check (stock >= 0)` |

### Seed (`src/db/seed.ts`)

Único para dev e teste, com os mesmos dados, para que os asserts do E2E batam com o que se vê no navegador. É idempotente: só insere se `products` estiver vazia.

| id | name | priceCents | stock |
|---|---|---|---|
| 1 | Camiseta Básica Algodão | 4990 | 25 |
| 2 | Tênis Esportivo Runner | 29990 | 10 |
| 3 | Mochila Urbana 20L | 15990 | 8 |
| 4 | Fone de Ouvido Bluetooth | 19990 | 15 |
| 5 | Garrafa Térmica 500ml | 7990 | 40 |
| 6 | Caderno Universitário 200 folhas | 3490 | **0** |

Cada produto tem uma `description` curta e fixa. O produto 6 (estoque 0) cobre a exibição de "sem estoque".

### Migrations

- `drizzle-kit generate` (via `npm run db:generate` no backend) gera arquivos `.sql` em `backend/drizzle/`, que são commitados.
- `src/db/migrate.ts` aplica com `drizzle-orm/node-postgres/migrator` (`migrationsFolder: './drizzle'`), sem depender do CLI na imagem de produção.

---

## 6. Camadas e fluxo de código

### Backend

`app.ts` expõe `createApp({ db })`, que faz a composição manual das dependências (sem framework de DI):

```
db → ProductRepository → ProductService → ProductController → product.routes → app
```

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Controller | `product.controller.ts` | Recebe `req`/`res`, delega ao service e monta a resposta `{ data, total }` |
| Service | `product.service.ts` | Regra de negócio. Hoje só chama o repository e calcula `total` |
| Repository | `product.repository.ts` | Único ponto que fala com o Drizzle. Retorna `Product[]` (`select` ordenado por `id`) |
| Routes | `product.routes.ts` | Associa `GET /` ao controller. Montado em `/api/products` |

Regras: controller não importa repository nem Drizzle; service não conhece `req`/`res`; só o repository importa `db/schema`.

`server.ts` lê o env (`config/env.ts`), cria o pool, chama `createApp` e `listen`. Ele trata `SIGTERM` fechando o servidor e o pool.

### Frontend

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| API | `api/products.api.js`, `api/http-client.js` | `fetchProducts()` faz `fetch('/api/products')` com caminho relativo e lança erro em status não-2xx |
| Domain | `domain/product.js` | `formatPrice(cents)` usa `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`. `isOutOfStock(product)` retorna `stock === 0` |
| Presentation | `views/product-list.view.js` | Renderiza e manipula o DOM nos estados carregando, lista, vazio e erro |

`main.js` orquestra: chama a API, passa os dados à view. As views usam o domain, nunca o `fetch` direto. Os tipos (`Product`, `ProductListResponse`) ficam em JSDoc `@typedef` em `api/products.api.js`.

Atributos `data-testid` usados pelo Playwright: `product-list`, `product-item`, `product-name`, `product-price`, `product-stock`, `out-of-stock-badge`, `loading`, `empty-state`, `error-message`.

---

## 7. Containerização

Práticas obrigatórias: imagens com versão fixada, usuário não-root, `.dockerignore` em cada pacote, `COPY` (não `ADD`), volume nomeado para dados persistentes, healthchecks com `depends_on: condition: service_healthy`, nenhum segredo em Dockerfile.

### Ordem de subida

`db` (saudável) → `migrate` (conclui com sucesso: migrations + seed) → `backend` (saudável via `/health`) → `frontend` (saudável).

### `backend/Dockerfile` (multi-stage)

```dockerfile
FROM node:22-alpine AS base
WORKDIR /app
RUN chown node:node /app
COPY package*.json ./

FROM base AS dev
USER node
RUN npm ci
COPY --chown=node:node . .
CMD ["npm", "run", "dev"]            # tsx watch src/server.ts

FROM base AS build
USER node
RUN npm ci
COPY --chown=node:node . .
RUN npm run build                    # tsc -p tsconfig.build.json -> dist/

FROM base AS production
ENV NODE_ENV=production
USER node
RUN npm ci --omit=dev
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle
CMD ["node", "dist/server.js"]
```

O estágio `dev` instala e roda como `node` para o Vitest conseguir gravar cache em `node_modules/.vite`. O `COPY package*.json` na `base` roda como root (arquivos legíveis, sem problema).

### `frontend/Dockerfile`

```dockerfile
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY src /usr/share/nginx/html
```

### `frontend/nginx.conf`

```nginx
server {
  listen 8080;
  root /usr/share/nginx/html;
  index index.html;
  add_header Cache-Control "no-cache" always;

  location /api/ {
    proxy_pass http://backend:3000;      # sem URI: preserva /api/...
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location / {
    try_files $uri $uri/ =404;
  }
}
```

O backend escuta na porta 3000 dentro da rede Compose, e o nginx assume essa porta. Não altere `BACKEND_PORT` sem ajustar o `nginx.conf`.

### `e2e/Dockerfile`

```dockerfile
FROM mcr.microsoft.com/playwright:v<VERSÃO>-noble
WORKDIR /e2e
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["npx", "playwright", "test"]
```

O serviço usa `ipc: host` e `init: true`, como recomendado para o Chromium em container.

### `docker-compose.yml` (base)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 10
      start_period: 10s

  migrate:
    build: { context: ./backend, target: production }
    command: ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js"]
    environment: &backend-env
      NODE_ENV: ${NODE_ENV:-production}
      BACKEND_PORT: ${BACKEND_PORT:-3000}
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db: { condition: service_healthy }
    restart: "no"

  backend:
    build: { context: ./backend, target: production }
    environment: *backend-env
    depends_on:
      db: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:$${BACKEND_PORT}/health || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 5s

  frontend:
    build: ./frontend
    depends_on:
      backend: { condition: service_healthy }
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8080/ || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Senhas com caracteres especiais precisam ser codificadas em URL na `DATABASE_URL`.

### `docker-compose.dev.yml`

- `db`: `volumes: [db_data:/var/lib/postgresql/data]` (volume nomeado, declarado em `volumes:`) e `ports: ["${DB_PORT}:5432"]`.
- `migrate` e `backend`: `build.target: dev`, `NODE_ENV: development`. O `migrate` usa `command: ["sh","-c","npm run db:migrate && npm run db:seed"]` (via `tsx`). O `backend` monta `./backend/src:/app/src` e `./backend/drizzle:/app/drizzle`, e publica `${BACKEND_PORT}:3000`.
- `frontend`: monta `./frontend/src:/usr/share/nginx/html:ro` e `./frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro`, e publica `${FRONTEND_PORT}:8080`.

### `docker-compose.test.yml`

- `db`: `tmpfs: [/var/lib/postgresql/data]` (efêmero, sem volume). Nenhuma porta publicada.
- `migrate`, `backend` e `frontend` usam os targets de produção (testa o artefato real) com `NODE_ENV: test`.
- `backend-test` (`profiles: ["tools"]`): `build.target: dev`, `command: ["npm", "test"]`, `NODE_ENV: test`, mesma `DATABASE_URL`, `depends_on` `db` saudável e `migrate` concluído.
- `e2e` (`profiles: ["tools"]`): `build: ./e2e`, `BASE_URL: http://frontend:8080`, `depends_on` `frontend` saudável, `ipc: host`, `init: true`, bind mounts de `./e2e/playwright-report` e `./e2e/test-results`.

### `docker-compose.test.local.yml`

Publica `${TEST_LOCAL_FRONTEND_PORT}:8080` no `frontend`. Usado só para depuração, com o projeto `ecommerce-test-local`.

### Projetos Compose

| Uso | Projeto (`-p`) | Arquivos | Env file |
|---|---|---|---|
| Dev | `ecommerce` | base + dev | `.env` |
| Teste oficial | `ecommerce-test` | base + test | `.env.test` |
| Depuração | `ecommerce-test-local` | base + test + test.local | `.env.test` |

Nomes de projeto distintos evitam que `make test` e o ambiente de depuração colidam.

---

## 8. Configuração de ambiente

### `.env.example` (dev; copiado para `.env`)

| Variável | Valor padrão | Controla |
|---|---|---|
| `POSTGRES_USER` | `ecommerce` | Usuário do Postgres |
| `POSTGRES_PASSWORD` | `change-me` | Senha do Postgres (trocar localmente) |
| `POSTGRES_DB` | `ecommerce` | Nome do banco |
| `BACKEND_PORT` | `3000` | Porta do Express (dentro e fora do container em dev). Não alterar sem ajustar o `nginx.conf` |
| `FRONTEND_PORT` | `8080` | Porta publicada do nginx em dev |
| `DB_PORT` | `5433` | Porta publicada do Postgres em dev (evita conflito com um Postgres local em 5432) |
| `TEST_LOCAL_FRONTEND_PORT` | `8081` | Porta publicada do frontend no ambiente de depuração |

`NODE_ENV` e `DATABASE_URL` não ficam no `.env`: o Compose define `NODE_ENV` por ambiente e monta a `DATABASE_URL`.

### `.env.test` (commitado)

Valores fixos e não secretos para o ambiente de teste (`POSTGRES_PASSWORD=test`, `POSTGRES_DB=ecommerce_test`, `TEST_LOCAL_FRONTEND_PORT=8081`). Ele permite rodar `make test` num clone limpo, sem criar `.env`.

### Validação no backend (`src/config/env.ts`)

Zod valida `NODE_ENV` (`development` | `test` | `production`), `BACKEND_PORT` (inteiro, padrão 3000) e `DATABASE_URL` (obrigatória, URL). Se algo estiver inválido, o processo termina na inicialização com uma mensagem listando o campo. `env.test.ts` cobre os casos válido, ausente e inválido.

### Segredos

Sem Docker Secrets: o projeto é educacional, sem deploy nem CI/CD, e a única credencial é a do Postgres local. `.env` nunca é commitado. Se houver deploy no futuro, migrar para Secrets é uma mudança localizada.

---

## 9. Estratégia de testes

Camadas, do mais barato ao mais caro:

| Tipo | Ferramenta | Onde | Arquivos | O que prova |
|---|---|---|---|---|
| Unitário | Vitest | `backend/src/**` | `*.test.ts` | Lógica isolada, com dependências mockadas |
| Integração | Vitest + supertest | `backend/src/**` | `*.integration.test.ts` | Repository e rotas contra o Postgres real |
| E2E de endpoint | Playwright Test (`request`) | `e2e/tests/api/` | `*.api.spec.ts` | Contrato HTTP do sistema inteiro, via nginx |
| E2E de frontend | Playwright Test (Chromium) | `e2e/tests/ui/` | `*.ui.spec.ts` | Usuário vê a listagem vinda do banco |

**Por que dois runners.** O Vitest vive dentro do backend e pode importar o código dele. O E2E é caixa-preta: só enxerga HTTP e o navegador, então não importa código interno e continua válido se o backend for reescrito. O Playwright Test serve aos dois tipos de E2E (tem runner, asserts e cliente HTTP), então o E2E inteiro usa uma ferramenta só.

### Backend: Vitest

`vitest.config.ts` define dois *projects*:
- `unit`: `include: ['src/**/*.test.ts']`, `exclude: ['src/**/*.integration.test.ts']`.
- `integration`: `include: ['src/**/*.integration.test.ts']`.

Scripts: `test:unit`, `test:integration`, `test` (ambos). Os testes de integração usam a `DATABASE_URL` do ambiente e assumem o dataset do seed (somente leitura por enquanto; no Step 2 passa a exigir limpeza por teste).

Casos obrigatórios:

- `env.test.ts`: aceita env válido; falha com `DATABASE_URL` ausente; falha com `BACKEND_PORT` inválida.
- `product.service.test.ts` (repository mockado): retorna `{ data, total }` com `total === data.length`; retorna lista vazia sem erro.
- `product.repository.integration.test.ts`: retorna os 6 produtos do seed, ordenados por `id`, com os tipos corretos (`priceCents` inteiro).
- `product.routes.integration.test.ts`: `GET /api/products` retorna `200` com o envelope; rota desconhecida retorna `404` no formato de erro; `GET /health` retorna `200` com o banco disponível.

### E2E: Playwright Test

`playwright.config.ts`:
- `use.baseURL = process.env.BASE_URL` (obrigatória; falha com mensagem clara se ausente).
- Projetos: `api` (`testMatch: /.*\.api\.spec\.ts/`) e `ui` (`testMatch: /.*\.ui\.spec\.ts/`, Chromium).
- `retries: 0` (flaky não deve ser escondido), `reporter: [['list'], ['html', { open: 'never' }]]`.

Casos obrigatórios:

`products.api.spec.ts`:
- `GET /api/products` retorna `200`, `total === 6` e `data.length === 6`.
- Cada item tem `id`, `name`, `description`, `priceCents` (inteiro), `stock` (inteiro) com os tipos corretos.
- Itens vêm ordenados por `id`.
- Existe ao menos um item com `stock === 0`.
- `GET /api/rota-inexistente` retorna `404` com `{ error: { code: 'NOT_FOUND', message } }`.

`product-list.ui.spec.ts`:
- A página exibe 6 `product-item`, com o nome do primeiro produto visível.
- O preço é exibido formatado em pt-BR (ex.: `/R\$\s*49,90/`; o `\s` cobre o espaço não separável do `Intl`).
- O produto com estoque 0 exibe `out-of-stock-badge`; os demais não.
- Os dados exibidos na tela batem com os de `GET /api/products` (prova do fluxo completo tela → banco).
- Estado de erro: interceptando `/api/products` com `page.route` e respondendo `500`, aparece `error-message`.
- Estado vazio: interceptando e respondendo `{ data: [], total: 0 }`, aparece `empty-state`.

### Execução

| Alvo | Onde roda | Ambiente |
|---|---|---|
| `make test-backend` | Container `backend-test` | `ecommerce-test`, banco efêmero com migrate e seed |
| `make test-e2e` | Container `e2e` | `ecommerce-test`, stack completa sem portas publicadas |
| `make test-e2e-local` | Host | `ecommerce-test-local`, `BASE_URL=http://localhost:$TEST_LOCAL_FRONTEND_PORT` |

Para o `test-e2e-local`, a versão local de `@playwright/test` é a mesma da imagem (versão exata), e é preciso rodar `npx playwright install chromium` uma vez.

Os alvos de teste usam `docker compose run --rm` (e não `up --abort-on-container-exit`), porque o serviço one-shot `migrate` encerra com sucesso e dispararia o abort. O `run` respeita as condições do `depends_on` e devolve o código de saída do serviço executado.

---

## 10. Ferramentas de qualidade

| Ferramenta | Escopo | Como roda |
|---|---|---|
| ESLint (flat config) | `backend`, `frontend`, `e2e` | `npm run lint` na raiz |
| `typescript-eslint` (preset `recommended`, sem type-aware) | `.ts` do backend e do e2e | idem |
| Prettier | tudo | `npm run format:check` / `npm run format` |
| `tsc --noEmit` (`strict`) | cada pacote | `npm --prefix <pacote> run typecheck` |
| `tsc --noEmit` com `checkJs` | `frontend/src` | idem |
| Husky + lint-staged | arquivos staged | Hook `pre-commit` roda `eslint --fix` e `prettier --write` |

### `.prettierrc`

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

### `eslint.config.js` (raiz)

Config única com três blocos: `.ts` do backend e do e2e (`typescript-eslint`, globals de Node), `.js` do frontend (`@eslint/js` recommended, globals de browser) e arquivos de config na raiz (globals de Node). Termina com `eslint-config-prettier`. Ignora `dist/`, `node_modules/`, `playwright-report/` e `test-results/`.

### Hook de pre-commit

O `lint-staged` aplica lint e formatação só nos arquivos staged. O type check não entra no hook (é lento); ele roda em `make lint`.

---

## 11. Convenções

- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`). Sem commitlint por enquanto.
- **Branches:** `feat/<nome>`, `fix/<nome>`, `chore/<nome>`, a partir de `main`.
- **Arquivos:** `kebab-case`. Em cada módulo do backend: `<nome>.controller.ts`, `<nome>.service.ts`, `<nome>.repository.ts`, `<nome>.routes.ts`, `<nome>.types.ts`.
- **Código:** classes e tipos em `PascalCase`; funções e variáveis em `camelCase`; variáveis de ambiente em `UPPER_SNAKE_CASE`.
- **Banco:** colunas em `snake_case`, mapeadas para `camelCase` no schema Drizzle.
- **Testes:** `*.test.ts` (unitário), `*.integration.test.ts` (integração), `*.api.spec.ts` e `*.ui.spec.ts` (E2E). Testes de backend ficam ao lado do código; E2E ficam em `e2e/tests/`.
- **Idioma:** identificadores e commits em inglês; conteúdo exibido ao usuário e seed em português (pt-BR); documentação em português.

---

## 12. Comandos essenciais (Makefile)

O alvo padrão é `help`, que lista os alvos a partir de comentários `##`. Variáveis do Makefile:

```makefile
COMPOSE_DEV        = docker compose -p ecommerce            --env-file .env      -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_TEST       = docker compose -p ecommerce-test       --env-file .env.test -f docker-compose.yml -f docker-compose.test.yml
COMPOSE_TEST_LOCAL = docker compose -p ecommerce-test-local --env-file .env.test -f docker-compose.yml -f docker-compose.test.yml -f docker-compose.test.local.yml
```

| Alvo | O que faz |
|---|---|
| `make help` | Lista os alvos com descrição (padrão) |
| `make install` | `npm ci` na raiz e em cada pacote (necessário para lint e para o `test-e2e-local`); instala os hooks do Husky |
| `make up` | Cria `.env` a partir de `.env.example` se não existir e sobe o dev (`up --build -d --wait`) |
| `make down` | Derruba o dev e mantém o volume do banco |
| `make clean` | Derruba o dev e remove os volumes (`down -v`), voltando ao banco zerado |
| `make logs` | Segue os logs do dev (`SERVICE=backend` opcional) |
| `make migrate` / `make seed` | Rodam as migrations / o seed manualmente no dev |
| `make test` | **Suíte completa:** `test-backend` e depois `test-e2e`. Para na primeira falha e devolve o código de saída correto |
| `make test-backend` | Build, `run --rm backend-test` e teardown (`down -v`) garantido |
| `make test-e2e` | Build, `run --rm e2e` (sobe a stack completa por dependência) e teardown garantido |
| `make test-env-up` | Sobe o ambiente de depuração (`ecommerce-test-local`, com porta publicada) |
| `make test-env-down` | Derruba o ambiente de depuração (`down -v`) |
| `make test-env-reset` | `test-env-down` seguido de `test-env-up` (banco e seed do zero) |
| `make test-e2e-local` | Playwright no host contra o ambiente de depuração (`BASE_URL=http://localhost:$TEST_LOCAL_FRONTEND_PORT`) |
| `make lint` | ESLint, `format:check` e `tsc --noEmit` nos três pacotes (no host) |
| `make format` | Prettier `--write` (no host) |
| `make check` | `lint` e depois `test` |

### Padrão de teardown garantido

```makefile
test-e2e:
	$(COMPOSE_TEST) build
	$(COMPOSE_TEST) run --rm e2e; rc=$$?; $(COMPOSE_TEST) down -v; exit $$rc
```

O `down -v` roda mesmo com falha e o código de saída do teste é preservado. O mesmo padrão vale para `test-backend`. O requisito do `make test` é só Docker (sem Node no host).

### Pontos a verificar na implementação

- `up --wait` com o serviço one-shot `migrate`: confirmar que a versão instalada do Docker Compose trata o `migrate` concluído com sucesso como pronto. Se não tratar, substituir por `up -d` seguido de espera pelo healthcheck do `frontend`.
- Dev com bind mount no macOS: confirmar que `tsx watch` detecta as alterações em `backend/src`.

---

## 13. Critérios de aceite do scaffolding

1. `make up` num clone limpo sobe `db`, `migrate`, `backend` e `frontend` saudáveis, e `http://localhost:8080` exibe os 6 produtos.
2. `curl localhost:3000/health` retorna `200 {"status":"ok"}` e `curl localhost:8080/api/products` retorna o envelope com 6 itens.
3. `make test` num clone limpo, sem `.env` e só com Docker, executa `test-backend` e `test-e2e` e termina com código `0`.
4. Quebrar de propósito o seed, a rota ou a view faz `make test` terminar com código diferente de `0` e ainda derrubar os containers.
5. `make check` passa (lint, format e type check nos três pacotes).
6. O pre-commit bloqueia um commit com erro de lint.
7. `make test-env-up` seguido de `make test-e2e-local` executa o E2E no host contra o ambiente de depuração.
