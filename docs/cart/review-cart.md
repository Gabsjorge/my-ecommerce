# Relatório de Revisão — Carrinho de Compras

Referências: [frd-cart.md](frd-cart.md), [blueprint-cart.md](blueprint-cart.md) e o diagrama de estados do FRD.

## Resumo
- Total de findings: 24 (0 críticos, 0 altos, 4 médios, 20 baixos)
- Conformidade com o Blueprint: Alta
- Conformidade com o FRD: Alta
- Cobertura de testes: Parcial (unitários completos; lacunas pontuais em E2E de UI e HTTP de `/confirm`)
- Avaliação de segurança: Sem riscos identificados

Evidência de testes (rodados offline): `make lint` OK; backend unitário 332/332; frontend 67/67. Integração e E2E exigem Docker e não foram executados pelo agente.

## Findings

#### [MÉDIO] Teste de timeout da UI não detecta renovação do contador
**Eixo**: Qualidade
**Localização**: `e2e/tests/ui/cart-coupon-errors.ui.spec.ts:344-359`
**RF/RN relacionado**: RN-024, T-032
**Problema**: o teste espera 11,5 s após abrir o carrinho; se a UI renovasse o contador ao abrir/recarregar, o teste passaria do mesmo jeito.
**Recomendação**: abrir/recarregar a ~6 s após a última escrita e verificar "Abandonado" a ~11 s da escrita.

#### [MÉDIO] Botões de ação do carrinho sem guarda de requisição em andamento
**Eixo**: Qualidade
**Localização**: `frontend/src/main.js:76-84`, `frontend/src/views/cart.view.js:121-129`
**RF/RN relacionado**: RF-014
**Problema**: duplo clique em "Confirmar pedido" ou "Iniciar checkout" envia duas requisições; a segunda devolve `INVALID_CART_STATE` e o usuário vê erro após um sucesso. O servidor permanece consistente.
**Recomendação**: desabilitar os botões durante a requisição.

#### [MÉDIO] Projeto `integration` do Vitest sem `fileParallelism: false`
**Eixo**: Blueprint
**Localização**: `backend/vitest.config.ts:17-19`
**RF/RN relacionado**: T-021
**Problema**: usa `singleFork`; `poolOptions` foi removido no Vitest 4, e um upgrade reativaria o paralelismo.
**Recomendação**: sem correção possível agora: `fileParallelism` não é aceito por projeto no Vitest 3.2 (erro de `tsc`). `singleFork` é equivalente e correto nesta versão; um comentário foi adicionado para revisitar no upgrade.

#### [MÉDIO] Lacunas de E2E de UI
**Eixo**: Qualidade
**Localização**: `e2e/tests/ui/`
**RF/RN relacionado**: RN-011, RF-006/007, RF-010, RF-012, RF-015
**Problema**: sem teste para cupom já usado na confirmação (remover e confirmar), aplicar/remover cupom em Em Checkout, erros de adicionar pela listagem (estado inválido, estoque), abandonar em Em Checkout e `CART_NOT_FOUND` no meio da sessão.
**Recomendação**: adicionar os cenários.

#### [BAIXO] Timeout não passa por `nextState('TIMEOUT')`
**Localização**: `cart.service.ts:277`, `cart.repository.ts:119`, `cart.state.ts:14,42`
**RF/RN relacionado**: RN-020, T-009
**Problema**: a operação `TIMEOUT` existe na tabela mas nunca é chamada; o destino `abandoned` é fixo no código. Comportamento correto hoje, risco de divergência.
**Recomendação**: usar `nextState` ou remover a entrada morta.

#### [BAIXO] GET do carrinho sem snapshot consistente
**Localização**: `cart.repository.ts:44-57`
**RF/RN relacionado**: RF-002
**Problema**: duas queries sem transação; uma escrita concorrente pode gerar leitura inconsistente (status × itens).
**Recomendação**: executar em transação de leitura (REPEATABLE READ) ou uma única query.

#### [BAIXO] `available` impreciso no guard do decremento
**Localização**: `cart.service.ts:228-236`
**RF/RN relacionado**: RN-009
**Problema**: o valor reportado é o já validado (`>= requested`). Só ocorre se o invariante do lock quebrar; o rollback está correto.
**Recomendação**: reler o estoque ou omitir o valor.

#### [BAIXO] JSON malformado em rota sem corpo retorna 400
**Localização**: `app.ts:33`
**RF/RN relacionado**: Blueprint §4.1
**Problema**: o Blueprint diz que rotas sem corpo ignoram o corpo.
**Recomendação**: decisão do time (muda o contrato); manter ou aplicar `express.json` só às rotas com corpo.

#### [BAIXO] Normalização do código de cupom aceita caracteres Unicode
**Localização**: `coupon.code.ts:7`
**RF/RN relacionado**: RN-014
**Problema**: `toUpperCase` converte `ſ`→`S`, `ı`→`I`, `ß`→`SS`; `"ſſſ"` é aceito como `SSS`.
**Recomendação**: validar o formato ASCII antes de normalizar a caixa.
**Status**: corrigido; a normalização agora põe em maiúsculas apenas letras ASCII, e os testes unitários cobrem `ſ`, `ı` e `ß`.

#### [BAIXO] Default do timeout duplicado
**Localização**: `app.ts:29`, `config/env.ts:7`
**Recomendação**: manter uma única fonte.

