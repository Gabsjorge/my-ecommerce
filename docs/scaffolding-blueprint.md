# Blueprint de Desenvolvimento — Scaffolding do my-ecommerce

> Produzido com o skill `scaffolding-blueprint` (em `skills/scaffolding-blueprint/`), com o `docker-advisor` aplicado às etapas de Docker.
> Este documento é para revisão e aprovação. Nada foi implementado.
> Depois da aprovação, ele é salvo em `docs/scaffolding-blueprint.md` (Fase 5 do skill). A implementação é feita por `scaffolding-development`.
> Fontes: `docs/scaffolding-specification.md`, `docs/high_level_requirements.md`, `docs/system_architecture.md` e `AGENTS.md`.

---

## 0. Contexto do projeto (autocontido)

E-commerce simplificado, com fins educacionais. O scaffolding entrega **só a Listagem de Produtos** de ponta a ponta: tela → `fetch` → endpoint → service → repository → PostgreSQL. Ele tem testes E2E de endpoint e de frontend. Carrinho, cupons e pedidos vêm nos Steps seguintes.

### Stack (decisões fixas, não questionar)

| Parte | Tecnologia |
|---|---|
| Backend | Node 22, Express 5, TypeScript `strict`, Controller → Service → Repository, **por módulo** |
| Banco | PostgreSQL 16 (`postgres:16-alpine`) |
| ORM | Drizzle ORM + `drizzle-kit` (migrations `.sql` commitadas em `backend/drizzle/`) |
| Frontend | JS puro com ES modules, JSDoc + `// @ts-check`, sem framework e sem build. Camadas `views/`, `domain/`, `api/` |
| Servidor do frontend | nginx-unprivileged com proxy de `/api/` → `backend:3000` (mesma origem, sem CORS) |
| Testes backend | Vitest (projects `unit` e `integration`) + supertest |
| Testes E2E | Playwright Test em `e2e/` (projects `api` e `ui`), caixa-preta, versão **exata** igual à da imagem Docker |
| Env | `.env` (não commitado), `.env.example`, `.env.test` (commitado), validação com Zod em `config/env.ts` |
| Qualidade | ESLint flat config, Prettier, `tsc --noEmit`, Husky + lint-staged |
| Orquestração | Docker Compose (base + dev + test + test.local) + Makefile |

### Convenções obrigatórias

- **Camadas do backend:** o controller não importa repository nem Drizzle. O service não conhece `req`/`res`. **Só o repository importa `db/schema`.** A composição é manual em `app.ts` (`createApp({ db })`), sem DI framework.
- **Camadas do frontend:** a view renderiza, o `domain/` tem a lógica, o `api/` faz `fetch`. A view nunca chama `fetch`.
- **Env:** `process.env` só é lido em `backend/src/config/env.ts`.
- **Nomes:** arquivos em `kebab-case`. Tipos e classes em `PascalCase`. Funções e variáveis em `camelCase`. Env em `UPPER_SNAKE_CASE`. Colunas do banco em `snake_case`, propriedades TS em `camelCase`.
- **Testes:** `*.test.ts` (unitário), `*.integration.test.ts` (integração), `*.api.spec.ts` e `*.ui.spec.ts` (E2E, só em `e2e/`).
- **Commits:** Conventional Commits em inglês. **Branches:** `feat|fix|chore/<nome>`. **Idioma:** identificadores em inglês. UI, seed e docs em pt-BR.
- **Contrato da API (não mudar):** preço em centavos inteiros (`priceCents`), `id` serial inteiro, campos em `camelCase`, listagem `{ data, total }` sem paginação ordenada por `id`, erros `{ error: { code, message } }`.
- Use `data-testid` nos elementos que o Playwright consulta.

### Estrutura alvo (resumo)

```
backend/   Dockerfile, .dockerignore, package.json, tsconfig(.build).json, vitest.config.ts, drizzle.config.ts, drizzle/
           src/{server.ts, app.ts, config/env(.test).ts, db/{client,schema,migrate,seed}.ts,
                shared/{errors,error-handler.middleware}.ts, modules/{health,products}/...}
frontend/  Dockerfile, .dockerignore, nginx.conf, package.json, tsconfig.json,
           src/{index.html, main.js, styles.css, views/product-list.view.js, domain/product.js,
                api/{http-client,products.api}.js}
e2e/       Dockerfile, .dockerignore, package.json, tsconfig.json, playwright.config.ts,
           tests/{api/products.api.spec.ts, ui/product-list.ui.spec.ts}
raiz       Makefile, package.json (tooling), eslint.config.js, .prettierrc, .prettierignore, .gitignore, .nvmrc,
           .husky/pre-commit, .env.example, .env.test, docker-compose{,.dev,.test,.test.local}.yml, README.md
```

---

## 1. Visão geral do plano

### O que será implementado e por quê

- **Entidade de exemplo: `Product`.** Ela é central ao domínio, e carrinho, cupons e pedidos dependem dela. É simples (5 colunas, só leitura) e exercita todas as fronteiras: banco, migration, repository, service, controller, rota, nginx, `fetch`, domain e view.
- **Infra completa:** Docker, Compose em 3 projetos, Makefile, env, lint/format/typecheck e hooks. Esses itens fixam o padrão que os Steps seguintes herdam.
- **Seed** com 6 produtos de exemplo (seção 3).
- **Testes** em 4 camadas (seção 4), usados como template para features futuras.

