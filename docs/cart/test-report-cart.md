## Relatório de Testes — Carrinho de Compras

> Status: `make test` executado pelo desenvolvedor e **passando por inteiro** (backend, frontend e E2E). Antes deste trabalho o relatório de revisão registrava backend 463, frontend 67 e E2E 152.

### Resumo
- Testes unitários do backend: 364 total (364 passando, 0 falhando); 27 novos
- Testes de integração do backend: 172 total (172 passando, 0 falhando); 46 novos
- Testes unitários do frontend: 87 total (87 passando, 0 falhando); 20 novos
- Testes E2E de endpoint: 111 total (111 passando, 0 falhando); 4 novos
- Testes E2E de frontend: 55 total (55 passando, 0 falhando); 10 novos
- Backend: 536 passando em 25 arquivos. E2E: 166 passando em 2,1 min, com `retries: 0`.
- Bugs encontrados durante testes: 0

### Seeds e Dados de Teste
- Nenhum produto ou cupom novo no seed. As contagens de `products.*`, `seed.ts` e `e2e/support/api.ts` ficam inalteradas.
- `MIN200` (reutilizável, não é consumido em falha) cobre o pedido mínimo na API de integração e na UI; `limitedStock` (nunca confirmado) cobre RN-007 sem corrida entre specs paralelos.
- Factories (`backend/src/test-support/factories.ts`): nomes e descrições realistas em pt-BR ("Cafeteira Italiana 6 Xícaras", cupom `PRIMEIRA-…`); novo `createCartWithItems` insere o carrinho em qualquer estado com linhas já congeladas.
- Tabela de casos-limite de RN-015 em `backend/src/test-support/rounding-cases.ts` (99¢×15%→14, 1¢×10%→0, limite int32, 100%, fixo acima/igual/abaixo do subtotal).
- Isolamento: cleanup por id (inalterado). `createTestApp` agora falha com mensagem clara se `DATABASE_URL` não existir; `seed.integration.test.ts` restaura o seed em `afterAll`, mesmo se um teste falhar no meio (antes podia deixar `DESC10`/`USADO10` apagados).

### Test Doubles
- Biblioteca: **nenhuma dependência nova** (decisão do desenvolvedor). Vitest `vi.fn`/`vi.spyOn` no backend, `node:test` `mock.fn` no frontend, `page.route` no Playwright.
- `FaultInjectingUnitOfWork` (`faultInjectingUnitOfWork`, `backend/src/test-support/fault-injection.ts`): fake de transação real que falha em um repositório/método nomeado, antes ou depois da escrita. Prova o rollback de RN-021 em `orders.create`, `products.decrementStock`, `coupons.markUsed` e `carts.setStatus`.
- DOM falso (`frontend/src/views/fake-dom.test-support.js`): fake mínimo (`createElement`, `dataset`, `textContent`, `append/prepend/after/replaceChildren`, `addEventListener`, `dispatch`) que permite testar `views/` sem jsdom. Fica fora da imagem do nginx (`**/*.test-support.js` no `.dockerignore`).
- Stubs de rede na UI (`page.route`) para `CART_ITEM_NOT_FOUND`, `COUPON_ALREADY_APPLIED`, `COUPON_NOT_APPLIED`, `PRODUCT_NOT_FOUND`, `INTERNAL_ERROR`, código desconhecido e `NETWORK_ERROR`.
- Reaproveitados: `makeRepos()`/`NOW`/`TIMEOUT_MS` (`cart-mocks.ts`), `installFakeFetch`, `memoryStorage`, relógio injetável `Clock`.

### Cobertura por Requisito (apenas o que este trabalho acrescentou)
| RF/RN | Unitário | Integração | E2E Endpoint | E2E Frontend | Observação |
|-------|----------|------------|--------------|--------------|------------|
| RN-004 preço congelado | 1 (confirm usa preço da linha) | 1 (até `order_items`) | — | 1 (preço unitário na tela) | E2E de API não altera preço (não há API de produto) |
| RN-007 sem reserva | — | — | 2 (`limitedStock`) | — | add+checkout já eram cobertos para abandono |
| RN-008 / RN-013 locks | — | 1 (lock de cupom) + 4 (mesmo carrinho, corrida de cupom) | — | — | |
| RN-010 precedência de erros | — | 2 | — | 1 (MIN200 na UI) | |
| RN-011 mínimo na confirmação | — | — | — | 1 | piso do subtotal após encolher o carrinho |
| RN-015 arredondamento | 18 (tabela) + 1 | 1 (persistido) + 2 (MIN200 HTTP) | — | 1 | |
| RN-018 / RN-022 estados finais | — | 5 | — | — | todas as 9 escritas em `order_created` e `abandoned` |
| RN-020 timeout | — | 10 (9 operações + escrita recusada não renova) | 2 (escrita renova; escrita recusada não renova) | — | |
| RN-021 atomicidade | 1 | 4 | — | — | falhas em 4 pontos de escrita |
| RN-023 mensagens pt-BR | — | — | — | 7 | todos os códigos que faltavam na UI |
| RN-002 / validação de entrada | 6 | 11 | — | — | PATCH/DELETE com tipos e ids inválidos |
| Schema de `orders`/`order_items` | — | 7 | — | — | CHECKs de valor não negativo e item |
| RF-012..016 (views) | 20 | — | — | — | controles por estado, handlers, `textContent` sem markup, resumo do pedido, cabeçalho e aviso |

