# Blueprint Técnico — Carrinho de Compras

> Escopo: **backend + frontend (UI) + testes (unitário, integração, E2E de API e de UI)**, com produtos e cupons dedicados no seed para isolar os testes.
> Documento em pt-BR (regra do repo para `docs/`); identificadores, comentários de código, commits e README em inglês; textos de UI e seed em pt-BR.
> Este documento é autocontido: quem o executa não precisa consultar o FRD nem os documentos de arquitetura.

## 1. Contexto

### 1.1 A funcionalidade
Carrinho de compras para um e-commerce simplificado, com fins educacionais. O cliente monta uma seleção de produtos, aplica um cupom de desconto e converte o carrinho em um **Pedido**. Não há autenticação: o cliente é identificado apenas pelo id (inteiro serial) do carrinho que criou. A conversão é **atômica**: ou tudo é aplicado (pedido criado, estoque decrementado, cupom consumido, carrinho em Pedido Criado) ou nada muda.

O carrinho é uma máquina de estados: `empty` (Vazio), `with_items` (Com Itens), `in_checkout` (Em Checkout), `order_created` (Pedido Criado, final) e `abandoned` (Abandonado, final). Esta funcionalidade fecha as lacunas "regras de desconto, estoque e validação de entrada" do documento de alto nível.

### 1.2 Requisitos funcionais (resumo)
| RF | Descrição |
|---|---|
| RF-001 | Criar carrinho (estado Vazio, sem itens e sem cupom); devolve o id. Vários carrinhos coexistem. |
| RF-002 | Visualizar carrinho: estado, itens (produto, quantidade, preço unitário congelado, subtotal da linha), cupom, subtotal, desconto, total. Se estiver inativo além do timeout, já devolve Abandonado. A leitura **não** reinicia o contador de inatividade. |
| RF-003 | Adicionar item (produto + quantidade) em Vazio ou Com Itens. Produto novo cria linha com o preço atual (congelado); produto existente soma a quantidade. Vazio passa a Com Itens. Excede o estoque → recusa. |
| RF-004 | Atualizar a quantidade de um item (Com Itens): substitui o valor, sujeito a RN-002 e RN-005. |
| RF-005 | Remover item (Com Itens). Se era o último: volta a Vazio e o cupom é removido. |
| RF-006 | Aplicar cupom (Com Itens ou Em Checkout) após as validações da RN-010. |
| RF-007 | Remover cupom (Com Itens ou Em Checkout). Sem cupom aplicado → `COUPON_NOT_APPLIED`. |
| RF-008 | Iniciar checkout (Com Itens → Em Checkout). Itens ficam bloqueados. Não verifica nem reserva estoque. |
| RF-009 | Voltar a editar (Em Checkout → Com Itens). O cupom é mantido. |
| RF-010 | Abandonar (Com Itens ou Em Checkout → Abandonado), explicitamente ou por timeout. Não consome cupom nem devolve estoque. |
| RF-011 | Confirmar pedido (Em Checkout), em uma operação atômica: revalida o cupom, recalcula valores, verifica o estoque de todos os itens e, se tudo passar, cria o Pedido (status `created`), decrementa o estoque, marca o cupom como usado e leva o carrinho a Pedido Criado. Qualquer falha: nada muda e o carrinho continua Em Checkout. |
| RF-012 | UI: botão "Adicionar ao carrinho" em cada produto da listagem (1 unidade por clique). Cria o carrinho sob demanda. Desabilitado com estoque 0. |
| RF-013 | UI: tela do carrinho com estado, itens, alterar quantidade, remover, cupom, subtotal, desconto e total. Controles conforme o estado (seção 5.2). |
| RF-014 | UI: ações de checkout na tela — iniciar, voltar a editar, confirmar, abandonar. |
| RF-015 | UI: o id do carrinho fica guardado no navegador; ao recarregar o carrinho é restaurado em qualquer estado. Id inexistente (`CART_NOT_FOUND`) é descartado. |
| RF-016 | UI: após confirmar, mostra o resumo do pedido (número, itens, desconto, total). Em estado final a tela é somente leitura com "Novo carrinho", que descarta o id guardado. Ao recarregar depois da confirmação, mostra o carrinho em Pedido Criado com o total (não há consulta de Pedido). |

### 1.3 Regras de negócio (resumo)
- **RN-001** Uma linha por produto. **RN-002** Quantidade é inteiro ≥ 1, sem teto fixo; atualizar para 0 é erro (para tirar o item, remover). **RN-003** Adicionar produto repetido soma. **RN-004** Preço congelado na criação da linha; somar quantidade mantém o preço; valores sempre em centavos inteiros.
- **RN-005** Adicionar/atualizar é recusado (`INSUFFICIENT_STOCK`) se a quantidade resultante da linha > estoque atual; estoque 0 não pode ser adicionado. **RN-006** Essa verificação é informativa (outro carrinho pode consumir o estoque). **RN-007** Sem reserva de estoque: só o pedido decrementa. **RN-008** Decremento pessimista: na confirmação os produtos são travados (`FOR UPDATE`). **RN-009** Falta de estoque na confirmação: falha inteira (`INSUFFICIENT_STOCK`), erro lista os itens problemáticos (produto, pedido, disponível), carrinho segue Em Checkout, sem ajuste automático.
- **RN-010** Validações ao aplicar cupom, **nesta ordem**: (1) formato do código (RN-014) → `VALIDATION_ERROR`; (2) existe → `COUPON_NOT_FOUND`; (3) carrinho sem cupom → `COUPON_ALREADY_APPLIED`; (4) não expirado → `COUPON_EXPIRED`; (5) não usado → `COUPON_ALREADY_USED`; (6) subtotal ≥ pedido mínimo → `COUPON_MIN_ORDER_NOT_MET`. Carrinho Vazio recusa (`INVALID_CART_STATE`).
- **RN-011** Na confirmação refazem-se os itens 2, 4, 5 e 6 da RN-010. **RN-012** Um cupom por carrinho (trocar = remover e aplicar). **RN-013** Cupom de uso único; só é "usado" quando um pedido é criado com ele; dois carrinhos podem ter o mesmo cupom aplicado, o primeiro a confirmar vence. **RN-014** Código normalizado (trim, case-insensitive), 3 a 30 caracteres entre letras, dígitos, `-` e `_`; senão `VALIDATION_ERROR`.
- **RN-015** Subtotal = Σ(preço unitário × quantidade). Percentual (1 a 100): desconto = ⌊subtotal × valor ÷ 100⌋. Fixo (centavos > 0): desconto = min(valor, subtotal). Total = subtotal − desconto, nunca negativo. **RN-016** Quando o carrinho volta a Vazio o cupom é removido; se o subtotal cair abaixo do mínimo depois de aplicado, o cupom permanece (só a confirmação falha) e o desconto continua calculado pela RN-015 sobre o subtotal atual. **RN-017** Pedido mínimo em centavos (0 = sem mínimo), comparado ao subtotal antes do desconto.
- **RN-018** Itens só mudam em Vazio (primeiro item) e Com Itens; em Em Checkout só cupom, voltar a editar, confirmar e abandonar; estados finais rejeitam qualquer escrita (`INVALID_CART_STATE`). **RN-019** Só Com Itens e Em Checkout abandonam; Vazio permanece Vazio e a tentativa é `INVALID_CART_STATE`. **RN-020** Timeout por inatividade: Com Itens/Em Checkout cuja última escrita foi há **mais** que o timeout é considerado abandonado; avaliado no acesso (sem processo em segundo plano); ao detectar grava Abandonado; escrita → `INVALID_CART_STATE`, leitura devolve Abandonado; só escrita bem-sucedida reinicia o contador. Timeout: 600 s (dev), 10 s (teste). **RN-021** Confirmação atômica. **RN-022** Pedido Criado não transita para outro estado.
- **RN-023** Todo código de erro tem mensagem pt-BR na UI; `INSUFFICIENT_STOCK` na confirmação lista os itens (pedido × disponível); códigos desconhecidos e `INTERNAL_ERROR` mostram mensagem genérica. **RN-024** O servidor é a autoridade: a UI só esconde/desabilita controles por conveniência; após erro de estado recarrega o carrinho; a UI não renova o contador de inatividade ao exibir/recarregar.