### Fora do escopo

Carrinho, cupons, pedidos, paginação, autenticação, pagamento, notificações, upload de imagem, busca, CI/CD, `docker-compose.prod.yml`, testes unitários de frontend, commitlint, Docker Secrets.

### Critérios de sucesso (verificáveis, = critérios de aceite da spec)

| # | Critério | Como verificar |
|---|---|---|
| 1 | `make up` num clone limpo sobe `db`, `migrate`, `backend` e `frontend` saudáveis, e `localhost:8080` mostra 6 produtos | `docker compose -p ecommerce ps` e abrir o navegador |
| 2 | `/health` retorna `200 {"status":"ok"}`. `/api/products` pelo nginx retorna o envelope com 6 itens | `curl localhost:3000/health` e `curl localhost:8080/api/products` |
| 3 | `make test` num clone limpo, sem `.env` e só com Docker, termina com código 0 | `rm -f .env && make test; echo $?` |
| 4 | Quebrar o seed, a rota ou a view faz `make test` falhar (≠ 0) **e** derruba os containers | Quebra proposital, `echo $?`, `docker ps` vazio |
| 5 | `make check` passa | `make check` |
| 6 | O pre-commit bloqueia um commit com erro de lint | Commit com `var x` ou semelhante staged |
| 7 | `make test-env-up` + `make test-e2e-local` rodam o E2E no host | Executar os dois alvos |

---

## 2. Implementação da entidade `Product` (em ordem de execução)

A ordem é **persistência → backend → frontend → containers → E2E**. O backend e o frontend são desenvolvidos e testados antes do Docker. Os containers só encapsulam o que já funciona. Os testes entram junto com cada camada (TDD sempre que possível).

### Etapa A — Fundação do repositório (tooling raiz)

- **O que fazer:** criar a configuração de qualidade e os arquivos de base do monorepo.
- **Onde:** raiz.
- **Como:**
  - `.nvmrc` com `22`.
  - `.gitignore`: **manter a linha `skills/` que já existe** (ver Pontos de Atenção). Adicionar `node_modules/`, `.env`, `backend/dist/`, `e2e/playwright-report/`, `e2e/test-results/`.
  - `.prettierrc` com `{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }`.
  - `.prettierignore`: `node_modules`, `dist`, `playwright-report`, `test-results`, `backend/drizzle` (meta gerado), `package-lock.json`, `skills/`, `docs/` (decidir; ver Pontos de Atenção).
  - `package.json` raiz (`private: true`, só tooling). Devs: `eslint`, `@eslint/js`, `typescript`, `typescript-eslint`, `eslint-config-prettier`, `globals`, `prettier`, `husky`, `lint-staged`. Scripts: `lint` (`eslint .`), `format` (`prettier --write .`), `format:check` (`prettier --check .`), `prepare` (`husky`). Bloco `lint-staged`: `*.{ts,js}` → `eslint --fix` e `prettier --write`. `*.{json,md,yml,yaml,css,html}` → `prettier --write`.
  - `eslint.config.js` com 3 blocos: (1) `.ts` de backend e e2e com `typescript-eslint` recommended, sem type-aware, e globals de Node; (2) `.js` de `frontend/src` com `@eslint/js` recommended e globals de browser; (3) arquivos de config da raiz com globals de Node. Fecha com `eslint-config-prettier`. Ignora `dist/`, `node_modules/`, `playwright-report/`, `test-results/`.
  - `.husky/pre-commit` com `npx lint-staged` (gerado por `npx husky init` e ajustado).
- **Resultado:** `npm ci && npx eslint .` roda sem erro (sem fontes ainda) e o hook está instalado.

### Etapa B — Backend: projeto base

