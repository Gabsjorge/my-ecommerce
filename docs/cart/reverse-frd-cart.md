# FRD Reverso — Carrinho de Compras

> **Fonte e escopo.** Documento inferido exclusivamente de `backend/src/modules/carts/cart.service.ts` e de `frontend/src/domain/{cart,cart-session,error-messages}.js`. Nenhuma especificação original foi consultada. Os comentários do código que citam IDs de outros documentos (RN-0xx, RF-0xx) foram ignorados como fonte.
>
> Regras implementadas em módulos auxiliares **não lidos** (`cart.state`, `cart.pricing`, `cart.timeout`, `coupon.rules`, repositories) aparecem marcadas como **[delegada]**: sabe-se que existem e onde são chamadas, mas não o seu conteúdo.

## 1. Visão Geral

O carrinho é um agregado identificado por `id` inteiro, com um **status**, uma lista de **linhas** (produto, quantidade, preço unitário congelado), um **cupom** opcional e totais calculados (subtotal, desconto, total).

O backend (`CartService`) expõe operações de criação, consulta, edição de itens, aplicação/remoção de cupom, mudança de estado (checkout, voltar a editar, abandonar) e confirmação, que cria um **Pedido** de forma atômica, baixa o estoque e consome o cupom. Toda escrita roda sob lock de linha do carrinho dentro de uma transação.

O frontend (`domain/`) não executa regras de negócio: apenas espelha, para fins de UX, quais ações estão habilitadas por status, valida a quantidade digitada, guarda o id do carrinho num storage injetado (chave `ecommerce.cartId`) e traduz códigos de erro para mensagens pt-BR.

## 2. Atores

| Ator                              | Interação                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Cliente (anônimo)                 | Opera o próprio carrinho pela UI; o id do carrinho fica no storage do navegador. Não há identificação de usuário. |
| Camada de API (controllers)       | Chama os métodos do `CartService`; é o único consumidor do service.                                               |
| Processo de timeout (implícito)   | Não há job: o abandono por inatividade é aplicado sob demanda, no acesso ao carrinho (RN-R011).                   |
| Repositórios / Unit of Work       | Persistência e locks; fora do escopo lido.                                                                        |

## 3. Requisitos Funcionais

### 3.1 Backend (`CartService`)

| ID      | Requisito                                                                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-R001 | **Criar carrinho** (`createCart`): cria um carrinho com o instante atual do relógio injetado e devolve a visão com `items: []`, `coupon: null`. O status inicial é definido pelo repository **[delegada]**.                                                                    |
| RF-R002 | **Consultar carrinho** (`getCart`): primeiro tenta abandonar o carrinho se expirado (`abandonIfExpired` com limite `agora − timeout`), depois lê os detalhes. Inexistente → `CART_NOT_FOUND`. Não renova o contador de inatividade e não lança erro se o carrinho acabou de ser abandonado: devolve-o com o novo status. |
| RF-R003 | **Adicionar item** (`addItem`): produto inexistente → `PRODUCT_NOT_FOUND`. Se já existe linha do produto, soma a quantidade; senão cria a linha com o preço atual do produto, que fica congelado na linha. Aplica a transição de estado de `ADD_ITEM` e persiste o novo status se mudou **[delegada]**. |
| RF-R004 | **Alterar quantidade** (`updateItemQuantity`): **substitui** a quantidade de uma linha existente (não soma). Linha inexistente → `CART_ITEM_NOT_FOUND`; produto inexistente → `PRODUCT_NOT_FOUND`.                                                                                  |
| RF-R005 | **Remover item** (`removeItem`): apaga a linha. Depois recalcula a transição passando o número de itens restantes; se a transição indicar `clearCoupon`, remove o cupom; se indicar novo estado, persiste-o **[delegada]**.                                                      |
| RF-R006 | **Aplicar cupom** (`applyCoupon`): recebe o código já normalizado (pelo schema, fora do escopo). Busca o cupom por código, calcula o subtotal atual e valida via `validateOnApply` **[delegada]**; se válido, associa o cupom ao carrinho. Carrinho vazio é recusado pela máquina de estados com `INVALID_CART_STATE`. |
| RF-R007 | **Remover cupom** (`removeCoupon`): sem cupom aplicado → `COUPON_NOT_APPLIED`; caso contrário desassocia o cupom.                                                                                                                                                              |
| RF-R008 | **Checkout** (`checkout`): aplica a transição `CHECKOUT` e persiste o novo status. Não verifica nem reserva estoque neste ponto.                                                                                                                                              |
| RF-R009 | **Voltar a editar** (`edit`): aplica a transição `EDIT`; o cupom é mantido.                                                                                                                                                                                                    |
| RF-R010 | **Abandonar** (`abandon`): aplica a transição `ABANDON`; cupom e estoque não são alterados.                                                                                                                                                                                    |
| RF-R011 | **Confirmar** (`confirm`): em uma única transação, revalida cupom, verifica estoque, cria o Pedido e seus itens, baixa o estoque, marca o cupom como usado e muda o status do carrinho. Devolve `{ order, cart }`. Detalhes em RN-R015 a RN-R019.                                |
| RF-R012 | **Visão do carrinho** (`toCartView`): `id`, `status`, `items[]` (`productId`, `name`, `quantity`, `unitPriceCents`, `subtotalCents = unitPriceCents × quantity`), `coupon` (`code`, `type`, `value`) ou `null`, mais os totais de `computeTotals` **[delegada]** (spread no objeto). |

