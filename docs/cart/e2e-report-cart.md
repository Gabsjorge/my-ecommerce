## Relatório E2E — Carrinho de Compras

> **Status: executado e aprovado.** `make test` completo (confirmado pelo desenvolvedor, `exit=0`):
>
> | Suíte | Resultado |
> |-------|-----------|
> | Backend (Vitest, unitário + integração) | 555 de 555 passando |
> | Frontend (`node:test`) | 87 de 87 passando |
> | E2E (Playwright, API + UI) | 180 de 180 passando (1 worker, 2,5 min) |
>
> O E2E inclui os 14 fluxos novos e os 166 testes anteriores (sem regressão com o seed ampliado).
>
> **Achado durante a verificação:** a primeira execução do `make test` falhou em `product.repository.integration.test.ts`, que esperava 10 produtos fixos. Não era bug do sistema, e sim um teste com a contagem do seed escrita no código. Foi corrigido para usar `seedProducts.length`.

### Resumo
- Fluxos testados: 14 (9 de endpoint, 5 de interface)
- Testes passando: 14 de 14 fluxos (180 de 180 na suíte E2E completa)
- Testes falhando: 0
- Bugs encontrados: 0

### Fluxos Cobertos
| Fluxo | Passos | Status | Observação |
|-------|--------|--------|------------|
| F1 Compra com cupom percentual (item repetido, atualização, remoção, cupom, checkout, pedido) | 12 | Passando | Cupom `FLUXO-PCT` queimado; estoque exato |
| F2 Compra sem cupom | 4 | Passando | Desconto 0, `couponCode null` |
| F3 Ida e volta checkout ↔ edição com troca de cupom | 11 | Passando | Cupom `FLUXO-FIXO` queimado; `DESC10` segue livre |
| F4 Subtotal cai abaixo do mínimo antes da confirmação | 10 | Passando | `COUPON_MIN_ORDER_NOT_MET`, recuperação removendo o cupom |
| F5 Falta de estoque na confirmação é atômica e recuperável | 10 | Passando | `INSUFFICIENT_STOCK` com `details.items`; cupom e estoque preservados |
| F6 Abandono explícito (carrinho final, cupom e estoque intactos) | 8 | Passando | Cupom `FLUXO-F6` depois confirmado em outro carrinho |
| F7 Inatividade no meio do checkout | 5 | Passando | Espera real de ~11,5 s (timeout de 10 s do ambiente de teste); 11,6 s na execução |
| F8 Esvaziar o carrinho derruba o cupom e o ciclo recomeça | 7 | Passando | `empty` → `with_items` → pedido |
| F9 Corrida entre dois clientes (mesmo cupom e última unidade) | 5 | Passando | Perdedor falha por estoque **ou** cupom, conforme quem trava primeiro |
| U1 Compra completa pela interface | 14 | Passando | Cross-check pela API e estoque na listagem |
| U2 Voltar a editar, abandonar e novo carrinho | 9 | Passando | |
| U3 Outro cliente leva a última unidade; recuperação pela UI | 8 | Passando | Mensagem pt-BR de estoque (RN-023) |
| U4 Checkout sobrevive a reload e é confirmado | 5 | Passando | RF-015 |
| U5 Inatividade durante o checkout | 6 | Passando | Espera real de ~11,5 s; RN-024 |

### Bugs Encontrados
Nenhum até agora.

### Cenários Não Cobertos
- **Consulta do Pedido por id:** não existe endpoint (FRD, seção 10). O pedido é verificado pela resposta de `confirm` e pelos efeitos (estoque, cupom, carrinho).
- **Estado do banco direto:** os testes são caixa-preta; a persistência é conferida relendo carrinho e produtos pela API/UI, não por SQL.
- **Preço do produto mudando após adicionar (RN-004):** não há API para alterar preço; coberto por testes de integração do backend.
- **Falha inesperada no meio da confirmação (`INTERNAL_ERROR`):** exige injetar falha no banco; coberto em integração.
- **F9/U3 com dois navegadores simultâneos:** a UI usa uma única página que troca de carrinho em sequência (o isolamento de `localStorage` é feito pelo id guardado). A corrida real é exercitada na F9, via API, com `Promise.all`.
- **Ciclo de vida do Pedido (Confirmado, Enviado, Entregue, Cancelado):** fora de escopo (próximo Step).

### Arquivos Criados / Alterados
| Arquivo | Propósito |
|---------|-----------|
| `e2e/tests/api/flows.api.spec.ts` | Fluxos F1–F9 de endpoint |
| `e2e/tests/ui/flows.ui.spec.ts` | Fluxos U1–U5 de interface |
| `e2e/support/api.ts` | Constantes `PRODUCT_NAMES` e `COUPON_CODES` dos fluxos |
| `backend/src/db/seed.ts` | 7 produtos e 8 cupons dedicados aos fluxos (idempotente) |
| `backend/src/db/seed.test.ts` | Contagens do seed: 17 produtos e 21 cupons |
| `e2e/tests/api/products.api.spec.ts`, `e2e/tests/ui/product-list.ui.spec.ts` | Contagem de produtos de 10 para 17 |
| `docs/seeds-report.md` | Contagens do seed original atualizadas |

### Isolamento
- Cada teste cria seus próprios carrinhos e acha produtos por nome.
- Produtos `Kit Fluxo ... (E2E Endpoint)` só são usados por `flows.api.spec.ts`, e `... (E2E UI)` só por `flows.ui.spec.ts` (testes de um mesmo arquivo rodam em série), então o estoque é conferido de forma exata.
- Cupom consumível e produto de estoque 1 são dedicados a um único fluxo. `DESC10` e `MIN200` só são aplicados/removidos, nunca confirmados. O `FIXO20` compartilhado não é usado nos fluxos.
- Sem `retries`.

### Como executar
```bash
make test-e2e                      # suíte completa em containers
# ou, para depurar fluxo a fluxo no host:
make test-env-reset && make test-env-up
cd e2e && BASE_URL=http://localhost:8081 npx playwright test flows
```