### 1.4 Arquitetura e stack do projeto (estado real do repositório)
- **Stack:** Node 22, Express 5, TypeScript `strict`; PostgreSQL 16; Drizzle ORM + `drizzle-kit` (migrations `.sql` commitadas em `backend/drizzle/`); frontend em JS puro com ES modules, JSDoc + `// @ts-check`, **sem framework e sem build**; nginx serve o frontend e faz proxy de `/api/` para o backend; Vitest + supertest no backend; Playwright Test (versão exata igual à da imagem Docker) em `e2e/`; Zod para env; ESLint (flat config), Prettier, `tsc --noEmit`, Husky + lint-staged; Docker Compose + Makefile.
- **Backend por módulo:** `backend/src/modules/<modulo>/{controller,service,repository,routes,types}`. Composição manual em `app.ts` (`createApp({ db })`), sem framework de DI. O service depende de uma *Port* do repository (ex.: `ProductRepositoryPort`). Controllers são classes com arrow properties; Express 5 repassa rejeições de promise ao error handler.
- **Camadas (obrigatório):** Controller → Service → Repository. Controller não importa repository nem Drizzle. Service não conhece `req`/`res`. **Só o repository importa `db/schema`.** `process.env` só é lido em `config/env.ts`. Erros e middlewares compartilhados em `backend/src/shared/`.
- **Erros:** `AppError(code, message, status)`; `errorHandler` responde `{ "error": { "code", "message" } }` e, para erros inesperados, `500 INTERNAL_ERROR` sem detalhes (loga no servidor). Hoje existe só `NotFoundError`.
- **Banco:** colunas `snake_case`, propriedades TS `camelCase`; ids com `generatedAlwaysAsIdentity()`; CHECKs nomeados `<tabela>_<coluna>_nonneg`; única migration atual: `0000_init_products` (nunca editar migration aplicada). Tabela `products(id, name varchar(120), description text, price_cents int, stock int)`. Seed idempotente hoje por "tabela vazia" (6 produtos).
- **Frontend:** `views/` renderiza (DOM, só `textContent`, nunca `innerHTML`), `domain/` tem a lógica (cálculos, formatação, validações de UX), `api/` faz `fetch`; a view nunca chama `fetch`. `// @ts-check` + `checkJs`. Hoje: `main.js`, `api/{http-client,products.api}.js`, `domain/product.js` (`formatPrice`), `views/product-list.view.js`. **Não existe test runner no frontend** (só `tsc --noEmit`).
- **nginx:** `location ~ ^/api/.+\.js$` serve do disco os módulos `src/api/*.js` do frontend. **Nenhuma rota do backend pode terminar em `.js`.** `location /api/` faz proxy sem alterar o path; `location /` usa `try_files`.
- **Testes:** Vitest com projetos `unit` (`*.test.ts`) e `integration` (`*.integration.test.ts`, Postgres real via `DATABASE_URL`); hoje só leitura, sem helpers/limpeza. Playwright caixa-preta em `e2e/tests/api/*.api.spec.ts` e `e2e/tests/ui/*.ui.spec.ts`, banco efêmero, **sem reset entre testes**, `retries: 0`, arquivos de spec rodam em paralelo contra o mesmo banco. `data-testid` nos elementos que o Playwright consulta. E2E nunca importa código do backend.
- **Make/Docker:** `make test` = `test-backend` + `test-e2e`, **só Docker**. Projetos Compose fixos: `ecommerce`, `ecommerce-test`, `ecommerce-test-local`. Ordem de subida fixa: `db` → `migrate` → `backend` → `frontend`. Sem `:latest`. `.env` não é commitado; só `.env.example` e `.env.test`.
- **Contrato da API existente:** rotas de negócio em `/api`, `/health` fora do prefixo; listagem `{ "data": [...], "total": n }`; campos em `camelCase`; preço sempre em centavos inteiros (`priceCents`); `id` serial.
- **Limitações do ambiente de agentes:** sem rede para Docker/`npm audit`. O agente roda só `make lint`, `npm --prefix backend run test:unit` e `npm --prefix frontend test` (Node 22, `nvm use`); o desenvolvedor roda `make test` e envia a saída completa. A tarefa não é dada como concluída sem a saída do `make test`.

### 1.5 Lacunas do scaffolding que este plano fecha
`express.json()` ausente; camada de validação e `VALIDATION_ERROR`; `details` em `AppError`; tipo de transação; relógio e timeout injetáveis; isolamento de dados de teste; tabelas/migration/seed de carrinho-cupom-pedido; ausência de test runner no frontend; cliente HTTP do frontend só faz GET e descarta o corpo de erro.

### 1.6 Premissas técnicas (decisões deste blueprint; o FRD as delegou)
1. Endpoints, status HTTP e formato de resposta de §4.
2. Respostas de recurso único são objeto simples (sem envelope `data`); `details` em erros é opcional e aditivo. É extensão aditiva do contrato — esta feature é o "pedido explícito" exigido pelo AGENTS.md.
3. "Cupom usado" = `coupons.used_at IS NOT NULL`; `orders.coupon_id` tem índice único (um pedido por cupom, garantia no banco).
4. Código de cupom armazenado normalizado em **MAIÚSCULAS**.
5. Toda escrita num carrinho serializa por `SELECT … FOR UPDATE` na linha do carrinho.
6. UI em página única com **rotas por hash** (`#/` produtos, `#/cart` carrinho); testes unitários do frontend com **`node --test`** (sem dependência nova de runner), executados em container `node:22-alpine` para manter "`make test` só precisa de Docker".

## 2. Modelos de Dados

### 2.1 Banco (`backend/src/db/schema.ts` + migration `0001_add_cart_tables`)
| Tabela | Colunas | Restrições | Origem |
|---|---|---|---|
| `coupons` | `id` identity; `code varchar(30)`; `type varchar(10)` (`percentage`\|`fixed`); `value int`; `min_order_cents int default 0`; `expires_at timestamptz`; `used_at timestamptz null` | UNIQUE(`code`); CHECK type; CHECK `type='percentage' ⇒ value BETWEEN 1 AND 100`, `type='fixed' ⇒ value > 0`; CHECK `min_order_cents >= 0` | cadastro de cupom, RN-013/014/015/017 |
| `carts` | `id` identity; `status varchar(20)` default `empty`; `coupon_id int null` FK→coupons (sem cascade); `created_at timestamptz default now()`; `last_activity_at timestamptz` | CHECK status ∈ {`empty`,`with_items`,`in_checkout`,`order_created`,`abandoned`}; índice em `status` | RF-001/002, RN-012/016/018/020 |
| `cart_items` | `id` identity; `cart_id` FK→carts ON DELETE CASCADE; `product_id` FK→products; `quantity int`; `unit_price_cents int` | UNIQUE(`cart_id`,`product_id`) (RN-001); CHECK `quantity >= 1` (RN-002); CHECK `unit_price_cents >= 0` | RN-001..004 |
| `orders` | `id` identity; `cart_id` FK→carts UNIQUE; `status varchar(20)` default `created`; `subtotal_cents`, `discount_cents`, `total_cents` int; `coupon_id` FK→coupons null UNIQUE; `created_at timestamptz default now()` | CHECK `status = 'created'` (ciclo de vida é outro FRD; ampliar depois); CHECKs `>= 0`; CHECK `total_cents = subtotal_cents - discount_cents` | RF-011, RN-013/015/021 |
| `order_items` | `id` identity; `order_id` FK→orders ON DELETE CASCADE; `product_id` FK→products; `quantity int`; `unit_price_cents int` | CHECK `quantity >= 1`; CHECK `unit_price_cents >= 0` | RF-011 |

