# Comparação FRD Original × FRD Reverso — Carrinho de Compras

> Fases 3 e 4 da skill `reverse-engineering`. Documentos comparados: [frd-cart.md](frd-cart.md) (original) e [reverse-frd-cart.md](reverse-frd-cart.md) (inferido do código). Este documento é um diagnóstico: não propõe nem aplica correções.

## 1. Escopo e limitação

O FRD reverso foi gerado a partir de apenas dois conjuntos de arquivos: `backend/src/modules/carts/cart.service.ts` e `frontend/src/domain/{cart,cart-session,error-messages}.js`. As regras que vivem em `cart.state`, `cart.pricing`, `cart.timeout`, `coupon.rules`, nos schemas HTTP, nos repositories e nas views aparecem no reverso como **[delegada]**.

Por isso a comparação separa duas situações:

- **Lacuna confirmada**: o código lido mostra que o requisito não existe.
- **Não verificável no escopo lido**: o requisito pode estar implementado, mas em um arquivo que o reverso não leu. Não conta como lacuna.

## 2. Resumo

- Requisitos no FRD original: **40** (16 RF + 24 RN)
- Requisitos inferidos do código: **43** (19 RF-R + 24 RN-R)
- Lacunas confirmadas (especificado, não implementado): **0**
- Não verificáveis no escopo lido: **14**
- Excessos (implementado, não especificado): **8**
- Divergências (comportamento diferente): **5**, todas de baixo impacto

## 3. Lacunas

Nenhuma lacuna foi confirmada. Os itens abaixo ficaram sem evidência porque o reverso não leu o arquivo responsável.

| RF/RN original | Descrição | Onde conferir | Impacto se faltar |
| --- | --- | --- | --- |
| RN-002 | Quantidade inteira ≥ 1. O service não valida; o front valida em `parseQuantity` | Schema HTTP | Alto, porque quantidade 0 ou negativa passaria pelas checagens de estoque |
| RN-014 | Normalização do código do cupom (trim, caixa) e formato de 3 a 30 caracteres | Schema HTTP | Médio |
| RN-010 | Ordem das 6 validações ao aplicar cupom | `coupon.rules` | Médio |
| RN-011 | Revalidação do cupom na confirmação. O reverso só vê a chamada a `revalidateOnConfirm` | `coupon.rules` | Alto |
| RN-015 | Cálculo do desconto (percentual com piso, fixo limitado ao subtotal, total nunca negativo) | `cart.pricing` | Alto |
| RN-017 | Pedido mínimo comparado ao subtotal antes do desconto | `coupon.rules` | Médio |
| RN-016 | Cupom removido ao voltar a Vazio; cupom mantido se o subtotal cair abaixo do mínimo | `cart.state` | Médio |
| RN-018 / RN-019 | Tabela real de transições, incluindo Vazio não abandonável | `cart.state` | Alto |
| RN-020 | Valores do timeout (600 s em dev, 10 s em teste) | Config e `cart.timeout` | Baixo |
| RF-001 / RF-011 | Status inicial do carrinho (Vazio) e do Pedido (Criado) | Repositories | Baixo |
| RF-012 a RF-014 | Telas: botão na listagem (desabilitado com estoque 0), tela do carrinho, ações de checkout | `frontend/src/views` | Médio |
| RF-015 | Descartar o id guardado quando a API devolve `CART_NOT_FOUND` | Views / app | Médio |
| RF-016 | Resumo do pedido após confirmar e botão "Novo carrinho". O reverso só vê `allowedActions.newCart` | Views | Médio |
| RN-024 | Recarregar o carrinho após `INVALID_CART_STATE` e não renovar a inatividade na UI | Views | Médio |

## 4. Excessos

