# AGENTS.md

Instruções para agentes de IA neste repositório. A especificação completa está em [docs/scaffolding-specification.md](docs/scaffolding-specification.md). Requisitos e arquitetura estão em [docs/high_level_requirements.md](docs/high_level_requirements.md) e [docs/system_architecture.md](docs/system_architecture.md).

## Projeto

E-commerce simplificado, com fins educacionais: listagem de produtos, carrinho (máquina de estados), cupons e pedidos. Estão implementados de ponta a ponta (tela → API → PostgreSQL), com testes de unidade, integração e E2E: a **Listagem de Produtos** e o **Carrinho** (itens, cupom, checkout, abandono por inatividade e criação atômica do Pedido). O ciclo de vida do Pedido após a criação (Confirmado, Enviado, Entregue, Cancelado) virá em Step seguinte. Especificação do carrinho: [docs/cart/frd-cart.md](docs/cart/frd-cart.md) e [docs/cart/blueprint-cart.md](docs/cart/blueprint-cart.md).

Fora de escopo: autenticação, pagamento real, notificações, upload de imagem, busca full-text, CI/CD.

## Stack

| Parte                | Tecnologia                                                                       |
| -------------------- | -------------------------------------------------------------------------------- |
| Backend              | Node 22, Express 5, TypeScript (`strict`)                                        |
| Banco                | PostgreSQL 16 (`postgres:16-alpine`)                                             |
| ORM                  | Drizzle ORM + `drizzle-kit` (migrations `.sql` commitadas em `backend/drizzle/`) |
| Frontend             | JS puro com ES modules, JSDoc + `// @ts-check`, sem framework e sem build        |
| Servidor do frontend | nginx (container), com proxy de `/api/` para o backend                           |
| Testes de backend    | Vitest (+ supertest)                                                             |
| Testes de frontend   | `node:test` (runner nativo do Node 22), em `frontend/src/**/*.test.js`           |
| Testes E2E           | Playwright Test (versão exata, igual à da imagem Docker)                         |
| Validação de env     | Zod                                                                              |
| Qualidade            | ESLint (flat config), Prettier, `tsc --noEmit`, Husky + lint-staged              |
| Orquestração         | Docker Compose + Makefile                                                        |

## Estrutura

```
backend/    API. src/modules/<modulo>/{controller,service,repository,routes,types}
            módulos: products, carts, coupons, orders, health
            src/db (client, schema, migrate, seed), src/config, src/shared
frontend/   src/views (DOM), src/domain (lógica de frontend), src/api (fetch)
            testes unitários `*.test.js` ao lado do código (não entram na imagem do nginx)
e2e/        tests/api/*.api.spec.ts e tests/ui/*.ui.spec.ts (Playwright, caixa-preta)
docs/       Requisitos, arquitetura e especificação
docker-compose*.yml, Makefile, .env.example, .env.test na raiz
```

Onde cada código vive:

- Rotas, controllers, services e repositories do backend ficam em `backend/src/modules/<modulo>/`.
- Acesso ao banco só no repository. Schema em `backend/src/db/schema.ts`.
- Config lida só em `backend/src/config/env.ts`. Nunca leia `process.env` em outro lugar.
- Erros e middlewares compartilhados em `backend/src/shared/`.
- Testes unitários e de integração ficam ao lado do código; E2E só em `e2e/`.

## Convenções obrigatórias