Notas:
- `last_activity_at` é gravado com o relógio injetável (`Clock`), não com `now()` do banco, para o timeout ser testável sem esperar.
- `carts.status` é o único campo de estado. `order_created` e `abandoned` são terminais, garantidos em código (`nextState`).
- Colunas `integer` (int4) limitam o subtotal a ~21 milhões de reais; suficiente (risco registrado em §9).
- Nomes de CHECK seguem `<tabela>_<coluna>_<regra>`.

### 2.2 Seed (`backend/src/db/seed.ts`)
O seed passa de "idempotente por tabela vazia" para **idempotente por linha**: produto é inserido se não existir linha com o mesmo `name`; cupom usa `ON CONFLICT (code) DO NOTHING`. Sem isso, bancos de dev já populados (6 produtos) nunca receberiam os novos. O total de produtos passa de 6 para **10**. Testes localizam os produtos novos **por nome**, nunca por id.

Produtos novos (nomes em pt-BR; constantes duplicadas em `e2e/support/`, que não importa código do backend):
| Nome | Preço (centavos) | Estoque | Uso |
|---|---|---|---|
| Caneta Esferográfica Azul (Estoque Alto) | 1000 | 1000 | Testes que consomem estoque, medidos **por diferença** (API e UI) |
| Edição Limitada Caderno Artesanal (Último Item) | 2500 | 1 | Corrida de duas confirmações (E2E de API) |
| Mochila Escolar Compacta (Estoque Limitado) | 1500 | 3 | Limite de estoque ao adicionar/somar/atualizar |
| Agenda Anual Última Unidade (UI) | 2500 | 1 | Estoque insuficiente na confirmação (E2E de UI) |

Cupons (expiram em 2099-12-31, exceto o expirado; tipo/valor/mínimo em centavos):
| Código | Tipo | Valor | Mínimo | Observação |
|---|---|---|---|---|
| `DESC10` | percentual | 10 | 0 | reutilizável (não é consumido pelos testes) |
| `FIXO20` | fixo | 2000 | 0 | reutilizável |
| `MEGA100` | percentual | 100 | 0 | zera o total |
| `FIXO5000` | fixo | 500000 | 0 | maior que qualquer subtotal de teste (desconto limitado ao subtotal) |
| `MIN200` | percentual | 15 | 20000 | pedido mínimo |
| `EXPIRADO10` | percentual | 10 | 0 | `expires_at = 2020-01-01` |
| `USADO10` | percentual | 10 | 0 | `used_at` preenchido |
| `CONFIRMA10` | percentual | 10 | 0 | **consumível** (um teste de API que confirma) |
| `ZERA-FIXO` | fixo | 500000 | 0 | **consumível** (total 0 na confirmação) |
| `DISPUTA10` | percentual | 10 | 0 | **consumível** (dois carrinhos com o mesmo cupom) |
| `UI-CONFIRMA10` | percentual | 10 | 0 | **consumível** (E2E de UI) |
| `UI-ZERA-FIXO` | fixo | 500000 | 0 | **consumível** (E2E de UI) |

Cobre as cinco categorias exigidas: percentual, fixo, expirado, com pedido mínimo e já usado.

### 2.3 Modelos do frontend (JSDoc `@typedef`)
- `CartView`: `{ id, status, items: CartItem[], coupon: {code,type,value}|null, subtotalCents, discountCents, totalCents }`; `CartItem`: `{ productId, name, quantity, unitPriceCents, subtotalCents }`.
- `OrderView`: `{ id, cartId, status, items[], subtotalCents, discountCents, totalCents, couponCode|null, createdAt }`.
- `ApiError` (evolução do `HttpError`): `{ status, code, message, details? }`; falha de rede → `code: 'NETWORK_ERROR'`; resposta de erro sem JSON → `code: 'UNKNOWN_ERROR'`.
- `CartSession`: id do carrinho no `localStorage`, chave `ecommerce.cartId` (storage injetável nos testes).

## 3. Componentes e Módulos

### 3.1 Backend — novos
- `shared/validation.ts` — `parseOrThrow(schema, data)` (ZodError → `ValidationError`) e `positiveIntParam` (inteiro positivo **≤ 2147483647**). (RN-002, validação geral)
- `modules/carts/`: `cart.types.ts` (tipos, Ports, `CartStatus`, `Clock`), `cart.errors.ts` (erros de negócio), `cart.schemas.ts` (zod de params/body; o campo `code` do cupom é normalizado/validado com `coupon.code.ts`), **`cart.state.ts` (máquina de estados: `Operation`, `nextState`, `assertAllowed`)**, `cart.timeout.ts` (`isExpired`), `cart.pricing.ts` (subtotal/desconto/total), `cart.repository.ts`, `cart.unit-of-work.ts`, `cart.service.ts`, `cart.controller.ts`, `cart.routes.ts`.
- `modules/coupons/`: `coupon.types.ts`, `coupon.code.ts` (normalização + formato RN-014), `coupon.rules.ts` (RN-010/011), `coupon.repository.ts`.
- `modules/orders/`: `order.types.ts`, `order.repository.ts` (somente criação).
- `src/test-support/` (só testes de integração): `app.ts` (`createTestApp({ clock })`), `factories.ts` (produto/cupom com sufixo único), `cleanup.ts` (apaga em ordem de FK o que o teste criou).

### 3.2 Backend — modificados
- `config/env.ts` (+`CART_INACTIVITY_TIMEOUT_SECONDS`, inteiro > 0, default 600) e `env.test.ts`.
- `shared/errors.ts` (+`details?`, `ValidationError`), `shared/error-handler.middleware.ts` (serializa `details`; erros do body-parser: `entity.parse.failed` → 400 `VALIDATION_ERROR`, `entity.too.large` → 413 `VALIDATION_ERROR`).
- `db/client.ts` (+`Tx`, `Executor = Database | Tx`), `db/schema.ts`, `db/seed.ts` (+ testes de seed).
- `modules/products/product.repository.ts` (+`findById`, `lockByIds` ordenado por id com `.for('update')`, `decrementStock`) e `product.types.ts`.
- `app.ts` (`express.json({ limit: '10kb' })`, wiring dos módulos; `AppDeps` ganha `clock?` e `cartInactivityTimeoutSeconds?`) e `server.ts` (passa a env).
- `.env.example` (600), `.env.test` (10), `docker-compose.yml` (âncora `&backend-env` com `CART_INACTIVITY_TIMEOUT_SECONDS: ${CART_INACTIVITY_TIMEOUT_SECONDS:-600}`), `docker-compose.test.yml` (o serviço `backend-test` tem bloco próprio de `environment`, repetir a variável), `vitest.config.ts` (projeto `integration` com `fileParallelism: false`).

### 3.3 Frontend — novos e modificados
| Camada | Arquivo | Responsabilidade |
|---|---|---|
| api | `api/http-client.js` (alterar) | `postJson`, `patchJson`, `deleteJson`; `ApiError` com `status`, `code`, `message`, `details`. |
| api | `api/carts.api.js` (novo) | Uma função por endpoint da §4.1; typedefs de `CartView`/`OrderView`. |
| domain | `domain/cart.js` (novo) | `allowedActions(status)`, rótulo do estado, contador de itens, `isTerminal`, `parseQuantity(texto)`. |
| domain | `domain/error-messages.js` (novo) | Código de erro → mensagem pt-BR (RN-023); formatação do detalhe de estoque. |
| domain | `domain/cart-session.js` (novo) | Ler/gravar/limpar o id (storage injetável). |
| domain | `domain/route.js` (novo) | `parseRoute(hash)` → `'/'` ou `'/cart'` (desconhecido → `'/'`). |
| view | `views/app-header.view.js`, `views/cart.view.js`, `views/order-confirmation.view.js` (novos) | Cabeçalho com link/contador, tela do carrinho, resumo do pedido. |
| view | `views/product-list.view.js` (alterar) | Botão "Adicionar ao carrinho". |
| entrada | `main.js` (alterar), `index.html`, `styles.css` | Roteamento por hash e orquestração; decisões ficam em `domain/`, `main.js` só encadeia. |