### 3.2 Frontend (`domain/`)

| ID      | Requisito                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RF-R013 | **Rótulo de status** (`statusLabel`): `empty` → "Vazio", `with_items` → "Com Itens", `in_checkout` → "Em Checkout", `order_created` → "Pedido Criado", `abandoned` → "Abandonado". Status desconhecido devolve o próprio valor.                |
| RF-R014 | **Estado terminal** (`isTerminal`): `order_created` e `abandoned`.                                                                                                                                                                          |
| RF-R015 | **Ações permitidas por status** (`allowedActions`): ver tabela em 6.2. Declarado como "UX apenas; o servidor é a autoridade".                                                                                                                |
| RF-R016 | **Contagem de unidades** (`itemCount`): soma das `quantity` de todas as linhas; `0` se o carrinho é `null`.                                                                                                                                  |
| RF-R017 | **Interpretar quantidade digitada** (`parseQuantity`): ver RN-R021.                                                                                                                                                                          |
| RF-R018 | **Persistir id do carrinho** (`cart-session`): lê, grava e remove o id na chave `ecommerce.cartId` de um storage injetado. Leitura valida o formato (RN-R022).                                                                               |
| RF-R019 | **Mensagens de erro** (`errorMessage`): converte `error.code` em mensagem pt-BR; para `INSUFFICIENT_STOCK` anexa uma linha por item faltante (RN-R023).                                                                                     |

## 4. Regras de Negócio

### 4.1 Backend

