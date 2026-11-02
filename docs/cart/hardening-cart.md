# Hardening — Máquina de estados do carrinho (T-009)

## O que foi endurecido

- **Estados:** `CART_STATUSES` com exatamente os 5 estados do diagrama (`empty`, `with_items`, `in_checkout`, `order_created`, `abandoned`).
- **Mapa de transições:** tabela única `TRANSITIONS` em `cart.state.ts` (10 operações). Qualquer par (operação, estado) ausente é proibido; `order_created` e `abandoned` nunca aparecem como origem.
- **Função de transição:** `nextState(op, from, ctx)` valida e devolve `{ to, clearCoupon }`; `assertAllowed` usa a mesma tabela.
- **Transição proibida:** `InvalidCartStateError` (`INVALID_CART_STATE`, 409), mensagem e `details` com operação e estado de origem.
- **Timeout:** `isExpired` (RN-020): só `with_items`/`in_checkout`, estritamente maior que o timeout.

## Arquivos

Novos, em `backend/src/modules/carts/`: `cart.types.ts`, `cart.errors.ts`, `cart.state.ts`, `cart.timeout.ts` e os respectivos `*.test.ts`. Nenhum arquivo existente foi alterado.

## Testes

- Unitários: 211 passando em `npm --prefix backend run test:unit` (inclui a matriz completa 10 operações × 5 estados, `REMOVE_ITEM` com e sem itens restantes, estados finais, limite exato do timeout, serialização do erro pelo `errorHandler`).
- `make lint` (ESLint, Prettier, `tsc --noEmit` nos 3 pacotes): passou.
- Integração e E2E de endpoint/frontend: **não aplicáveis ainda**, pois não existem service, rotas `/api/carts` nem UI do carrinho. Serão exercitados em T-015..T-022 e T-029..T-032.
- `make test` (Docker): **pendente, a executar pelo desenvolvedor**.

## Gaps na especificação

1. O diagrama não desenha as operações que mantêm o estado (adicionar item em `with_items`, cupom); vêm do FRD §6 e foram modeladas como transições estado→mesmo estado.
2. A falha da confirmação (permanece `in_checkout`) não é transição; é rollback no service (T-019).
3. A semântica de `TIMEOUT` em `empty` e estados finais não é desenhada; tratada como proibida/ignorada pelo `isExpired`.

## O que não foi alterado

Pricing, cupons, schema, handler de erros, service/rotas/UI (ainda inexistentes).