### Bugs Encontrados
Nenhum. Todos os testes novos passaram na primeira execução de `make test`, o que indica que a implementação já respeitava os requisitos que os testes passaram a verificar (atomicidade em 4 pontos, locks, timeout por operação, estados finais, mensagens pt-BR). Os testes de integração e E2E foram escritos sem execução prévia, e nenhum precisou ser ajustado.

### Cenários Não Cobertos
- `COUPON_NOT_FOUND` na confirmação: a FK `carts.coupon_id → coupons.id` impede o cenário real. Coberto só por unitário (mocks).
- Cupom expirando entre aplicar e confirmar no E2E: sem API de cupom nem relógio injetável no ambiente E2E. Coberto no nível de integração (relógio fake).
- `INTERNAL_ERROR` real na confirmação no E2E: não há como forçar uma falha interna em caixa-preta. Coberto na integração (fault injection) e na UI por stub.
- RN-004 no E2E de API: não existe API para alterar preço de produto. Coberto na integração.
- RN-006 (estoque consumido por outro carrinho entre adicionar e confirmar) no E2E de API: exigiria consumir permanentemente estoque compartilhado e poderia quebrar specs que medem estoque por diferença. Coberto por integração (`reports the shortage…`), pela corrida de confirmações do E2E e pelo E2E de UI com estoque esvaziado.
- `main.js` (orquestração): continua sem teste unitário; coberto pelos E2E de UI. Só `views/` ganhou testes unitários.
- Itens do diagnóstico inicial que, ao conferir, já estavam cobertos: RN-007 para checkout/abandono e a matriz de controles por estado na UI.

### Arquivos Criados/Modificados
Criados:
- `backend/src/modules/carts/cart.hardening.integration.test.ts`: atomicidade, concorrência no mesmo carrinho, timeout por operação, preço congelado, arredondamento persistido, estados finais e precedência de cupom.
- `backend/src/test-support/fault-injection.ts`: unit of work com falha injetável.
- `backend/src/test-support/rounding-cases.ts`: tabelas de limites de RN-015.
- `frontend/src/views/fake-dom.test-support.js`: DOM falso.
- `frontend/src/views/cart.view.test.js`, `frontend/src/views/order-and-header.view.test.js`: testes de views.
- `e2e/tests/ui/cart-error-messages.ui.spec.ts`: mensagens pt-BR, preço unitário e mínimo na confirmação.

Modificados:
- `backend/src/test-support/app.ts` (guarda de `DATABASE_URL`), `factories.ts` (dados realistas e `createCartWithItems`).
- `backend/src/db/seed.integration.test.ts` (restauração do seed).
- `backend/src/db/schema.integration.test.ts` (CHECKs de `orders`/`order_items`).
- `backend/src/modules/carts/cart.pricing.test.ts`, `cart.service.test.ts`, `cart.schemas.test.ts`, `cart.routes.integration.test.ts`.
- `backend/src/modules/coupons/coupon.repository.integration.test.ts` (lock de cupom).
- `e2e/tests/api/carts.api.spec.ts` (RN-007), `e2e/tests/api/timeout.api.spec.ts` (renovação do contador).

### Verificação
Comando: `make test` (`test-backend` + `test-frontend` + `test-e2e`, em containers), saída enviada pelo desenvolvedor.
- Backend: `Test Files 25 passed`, `Tests 536 passed`.
- Frontend: `tests 87, pass 87, fail 0`.
- E2E: `166 passed (2.1m)`, incluindo os 7 testes de timeout real (~11,5 s cada, em paralelo) e os novos de `cart-error-messages.ui.spec.ts`.
- `make lint` (ESLint, Prettier, `tsc --noEmit` nos 3 pacotes): passando.

Observação: o log do backend mostra um `Health check failed: Error: db down` em stderr. É esperado: o teste "returns 503 when the database ping fails" simula a queda do banco.