| ID      | Regra                                                                                                                                                                                                                                                                                       | Origem                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| RN-R001 | Toda operação de escrita (add, update, remove, apply/remove cupom, checkout, edit, abandon, confirm) executa numa transação com **lock de linha do carrinho**; qualquer erro lançado desfaz tudo.                                                                                           | `withCartLock`                                            |
| RN-R002 | **Ordem de verificação** nas escritas: (1) carrinho existe (`CART_NOT_FOUND`); (2) timeout de inatividade; (3) o que o trabalho valida (estado, depois regras de domínio).                                                                                                                  | `withCartLock`                                            |
| RN-R003 | Uma linha por produto no carrinho. Adicionar produto já presente **soma** a quantidade; atualizar **substitui**.                                                                                                                                                                             | `addItem`, `updateItemQuantity`                           |
| RN-R004 | O preço unitário é capturado do produto **na primeira inclusão** e nunca é reatualizado: adições posteriores do mesmo produto usam o preço da linha existente.                                                                                                                              | `addItem` (`line?.unitPriceCents ?? product.priceCents`)  |
| RN-R005 | Em `addItem`, `quantidade acumulada (linha + nova) > estoque do produto` → `INSUFFICIENT_STOCK` com `details.items = [{productId, requested, available}]`. Em `updateItemQuantity`, `quantidade > estoque` → mesmo erro. É checagem **informativa**; a definitiva é a da confirmação.    | `addItem`, `updateItemQuantity`                           |
| RN-R006 | Limite de valor: após a operação, o subtotal (outras linhas + a linha afetada com a quantidade e o preço resultantes) não pode exceder `MAX_CART_SUBTOTAL_CENTS` → `VALIDATION_ERROR` "Cart total exceeds the allowed maximum". A checagem ocorre **depois** da de estoque.            | `assertWithinTotalLimit`                                  |
| RN-R007 | Em `addItem` a ordem é: transição de estado → produto existe → estoque → limite de valor. Em `updateItemQuantity`: estado permitido → linha existe → produto existe → estoque → limite. Em `removeItem`: estado permitido → linha existe.                                                  | métodos                                                   |
| RN-R008 | `addItem` pode mudar o status (ex.: de vazio para com itens); a mudança só é gravada se o status destino difere do atual. As regras da tabela de transições são **[delegada]**.                                                                                                              | `addItem`                                                 |
| RN-R009 | Remover o último item pode mudar o status e limpar o cupom (decisão vinda de `nextState('REMOVE_ITEM', …, { remainingItems })`). A condição exata é **[delegada]**; o service só obedece `to` e `clearCoupon`.                                                                              | `removeItem`                                              |
| RN-R010 | Cupom: aplicar exige cupom existente (por código) e passar em `validateOnApply` com `cartCouponId`, subtotal e `now` — conteúdo **[delegada]**. Remover exige cupom aplicado (`COUPON_NOT_APPLIED`). Um segundo cupom é recusado em algum ponto de `validateOnApply` (código `COUPON_ALREADY_APPLIED` mapeado no front). | `applyCoupon`, `removeCoupon`, `error-messages`           |
| RN-R011 | **Abandono por inatividade**: dentro de uma escrita, se `isExpired(status, lastActivityAt, now, timeout)` **[delegada]**, o status vira `abandoned`, a transação é **confirmada** e só então é lançado `INVALID_CART_STATE` (operação, `abandoned`). Isso evita que o rollback apague o abandono. | `withCartLock`                                            |
| RN-R012 | `getCart` também aplica o timeout (via `abandonIfExpired`, fora de transação/lock), mas **não** renova a atividade e **não** lança erro: devolve o carrinho com o status atual.                                                                                                            | `getCart`                                                 |
| RN-R013 | Toda escrita bem-sucedida chama `touch(cartId, now)`, renovando a última atividade, e devolve a visão relida do banco. Leituras e escritas que falham não renovam.                                                                                                                         | `finishWrite`                                             |
| RN-R014 | `checkout`, `edit` e `abandon` não têm regra própria: toda a validação vem de `nextState(operation, status)` **[delegada]**. Checkout não verifica estoque.                                                                                                                                 | `transition`                                              |
| RN-R015 | **Confirmação — pré-condição**: transição `CONFIRM` permitida para o status atual **[delegada]**; itens e subtotal lidos sob o lock do carrinho.                                                                                                                                              | `confirm`                                                 |
| RN-R016 | **Confirmação — cupom primeiro**: se há cupom, ele é travado (`lockById`) e revalidado (`revalidateOnConfirm` com cupom, subtotal e `now`) **[delegada]** antes de qualquer checagem de estoque. Totais e desconto são calculados por `computeTotals(items, cupom)` **[delegada]**.        | `confirm`                                                 |
| RN-R017 | **Confirmação — estoque**: produtos travados em lote (`lockByIds`, ordem de lock: carrinho → cupom → produtos por id). Para cada item, `disponível < solicitado` é falta; produto ausente do lock conta como disponível `0`. **Todas** as faltas são reportadas juntas em um único `INSUFFICIENT_STOCK`. | `confirm`                                                 |
| RN-R018 | **Confirmação — efeitos, em ordem**: criar Pedido com `cartId`, totais e `couponId` (ou `null`) e itens com preço da linha → baixar estoque de cada item com update guardado (falha → `INSUFFICIENT_STOCK` do item e rollback total) → marcar cupom usado em `now` (falha → `COUPON_ALREADY_USED` e rollback) → gravar o novo status do carrinho. | `confirm`                                                 |
| RN-R019 | O Pedido devolvido contém `id`, `cartId`, `status`, itens (`productId`, `name`, `quantity`, `unitPriceCents`), `subtotalCents`, `discountCents`, `totalCents`, `couponCode` (ou `null`) e `createdAt`. O carrinho devolvido é a visão pós-confirmação. A confirmação também renova a atividade (RN-R013). | `confirm`                                                 |
| RN-R020 | Valores monetários são inteiros em centavos (`*Cents`); `subtotalCents` da linha = `unitPriceCents × quantity`.                                                                                                                                                                             | `toCartView`                                              |