#### [BAIXO] Error handler e health
**Localização**: `shared/error-handler.middleware.ts:9-14,35-36`, `health/health.controller.ts:10`
**Problema**: outros erros do body-parser (ex.: `encoding.unsupported`) viram 500; falta `res.headersSent`; o health engole o erro sem log.
**Recomendação**: delegar a `next(err)` se `headersSent`; logar a falha do health.

#### [BAIXO] Pontos menores da UI
**Localização**: `main.js`, `views/cart.view.js`, `domain/error-messages.js`, `frontend/package.json`
**Problema**: "Produto #id" em `INSUFFICIENT_STOCK` vindo da listagem; carrinho vazio sem link no corpo (Blueprint §5.5); contador de itens em estado final; GET duplo no boot; sem loading em `#/cart`; código de cupom digitado se perde após erro; `allowedActions().addItem` sem uso; descrição do `package.json` desatualizada.
**Recomendação**: corrigir o link e a descrição; o restante é opcional.

#### [BAIXO] Testes ausentes de `/confirm` por HTTP e de confirm com mínimo não atendido
**Localização**: `cart.routes.integration.test.ts:393-470`
**RF/RN relacionado**: RF-011, RN-011
**Problema**: faltam 404 `CART_NOT_FOUND`/`COUPON_NOT_FOUND`, 422 `COUPON_EXPIRED`/`COUPON_MIN_ORDER_NOT_MET` e integração de service para o mínimo. Há cobertura unitária e em E2E de API.
**Recomendação**: adicionar.

#### [BAIXO] Detalhes menores de infra e testes
**Localização**: `schema.integration.test.ts`, `seed.ts:108-135`, `positiveIntParam`, `coupons.expires_at NOT NULL`
**Problema**: CHECKs de `orders`/`order_items` sem teste; seed sem lock (execução única, risco desprezível); `"007"` aceito em params; 404 `NOT_FOUND` para rota desconhecida não documentado.
**Recomendação**: registrar; sem ação imediata.

## Matriz de Cobertura
| RF/RN | Implementado? | Testado? | Observação |
|-------|--------------|----------|------------|
| RF-001..005 | Sim | Sim | — |
| RF-006/007, RN-010..014 | Sim | Sim | Normalização Unicode (baixo) |
| RF-008..010, RN-018/019/022 | Sim | Sim | Matriz 7×5 testada; abandonar em Em Checkout sem E2E de UI |
| RF-011, RN-008/009/011/021 | Sim | Parcial | Faltam testes HTTP de `/confirm` e UI de RN-011 |
| RF-012..016 | Sim | Parcial | Faltam erros de RF-012 pela UI |
| RN-015/016/017 | Sim | Sim | — |
| RN-020 | Sim | Sim | Teste de UI não discriminante |
| RN-023 | Sim | Sim | — |
| RN-024 | Sim | Parcial | Ver finding de timeout da UI |

## O que está correto
- Tabela de transições idêntica ao diagrama e ao FRD §6; `empty` não abandona nem aceita cupom; estados finais irreversíveis.
- Timeout estrito (`>`), só em estados ativos, GET sem renovar, abandono comitado antes do erro.
- Ordem de validação do cupom (RN-010) e revalidação na confirmação (RN-011); válido até o instante de expiração.
- Desconto (floor/min), preço congelado, estoque informativo na adição e pessimista na confirmação (locks cart → cupom → produtos por id), lista de todos os itens faltantes, atomicidade.
- Schema, CHECKs, migration `0001` e seed (10 produtos, 12 cupons) conforme §2; seed idempotente por linha.
- Camadas respeitadas; `process.env` só em `config/env.ts`; sem SQL injection, sem vazamento de erro, sem rota terminando em `.js`.
- Frontend: `fetch` só em `api/`, sem `innerHTML`, 25 `data-testid`, mensagens pt-BR exatas, `allowedActions` igual à tabela.

## Próximos passos sugeridos
1. Guarda de requisição nos botões do carrinho.
2. Testes de E2E de UI ausentes e teste de timeout discriminante.
3. `fileParallelism: false`.
4. Testes HTTP de `/confirm`.
5. Ajustes menores (health, `headersSent`, default único, `available`, link do carrinho vazio, descrição do package).
6. Decisão do time: corpo em rotas sem corpo, `TIMEOUT` em `nextState`, snapshot do GET, normalização do cupom.

## Atualização pós-correções
Validado com `make test` completo (backend 463/463, frontend 67/67, E2E 152/152).

Resolvidos: guarda de requisição em andamento nos botões do carrinho; link no carrinho vazio; `headersSent` no handler de erros; log de falha no health; default do timeout em constante única; normalização ASCII do código do cupom; descrição do `package.json`; testes HTTP de `/confirm` (404, `COUPON_EXPIRED`, `COUPON_MIN_ORDER_NOT_MET`); novo `cart-edge-cases.ui.spec.ts` (cupom em Em Checkout, abandonar em Em Checkout, RN-011 pela UI com o cupom `UI-DISPUTA10`, erros de adicionar pela listagem, `CART_NOT_FOUND` na sessão, timeout com recarga intermediária).

Sem correção: `fileParallelism` por projeto (não suportado no Vitest 3.2). Dependem de decisão: corpo em rotas sem corpo, `nextState('TIMEOUT')`, snapshot do GET. Sem teste viável: `COUPON_NOT_FOUND` na confirmação (a FK impede o cenário).