| RF/RN reverso | Descrição | Avaliação |
| --- | --- | --- |
| RN-R006 | Limite `MAX_CART_SUBTOTAL_CENTS` com `VALIDATION_ERROR` ("Cart total exceeds the allowed maximum"), checado depois do estoque | Não especificado. Tem origem conhecida no commit `2e22e9a` (colunas int32). Desejável; sugere-se incorporar ao FRD |
| RN-R021 / RN-R022 | Front limita quantidade e id do storage a 1–2.147.483.647 (constante duplicada em `cart.js` e `cart-session.js`) | Endurecimento de UX coerente com o item anterior. Duplicação da constante é pequena dívida |
| RN-R001 | Lock de linha do carrinho em toda escrita, em transação | FRD só exige lock de estoque na confirmação (RN-008). Desejável, pois protege contra escritas concorrentes no mesmo carrinho |
| RN-R017 | Produto ausente no lock em lote conta como estoque 0; todas as faltas são reportadas juntas | Detalhe defensivo. Compatível com RN-009 |
| RN-R018 | Baixa de estoque com update guardado e `markUsed` guardado, com rollback total em caso de falha | Defesas extras além da verificação prévia. Desejável |
| RN-R005 | `details.items` em `INSUFFICIENT_STOCK` também em add e update | FRD só prevê detalhes na confirmação. Inofensivo, mas amplia o contrato |
| RN-R023 / RF-R019 | Mensagem `NETWORK_ERROR` e nome de fallback "Produto #id" | Não especificado. Melhora de UX |
| RN-R019 | Pedido devolvido inclui `cartId`, `couponCode` e `createdAt` | FRD define o conteúdo só de forma geral (itens, preços, total, desconto, cupom). Avaliar se vira contrato |

## 5. Divergências

| Original | Reverso | Diferença |
| --- | --- | --- |
| RF-004 / seção 5: item ausente → `CART_ITEM_NOT_FOUND` | RN-R007 / RF-R004: após achar a linha, produto inexistente → `PRODUCT_NOT_FOUND` | Caminho de erro extra, praticamente inalcançável (linha existe, produto não) |
| Ordem de precedência de erros não definida | RN-R002: carrinho existe → timeout → estado → regras de domínio. RN-R007: ordem própria em add, update e remove | FRD não fixa a precedência; o código a define. Só importa quando mais de um erro ocorre ao mesmo tempo |
| RF-011 / RN-011: lista revalidação do cupom e depois estoque, sem tratar falha dupla | RN-R016: erro de cupom tem precedência sobre estoque; só o erro de cupom é visto | Comportamento implícito no código; o FRD é omisso |
| RN-020: lista as escritas que reiniciam o contador (add, update, remove, cupom, checkout, voltar a editar) | RN-R013: toda escrita bem-sucedida chama `touch`, inclusive a confirmação | Sem efeito prático, já que abandonar e confirmar levam a estados finais |
| RN-023: mensagens ao cliente em pt-BR | RN-R006: mensagem do service em inglês | Mitigado: o front traduz por código e a mensagem do servidor não chega ao usuário |

## 6. Itens confirmados como fiéis

- Uma linha por produto; adicionar soma, atualizar substitui (RN-001, RN-003, RF-004).
- Preço congelado na primeira inclusão (RN-004).
- Estoque informativo no carrinho, sem reserva, e checkout sem checagem de estoque (RN-005 a RN-007).
- Confirmação atômica: pedido, itens, baixa de estoque, cupom usado e status em uma transação (RN-021).
- Lock pessimista de produtos na confirmação, com ordem fixa carrinho → cupom → produtos (RN-008).
- `INSUFFICIENT_STOCK` na confirmação lista todos os itens com pedido e disponível (RN-009).
- Timeout avaliado no acesso, sem job. Em escrita grava Abandonado e recusa com `INVALID_CART_STATE`; em leitura devolve Abandonado sem renovar (RN-020).
- Remover cupom sem cupom aplicado → `COUPON_NOT_APPLIED` (RF-007).
- Aplicar cupom em carrinho vazio → `INVALID_CART_STATE` (seção 7).
- `allowedActions` do front é idêntica à tabela "Operações proibidas por estado" da seção 6 do FRD, e "Novo carrinho" aparece só nos estados finais (RF-013, RF-016).
- Mensagens pt-BR para todos os códigos de erro, com fallback genérico sem detalhes internos (RN-023).
- Valores monetários em centavos inteiros (RN-004).

## 7. Conclusão

A implementação está **fiel** à especificação no que foi possível observar. Nenhuma lacuna foi confirmada e as divergências são de baixo impacto: precedência de erros e caminhos de erro que o FRD não define.

Os excessos são endurecimentos defensivos (limite de subtotal, locks, updates guardados), e o mais relevante, `MAX_CART_SUBTOTAL_CENTS`, merece ser registrado no FRD.

A limitação principal é de cobertura: 14 itens, incluindo o cálculo de desconto, as validações de cupom, a tabela de transições e as telas, não puderam ser confirmados. Recomenda-se uma segunda passada do reverso sobre `cart.state`, `cart.pricing`, `cart.timeout`, `coupon.rules`, os schemas HTTP e `frontend/src/views` para fechar esses itens.