### 4.2 Frontend

| ID      | Regra                                                                                                                                                                                                                              |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RN-R021 | Quantidade digitada: após `trim`, só aceita texto inteiramente de dígitos (`^\d+$`, sem sinal, decimal, notação científica ou texto vazio) e valor entre **1** e **2.147.483.647**; caso contrário `null` (não deve ser enviada). |
| RN-R022 | Id de carrinho no storage: só dígitos, valor entre **1** e **2.147.483.647**; ausente, malformado ou fora da faixa → `null`. Chave: `ecommerce.cartId`.                                                                           |
| RN-R023 | Mensagens: código desconhecido ou ausente → "Algo deu errado. Tente novamente."; nunca expõe detalhes internos. Para `INSUFFICIENT_STOCK`, cada item vira "{nome ou `Produto #id`}: pedido X, disponível Y"; itens com formato inválido em `details.items` são descartados. O nome vem do carrinho em memória, quando informado. |
| RN-R024 | Habilitação de ações é derivada só do status (tabela 6.2) e não consulta estoque, cupom nem itens.                                                                                                                                 |

## 5. Dados de Entrada

Conforme o que o service e o domain do front aceitam (validação de formato HTTP/schema está fora do escopo lido).

| Operação          | Parâmetros                              | Validação dentro do escopo                                                                                  |
| ----------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `createCart`      | —                                       | —                                                                                                           |
| `getCart`         | `cartId: number`                        | Existência.                                                                                                 |
| `addItem`         | `cartId`, `productId`, `quantity`       | Produto existe; estoque; limite de subtotal. Positividade/inteiro de `quantity` **não** é checada no service. |
| `updateItemQuantity` | `cartId`, `productId`, `quantity`    | Linha e produto existem; estoque; limite de subtotal. Idem quanto a `quantity`.                             |
| `removeItem`      | `cartId`, `productId`                   | Linha existe.                                                                                               |
| `applyCoupon`     | `cartId`, `code: string`                | Já normalizado antes; cupom existe e é válido **[delegada]**.                                               |
| `removeCoupon`, `checkout`, `edit`, `abandon`, `confirm` | `cartId` | Existência, timeout, estado.                                                          |

Configuração: `inactivityTimeoutMs` e `clock()` injetados; valores **não** visíveis no escopo lido.

Frontend: texto de quantidade (RN-R021), valor do storage (RN-R022), `error` com `code` e `details.items[]` (RN-R023).

## 6. Estados e Transições

### 6.1 Estados observados

`empty`, `with_items`, `in_checkout`, `order_created`, `abandoned` (rótulos e `isTerminal` no front; `abandoned` e `order_created` são terminais).

