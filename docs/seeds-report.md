# Relatório de Dados Sintéticos — Seeds Volumosos

## Resumo

- Entidades populadas: 6 (`products`, `coupons`, `carts`, `cart_items`, `orders`, `order_items`)
- Total de registros gerados: **14.682** (1.000 + 1.200 + 3.000 + 7.053 + 1.200 + 3.129 — valores com a semente fixa `20260101`)
- Biblioteca utilizada: `@faker-js/faker` ^10.6.0 (devDependency do backend), locale `pt_BR` com fallback `en`/`base`
- Determinismo: semente fixa e data de referência (`now`) injetada; o mesmo `now` produz exatamente os mesmos dados.

## Dados Gerados por Entidade

| Entidade    | Registros | Variações                                                                                                                                                                                                                                                           | Observação                                                                     |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| products    | 1.000     | 12 categorias (eletrônicos, moda, calçados, casa, cozinha, livros, esporte, beleza, brinquedos, papelaria, pet, ferramentas). Preços de R$ 0,00 a R$ 9.999,99. 53 com estoque 0, 53 com estoque 1–3, 107 com estoque ≥ 5.000. Descrições curtas e longas (~10%).       | Nome termina em ` #NNNN` (único; um deles tem exatamente 120 caracteres).      |
| coupons     | 1.200     | 724 percentuais (1 a 100) e 476 fixos (1 a 50.000 centavos, mais um de 500.000). Mínimo de pedido 0 ou R$ 50 a R$ 1.000. 360 usados, 180 expirados, 660 ativos (alguns com validade em 2099).                                                                       | Prefixo `VOL-` (marcador de idempotência).                                     |
| carts       | 3.000     | `empty` 240 · `with_items` 600 · `in_checkout` 300 · `abandoned` 660 · `order_created` 1.200. 903 com cupom, 2.097 sem.                                                                                                                                              | Janela de histórico: 180 dias.                                                 |
| cart_items  | 7.053     | 1 a 8 linhas por carrinho, quantidade 1 a 10, nunca acima do estoque. 383 linhas com preço congelado diferente do preço atual (RN-004).                                                                                                                              | Uma linha por produto em cada carrinho.                                        |
| orders      | 1.200     | Um por carrinho `order_created`. 360 com cupom (30%), 840 sem. 18 com total zero (cupom de 100% ou fixo ≥ subtotal).                                                                                                                                                 | `total = subtotal − desconto`; datas entre 2 e 180 dias atrás.                 |
| order_items | 3.129     | Cópia das linhas do carrinho (preço e quantidade).                                                                                                                                                                                                                   | —                                                                              |

### Valores limite e campos opcionais

- Preço 0, 1 centavo e 999.999 centavos; estoque 0, 1, 3 e ≥ 5.000; nome com 120 caracteres.
- Cupom percentual 1% e 100%; fixo de 1 centavo e de R$ 5.000,00; cupom com mínimo de R$ 1.000,00; validade em 2099.
- `coupons.used_at`, `carts.coupon_id` e `orders.coupon_id` preenchidos e nulos.

### Consistência (garantida pela geração)

- Cupom usado ⇔ exatamente um pedido o utiliza (restrição `orders_coupon_id_unique`); o pedido cumpre o mínimo e o cupom não estava expirado quando o pedido foi criado (`used_at` = data do pedido).
- Desconto conforme a RN-015: `⌊subtotal × valor ÷ 100⌋` (percentual) e `min(valor, subtotal)` (fixo).
- O estoque gravado é o **estoque final**: estoque inicial menos o vendido nos pedidos, nunca negativo. Produtos com estoque ≤ 3 nunca são vendidos, preservando os valores limite.
- Carrinhos `empty` não têm itens nem cupom. Carrinhos `with_items`/`in_checkout` têm atividade dentro do timeout (600 s) e `abandoned` além dele (RN-020). Carrinhos abertos só pedem quantidade ≤ estoque atual (RN-005).
- Cupons aplicados a carrinhos abertos são ativos e não usados; os abandonados podem ter cupom ativo ou expirado.