Infra de teste do frontend: `frontend/package.json` (script `test`, `@types/node@^22`), `frontend/tsconfig.json`, override no `eslint.config.js` para `frontend/src/**/*.test.js` (globals de Node), serviço `frontend-test` em `docker-compose.test.yml`, alvo `make test-frontend`, `frontend/.dockerignore` (`**/*.test.js`).

### 3.4 E2E e documentação
- `e2e/support/api.ts` (helpers HTTP puros, constantes de nomes de produto/cupom — sem importar o backend); `tests/api/products.api.spec.ts` (total 6→10); novos specs de API e de UI; `tests/ui/product-list.ui.spec.ts` (6→10).
- Docs: `README.md`, `AGENTS.md`, `docs/system_architecture.md`.

### 3.5 Regras de camada
Controller só parseia/valida (zod) e delega. Service conhece `Clock`, `UnitOfWork` e Ports, nunca `req/res` nem Drizzle. Repositories são os únicos a importar `db/schema`. `cart.unit-of-work.ts` importa só o tipo `Database`: `run(work)` abre `db.transaction` e entrega `{ carts, coupons, products, orders }` (repositories ligados ao `tx`). Em testes unitários o UoW é um fake que executa `work` com mocks. `test-support` importa `db/schema` para fixtures (exceção restrita a testes).

## 4. Interfaces

### 4.1 API REST (`/api/carts`; nenhuma rota termina em `.js`)
`CartView`: `{ id, status, items: [{ productId, name, quantity, unitPriceCents, subtotalCents }], coupon: { code, type, value } | null, subtotalCents, discountCents, totalCents }`. Ids de path e `productId`: inteiro positivo ≤ 2147483647, senão `400 VALIDATION_ERROR`.
**Ordem de checagem em toda escrita:** validar entrada (400, incluindo o formato do código de cupom) → carrinho existe (404) → timeout/estado (409) → regras de domínio.

| RF | Método e rota | Entrada | Sucesso | Erros |
|---|---|---|---|---|
| 001 | `POST /api/carts` | — | 201 `CartView` | — |
| 002 | `GET /api/carts/:cartId` | — | 200 `CartView` (aplica timeout no acesso, não renova atividade) | 400, 404 `CART_NOT_FOUND` |
| 003 | `POST /api/carts/:cartId/items` | `{ productId: int>0, quantity: int>=1 }` | 200 `CartView` | 400; 404 `CART_NOT_FOUND`/`PRODUCT_NOT_FOUND`; 409 `INVALID_CART_STATE`/`INSUFFICIENT_STOCK` |
| 004 | `PATCH /api/carts/:cartId/items/:productId` | `{ quantity: int>=1 }` | 200 `CartView` | 400; 404 `CART_NOT_FOUND`/`CART_ITEM_NOT_FOUND`; 409 estado/estoque |
| 005 | `DELETE /api/carts/:cartId/items/:productId` | — | 200 `CartView` | 400; 404 `CART_NOT_FOUND`/`CART_ITEM_NOT_FOUND`; 409 estado |
| 006 | `POST /api/carts/:cartId/coupon` | `{ code: string }` | 200 `CartView` | 400 (formato); 404 `COUPON_NOT_FOUND`; 409 `COUPON_ALREADY_APPLIED`/estado; 422 `COUPON_EXPIRED`/`COUPON_ALREADY_USED`/`COUPON_MIN_ORDER_NOT_MET` |
| 007 | `DELETE /api/carts/:cartId/coupon` | — | 200 `CartView` | 409 `COUPON_NOT_APPLIED`/estado |
| 008 | `POST /api/carts/:cartId/checkout` | — | 200 `CartView` | 409 estado |
| 009 | `POST /api/carts/:cartId/edit` | — | 200 `CartView` | 409 estado |
| 010 | `POST /api/carts/:cartId/abandon` | — | 200 `CartView` | 409 estado (inclui Vazio, RN-019) |
| 011 | `POST /api/carts/:cartId/confirm` | — | 201 `{ order: { id, cartId, status, items: [{ productId, name, quantity, unitPriceCents }], subtotalCents, discountCents, totalCents, couponCode \| null, createdAt }, cart: CartView }` | 404 `CART_NOT_FOUND`/`COUPON_NOT_FOUND`; 409 estado; 409 `INSUFFICIENT_STOCK` com `details.items: [{ productId, requested, available }]`; 422 cupom (`COUPON_EXPIRED`/`COUPON_ALREADY_USED`/`COUPON_MIN_ORDER_NOT_MET`); 500 `INTERNAL_ERROR` |

Erro padrão: `{ "error": { "code", "message", "details"? } }`. Status por código: `VALIDATION_ERROR` 400 (413 para corpo grande); `CART_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `CART_ITEM_NOT_FOUND`, `COUPON_NOT_FOUND` 404; `INVALID_CART_STATE`, `INSUFFICIENT_STOCK`, `COUPON_ALREADY_APPLIED`, `COUPON_NOT_APPLIED` 409; `COUPON_EXPIRED`, `COUPON_ALREADY_USED`, `COUPON_MIN_ORDER_NOT_MET` 422; `INTERNAL_ERROR` 500. Corpo ausente ou não JSON em rotas com corpo → `VALIDATION_ERROR`; rotas sem corpo ignoram o corpo. Valores monetários são sempre inteiros em centavos. `GET /api/products` (existente) continua como está.

### 4.2 Interface web
- **Rotas por hash:** `#/` (listagem) e `#/cart` (carrinho, inclusive o resumo do pedido logo após confirmar).
- **Cabeçalho:** link "Carrinho" com contador de itens.
- **`data-testid`:** `cart-link`, `cart-count`, `add-to-cart-button`, `cart-status`, `cart-item`, `cart-item-name`, `cart-item-quantity-input`, `cart-item-subtotal`, `cart-item-remove`, `coupon-input`, `coupon-apply`, `coupon-remove`, `coupon-code`, `cart-subtotal`, `cart-discount`, `cart-total`, `checkout-button`, `edit-button`, `confirm-button`, `abandon-button`, `new-cart-button`, `order-summary`, `order-id`, `cart-error`, `cart-empty` (mais os já existentes da listagem).
- **Rótulos de estado:** `empty` Vazio, `with_items` Com Itens, `in_checkout` Em Checkout, `order_created` Pedido Criado, `abandoned` Abandonado.
- **Mensagens de erro (RN-023):**
  - `VALIDATION_ERROR` "Dados inválidos. Verifique o que foi informado."
  - `CART_NOT_FOUND` "Carrinho não encontrado."
  - `PRODUCT_NOT_FOUND` "Produto não encontrado."
  - `CART_ITEM_NOT_FOUND` "Item não encontrado no carrinho."
  - `INVALID_CART_STATE` "Esta operação não está disponível para o estado atual do carrinho."
  - `INSUFFICIENT_STOCK` "Estoque insuficiente." (na confirmação, acrescenta uma linha por item: "<produto>: pedido <n>, disponível <m>")
  - `COUPON_NOT_FOUND` "Cupom não encontrado."
  - `COUPON_EXPIRED` "Cupom expirado."
  - `COUPON_ALREADY_USED` "Este cupom já foi utilizado."
  - `COUPON_MIN_ORDER_NOT_MET` "O pedido não atinge o valor mínimo do cupom."
  - `COUPON_ALREADY_APPLIED` "Já há um cupom aplicado. Remova-o para aplicar outro."
  - `COUPON_NOT_APPLIED` "Não há cupom aplicado."
  - `NETWORK_ERROR` "Não foi possível conectar ao servidor."
  - `INTERNAL_ERROR`, `UNKNOWN_ERROR` e códigos desconhecidos: "Algo deu errado. Tente novamente."