### 6.2 Ações por estado (frontend, `allowedActions`)

| Ação                       | empty | with_items | in_checkout | order_created | abandoned |
| -------------------------- | :---: | :--------: | :---------: | :-----------: | :-------: |
| Adicionar item             |  sim  |    sim     |     não     |      não      |    não    |
| Editar itens (alterar/remover) | não |   sim     |     não     |      não      |    não    |
| Cupom (aplicar/remover)    |  não  |    sim     |     sim     |      não      |    não    |
| Checkout                   |  não  |    sim     |     não     |      não      |    não    |
| Voltar a editar            |  não  |    não     |     sim     |      não      |    não    |
| Confirmar                  |  não  |    não     |     sim     |      não      |    não    |
| Abandonar                  |  não  |    sim     |     sim     |      não      |    não    |
| Novo carrinho              |  não  |    não     |     não     |      sim      |    sim    |

### 6.3 Transições inferidas do service

A tabela real vive em `cart.state` **[delegada]**. O que o service permite deduzir:

| Operação            | Efeito no status                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `ADD_ITEM`          | Pode mudar (ex.: `empty` → `with_items`); grava só se diferente.                                          |
| `UPDATE_ITEM`       | Sem mudança de status (valida apenas se é permitido).                                                     |
| `REMOVE_ITEM`       | Pode mudar conforme itens restantes; pode limpar cupom.                                                   |
| `APPLY_COUPON`, `REMOVE_COUPON` | Sem mudança de status; `APPLY_COUPON` é recusado em carrinho vazio.                           |
| `CHECKOUT`          | `with_items` → `in_checkout` (por RF-R015 e nome; destino vem de `nextState`).                            |
| `EDIT`              | `in_checkout` → `with_items`.                                                                             |
| `ABANDON`           | `with_items`/`in_checkout` → `abandoned`.                                                                 |
| `CONFIRM`           | `in_checkout` → (provavelmente) `order_created`; destino vem de `nextState`.                              |
| Timeout             | Status elegível **[delegada]** → `abandoned`, fora das transições de `nextState`.                         |

## 7. Tratamento de Erros

| Código (inferido do tipo de erro)  | Quando ocorre                                                                                   | Observação                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `CART_NOT_FOUND`                   | Carrinho inexistente em `getCart`, no lock ou ao reler após escrita.                            |                                                                        |
| `PRODUCT_NOT_FOUND`                | Produto inexistente em `addItem`/`updateItemQuantity`.                                          |                                                                        |
| `CART_ITEM_NOT_FOUND`              | Alterar ou remover produto sem linha no carrinho.                                               |                                                                        |
| `INVALID_CART_STATE`               | Operação não permitida pelo estado; carrinho expirado durante escrita (estado `abandoned`).     | Carrega operação e estado.                                             |
| `INSUFFICIENT_STOCK`               | Add/update acima do estoque; faltas na confirmação; baixa guardada falhou.                      | `details.items[]` com `productId`, `requested`, `available`.           |
| `VALIDATION_ERROR`                 | Subtotal acima do máximo.                                                                       | Mensagem em inglês no service.                                         |
| `COUPON_NOT_APPLIED`               | Remover cupom sem cupom aplicado.                                                               |                                                                        |
| `COUPON_ALREADY_USED`              | Marcar cupom como usado falhou na confirmação.                                                  | Também pode vir de `validateOnApply`/`revalidateOnConfirm` **[delegada]**. |
| `COUPON_NOT_FOUND`, `COUPON_EXPIRED`, `COUPON_ALREADY_APPLIED`, `COUPON_MIN_ORDER_NOT_MET` | Mapeados no front; lançados por `coupon.rules` **[delegada]**. | Não visíveis no service. |