### Desvios em relação ao plano aprovado

- **Cupons: 1.200 em vez de 300.** Como cada cupom só vale para um pedido (RN-013), ter ~30% dos pedidos com cupom exige ~360 cupons usados. Com 300 cupons só ~6% dos pedidos teriam cupom.
- **Idempotência por marcador:** em vez de marcar produtos, o seed usa os cupons `VOL-%` como marcador e roda tudo em uma transação; produtos têm nomes únicos com ` #NNNN`.
- **Carrinhos abertos e o tempo:** `with_items` e `in_checkout` são gerados com atividade recente, mas passam a `abandoned` sozinhos (sob demanda) 10 minutos depois, conforme a RN-020. Para ver esses estados, consulte logo após rodar o seed.

## Estrutura dos Seeds

- Geração pura (sem banco): [backend/src/db/seed-volume.data.ts](../backend/src/db/seed-volume.data.ts)
- Persistência (transação, lotes de 500): [backend/src/db/seed-volume.ts](../backend/src/db/seed-volume.ts)
- Testes unitários dos invariantes: [backend/src/db/seed-volume.data.test.ts](../backend/src/db/seed-volume.data.test.ts)
- Seed original (10 produtos e 13 cupons do E2E) permanece intacto e **não** inclui a massa volumosa.
- Execução (somente desenvolvimento; recusa `NODE_ENV` diferente de `development`):

```bash
make up            # sobe a stack de dev (seed original)
make seed-volume   # carrega a massa volumosa (idempotente)
# ou, no backend: npm run db:seed:volume
```

- Ordem de inserção: products → coupons → carts → cart_items → orders → order_items.
- Reexecução: se existir algum cupom `VOL-%`, o seed é ignorado. Para recarregar: `make clean && make up && make seed-volume`.
- A massa **não** entra nos compose nem no ambiente de teste: o E2E espera exatamente 10 produtos.

## Verificação

Executado pelo agente (offline):

- `npm --prefix backend run test:unit`: 383 testes passando (inclui 19 novos do seed volumoso).
- `tsc --noEmit` e ESLint/Prettier: backend sem erros.
- `npm --prefix frontend test`: 87/87 passando.
- `make lint`: falha somente em `frontend` (`tsc`: "Cannot find type definition file for 'node'"), nos arquivos que esta tarefa não tocou; provavelmente `npm ci` pendente no frontend (`make install`). Pendente de confirmação.

Confirmado pelo desenvolvedor (Docker, `make up`):

- [x] `make seed-volume`: `Volume seed finished: {"skipped":false,"products":1000,"coupons":1200,"carts":3000,"cartItems":7053,"orders":1200,"orderItems":3129}` (contagens idênticas às da simulação; as constraints e o `RETURNING` funcionaram no PostgreSQL real).
- [x] Segunda execução: `Volume seed skipped: already applied (coupons with prefix VOL- exist)` (idempotência).
- [x] `curl localhost:3000/health`: `{"status":"ok"}`.
- [x] `curl localhost:3000/api/products`: lista os 10 produtos originais seguidos dos de volume (ids 11 em diante).

- [x] `/api/products`: `"total":1010`.
- [x] Contagens no banco de dev: products 1010, coupons 1213 (1200 + 13 do seed original), carts 3000, cart_items 7053, orders 1200, order_items 3129.
- [x] `make test-backend`: 26 arquivos e 555 testes passando (unitários + integração, inclui os 19 novos). `make test-frontend`: 87/87.

**Fechamento:** `make test` completo (backend, frontend e E2E) confirmado pelo desenvolvedor.

- [x] `make test-e2e`: 166 de 166 testes passando (2,0 min). O ambiente de teste não recebe a massa volumosa, então os asserts de 10 produtos continuam válidos.

Observação: o produto `#0003` (preço limite R$ 9.999,99) termina com estoque 0 porque foi vendido por completo nos pedidos gerados. Os valores limite de preço e estoque continuam presentes no conjunto, mas não necessariamente no mesmo produto.