- **O que fazer:** criar o pacote `backend` com TypeScript, scripts e config do Vitest.
- **Onde:** `backend/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `drizzle.config.ts`.
- **Como:**
  - Dependências conforme a spec (seção 3): runtime `express@5`, `drizzle-orm`, `pg`, `zod`. Dev: `typescript`, `tsx`, `drizzle-kit`, `vitest`, `supertest`, `@types/{node,express,pg,supertest}`. Fixar versões compatíveis entre `drizzle-orm` e `drizzle-kit`. Commitar o `package-lock.json`.
  - Scripts: `dev` (`tsx watch src/server.ts`), `build` (`tsc -p tsconfig.build.json`), `start` (`node dist/server.js`), `typecheck` (`tsc --noEmit`), `test:unit`, `test:integration`, `test` (`vitest run`, os dois projects), `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx src/db/migrate.ts`), `db:seed` (`tsx src/db/seed.ts`).
  - `tsconfig.json`: `strict`, `noEmit`, inclui `src`, `vitest.config.ts` e `drizzle.config.ts`.
  - `tsconfig.build.json`: estende o anterior, `outDir: dist`, `rootDir: src`, exclui `**/*.test.ts` e `**/*.integration.test.ts`. **Precisa compilar `db/migrate.ts` e `db/seed.ts`**, porque o container `migrate` de produção os executa.
  - `vitest.config.ts` com dois projects: `unit` (`include src/**/*.test.ts`, `exclude src/**/*.integration.test.ts`) e `integration` (`src/**/*.integration.test.ts`).
  - `drizzle.config.ts`: `dialect: 'postgresql'`, `schema: './src/db/schema.ts'`, `out: './drizzle'`. **Sem `dbCredentials`**, porque o `generate` não conecta ao banco. Assim não lê `process.env` fora de `env.ts`.
- **Resultado:** `npm --prefix backend run typecheck` passa e `vitest run` roda sem testes.

### Etapa C — Config e erros compartilhados (com testes primeiro)

- **O que fazer:** validar o env com Zod e definir o formato de erro.
- **Onde:** `backend/src/config/env.ts`, `env.test.ts`, `backend/src/shared/errors.ts`, `error-handler.middleware.ts`.
- **Como:**
  - `env.ts` exporta `parseEnv(raw)`, função pura que recebe um objeto e é testável sem mexer em `process.env`. Exporta também `loadEnv()`, que chama `parseEnv(process.env)`. O schema aceita `NODE_ENV` (`development|test|production`, padrão `development`), `BACKEND_PORT` (`z.coerce.number().int().positive()`, padrão 3000) e `DATABASE_URL` (obrigatória, URL). Em erro, `loadEnv` imprime os campos inválidos e termina com `process.exit(1)`. `parseEnv` lança, para os testes. Não executar parse no import, para não derrubar os testes.
  - `env.test.ts` (escrever antes): aceita env válido, falha com `DATABASE_URL` ausente, falha com `BACKEND_PORT` inválida (`abc`).
  - `errors.ts`: `AppError(code, message, status)` e `NotFoundError extends AppError` (`NOT_FOUND`, 404).
  - `error-handler.middleware.ts`: exporta `notFoundHandler` (responde `NotFoundError('Route not found')`) e `errorHandler` com 4 argumentos. `AppError` responde `{ error: { code, message } }` no status dele. Qualquer outro erro responde `500 { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }`, registra o detalhe só no log e **não vaza stack**.
- **Resultado:** `npm run test:unit` roda `env.test.ts` e passa.

### Etapa D — Banco: schema, client, migration

- **O que fazer:** modelar `products` e gerar a migration inicial.
- **Onde:** `backend/src/db/schema.ts`, `client.ts`, `migrate.ts`, `backend/drizzle/`.
- **Como:**
  - `schema.ts`: `pgTable('products', ...)` com `id: integer('id').primaryKey().generatedAlwaysAsIdentity()`, `name: varchar('name', { length: 120 }).notNull()`, `description: text('description').notNull()`, `priceCents: integer('price_cents').notNull()`, `stock: integer('stock').notNull()`. No bloco de extras: `check('products_price_cents_nonneg', sql\`${t.priceCents} >= 0\`)` e `check('products_stock_nonneg', sql\`${t.stock} >= 0\`)`.
  - `client.ts`: `createPool(databaseUrl)` e `createDb(pool)` (Drizzle `node-postgres` com `schema`). Exporta o tipo `Database`. Exporta `pingDb(db)` (`select 1`), usado pelo `/health` (ver Pontos de Atenção).
  - `migrate.ts`: usa `loadEnv()`, cria o pool, roda `migrate(db, { migrationsFolder: './drizzle' })` (`drizzle-orm/node-postgres/migrator`), fecha o pool e usa `process.exit(1)` em erro.
  - Rodar `npm run db:generate -- --name init_products` no host. **Commitar** o `.sql` e o `meta/` gerados. Nunca editar uma migration já aplicada.
- **Resultado:** existe `backend/drizzle/0000_init_products.sql` com a tabela, a identity e os 2 checks. O `db:migrate` ainda não foi executado (não há banco).

### Etapa E — Módulo `products` (TDD: teste → código)

- **O que fazer:** implementar as camadas Repository → Service → Controller → Routes.
- **Onde:** `backend/src/modules/products/`.
- **Como:**
  - `product.types.ts`: `Product { id: number; name: string; description: string; priceCents: number; stock: number }` (tipo de domínio escrito à mão, **sem importar `db/schema`**), `ProductListResponse { data: Product[]; total: number }` e a interface `ProductRepositoryPort { findAll(): Promise<Product[]> }`.
  - `product.repository.ts` (único que importa `db/schema`): `class ProductRepository { constructor(db: Database); findAll() }` → `db.select().from(products).orderBy(asc(products.id))`, mapeando para `Product`.
  - `product.service.ts`: `class ProductService { constructor(repo: ProductRepositoryPort); async list(): Promise<ProductListResponse> }` → `{ data, total: data.length }`.
  - `product.controller.ts`: `class ProductController { constructor(service) ; list = async (_req, res) => res.json(await service.list()) }`. Express 5 propaga o erro async sem wrapper.
  - `product.routes.ts`: `createProductRoutes(controller): Router` com `GET /`.
  - Testes (escritos antes, ver seção 4): `product.service.test.ts`, `product.repository.integration.test.ts`, `product.routes.integration.test.ts`.
- **Resultado:** o service passa nos testes unitários com repository mockado. Os testes de integração ainda não podem rodar (sem banco).

### Etapa F — Módulo `health`, `app.ts` e `server.ts`

- **O que fazer:** compor a aplicação e subir o servidor.
- **Onde:** `backend/src/modules/health/health.{routes,controller}.ts`, `app.ts`, `server.ts`.
- **Como:**
  - `health.controller.ts` recebe `checkDb: () => Promise<void>`. Responde `200 { status: 'ok' }` e, em exceção, `503 { status: 'unavailable' }`.
  - `app.ts`: `createApp({ db })` monta, em ordem: `express.json()`, `GET /health` (fora de `/api`), `app.use('/api/products', createProductRoutes(new ProductController(new ProductService(new ProductRepository(db)))))`, `notFoundHandler`, `errorHandler`. Ele injeta `() => pingDb(db)` no health. Sem `listen`.
  - `server.ts`: `loadEnv()`, `createPool`, `createDb`, `createApp`, `listen(BACKEND_PORT)` em `0.0.0.0`. Em `SIGTERM`/`SIGINT` fecha o servidor e depois o pool, e sai com 0.
- **Resultado:** com um Postgres disponível, `npm run dev` serve `/health` e `/api/products`.

### Etapa G — Seed

Ver a seção 3 (arquivo `backend/src/db/seed.ts`). Depende das etapas D e E.

### Etapa H — Frontend

- **O que fazer:** criar a tela de listagem em JS puro com 4 estados (carregando, lista, vazio, erro).
- **Onde:** `frontend/`.
- **Como:**
  - `package.json` (`private`, devDependency `typescript`, script `typecheck`: `tsc --noEmit`). `tsconfig.json`: `allowJs`, `checkJs`, `noEmit`, `strict`, `target`/`module` `ES2022`, `moduleResolution: Bundler`, `lib: ["ES2022","DOM"]`, include `src`.
  - `src/index.html`: `lang="pt-BR"`, `<h1>Produtos</h1>`, `<main id="app">`, `<script type="module" src="/main.js">`, link para `styles.css`.
  - `api/http-client.js`: `getJson(path)` faz `fetch`, lança `HttpError(status)` se `!res.ok` e devolve `res.json()`.
  - `api/products.api.js`: `@typedef` de `Product` e `ProductListResponse`. `fetchProducts()` → `getJson('/api/products')` com **caminho relativo**.
  - `domain/product.js`: `formatPrice(cents)` usa `new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)`. `isOutOfStock(product)` retorna `product.stock === 0`.
  - `views/product-list.view.js`: `renderLoading(el)`, `renderProducts(el, products)`, `renderEmpty(el)`, `renderError(el, message)`. Constrói o DOM com `createElement` e `textContent` (**nunca `innerHTML` com dados**).
  - `main.js`: `renderLoading` → `await fetchProducts()` → `total === 0 ? renderEmpty : renderProducts`. Em `catch`, `renderError('Não foi possível carregar os produtos.')`. Só o `main.js` conhece a `api/`.
  - `data-testid`: `product-list` (container), `product-item` (cada card), `product-name`, `product-price`, `product-stock`, `out-of-stock-badge` (só quando `isOutOfStock`, com o texto "Sem estoque"), `loading`, `empty-state`, `error-message`.
  - `styles.css`: grid simples e legível, mínimo.
- **Resultado:** `npm --prefix frontend run typecheck` passa. Com o backend no ar e o nginx fazendo proxy, a tela lista 6 produtos.

### Etapa I — Containerização (aciona `docker-advisor`)

Segundo o `docker-advisor`, **os arquivos Docker são apresentados ao usuário para confirmação antes de serem salvos**. A implementação segue isso: gerar, mostrar, confirmar e salvar.

- **O que fazer:** Dockerfiles, `.dockerignore`, quatro arquivos Compose e arquivos de env.
- **Onde:** `backend/Dockerfile`, `frontend/Dockerfile`, `e2e/Dockerfile`, `*/.dockerignore`, `frontend/nginx.conf`, `docker-compose*.yml`, `.env.example`, `.env.test`.
- **Como:**
  - Replicar exatamente os Dockerfiles, `nginx.conf` e Compose da spec (seção 7): multi-stage `base|dev|build|production` com `USER node`, imagens fixadas (`postgres:16-alpine`, `node:22-alpine`, `nginxinc/nginx-unprivileged:1.27-alpine`, `mcr.microsoft.com/playwright:v<VER>-noble`), `COPY` em vez de `ADD`, healthchecks com `depends_on: condition: service_healthy` e `service_completed_successfully` para o `migrate`, volume nomeado `db_data` só no dev, `tmpfs` no banco de teste, `ipc: host` e `init: true` no `e2e`.
  - Ordem de subida preservada: `db` → `migrate` → `backend` → `frontend`. Nomes de projeto: `ecommerce`, `ecommerce-test`, `ecommerce-test-local`.
  - `.dockerignore` por pacote: `node_modules`, `dist`, `.env*`, `.git`, `*.log`, `playwright-report`, `test-results`. **Não** excluir `*.test.ts`, `drizzle/` nem `tsconfig*.json` do backend (o estágio `dev` roda os testes e o `production` copia `drizzle/`).
  - `.env.example`: as 7 variáveis da spec. `.env.test` (commitado, sem segredos reais): `POSTGRES_USER`, `POSTGRES_PASSWORD=test`, `POSTGRES_DB=ecommerce_test`, `BACKEND_PORT=3000`, `TEST_LOCAL_FRONTEND_PORT=8081`. `POSTGRES_USER` e `BACKEND_PORT` não estão na lista da spec, mas o Compose base os referencia (ver Pontos de Atenção).
  - Divergências em relação às sugestões padrão do `docker-advisor`, **todas por decisão da spec**: Alpine em vez de distroless, `.env` em vez de Docker Secrets, sem resource limits nem restart policy (não há compose de prod). O usuário `node` já existe na imagem, então não é preciso `adduser`.
- **Resultado:** `docker compose -p ecommerce --env-file .env -f docker-compose.yml -f docker-compose.dev.yml config` valida sem erro. `docker build` de cada pacote funciona.

### Etapa J — Makefile

- **O que fazer:** implementar os alvos da spec (seção 12).
- **Onde:** `Makefile`.
- **Como:**
  - Variáveis `COMPOSE_DEV`, `COMPOSE_TEST` e `COMPOSE_TEST_LOCAL` exatamente como na spec. `.DEFAULT_GOAL := help`. `help` lista os alvos pelos comentários `##`. `.PHONY` em todos. Receitas indentadas com TAB.
  - `up`: `test -f .env || cp .env.example .env` e depois `$(COMPOSE_DEV) up --build -d --wait`. `down`, `clean` (`down -v`) e `logs` (`SERVICE=`).
  - `migrate`: `$(COMPOSE_DEV) run --rm migrate sh -c "npm run db:migrate"`. `seed`: o mesmo com `npm run db:seed`.
  - `test-backend`: `build`, `run --rm backend-test; rc=$$?; down -v; exit $$rc`. `test-e2e`: o mesmo padrão com o serviço `e2e` e `mkdir -p e2e/playwright-report e2e/test-results` antes. `test` = `test-backend` e depois `test-e2e` (para na primeira falha).
  - `test-env-up`/`down`/`reset`. `test-e2e-local`: `cd e2e && BASE_URL=http://localhost:$$TEST_LOCAL_FRONTEND_PORT npx playwright test` (ler o valor do `.env.test`).
  - `install`: `npm ci` na raiz e em `backend`, `frontend` e `e2e`. `lint`: `npm run lint && npm run format:check` e `typecheck` nos 3 pacotes. `format`. `check` = `lint` e depois `test`.
- **Resultado:** `make help` lista os alvos. `make up` sobe a stack (depende da etapa I).

### Etapa K — E2E (Playwright)

- **O que fazer:** criar a suíte caixa-preta de endpoint e de UI.
- **Onde:** `e2e/`.
- **Como:**
  - **Descobrir a versão exata** do `@playwright/test` (`npm view @playwright/test version`) e verificar que a tag `mcr.microsoft.com/playwright:v<VER>-noble` existe. Usar a mesma versão, **sem `^`**, no `package.json` e no Dockerfile.
  - `playwright.config.ts`: lê `BASE_URL` e lança um erro claro se faltar. `use.baseURL`, `retries: 0`, `reporter: [['list'], ['html', { open: 'never' }]]`. Projects `api` (`testMatch /.*\.api\.spec\.ts/`) e `ui` (`/.*\.ui\.spec\.ts/`, `devices['Desktop Chrome']`).
  - `products.api.spec.ts` e `product-list.ui.spec.ts` com os casos obrigatórios da seção 4.
  - Não importar nada do backend.
- **Resultado:** `make test-env-up && make test-e2e-local` fica verde.

### Etapa L — Documentação e fechamento

- **O que fazer:** `README.md` (visão geral e quick start, apontando para `docs/` e `AGENTS.md`), verificação final e atualização do `AGENTS.md`, se algum comando mudar.
- **Resultado:** os 7 critérios de aceite passam.

---

## 3. Plano de Seed

| Item | Definição |
|---|---|
| **O que gerar** | **6 produtos** (entidade `products`), com os dados abaixo. Único para dev e teste, para que os asserts do E2E batam com o que se vê no navegador. |
| **Onde fica** | `backend/src/db/seed.ts` |
| **Idempotência** | Só insere se `products` estiver vazia. |
| **Como executar** | **Automático:** o serviço one-shot `migrate` roda `migrations` e depois `seed` (produção/teste: `node dist/db/migrate.js && node dist/db/seed.js`; dev: `npm run db:migrate && npm run db:seed`). **Manual:** `make seed` (e `make migrate`) no dev. **Isolado:** `npm run db:seed` no backend, com `DATABASE_URL` apontando para um banco. |

### Dados (pt-BR, fixos, sem dados reais ou sensíveis)

| # | name | description (curta e fixa) | priceCents | stock |
|---|---|---|---|---|
| 1 | Camiseta Básica Algodão | Camiseta de algodão macio, corte reto, ideal para o dia a dia. | 4990 | 25 |
| 2 | Tênis Esportivo Runner | Tênis leve e confortável para corrida e caminhada. | 29990 | 10 |
| 3 | Mochila Urbana 20L | Mochila resistente à água com compartimento para notebook. | 15990 | 8 |
| 4 | Fone de Ouvido Bluetooth | Fone sem fio com cancelamento de ruído e bateria de 20 horas. | 19990 | 15 |
| 5 | Garrafa Térmica 500ml | Garrafa em aço inox que mantém a temperatura por até 12 horas. | 7990 | 40 |
| 6 | Caderno Universitário 200 folhas | Caderno espiral com capa dura e 10 matérias. | 3490 | **0** |

### Variação coberta e por quê

- **Faixa de preço ampla** (R$ 34,90 a R$ 299,90), que exercita a formatação pt-BR com centenas e milhares.
- **Estoque variado:** alto (40), médio (25, 15), baixo (10, 8) e **zero** (produto 6), para cobrir o selo "Sem estoque" na tela e o item `stock === 0` no E2E.
- **Acentos e cedilha** (`Térmica`, `Básica`, `Universitário`), para validar a codificação ponta a ponta.

### Como implementar

1. Exportar `seedProducts: NewProduct[]`, um array tipado com os 6 itens **sem `id`**. O `id` é gerado pela identity, em ordem, e a tabela vazia produz 1 a 6. `generated always` rejeita `id` explícito, e usar `OVERRIDING SYSTEM VALUE` seria desnecessário.
2. Exportar `runSeed(db): Promise<{ inserted: number }>`. Numa transação: `select count(*)`; se for `> 0` retorna `{ inserted: 0 }` e loga "seed ignorado"; senão faz um `insert ... values(...)` único.
3. O bloco CLI (`if (require.main === module)`, o que supõe CommonJS; ver Pontos de Atenção) usa `loadEnv()`, `createPool`, `createDb`, `runSeed`, loga o resultado, fecha o pool e usa `process.exit(1)` em erro, para o `migrate` falhar de forma visível. O guard evita executar o seed ao importar `runSeed` nos testes.
4. Testes do seed (adição ao que a spec lista, e pequena):
   - `seed.test.ts` (unitário, puro): 6 itens, `priceCents` e `stock` inteiros `>= 0`, nomes únicos, ao menos um com `stock === 0`.
   - `seed.integration.test.ts`: com a tabela já populada, `runSeed` retorna `inserted: 0` e continua com 6 linhas (não destrutivo, preserva o dataset dos outros testes de integração).

---

## 4. Plano de Testes

### Setup do framework

- **Vitest:** `backend/vitest.config.ts` com os projects `unit` e `integration`. Os testes de integração usam a `DATABASE_URL` do ambiente e assumem o dataset do seed (somente leitura por enquanto).
- **supertest:** chama `createApp({ db })` in-process, sem `listen`.
- **Playwright:** `e2e/playwright.config.ts` (seção 2, Etapa K). Imagem Docker e `@playwright/test` na mesma versão exata. Rodar no host exige `npx playwright install chromium` uma vez em `e2e/`.

### Unitários (Vitest, sem banco)

- `config/env.test.ts`: aceita env válido. Falha com `DATABASE_URL` ausente. Falha com `BACKEND_PORT` inválida. (Extra opcional: aplica o padrão 3000 e o padrão de `NODE_ENV`.)
- `product.service.test.ts` (repository mockado com `vi.fn`): `list()` retorna `{ data, total }` com `total === data.length`. Retorna `{ data: [], total: 0 }` sem erro quando o repository devolve vazio.
- `db/seed.test.ts`: validação do dataset (seção 3).

### Integração (Vitest + supertest + Postgres real)

- `product.repository.integration.test.ts`: `findAll()` retorna os 6 produtos do seed, ordenados por `id` crescente, com `priceCents` e `stock` inteiros (`Number.isInteger`) e `name` e `description` do tipo string.
- `product.routes.integration.test.ts`: `GET /api/products` → `200` com o envelope `{ data, total }` e `total === data.length`. `GET /rota-inexistente` → `404 { error: { code: 'NOT_FOUND', message } }`. `GET /health` → `200 { status: 'ok' }`. (Extra opcional: um `db` falso cujo `select 1` lança, para provar o `503`.)
- `db/seed.integration.test.ts`: idempotência (seção 3).

### E2E de endpoint (`e2e/tests/api/products.api.spec.ts`, fixture `request`, via nginx)

- `GET /api/products` → `200`, `total === 6`, `data.length === 6`.
- Cada item tem `id`, `name`, `description`, `priceCents` e `stock`, com os tipos corretos (`priceCents` e `stock` inteiros).
- Itens ordenados por `id` crescente.
- Existe ao menos um item com `stock === 0`.
- `GET /api/rota-inexistente` → `404 { error: { code: 'NOT_FOUND', message } }`.

### E2E de frontend (`e2e/tests/ui/product-list.ui.spec.ts`, Chromium)

- `page.goto('/')` exibe 6 `product-item`, e o nome do primeiro produto fica visível.
- O preço aparece formatado em pt-BR: `toHaveText(/R\$\s*49,90/)` (o `\s` cobre o espaço não separável do `Intl`).
- O produto com estoque 0 mostra `out-of-stock-badge`. Os outros 5 não mostram.
- Os dados na tela (nome e preço formatado) batem com `GET /api/products` (`page.request`), o que prova o fluxo completo tela → banco.
- Estado de erro: `page.route('**/api/products', r => r.fulfill({ status: 500, ... }))` → aparece `error-message`.
- Estado vazio: `page.route` responde `{ data: [], total: 0 }` → aparece `empty-state`.
- O `loading` é opcional. Se for testado, deve ser de forma determinística (interceptar com um atraso controlado), sem `waitForTimeout`.

### Como executar

| Comando | O que roda |
|---|---|
| `make test-backend` | Vitest (unit + integration) no container `backend-test`, com Postgres efêmero, migrate e seed |
| `make test-e2e` | Playwright (api + ui) no container `e2e`, contra a stack completa sem portas publicadas |
| `make test` | `test-backend` e depois `test-e2e`. Só Docker |
| `make test-env-up && make test-e2e-local` | E2E no host (porta 8081) |
| `npm --prefix backend run test:unit` / `test:integration` | Unitários rápidos / integração no host (precisa de `DATABASE_URL`) |
| `make lint` / `make check` | Lint, formatação e tipos / `lint` + `test` |

---

## 5. Sequência de implementação (atômica, ordenada)

**Preparação**
1. Criar a branch `chore/scaffolding` a partir da `main`. Confirmar a versão exata do `@playwright/test` e da tag `playwright:v<VER>-noble`, e o Docker Compose v2 instalado (`docker compose version`).

**Tooling raiz** (commit `chore: add root tooling`)
2. Criar `.nvmrc`, `.gitignore` (preservando `skills/`), `.prettierrc`, `.prettierignore`.
3. Criar o `package.json` raiz, rodar `npm install` (gera o lockfile) e criar o `eslint.config.js`.
4. Configurar o Husky e o lint-staged (`.husky/pre-commit`).

**Backend base** (commit `chore: scaffold backend package`)
5. Criar `backend/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `drizzle.config.ts` e rodar `npm install`.
6. Teste primeiro: `config/env.test.ts`. Depois `config/env.ts` (`parseEnv`/`loadEnv`).
7. `shared/errors.ts` e `shared/error-handler.middleware.ts`.

**Banco** (commit `feat: add products schema and migration`)
8. `db/schema.ts` (`products` com identity e checks).
9. `db/client.ts` (`createPool`, `createDb`, `pingDb`) e `db/migrate.ts`.
10. `npm run db:generate -- --name init_products` e revisar o `.sql` gerado.

**Módulo products + app** (commit `feat: add product listing endpoint`)
11. `product.types.ts`.
12. Teste primeiro: `product.service.test.ts`. Depois `product.service.ts`.
13. `product.repository.ts`.
14. `product.controller.ts` e `product.routes.ts`.
15. `health.controller.ts` e `health.routes.ts`.
16. `app.ts` (`createApp({ db })`) e `server.ts` (com graceful shutdown).

**Seed** (commit `feat: add idempotent products seed`)
17. Teste primeiro: `db/seed.test.ts`. Depois `db/seed.ts` (`seedProducts`, `runSeed`, CLI).

**Testes de integração** (commit `test: add backend integration tests`)
18. `product.repository.integration.test.ts`, `product.routes.integration.test.ts` e `db/seed.integration.test.ts`. Rodar contra um Postgres temporário (`docker run`) para validar antes do Compose.

**Frontend** (commit `feat: add product list frontend`)
19. `frontend/package.json`, `tsconfig.json` e `npm install`.
20. `api/http-client.js` e `api/products.api.js`.
21. `domain/product.js`.
22. `views/product-list.view.js` com os `data-testid`.
23. `index.html`, `main.js` e `styles.css`. Rodar o `typecheck`.

**Containers** (commit `chore: add docker and compose setup`, após a confirmação do usuário via `docker-advisor`)
24. `backend/Dockerfile` e `backend/.dockerignore`. `frontend/Dockerfile`, `nginx.conf` e `.dockerignore`.
25. `docker-compose.yml` (base).
26. `docker-compose.dev.yml`, `.env.example` e `.env.test`.
27. `docker-compose.test.yml` e `docker-compose.test.local.yml`.
28. `Makefile` (todos os alvos). Validar com `make up`, `curl` nos dois endpoints e abrir a tela.

**E2E** (commit `test: add e2e api and ui suites`)
29. `e2e/package.json` (versão exata), `tsconfig.json`, `Dockerfile`, `.dockerignore` e `playwright.config.ts`.
30. `products.api.spec.ts`.
31. `product-list.ui.spec.ts`.

**Verificação e fechamento** (commit `docs: add readme and quick start`)
32. `make test-env-up && make test-e2e-local` (depuração no host).
33. `make test` num estado limpo (`rm -f .env`, `make clean`), conferindo o código de saída 0.
34. Quebras propositais (seed, rota e view): `make test` deve sair com código ≠ 0 e derrubar os containers. Reverter cada quebra.
35. `make lint` / `make check` e o teste do pre-commit com um erro de lint.
36. `README.md`. Revisar o `AGENTS.md` contra o que foi construído. Abrir o PR.

---

## 6. Pontos de atenção

**Lacunas e inconsistências encontradas na spec**

1. **`@eslint/js` e `typescript` na raiz:** a lista de devDependencies da raiz não os cita, mas o bloco de ESLint do frontend usa `@eslint/js` e o `typescript-eslint` exige `typescript` como peer. O blueprint os adiciona.
2. **`.env.test` incompleto:** a spec cita só 3 valores, mas o Compose base referencia `${POSTGRES_USER}` e `${BACKEND_PORT}`. Sem eles, o `POSTGRES_USER` fica vazio e o Postgres não sobe. O blueprint os acrescenta.
3. **`.gitignore` e `skills/`:** o `.gitignore` atual já contém a linha `skills/` (por isso o `git status` está limpo, e os skills de `skills/` não aparecem nele). O blueprint **preserva essa linha** e, para não passar lint/format em arquivos fora do projeto, inclui `skills/` no `.prettierignore` e no `ignores` do ESLint. Decisão sua: `docs/` entra no `format:check`? O blueprint propõe ignorar `docs/` para não reformatar os documentos de origem.
4. **`/health` e a regra "banco só no repository":** o health precisa de um `select 1`. A proposta é injetar `() => pingDb(db)` (função em `db/client.ts`, infraestrutura e não regra de negócio) no `health.controller`, em vez de criar um repository inteiro. É um desvio mínimo, e a alternativa é um `health.repository.ts`.
5. **CommonJS ou ESM no backend:** a spec roda `node dist/db/migrate.js` sem especificar o sistema de módulos. A proposta é **CommonJS** (`module: commonjs`, sem extensões `.js` nos imports e com `require.main === module` para os scripts CLI), que é o caminho mais simples com `tsc` e `tsx`. É preciso confirmar. Se a escolha for ESM (`NodeNext`), todos os imports relativos ganham `.js` e o guard de CLI muda.
6. **`.dockerignore` do backend:** o modelo genérico do `docker-advisor` exclui `**/*.test.*`, `docs/` e outros itens. **Não aplicar isso no backend.** O estágio `dev` precisa dos testes para o `backend-test`, e o `production` precisa de `drizzle/`.
7. **Volumes de bind do E2E:** `e2e/playwright-report` e `e2e/test-results` são ignorados pelo Git e podem não existir. O Makefile faz `mkdir -p` antes do `run`. No Linux os arquivos gerados ficam com dono root.

**Dependências e ordem**

8. A versão do `@playwright/test` precisa ser decidida **antes** de `e2e/package.json` e do `e2e/Dockerfile`, e as duas têm de ser iguais (e iguais à do host em `test-e2e-local`).
9. As migrations precisam existir (etapa D) antes de qualquer teste de integração ou Docker. O `tsconfig.build.json` precisa incluir `db/migrate.ts` e `db/seed.ts`, ou o container `migrate` quebra.
10. Os testes de integração assumem o dataset do seed. Nenhum teste pode alterar os dados nesta etapa. No Step 2 isso passa a exigir limpeza por teste.
11. **Ids do seed:** como a coluna é `generated always as identity`, os ids 1 a 6 só são garantidos com a tabela recém-criada. Se alguém apagar as linhas na mão, o seed repovoa com ids 7 a 12. Os asserts do E2E não devem depender de ids fixos (ordem e nome bastam). `make clean` ou `make test-env-reset` restauram os ids.

**Verificações que a spec já pede**

12. `up --wait` com o serviço one-shot `migrate`: confirmar na versão instalada do Compose. Se não funcionar, trocar por `up -d` seguido de espera pelo healthcheck do `frontend`.
13. `tsx watch` com bind mount no macOS: confirmar que a alteração em `backend/src` é detectada.
14. Senhas com caracteres especiais precisam ser codificadas em URL na `DATABASE_URL`. O padrão `change-me` é seguro, mas vale um comentário no `.env.example`.
15. O nginx assume `backend:3000`. Não mudar `BACKEND_PORT` sem ajustar o `nginx.conf`.
16. O hook de pre-commit **não** roda o type check (lento). Ele roda em `make lint`.

**Regras que o agente de implementação não pode violar** (do `AGENTS.md`)

Não usar `:latest`. Não commitar `.env`. Não apontar o E2E para o dev. Não esconder testes instáveis com `retries`. Não implementar carrinho, cupons, pedidos nem paginação. Não alterar a ordem de subida nem os nomes dos projetos Compose. Rodar `make check` antes de dar a tarefa por concluída.

---

## 7. Verificação ponta a ponta (resumo)

1. `make install` → `make lint` (verde).
2. `make up` → `curl localhost:3000/health`, `curl localhost:8080/api/products`, abrir `http://localhost:8080` (6 produtos, "Sem estoque" no Caderno).
3. `make clean` → `make test` (código 0, sem containers restantes em `docker ps`).
4. `make test-env-up && make test-e2e-local && make test-env-down`.
5. Quebras propositais → código ≠ 0 e teardown garantido.
6. Commit com erro de lint → bloqueado pelo Husky.
7. `make check` final.