- **Camadas do backend:** Controller → Service → Repository. Controller não importa repository nem Drizzle. Service não conhece `req`/`res`. Só o repository importa `db/schema`.
- **Composição:** manual, em `app.ts` (`createApp({ db })`). Não adicione framework de DI.
- **Camadas do frontend:** `views/` renderiza, `domain/` tem a lógica, `api/` faz `fetch`. A view nunca chama `fetch` diretamente.
- **Arquivos:** `kebab-case` (`product.service.ts`). Classes e tipos em `PascalCase`, funções e variáveis em `camelCase`, variáveis de ambiente em `UPPER_SNAKE_CASE`.
- **Banco:** colunas em `snake_case`, propriedades TS em `camelCase`.
- **Testes:** `*.test.ts` (unitário), `*.integration.test.ts` (integração), `*.api.spec.ts` e `*.ui.spec.ts` (E2E).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`). **Branches:** `feat|fix|chore/<nome>`.
- **Idioma:** identificadores, comentários de código, commits e o `README.md` em inglês; UI, seed e demais documentação (`docs/`, `AGENTS.md`) em português (pt-BR).

### Contrato da API (não mude sem pedido explícito)

- Rotas de negócio em `/api`; `/health` fora do prefixo (200 se o banco responde, 503 caso contrário).
- Listagem: `{ "data": [...], "total": n }`, sem paginação, ordenada por `id`.
- Recurso único (carrinho, pedido): objeto simples, sem envelope `data`. Rotas do carrinho em `/api/carts`.
- Erros: `{ "error": { "code": "NOT_FOUND", "message": "...", "details"? } }` com o status HTTP correto; `details` é opcional (ex.: `INSUFFICIENT_STOCK` na confirmação lista `details.items`). Erros de negócio estendem `AppError`. Erros inesperados retornam `500 INTERNAL_ERROR` sem detalhes.
- Status por código: `VALIDATION_ERROR` 400 (413 para corpo grande); `CART_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `COUPON_NOT_FOUND` 404; `INVALID_CART_STATE`, `INSUFFICIENT_STOCK`, `COUPON_ALREADY_APPLIED`, `COUPON_NOT_APPLIED` 409; `COUPON_EXPIRED`, `COUPON_ALREADY_USED`, `COUPON_MIN_ORDER_NOT_MET` 422; `INTERNAL_ERROR` 500.
- Campos em `camelCase`. **Preço sempre em centavos, inteiro** (`priceCents`). O frontend formata na camada `domain/`.
- `id` é inteiro serial.

## Decisões arquiteturais (não questione nem contorne)

| Decisão                                                       | Motivo                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Node + Express + TypeScript                                   | Experiência do time, linguagem única no repositório e toolchain de testes compartilhado        |
| PostgreSQL                                                    | Container de banco real, transações e `FOR UPDATE` para a estratégia de estoque do Step 2      |
| Drizzle ORM                                                   | Próximo do SQL, sem geração de código nem engine binário, `FOR UPDATE` nativo                  |
| Backend por módulo (não por camada)                           | Carrinho, pedidos e cupons vão crescer; cada módulo mantém suas camadas juntas                 |
| Preço em centavos (inteiro)                                   | Evita erro de ponto flutuante nos descontos do Step 2                                          |
| ID serial                                                     | Auth está fora de escopo, seeds e asserts ficam previsíveis                                    |
| Frontend em JS puro, sem build                                | Alinhado a "sem framework"; tipagem por JSDoc + `checkJs`                                      |
| nginx com proxy de `/api/`                                    | Mesma origem (sem CORS) e E2E por uma URL só                                                   |
| Vitest no backend, Playwright em `e2e/`                       | O E2E é caixa-preta e prova o sistema inteiro, sem importar código interno                     |
| E2E em container no `make test`                               | Resultado reproduzível, o único requisito é o Docker                                           |
| Ambiente de teste com banco efêmero e projeto Compose próprio | Testes determinísticos, nunca tocam nos dados de dev, sem resultados flaky                     |
| Serviço one-shot `migrate`                                    | Separa bootstrap do banco da aplicação e falha de forma visível                                |
| `.env` em vez de Docker Secrets                               | Projeto educacional, sem deploy                                                                |
| Seed idempotente por linha, único para dev e teste            | Os asserts do E2E batem com o que se vê no navegador                                           |
| Estoque: decremento pessimista (`FOR UPDATE`) na confirmação  | Resolve a decisão do Step 2: duas confirmações simultâneas não vendem o mesmo estoque (RN-008) |
| Testes de frontend com `node:test`                            | Sem dependência extra nem build; roda em container (`make test-frontend`)                      |