- **Comportamentos:** primeiro "Adicionar" cria o carrinho (RF-001) e grava o id; depois de adicionar ou confirmar, recarrega a listagem (estoque atualizado); erro mostra `cart-error` e, se for `INVALID_CART_STATE`, recarrega o carrinho (RN-024); `CART_NOT_FOUND` ao restaurar descarta o id; "Novo carrinho" descarta o id e volta a `#/`.

## 5. Gestão de Estado

### 5.1 Armazenamento e tabela de transições
O estado vive em `carts.status`. A **máquina de estados** vive em `cart.state.ts` (única fonte): `nextState(operation, from, ctx: { remainingItems })` devolve `{ to, clearCoupon }` ou lança `INVALID_CART_STATE`; `assertAllowed` deriva da mesma tabela.

| Operação | De | Para | Efeito |
|---|---|---|---|
| `ADD_ITEM` | `empty` | `with_items` | linha criada com preço congelado |
| `ADD_ITEM` | `with_items` | `with_items` | linha criada ou somada |
| `UPDATE_ITEM` | `with_items` | `with_items` | |
| `REMOVE_ITEM` | `with_items` | `with_items` (restam itens) / `empty` (era o último) | no último: `clearCoupon` |
| `APPLY_COUPON`, `REMOVE_COUPON` | `with_items`, `in_checkout` | mesmo estado | |
| `CHECKOUT` | `with_items` | `in_checkout` | itens bloqueados |
| `EDIT` | `in_checkout` | `with_items` | cupom mantido |
| `CONFIRM` | `in_checkout` | `order_created` | pedido, estoque, cupom |
| `ABANDON`, `TIMEOUT` | `with_items`, `in_checkout` | `abandoned` | cupom não consumido |
| qualquer outra combinação | — | inalterado | `INVALID_CART_STATE` (inclui `empty` + `ABANDON`/`APPLY_COUPON`, e toda escrita em `order_created`/`abandoned`) |

### 5.2 Operações por estado (também espelhado na UI)
| Operação | Vazio | Com Itens | Em Checkout | Pedido Criado | Abandonado |
|---|---|---|---|---|---|
| Adicionar item | Sim | Sim | Não | Não | Não |
| Atualizar quantidade / remover item | Não | Sim | Não | Não | Não |
| Aplicar / remover cupom | Não | Sim | Sim | Não | Não |
| Iniciar checkout | Não | Sim | Não | Não | Não |
| Voltar a editar | Não | Não | Sim | Não | Não |
| Confirmar pedido | Não | Não | Sim | Não | Não |
| Abandonar | Não | Sim | Sim | Não | Não |

Operações de leitura são permitidas em todos os estados.

### 5.3 Concorrência
Toda escrita faz `SELECT … FOR UPDATE` no carrinho primeiro (serializa operações do mesmo carrinho). A confirmação trava, em **ordem fixa**: carrinho → cupom → produtos **ordenados por id** (evita deadlock entre confirmações com produtos sobrepostos). Aplicar cupom e checar estoque ao adicionar são leituras sem lock (RN-006/007).

### 5.4 Timeout (RN-020) — ponto crítico
Um `throw` dentro de `db.transaction` faz rollback e perderia o `UPDATE status='abandoned'`. Por isso `withCartLock` devolve uma união discriminada `{ kind: 'abandoned' } | { kind: 'ok', … }` e o service lança `INVALID_CART_STATE` **depois do commit**. A leitura (GET) usa `UPDATE carts SET status='abandoned' WHERE id=? AND status IN ('with_items','in_checkout') AND last_activity_at < :cutoff`, condicional e atômico, sem lock e **sem** alterar `last_activity_at`. Expira se `now − last_activity_at > timeout` (estritamente maior). Escritas bem-sucedidas gravam `last_activity_at = clock()`; leitura e escrita recusada nunca.

### 5.5 Estado na UI
Vazio: mensagem e link para produtos. Com Itens: quantidade, remover, cupom, iniciar checkout, abandonar. Em Checkout: itens somente leitura, cupom, voltar a editar, confirmar, abandonar. Pedido Criado e Abandonado: somente leitura, com "Novo carrinho". `allowedActions(status)` em `domain/cart.js` é a única fonte do que a UI habilita. O servidor continua sendo a autoridade (RN-024).

## 6. Lógica de Negócio (pseudo-código)

```
subtotal(items)        = Σ unitPriceCents * quantity                                   // RN-015
discount(coupon, sub)  = percentage: floor(sub * value / 100)
                         fixed:      min(value, sub)                                   // total >= 0
total                  = subtotal - discount; sem cupom → discount 0

normalizeCode(raw)     = trim(raw).toUpperCase(); válido sse /^[A-Z0-9_-]{3,30}$/    // RN-014
                         (validado no schema do controller → VALIDATION_ERROR antes do estado)

nextState(op, from, ctx):                                                              // §5.1, cart.state.ts
  entry = TRANSITIONS[op][from] ?? throw INVALID_CART_STATE
  REMOVE_ITEM: to = ctx.remainingItems > 0 ? with_items : empty; clearCoupon = (to == empty)
  return { to, clearCoupon }

validateOnApply(cart, code, now):                                                      // RN-010, nesta ordem
  (1) formato já validado no schema
  coupon = repo.findByCode(code)       ?? COUPON_NOT_FOUND
  cart.couponId != null                 → COUPON_ALREADY_APPLIED
  coupon.expiresAt < now                → COUPON_EXPIRED            // válido até o instante
  coupon.usedAt != null                 → COUPON_ALREADY_USED
  subtotal < coupon.minOrderCents       → COUPON_MIN_ORDER_NOT_MET
revalidateOnConfirm(coupon, subtotal, now) = existe, expirado, usado, mínimo        // RN-011 (itens 2,4,5,6)

addItem(cartId, productId, qty):                                                       // RF-003, RN-001..005
  withCartLock: nextState(ADD_ITEM, status); product ?? PRODUCT_NOT_FOUND
  line = findLine; newQty = (line?.quantity ?? 0) + qty
  newQty > product.stock → INSUFFICIENT_STOCK(details [{productId, requested:newQty, available}])
  line ? update qty (preço congelado) : insert(unitPrice = product.priceCents)
  status = nextState.to; touch(clock())

updateQuantity: item ?? CART_ITEM_NOT_FOUND; qty > stock → INSUFFICIENT_STOCK; update; touch
removeItem:    item ?? CART_ITEM_NOT_FOUND; delete; nextState(REMOVE_ITEM, ctx{remaining}) → status e
               coupon_id = null se clearCoupon (RN-016); senão mantém cupom; touch
applyCoupon/removeCoupon: nextState (empty → INVALID_CART_STATE); remover sem cupom → COUPON_NOT_APPLIED; touch
                          (subtotal abaixo do mínimo depois de aplicado NÃO remove cupom, RN-016)
checkout / edit / abandon: nextState; setStatus; touch (checkout não toca estoque; edit mantém cupom)

confirm(cartId):                                                                       // RF-011, RN-008/009/011/013/021
  tx { withCartLock; nextState(CONFIRM, status)
       items = cart.items ; subtotal = Σ
       coupon = cart.couponId ? coupons.lockById(id) : null
       coupon → revalidateOnConfirm(...)                 // 1º cupom, depois estoque (ordem do FRD)
       discount/total
       products = products.lockByIds(sortedIds)
       short = items onde stock < qty
       short ≠ ∅ → INSUFFICIENT_STOCK(details.items = short)        // nada gravado ainda → rollback inofensivo
       order = orders.create(cartId, subtotal, discount, total, couponId, items)
       para cada item: products.decrementStock(id, qty)   // UPDATE … WHERE stock >= qty; 0 linhas → INSUFFICIENT_STOCK
       coupon → coupons.markUsed(id, clock())             // UPDATE … WHERE used_at IS NULL; 0 linhas → COUPON_ALREADY_USED
       cart: status = order_created; touch }
  qualquer exceção → rollback total (RN-021; erro inesperado vira 500 INTERNAL_ERROR sem detalhes)

isExpired(cart, now, timeoutMs) = status ∈ {with_items, in_checkout} && now - lastActivityAt > timeoutMs

// Frontend
parseQuantity(text): trim; /^\d+$/ e 1 <= n <= 2147483647 → n; senão inválido (nada é enviado)
allowedActions(status): tabela §5.2 (UX apenas; o servidor decide)
errorMessage(error): code → mensagem §4.2; INSUFFICIENT_STOCK com details.items → lista de linhas; desconhecido → genérica
```
Localização: funções puras em `cart.pricing/state/timeout` e `coupon.code/rules` (testáveis sem banco); orquestração em `CartService`.