**Mensagens pt-BR do front** (`errorMessage`): VALIDATION_ERROR "Dados inválidos. Verifique o que foi informado."; CART_NOT_FOUND "Carrinho não encontrado."; PRODUCT_NOT_FOUND "Produto não encontrado."; CART_ITEM_NOT_FOUND "Item não encontrado no carrinho."; INVALID_CART_STATE "Esta operação não está disponível para o estado atual do carrinho."; INSUFFICIENT_STOCK "Estoque insuficiente."; COUPON_NOT_FOUND "Cupom não encontrado."; COUPON_EXPIRED "Cupom expirado."; COUPON_ALREADY_USED "Este cupom já foi utilizado."; COUPON_MIN_ORDER_NOT_MET "O pedido não atinge o valor mínimo do cupom."; COUPON_ALREADY_APPLIED "Já há um cupom aplicado. Remova-o para aplicar outro."; COUPON_NOT_APPLIED "Não há cupom aplicado."; NETWORK_ERROR "Não foi possível conectar ao servidor."; demais → "Algo deu errado. Tente novamente.".

**Atomicidade:** em escritas, qualquer exceção reverte a transação, exceto o abandono por timeout (RN-R011), que é deliberadamente confirmado antes do erro.

## 8. Observações

1. **Quantidade não validada no service.** `addItem`/`updateItemQuantity` não rejeitam `quantity ≤ 0` ou não inteira; dependem do schema da camada HTTP (não lido). Se o service for chamado fora dela, `quantity = 0` ou negativa passaria nas checagens de estoque.
2. **Soma de quantidade sem teto próprio.** O limite superior efetivo é estoque e `MAX_CART_SUBTOTAL_CENTS`. O front limita a 2.147.483.647 por ser o máximo de int32.
3. **Estoque informativo vs. definitivo.** Add/update checam estoque sem reservá-lo; checkout nem checa. Outro cliente pode consumir o estoque até a confirmação, que é a única checagem vinculante (RN-R017/R018).
4. **Preço congelado.** Mudança de preço do produto depois da primeira inclusão não afeta a linha. Em `addItem` a verificação de limite usa o preço da linha existente; consistente com RN-R004.
5. **`getCart` x escritas no timeout.** Leitura devolve o carrinho já `abandoned` com 200; escrita devolve `INVALID_CART_STATE`. Comportamento assimétrico, possivelmente intencional. `getCart` não usa lock, portanto corre contra escritas concorrentes.
6. **Timeout só sob demanda.** Carrinhos nunca acessados permanecem no status antigo no banco.
7. **Ordem de erro na confirmação.** Cupom (qualquer erro de cupom) tem precedência sobre estoque. Se ambos falham, o cliente vê apenas o erro do cupom.
8. **Estado antes do cupom.** Em `applyCoupon`, `nextState` roda antes da busca do cupom: carrinho vazio dá `INVALID_CART_STATE` mesmo com código inexistente.
9. **Possível redundância.** O `COUPON_ALREADY_USED` lançado se `markUsed` falha parece uma defesa adicional à revalidação feita por `revalidateOnConfirm` (conteúdo não lido); o código só comenta explicitamente a defesa do estoque ("lock invariant").
10. **Duplicação no front.** O máximo `2147483647` aparece em `cart.js` (`MAX_QUANTITY`) e em `cart-session.js` (`MAX_ID`), sem constante compartilhada.
11. **Front espelha o backend manualmente.** `allowedActions` replica a tabela de `cart.state`; divergência futura só se descobre em runtime (o servidor rejeita). `editItems` (alterar/remover) exige `with_items`, enquanto `addItem` aceita `empty`; coerente com RN-R007 apenas por inferência.
12. **Idioma misto.** Mensagens do backend (ex.: "Cart total exceeds…") em inglês; mensagens do front em pt-BR via mapa por código, então a mensagem do servidor não chega ao usuário.
13. **Não verificado.** Valor de `inactivityTimeoutMs`, `MAX_CART_SUBTOTAL_CENTS`, fórmulas de desconto, tabela de estados completa, status inicial do carrinho e do Pedido.