## O que fazer

- Rode `make check` antes de dar uma tarefa como concluída. Mudanças que afetam fluxo de ponta a ponta exigem `make test` passando. Quando o agente não puder rodar `make test`, o desenvolvedor o executa e confirma.
- Escreva ou atualize testes junto com o código. Uma mudança de contrato exige atualizar o E2E de endpoint.
- Mantenha `.env.example` em dia ao criar variáveis. Valide-as em `config/env.ts`.
- Gere migrations com `npm run db:generate` (no backend) e commite os `.sql`. Nunca edite uma migration já aplicada.
- Fixe versões de imagens Docker e mantenha a versão de `@playwright/test` (exata) igual à da imagem do `e2e/`.
- Use `data-testid` nos elementos que o Playwright consulta.

## O que não fazer

- Não adicione frameworks de UI, bundlers, nem passo de build ao frontend.
- Não importe código do backend dentro de `e2e/`.
- Não acesse o banco fora do repository, nem leia `process.env` fora de `config/env.ts`.
- Não use `:latest` em imagens, não rode containers como root em produção e não coloque segredos em Dockerfile, compose ou código.
- Não commite `.env`. Só `.env.example` e `.env.test` (sem segredos reais).
- Não aponte testes E2E para o ambiente de dev. Eles usam o ambiente de teste.
- Não esconda testes instáveis com `retries`; corrija a causa.
- Não implemente paginação nem o ciclo de vida do Pedido após a criação (Confirmado, Enviado, Entregue, Cancelado). Os Steps seguintes cuidam disso.
- Não altere a ordem de subida (`db` → `migrate` → `backend` → `frontend`) nem o nome dos projetos Compose (`ecommerce`, `ecommerce-test`, `ecommerce-test-local`).

## Como rodar localmente

Pré-requisito: Docker (com Compose v2). Node 22 só é necessário para lint, format e `test-e2e-local`.

```bash
make install     # npm ci em todos os pacotes e hooks do Husky (para lint/format)
make up          # cria .env se faltar e sobe db, migrate, backend e frontend
                 # frontend: http://localhost:8080 | backend: http://localhost:3000 | db: localhost:5433
make down        # derruba (mantém o banco)
make clean       # derruba e apaga o volume do banco
make logs        # logs do dev (SERVICE=backend opcional)
make migrate     # roda migrations manualmente
make seed        # roda o seed manualmente
```

Qualidade e testes:

```bash
make test             # test-backend + test-frontend + test-e2e em containers (só Docker)
make test-backend     # Vitest (unitário + integração) contra Postgres efêmero
make test-frontend    # node:test do frontend em container
make test-e2e         # Playwright (endpoint + frontend) contra a stack completa
make lint             # ESLint + Prettier (check) + tsc --noEmit nos 3 pacotes
make format           # Prettier --write
make check            # lint + test
```

Depuração do E2E no host:

```bash
make test-env-up      # sobe o ambiente ecommerce-test-local (frontend em localhost:8081)
make test-e2e-local   # Playwright no host, contra esse ambiente
make test-env-reset   # recria banco e seed
make test-env-down    # derruba
```

Primeira vez no host: `npx playwright install chromium` dentro de `e2e/`.

### Limitações do ambiente de agentes

Por causa do proxy corporativo, agentes de IA **não** conseguem rodar comandos Docker que dependem de rede
(`make up`, `make test`, `make test-env-up`, `docker compose ...`) nem `npm audit`. O agente deve:

- rodar só o que funciona offline: `make lint`, `npm --prefix backend run test:unit` e `npm --prefix frontend test` (com Node 22: `nvm use`);
- para o restante, informar o comando exato e pedir ao desenvolvedor que o execute e envie a saída completa;
- não declarar a tarefa como concluída enquanto `make test` não tiver sido confirmado pelo desenvolvedor.