## 7. Tarefas de Implementação

Legenda: **U** unitário, **I** integração, **E** E2E (API ou UI). Complexidade: B baixa, M média, A alta. Comandos que dependem de Docker/rede são executados pelo desenvolvedor.

### Fase A — Fundações
- **T-001 Config do timeout** (B). *Onde:* `config/env.ts`, `env.test.ts`, `.env.example` (=600), `.env.test` (=10), `docker-compose.yml` (`&backend-env`), `docker-compose.test.yml` (bloco `backend-test`); conferir que `ecommerce-test-local` herda o valor de `.env.test`. *Dep.:* —. *Aceite:* RN-020 (config); `parseEnv` default 600, rejeita 0, negativo e não numérico. *Testes:* U (`toEqual` completo, default, inválidos).
- **T-002 Erros, validação e body-parser** (M). *Onde:* `shared/errors.ts` (`details`, `ValidationError`), `error-handler.middleware.ts`, `shared/validation.ts` (`parseOrThrow`, `positiveIntParam` ≤ 2147483647), `app.ts` (`express.json({ limit: '10kb' })`). *Dep.:* —. *Aceite:* validação geral do FRD; JSON malformado → 400 (não 500); ids acima de 2³¹−1 → 400. *Testes:* U do handler (AppError com/sem `details`; erro do body-parser; erro genérico segue 500 sem detalhes), U de `parseOrThrow` e `positiveIntParam` (0, negativo, decimal, texto, 2147483647, 2147483648).
- **T-003 Tipos de transação** (B). *Onde:* `db/client.ts` (`Tx`, `Executor`). *Dep.:* —. *Aceite:* typecheck. *Testes:* coberto por T-014/T-021.

### Fase B — Dados e suporte de teste
- **T-004 Schema** (M). *Onde:* `db/schema.ts` (5 tabelas, CHECKs e índices de §2.1). *Dep.:* T-003. *Aceite:* RN-001/002/013/015 refletidas em constraints. *Testes:* I (T-021) inserindo violações: duas linhas do mesmo produto, quantidade 0, cupom percentual 101, dois pedidos com o mesmo `coupon_id`, status de carrinho inválido.
- **T-005 Migration** (B). *Onde:* `npm run db:generate -- --name add_cart_tables` (offline); commitar `.sql`, snapshot e journal; não editar a `0000`. *Dep.:* T-004. *Aceite:* `make migrate` limpa. *Testes:* implícitos (todas as ITs rodam sobre ela).
- **T-021 Suporte de teste de integração** (M). *Onde:* `src/test-support/{app,factories,cleanup}.ts`, `vitest.config.ts` (`fileParallelism: false` no projeto `integration`). Cada teste cria seus próprios produtos/cupons (sufixo único) e limpa em `afterAll`, para não quebrar asserts de contagem do seed. *Dep.:* T-005. *Aceite:* suíte repetível e sem flakiness. *Testes:* o próprio uso por T-010..T-020.
- **T-006 Seed** (M). *Onde:* `db/seed.ts` (idempotência por linha; 4 produtos novos e 12 cupons de §2.2), `seed.test.ts`, `seed.integration.test.ts`, `products.*.integration.test.ts` (6→10). *Dep.:* T-005. *Aceite:* cobre percentual, fixo, expirado, com mínimo e usado; reexecução não duplica; banco com 6 produtos recebe os 4 novos. *Testes:* U (dados bem formados), I (rerun idempotente; banco pré-populado), E (listagem em `products.api.spec.ts`: total 10).

### Fase C — Domínio puro
- **T-007 Pricing** (B). *Onde:* `cart.pricing.ts`. *Dep.:* —. *Aceite:* RN-015, RN-004. *Testes:* U (floor no percentual, fixo maior que subtotal limita, 100% zera, sem cupom, subtotal 0, nunca negativo).
- **T-008 Código e regras de cupom** (M). *Onde:* `coupon.code.ts`, `coupon.rules.ts`. *Dep.:* T-002. *Aceite:* RN-010 (ordem), RN-011, RN-014, RN-017. *Testes:* U (trim e caixa; 2 e 31 caracteres; caracteres inválidos; ordem dos erros com vários problemas simultâneos; expiração no instante exato; mínimo 0 e igual ao subtotal).
- **T-009 Máquina de estados e timeout** (A). *Onde:* `cart.state.ts` (`Operation`, `nextState`, `assertAllowed`, tabela §5.1), `cart.timeout.ts` (`isExpired`), `cart.errors.ts`, `cart.types.ts` (`CartStatus`, `Clock`). *Dep.:* T-002. *Aceite:* RN-016 (efeito `clearCoupon`), RN-018, RN-019, RN-020, RN-022; uma única tabela, sem tabela paralela de permissões. *Testes:* U — cada linha da tabela de transições vira um caso; matriz completa 7 operações × 5 estados; `REMOVE_ITEM` com e sem itens restantes; estados finais irreversíveis; Vazio não abandona; `isExpired` no limite (igual ao timeout não expira), só para estados ativos.

### Fase D — Persistência
- **T-010 ProductRepository+** (M). *Onde:* `product.repository.ts`, `product.types.ts` (`findById`, `lockByIds` com `.for('update')` e `ORDER BY id`, `decrementStock` com guarda `stock >= qty`). *Dep.:* T-004, T-021. *Aceite:* RN-005/008. *Testes:* I (lock bloqueia segunda transação; guarda impede estoque negativo).
- **T-011 CouponRepository** (M). *Onde:* `coupon.repository.ts` (`findByCode`, `lockById`, `markUsed` condicional). *Dep.:* T-004, T-021. *Aceite:* RN-013. *Testes:* I (`markUsed` duas vezes: a segunda afeta 0 linhas).
- **T-012 CartRepository** (A). *Onde:* `cart.repository.ts` (create, `lockById`, dados da visão com join em produtos, itens, `insertItem`/`updateQuantity`/`deleteItem`, `setStatus`, `setCoupon`, `touch`, `abandonIfExpired(cutoff)`). *Dep.:* T-004, T-021. *Aceite:* RF-001..005, RN-001/016/020. *Testes:* I (CRUD, UNIQUE, cascade, `abandonIfExpired` não altera `last_activity_at` e não toca estados Vazio/finais).
- **T-013 OrderRepository** (M). *Onde:* `order.repository.ts` (`create(order, items)`). *Dep.:* T-004, T-021. *Aceite:* RF-011. *Testes:* I (constraint de cupom único; `total = subtotal − desconto`).
- **T-014 UnitOfWork e Ports** (M). *Onde:* `cart.unit-of-work.ts`, Ports em `*.types.ts`. *Dep.:* T-003, T-010..T-013, T-021. *Aceite:* service sem Drizzle; falha → rollback. *Testes:* I (exceção no meio reverte tudo).

### Fase E — Serviço e HTTP
Os serviços chamam `nextState(...)` e executam apenas os efeitos; nenhum decide estado de destino.
- **T-015 CartService: criar, ver e timeout** (A). *Onde:* `cart.service.ts` (`createCart`, `getCart`, `withCartLock` com abandono comitado antes do erro). *Dep.:* T-007, T-009, T-014. *Aceite:* RF-001/002, RN-020. *Testes:* U (relógio fake: abandona só estados ativos; leitura não renova; escrita recusada depois de o abandono ser gravado), I (abandono persiste após a escrita recusada).
- **T-016 CartService: itens** (A). *Dep.:* T-015. *Aceite:* RF-003..005, RN-001..006, RN-016. *Testes:* U (soma; preço congelado após mudar o preço do produto; estoque 0; soma ultrapassa o estoque e mantém a linha; atualizar para 0 inválido; último item zera o cupom e volta a Vazio), I.
- **T-017 CartService: cupom** (M). *Dep.:* T-008, T-015. *Aceite:* RF-006/007, RN-010/012/016. *Testes:* U (cada erro na ordem do FRD; carrinho Vazio → `INVALID_CART_STATE`; remover item abaixo do mínimo mantém o cupom e o desconto segue calculado), I.
- **T-018 CartService: transições** (B). *Dep.:* T-015. *Aceite:* RF-008..010, RN-007/018/019. *Testes:* U (cupom mantido no `edit`; Vazio não abandona; `checkout` não toca estoque), I.
- **T-019 CartService: confirmar** (A). *Onde:* algoritmo §6. *Dep.:* T-010, T-011, T-013, T-016, T-017. *Aceite:* RF-011, RN-008/009/011/013/021/022. *Testes:* U (revalidação; ordem cupom→estoque; `details` com todos os itens faltantes; cupom marcado só no sucesso); I (rollback com falha injetada após o decremento; **duas confirmações concorrentes pelo último item** → uma 201 e a outra `INSUFFICIENT_STOCK`; dois carrinhos com o mesmo cupom → o segundo `COUPON_ALREADY_USED`; cupom expira entre aplicar e confirmar via relógio fake; estoque zerado após adicionar).
- **T-020 Schemas, controller, rotas e wiring** (M). *Onde:* `cart.schemas.ts`, `cart.controller.ts`, `cart.routes.ts`, `app.ts` (`createApp({ db, clock?, cartInactivityTimeoutSeconds? })`), `server.ts`. *Dep.:* T-001, T-002, T-008, T-015..T-019. *Aceite:* §4.1 inteira; nenhuma rota termina em `.js`; código de cupom inválido → 400 antes do estado. *Testes:* U (schemas: decimal, string, 0, negativo, ausente, ids inválidos e > 2³¹−1, código de cupom inválido), I (supertest: status/códigos de cada linha da tabela §4.1; JSON malformado; corpo ausente).

### Fase F — E2E de API
- **T-022 E2E de API** (A). *Onde:* `e2e/support/api.ts` (helpers HTTP puros e constantes de nomes de produto/cupom), `tests/api/carts.api.spec.ts` (criar/ver, itens, soma, limite de estoque, validação), `coupons.api.spec.ts` (todos os códigos de erro com os cupons do seed; desconto percentual, fixo, 100% e fixo maior que o subtotal), `checkout.api.spec.ts` (fluxo completo; `edit` mantém cupom; falta de estoque lista itens e mantém `in_checkout`; estoque decrementado **por diferença** no produto de estoque alto; cupom consumido não reaplicável; corrida de duas confirmações pelo "último item"; mesmo cupom em dois carrinhos), `timeout.api.spec.ts` (espera real > 10 s com `test.setTimeout`; GET devolve `abandoned`; escrita → 409). Cada teste que consome estoque/cupom usa recurso dedicado. *Dep.:* T-006, T-020. *Aceite:* todos os edge cases E2E-áveis do FRD. *Testes:* E.

### Fase H — Frontend
- **T-025 Infra de testes do frontend** (M). *Onde:* `frontend/package.json` (`"test": "node --test \"src/**/*.test.js\""`, `@types/node@^22` em devDependencies), `frontend/tsconfig.json`, override de ESLint para `*.test.js`, serviço `frontend-test` em `docker-compose.test.yml` (profile `tools`, `node:22-alpine` fixado, `frontend/` montado), alvo `make test-frontend` incluído em `make test`, `frontend/.dockerignore` (`**/*.test.js`). *Dep.:* —. *Aceite:* `make test-frontend` passa com um teste de fumaça; `make lint` passa; a imagem do nginx não contém testes. *Testes:* o próprio teste de fumaça. *Atenção:* se o agente não conseguir `npm install` (rede), o desenvolvedor roda `npm --prefix frontend install -D @types/node@^22` e commita o lockfile.
- **T-026 Camada `api/`** (M). *Onde:* `api/http-client.js`, `api/carts.api.js`. *Dep.:* T-025. *Aceite:* contrato §4.1; a view nunca chama `fetch` (RF-012..014). *Testes:* U com `fetch` falso (método, URL, corpo serializado, parsing do envelope de erro, resposta de erro sem JSON, falha de rede).
- **T-027 Camada `domain/`** (M). *Onde:* `domain/cart.js`, `error-messages.js`, `cart-session.js`, `route.js`. *Dep.:* T-025. *Aceite:* RN-018 (espelho na UI), RN-023, RF-015. *Testes:* U — `allowedActions` com os 5 estados contra a tabela §5.2; `parseQuantity` (vazio, "0", "-1", "1.5", "abc", "007", acima de 2³¹−1); mensagens para todos os códigos mais desconhecido; `INSUFFICIENT_STOCK` com vários itens; sessão (vazia, id válido, texto, negativo, limpar); `parseRoute` (`#/`, `#/cart`, lixo, vazio). Não compara com o backend (pacotes separados); a divergência é detectada pelo E2E de UI (T-032).
- **T-028 Views e estilos** (A). *Onde:* `views/app-header.view.js`, `cart.view.js`, `order-confirmation.view.js`, `product-list.view.js` (botão), `styles.css`, `index.html`; todos os `data-testid` de §4.2; só `textContent`. *Dep.:* T-026, T-027. *Aceite:* RF-012, RF-013, RF-014, RF-016, controles dados por `allowedActions`. *Testes:* E2E (T-030..T-032); sem teste de DOM unitário.
- **T-029 Orquestração e roteamento** (A). *Onde:* `main.js`. *Dep.:* T-028. *Aceite:* RF-012, RF-014, RF-015, RF-016, RN-024 e os edge cases "timeout na tela" e "id guardado inexistente". Restaura o carrinho pelo id, cria sob demanda, um handler por ação, recarrega o carrinho após `INVALID_CART_STATE`, recarrega a listagem após adicionar/confirmar. *Testes:* E2E (T-030..T-032); decisões em `domain/` têm U na T-027.

### Fase I — E2E de UI
Todos os testes criam o próprio carrinho (por API via `e2e/support/api.ts` ou pelo fluxo); o `localStorage` é isolado por contexto do Playwright; cada fluxo cabe nos 10 s de timeout entre escritas (montar o estado por API e usar a UI só para o que se testa).
- **T-030 Ajuste da UI existente** (B). *Onde:* `tests/ui/product-list.ui.spec.ts` (6→10 em 3 lugares; badge "sem estoque" continua em 1). *Dep.:* T-006, T-020, T-029. *Aceite:* a UI antiga segue verde com o seed novo.
- **T-031 E2E de UI: fluxo principal** (A). *Onde:* `tests/ui/cart.ui.spec.ts`. *Dep.:* T-020, T-022, T-029, T-006. *Aceite:* RF-012..RF-016. *Cenários:* adicionar da listagem cria o carrinho e atualiza o contador; botão desabilitado no produto sem estoque; adicionar o mesmo produto soma; alterar quantidade (e valor inválido não é enviado); remover item; remover o último volta ao estado Vazio; fluxo completo até a confirmação com resumo do pedido; estoque na listagem cai após confirmar (por diferença, produto de estoque alto); recarregar restaura Com Itens, Em Checkout e Pedido Criado; id inexistente no `localStorage` é descartado.
- **T-032 E2E de UI: cupons, erros, estados e timeout** (A). *Onde:* `tests/ui/cart-coupon-errors.ui.spec.ts`. *Dep.:* T-031. *Aceite:* RN-010/011 vistos pela UI, RN-023, RN-024, RF-010/RF-016. *Cenários:* cupom percentual e fixo com desconto e total exibidos; cupom expirado, usado e abaixo do mínimo mostram a mensagem pt-BR; remover cupom; voltar a editar mantém o cupom; **controles por estado** (em Em Checkout os itens ficam somente leitura; em estados finais só "Novo carrinho") — detector de divergência com o backend; abandonar leva a somente leitura com "Novo carrinho"; confirmação com estoque insuficiente (produto dedicado à UI esvaziado via API) lista o item e mantém Em Checkout; **timeout real:** espera de mais de 10 s e uma escrita, esperando a mensagem de abandono e o carrinho recarregado.

### Fase G — Documentação e verificação
- **T-023 Docs** (B). *Onde:* `README.md` (estado atual, endpoints, UI, variável nova, `make test-frontend`); `AGENTS.md` (descrição do projeto, remover "Não implemente carrinho, cupons, pedidos…", stack ganha "Testes de frontend: `node:test`", novos códigos de erro/status e `details`, comandos); `docs/system_architecture.md` (decisão de estoque = pessimista, resolvida; frontend com carrinho). *Dep.:* T-020, T-025, T-029.
- **T-024 Verificação final** (B). *Agente:* `make lint`, `npm --prefix backend run test:unit` e `npm --prefix frontend test` (offline, Node 22). *Desenvolvedor:* `make migrate && make seed`, depois `make test` completo (inclui `test-frontend`) e envia a saída completa. A tarefa não é dada como concluída sem essa saída. *Dep.:* todas.

**Ordem sugerida das fases:** A → B → C → D → E → F → H → I → G. A Fase H (T-025..T-029) pode começar em paralelo com D/E, pois o contrato da §4.1 já está fixo.

## 8. Matriz de Rastreabilidade

| Requisito | Tarefas |
|---|---|
| RF-001, RF-002 | T-012, T-015, T-020, T-022 |
| RF-003, RF-004, RF-005 | T-010, T-012, T-016, T-020, T-022 |
| RF-006, RF-007 | T-008, T-011, T-017, T-020, T-022 |
| RF-008, RF-009, RF-010 | T-009, T-018, T-020, T-022 |
| RF-011 | T-010, T-011, T-013, T-019, T-022 |
| RF-012 | T-026, T-028, T-029, T-031 |
| RF-013 | T-027, T-028, T-031, T-032 |
| RF-014 | T-026, T-028, T-029, T-031, T-032 |
| RF-015 | T-027, T-029, T-031 |
| RF-016 | T-028, T-029, T-031, T-032 |
| RN-001, RN-002 | T-002, T-004, T-016, T-020 |
| RN-003, RN-004 | T-012, T-016 |
| RN-005, RN-006, RN-007 | T-010, T-016, T-018 |
| RN-008, RN-009 | T-010, T-019 |
| RN-010, RN-011, RN-012 | T-008, T-017, T-019, T-020 |
| RN-013 | T-004, T-011, T-019 |
| RN-014, RN-017 | T-008, T-020 |
| RN-015 | T-007 |
| RN-016 | T-009, T-016, T-017 |
| RN-018, RN-019, RN-022 | T-009, T-018 |
| RN-020 | T-001, T-009, T-015 |
| RN-021 | T-014, T-019 |
| RN-023 | T-027, T-028, T-032 |
| RN-024 | T-029, T-032 |

| Edge case | Tratamento |
|---|---|
| Carrinho, produto ou item inexistente | T-015, T-016, T-020 (404); ids acima de 2³¹−1 → 400 (T-002, T-020) |
| Quantidade 0, negativa, decimal ou não numérica | T-002, T-020 (400); T-027 (`parseQuantity`) |
| Estoque excedido, estoque 0, soma ultrapassa | T-016 (409; a linha mantém a quantidade) |
| Estado inválido; cupom em Vazio; abandonar Vazio | T-009, T-017, T-018 |
| Inatividade além do timeout | T-009, T-015; UI: T-029, T-032 |
| Código de cupom ausente ou inválido | T-008, T-020 (400, antes do estado) |
| Cupom inexistente, expirado, usado, abaixo do mínimo | T-008, T-017 |
| Segundo cupom; remover sem cupom | T-017 |
| Fixo maior que o subtotal; percentual 100% | T-007 |
| Cupom expira entre aplicar e confirmar; mesmo cupom em dois carrinhos | T-019 (I), T-022 (E) |
| Estoque zerou; confirmações simultâneas | T-019 (I), T-022 (E) |
| Falha inesperada na confirmação | T-014, T-019 (rollback injetado; 500 sem detalhes) |
| Preço muda após adicionar | T-016 (I) |
| Remover o último item com cupom | T-009 (`clearCoupon`), T-016 |
| Subtotal cai abaixo do mínimo depois de aplicar | T-017 (cupom permanece), T-019 (falha na confirmação) |
| Timeout enquanto o cliente está na tela | T-029, T-032 |
| Id de carrinho guardado inexistente | T-029, T-031 |

## 9. Riscos e Pontos de Atenção

- **Problemas já tratados neste plano:** rollback perdendo o estado "abandonado" (§5.4); `express.json` ausente e seu erro virar 500; `backend-test` sem a variável do timeout; seed por "tabela vazia" não povoaria o dev existente; ITs em paralelo quebrando asserts de contagem; deadlock entre confirmações (ordem fixa de locks); rota `*.js` bloqueada pelo nginx; ids acima de int4 virando 500; ordem entre validação de formato do cupom e estado; `make test` precisa continuar "só Docker" (serviço `frontend-test`); testes do frontend iriam para a imagem nginx (`.dockerignore`); ESLint e `tsc` do frontend precisam de globals/tipos de Node nos testes.
- **Timeout de 10 s no ambiente de teste e a UI:** um teste de UI lento entre duas escritas pode abandonar o carrinho. Mitigação: montar o estado por API e manter fluxos curtos. Nunca usar `retries` (regra do projeto).
- **Reexecução do E2E local** (`make test-e2e-local`) sem `make test-env-reset` falha nos testes que consomem estoque/cupom (aceito; `make test` usa banco efêmero).
- **Contrato da API estendido** (objeto simples, `details`, novos códigos): o AGENTS.md pede não mudar o contrato "sem pedido explícito" — esta feature é o pedido; registrado na T-023.
- **`@types/node` no frontend:** exige `npm install` com rede; se o agente não puder, o desenvolvedor executa e commita o lockfile (T-025).
- **Colunas `integer`** limitam subtotais a ~21 milhões de reais; suficiente para o escopo.
- **Teste de timeout E2E** dura mais de 10 s (API e UI); mantido pela definição do FRD.
- **Divergência de regras entre backend e UI:** como são pacotes separados, não há teste cruzado; a salvaguarda é o E2E de UI por estado (T-032).
- **Questões do FRD ainda abertas** (consulta de pedido, listagem de cupons, limpeza de carrinhos abandonados) não são implementadas.

## 10. Fora do Escopo Técnico

Ciclo de vida do Pedido após a criação e consulta/listagem de Pedidos (além do pedido devolvido na confirmação); CRUD de cupons por UI ou API (cadastro só via seed); listagem de cupons para o cliente; job em segundo plano para abandono; reserva de estoque; cupons cumulativos, limite de usos diferente de 1 e cupons por usuário; paginação, busca e remoção física de carrinhos antigos; autenticação e propriedade de carrinho; pagamento e notificações; teste de DOM unitário no frontend (as views são cobertas por E2E).

## Verificação (end-to-end)

1. Agente: `make lint`, `npm --prefix backend run test:unit` e `npm --prefix frontend test` (Node 22, `nvm use`).
2. Desenvolvedor: `make migrate && make seed`, depois `make test` (backend unit+integration, frontend unit, E2E de API e de UI) e colar a saída completa.
3. Manual: `make up`; no navegador (`http://localhost:8080`) adicionar produtos, aplicar `DESC10`, iniciar checkout, confirmar e conferir o estoque na listagem; via `curl`, percorrer criar carrinho → adicionar item → cupom → checkout → confirm e conferir `/api/products`.
