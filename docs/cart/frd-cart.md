# FRD — Carrinho de Compras

## 1. Visão Geral

Esta funcionalidade inclui a API e a interface web do cliente (listagem com botão de adicionar, tela do carrinho e confirmação). O Carrinho de Compras permite que um cliente monte uma seleção de produtos, aplique um cupom de desconto e a converta em um Pedido. O carrinho é gerido por uma máquina de estados (Vazio, Com Itens, Em Checkout, Pedido Criado, Abandonado). A conversão em Pedido é atômica: ou tudo é aplicado (pedido criado, estoque decrementado, cupom consumido), ou nada muda.

**Contexto:** o sistema é um e-commerce simplificado, com fins educacionais. A Listagem de Produtos já existe. Esta funcionalidade adiciona o carrinho, a aplicação de cupons e a criação do Pedido. O ciclo de vida do Pedido após a criação (Confirmado, Enviado, Entregue, Cancelado) fica fora deste FRD.

Este FRD fecha as três lacunas deixadas de propósito em `high_level_requirements.md`: **regras de desconto**, **comportamento de estoque** e **validação de dados de entrada**.

## 2. Atores

| Ator        | Papel                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cliente** | Cria o carrinho, gerencia itens, aplica e remove cupom, inicia o checkout, confirma o pedido ou abandona. Não há autenticação: o cliente é identificado apenas pelo id do carrinho que criou. |
| **Sistema** | Avalia o timeout de abandono, calcula valores, valida estoque e cupom, e executa a conversão em Pedido.                                                                                     |

Não há papéis administrativos. Os cupons são cadastrados por seed (ver seção 9).

## 3. Requisitos Funcionais

### Carrinho

**RF-001 — Criar carrinho**
- Disparo: o cliente solicita um novo carrinho.
- Resultado: é criado um carrinho no estado **Vazio**, sem itens e sem cupom, e seu id (inteiro serial) é devolvido. O cliente usa esse id em todas as demais operações. Vários carrinhos podem coexistir.

**RF-002 — Visualizar carrinho**
- Disparo: o cliente consulta um carrinho pelo id.
- Resultado: o sistema devolve o estado, os itens (produto, quantidade, preço unitário congelado, subtotal da linha), o cupom aplicado (se houver), o subtotal, o desconto e o total. Se o carrinho estiver inativo além do timeout, o estado devolvido já é **Abandonado** (RN-020). A consulta não reinicia o contador de inatividade.

### Itens

**RF-003 — Adicionar item**
- Disparo: o cliente informa produto e quantidade para um carrinho em **Vazio** ou **Com Itens**.
- Resultado:
  - Se o produto ainda não está no carrinho, é criada uma linha com o preço unitário atual do produto, que fica congelado (RN-004).
  - Se o produto já está no carrinho, a quantidade informada é somada à da linha existente (RN-003).
  - Se o carrinho estava Vazio, passa a **Com Itens**.
  - Se a quantidade resultante exceder o estoque atual do produto, a operação é recusada (RN-005) e nada muda.

**RF-004 — Atualizar quantidade de um item**
- Disparo: o cliente informa uma nova quantidade para um item de um carrinho em **Com Itens**.
- Resultado: a quantidade da linha é substituída pelo novo valor, sujeito a RN-002 e RN-005. O carrinho permanece Com Itens.

**RF-005 — Remover item**
- Disparo: o cliente remove um item de um carrinho em **Com Itens**.
- Resultado: a linha é removida. Se era a última, o carrinho volta a **Vazio** e o cupom aplicado é removido (RN-016). Caso contrário, permanece Com Itens.

### Cupom

**RF-006 — Aplicar cupom**
- Disparo: o cliente informa um código de cupom para um carrinho em **Com Itens** ou **Em Checkout**.
- Resultado: se o cupom passar por todas as validações da RN-010, ele é associado ao carrinho. O desconto passa a ser refletido no total do carrinho. Se qualquer validação falhar, o carrinho não muda e o erro correspondente é devolvido.

**RF-007 — Remover cupom**
- Disparo: o cliente solicita a remoção do cupom de um carrinho em **Com Itens** ou **Em Checkout**.
- Resultado: o cupom é desassociado e o desconto some. Sem cupom aplicado, a operação retorna erro (`COUPON_NOT_APPLIED`).

### Transições de checkout

**RF-008 — Iniciar checkout**
- Disparo: o cliente inicia o checkout de um carrinho em **Com Itens**.
- Resultado: o carrinho passa a **Em Checkout**. Os itens ficam bloqueados para edição. Esta operação não verifica nem reserva estoque (RN-007).

**RF-009 — Voltar a editar**
- Disparo: o cliente volta a editar um carrinho em **Em Checkout**.
- Resultado: o carrinho volta a **Com Itens**. O cupom aplicado é mantido.

**RF-010 — Abandonar carrinho**
- Disparo: o cliente abandona explicitamente um carrinho em **Com Itens** ou **Em Checkout**, ou o timeout é detectado (RN-020).
- Resultado: o carrinho passa a **Abandonado** (estado final). O cupom não é consumido e não há estoque a devolver.

**RF-011 — Confirmar pedido**
- Disparo: o cliente confirma um carrinho em **Em Checkout**.
- Resultado: em uma única operação atômica (RN-021):
  1. O cupom aplicado (se houver) é revalidado (RN-011).
  2. O subtotal, o desconto e o total são recalculados.
  3. O estoque de todos os itens é verificado.
  4. Se tudo passar, é criado o **Pedido** com status inicial **Criado** (itens, preços unitários, total, desconto aplicado, cupom), o estoque é decrementado, o cupom é marcado como usado e o carrinho passa a **Pedido Criado** (estado final).
  5. Se qualquer verificação falhar, nada é alterado e o carrinho continua **Em Checkout** (RN-009).

### Interface do Cliente

**RF-012 — Adicionar da listagem**
- Disparo: o cliente aciona "Adicionar ao carrinho" em um produto da listagem.
- Resultado: é adicionada 1 unidade do produto ao carrinho do cliente (RF-003). Se o cliente ainda não tem carrinho, ele é criado nesse momento (RF-001). O botão fica desabilitado para produto com estoque 0. Se o carrinho não aceita a operação (estado) ou o estoque é insuficiente, o erro é exibido (RN-023).

**RF-013 — Tela do carrinho**
- Disparo: o cliente abre o carrinho.
- Resultado: a tela mostra o estado, os itens (produto, quantidade, preço unitário, subtotal da linha), o cupom aplicado, o subtotal, o desconto e o total (RF-002). Oferece alterar quantidade (RF-004), remover item (RF-005), aplicar cupom por campo de texto (RF-006) e remover cupom (RF-007). Os controles disponíveis seguem a tabela "Operações proibidas por estado" (seção 6); os não permitidos não são exibidos ou ficam desabilitados.

**RF-014 — Ações de checkout na tela**
- Disparo: o cliente aciona iniciar checkout (RF-008), voltar a editar (RF-009), confirmar pedido (RF-011) ou abandonar (RF-010) na tela do carrinho.
- Resultado: a operação correspondente é executada e a tela reflete o novo estado. Em caso de erro, o carrinho exibido permanece como está no servidor.

**RF-015 — Continuidade do carrinho**
- Disparo: o cliente recarrega ou reabre a aplicação.
- Resultado: o carrinho é restaurado pelo id guardado no navegador, em qualquer estado, inclusive Abandonado e Pedido Criado. Se o id guardado não existe mais (`CART_NOT_FOUND`), ele é descartado e o cliente fica sem carrinho.

**RF-016 — Confirmação e novo carrinho**
- Disparo: a confirmação (RF-011) é bem-sucedida, ou o carrinho está em estado final.
- Resultado: após confirmar, a tela mostra o resumo do pedido criado (número, itens, desconto e total). Em estado final (Pedido Criado ou Abandonado), a tela é somente leitura e oferece "Novo carrinho", que descarta o id guardado; o próximo "Adicionar ao carrinho" cria um novo carrinho. Ao recarregar após a confirmação, o resumo detalhado não é exibido (não há consulta de Pedido); a tela mostra o carrinho em Pedido Criado com o total.

## 4. Regras de Negócio

### Itens e quantidades

- **RN-001 — Uma linha por produto.** O carrinho tem no máximo uma linha por produto.
- **RN-002 — Quantidade válida.** A quantidade é um inteiro maior ou igual a 1. Não há teto fixo por item: o limite é o estoque (RN-005). Atualizar a quantidade para 0 é erro; para tirar um item, usa-se RF-005.
- **RN-003 — Item repetido soma.** Adicionar um produto que já está no carrinho soma a quantidade à linha existente. A soma também está sujeita a RN-005.
- **RN-004 — Preço congelado.** O preço unitário da linha é o preço do produto no momento em que a linha foi criada. Alterações posteriores no preço do produto não afetam carrinhos existentes. Somar quantidade a uma linha existente (RN-003) mantém o preço congelado. Valores monetários são sempre inteiros, em centavos.

### Estoque

- **RN-005 — Quantidade limitada pelo estoque atual.** Adicionar ou atualizar um item é recusado (`INSUFFICIENT_STOCK`) se a quantidade resultante da linha for maior que o estoque atual do produto. Produto com estoque 0 não pode ser adicionado.
- **RN-006 — Verificação no carrinho é informativa.** A verificação da RN-005 dá retorno imediato ao cliente, mas não garante estoque futuro: outros carrinhos podem consumi-lo antes da confirmação. A verificação definitiva é feita na confirmação (RN-009).
- **RN-007 — Sem reserva de estoque.** Adicionar ao carrinho, iniciar o checkout e abandonar não reservam nem devolvem estoque. O estoque só é decrementado na criação do pedido.
- **RN-008 — Decremento pessimista.** Na confirmação, o estoque dos produtos do carrinho é travado para leitura e escrita até o fim da operação, de modo que duas confirmações simultâneas não vendam o mesmo estoque.
- **RN-009 — Falta de estoque na confirmação.** Se algum item tiver estoque atual menor que a quantidade do carrinho, a confirmação falha por inteiro (`INSUFFICIENT_STOCK`), sem criar pedido, sem decrementar nenhum estoque e sem consumir o cupom. O erro lista os itens problemáticos (produto, quantidade pedida, estoque disponível). O carrinho continua Em Checkout. Não há ajuste automático de quantidade.

### Cupom e desconto

- **RN-010 — Validações ao aplicar o cupom**, nesta ordem:
  1. O código está em formato válido (RN-014).
  2. O cupom existe (`COUPON_NOT_FOUND`).
  3. O carrinho ainda não tem cupom aplicado (`COUPON_ALREADY_APPLIED`).
  4. O cupom não está expirado (`COUPON_EXPIRED`).
  5. O cupom ainda não foi usado (`COUPON_ALREADY_USED`).
  6. O subtotal do carrinho (antes de qualquer desconto) é maior ou igual ao pedido mínimo do cupom (`COUPON_MIN_ORDER_NOT_MET`).
  Aplicar cupom a um carrinho Vazio é recusado, pois o subtotal é 0.
- **RN-011 — Revalidação na confirmação.** Ao confirmar o pedido, as validações de existência, expiração, uso e pedido mínimo (itens 2, 4, 5 e 6 da RN-010) são refeitas com o estado atual. Se alguma falhar, a confirmação é recusada com o erro correspondente e o carrinho continua Em Checkout (o cliente pode remover o cupom e confirmar sem ele).
- **RN-012 — Um cupom por carrinho.** O carrinho aceita no máximo um cupom aplicado. Para trocar, o cliente remove o atual (RF-007) e aplica o novo.
- **RN-013 — Cupom de uso único.** Um cupom só pode ser usado em um único pedido. Ele é considerado **usado** somente quando um pedido é criado com ele (RN-021). Aplicar o cupom a um carrinho não o consome; dois carrinhos podem ter o mesmo cupom aplicado ao mesmo tempo, e o primeiro a confirmar vence. O outro falha na revalidação (`COUPON_ALREADY_USED`).
- **RN-014 — Código do cupom.** O código é normalizado antes de qualquer verificação: espaços nas pontas são removidos e a comparação não diferencia maiúsculas de minúsculas. Após a normalização, deve ter de 3 a 30 caracteres entre letras, dígitos, hífen e underscore. Caso contrário, é erro de validação (`VALIDATION_ERROR`).
- **RN-015 — Cálculo do desconto.**
  - Subtotal = soma de (preço unitário × quantidade) das linhas.
  - Cupom **percentual** (valor inteiro de 1 a 100): desconto = ⌊subtotal × valor ÷ 100⌋, arredondado para baixo em centavos inteiros.
  - Cupom **fixo** (valor em centavos, maior que 0): desconto = menor valor entre o valor do cupom e o subtotal.
  - Total = subtotal − desconto. O total nunca é negativo e é sempre um inteiro em centavos. Um percentual de 100 zera o total.
- **RN-016 — Cupom acompanha o conteúdo do carrinho.** Quando o carrinho volta a Vazio (remoção do último item), o cupom aplicado é removido. Se o subtotal cair abaixo do pedido mínimo depois de o cupom já estar aplicado, o cupom permanece aplicado; a conformidade só é verificada na confirmação (RN-011). Nesse caso o desconto exibido continua calculado pela RN-015 sobre o subtotal atual.
- **RN-017 — Pedido mínimo.** Cada cupom tem um pedido mínimo em centavos (0 significa sem mínimo), comparado ao subtotal antes do desconto.

### Estados

- **RN-018 — Edição por estado.** Itens só podem ser alterados em Vazio (adicionar o primeiro item) e Com Itens. Em Em Checkout, só é possível aplicar ou remover cupom, voltar a editar, confirmar ou abandonar. Pedido Criado e Abandonado são finais e rejeitam qualquer operação de escrita (`INVALID_CART_STATE`).
- **RN-019 — Abandono.** Só carrinhos Com Itens e Em Checkout podem ser abandonados. Um carrinho Vazio não tem o que abandonar e permanece Vazio (divergência entre o texto "Any state → Abandoned" e o diagrama do documento de alto nível, resolvida a favor do diagrama).
- **RN-020 — Timeout por inatividade.**
  - Um carrinho em Com Itens ou Em Checkout cuja última escrita foi há mais tempo que o timeout configurado é considerado abandonado.
  - A avaliação é feita no momento do acesso (leitura ou tentativa de escrita) e não por processo em segundo plano. Ao detectar, o sistema grava o estado Abandonado e responde conforme esse estado: uma escrita é recusada com `INVALID_CART_STATE`; uma leitura devolve o carrinho Abandonado.
  - Qualquer escrita bem-sucedida (adicionar, atualizar, remover item, aplicar ou remover cupom, iniciar checkout, voltar a editar) reinicia o contador. A leitura não reinicia.
  - O timeout é configurável. Valores de referência: 600 segundos (10 minutos) em desenvolvimento e 10 segundos no ambiente de teste.
- **RN-021 — Atomicidade da confirmação.** A confirmação (RF-011) é indivisível. Ou todos os efeitos acontecem (pedido criado, estoque decrementado, cupom marcado como usado, carrinho em Pedido Criado) ou nenhum.
- **RN-022 — Irreversibilidade.** Pedido Criado não transita para nenhum outro estado.

### Interface

- **RN-023 — Mensagens de erro.** Todo código de erro da API tem uma mensagem em pt-BR exibida ao cliente. Em `INSUFFICIENT_STOCK` na confirmação, a mensagem lista cada item problemático com a quantidade pedida e a disponível. Códigos desconhecidos e `INTERNAL_ERROR` exibem uma mensagem genérica, sem detalhes internos.
- **RN-024 — O servidor é a autoridade.** A interface esconde ou desabilita controles apenas por conveniência; as regras são sempre aplicadas pelo servidor. Após qualquer erro de estado (`INVALID_CART_STATE`, inclusive por timeout), a interface recarrega o carrinho e exibe o estado real. A interface não renova o contador de inatividade ao exibir ou recarregar o carrinho (RN-020).

## 5. Dados de Entrada

| Operação | Campo | Tipo | Obrigatório | Validações | Origem |
| --- | --- | --- | --- | --- | --- |
| Todas (menos RF-001) | id do carrinho | inteiro positivo | Sim | Deve existir (`CART_NOT_FOUND`) | Cliente (devolvido em RF-001) |
| RF-003 | id do produto | inteiro positivo | Sim | Produto deve existir (`PRODUCT_NOT_FOUND`) | Cliente |
| RF-003 | quantidade | inteiro | Sim | ≥ 1 (RN-002); resultado ≤ estoque (RN-005) | Cliente |
| RF-004, RF-005 | id do produto | inteiro positivo | Sim | Deve haver linha para o produto no carrinho (`CART_ITEM_NOT_FOUND`) | Cliente |
| RF-004 | quantidade | inteiro | Sim | ≥ 1 (RN-002); ≤ estoque (RN-005) | Cliente |
| RF-006 | código do cupom | texto | Sim | Normalizado e com formato da RN-014 | Cliente |
| RF-011 | (nenhum além do id) | n/a | n/a | n/a | n/a |

Dados de cadastro do cupom (origem: seed):

| Campo | Tipo | Regra |
| --- | --- | --- |
| Código | texto | Único após normalização (RN-014) |
| Tipo | percentual ou fixo | Obrigatório |
| Valor | inteiro | Percentual: 1 a 100. Fixo: centavos, > 0 |
| Pedido mínimo | inteiro, centavos | ≥ 0 |
| Data de expiração | data e hora | Obrigatório; o cupom é válido até esse instante |
| Usado | indicador | Parte do estado do cupom; a vinculação ao pedido que o consumiu é registrada na criação do pedido |

**Validação de entrada em geral:**
- Campos obrigatórios ausentes, de tipo errado (texto onde se espera número, decimal onde se espera inteiro) ou fora da faixa resultam em `VALIDATION_ERROR`, sem alterar o carrinho.
- Valores monetários são inteiros em centavos em toda a interface.

## 6. Estados e Transições

### Tabela de transições

| Estado atual | Ação | Condição | Novo estado | Efeitos |
| --- | --- | --- | --- | --- |
| (início) | Criar carrinho (RF-001) | n/a | Vazio | |
| Vazio | Adicionar item (RF-003) | RN-005 ok | Com Itens | Linha criada com preço congelado |
| Com Itens | Adicionar item (RF-003) | RN-005 ok | Com Itens | Linha criada ou somada |
| Com Itens | Atualizar quantidade (RF-004) | RN-002 e RN-005 ok | Com Itens | |
| Com Itens | Remover item (RF-005) | Restam itens | Com Itens | |
| Com Itens | Remover item (RF-005) | Era o último | Vazio | Cupom removido (RN-016) |
| Com Itens | Aplicar ou remover cupom (RF-006, RF-007) | RN-010 ou cupom aplicado | Com Itens | |
| Com Itens | Iniciar checkout (RF-008) | n/a | Em Checkout | Itens bloqueados |
| Em Checkout | Aplicar ou remover cupom (RF-006, RF-007) | RN-010 ou cupom aplicado | Em Checkout | |
| Em Checkout | Voltar a editar (RF-009) | n/a | Com Itens | Cupom mantido |
| Em Checkout | Confirmar pedido (RF-011) | RN-011 e RN-009 ok | Pedido Criado | Pedido criado, estoque decrementado, cupom usado |
| Em Checkout | Confirmar pedido (RF-011) | Falha em RN-011 ou RN-009 | Em Checkout | Nenhuma alteração |
| Com Itens, Em Checkout | Abandonar (RF-010) ou timeout (RN-020) | n/a | Abandonado | Cupom não consumido |
| Pedido Criado, Abandonado | Qualquer escrita | n/a | (inalterado) | Erro `INVALID_CART_STATE` |
| Vazio | Abandonar | n/a | (inalterado) | Erro `INVALID_CART_STATE` (RN-019) |

### Operações proibidas por estado

| Operação | Vazio | Com Itens | Em Checkout | Pedido Criado | Abandonado |
| --- | --- | --- | --- | --- | --- |
| Adicionar item | Sim | Sim | Não | Não | Não |
| Atualizar quantidade, remover item | Não | Sim | Não | Não | Não |
| Aplicar ou remover cupom | Não | Sim | Sim | Não | Não |
| Iniciar checkout | Não | Sim | Não | Não | Não |
| Voltar a editar | Não | Não | Sim | Não | Não |
| Confirmar pedido | Não | Não | Sim | Não | Não |
| Abandonar | Não | Sim | Sim | Não | Não |

Uma operação não permitida no estado atual retorna `INVALID_CART_STATE` e não altera o carrinho. Operações de leitura são permitidas em todos os estados.

## 7. Edge Cases e Tratamento de Erros

| Cenário | Comportamento esperado | Código de erro |
| --- | --- | --- |
| Carrinho inexistente | Recusa | `CART_NOT_FOUND` |
| Produto inexistente ao adicionar | Recusa | `PRODUCT_NOT_FOUND` |
| Item inexistente no carrinho ao atualizar ou remover | Recusa | `CART_ITEM_NOT_FOUND` |
| Quantidade 0, negativa, decimal ou não numérica | Recusa, carrinho inalterado | `VALIDATION_ERROR` |
| Quantidade acima do estoque (ou produto com estoque 0) | Recusa, carrinho inalterado | `INSUFFICIENT_STOCK` |
| Somar a um item existente ultrapassa o estoque | Recusa, linha mantém a quantidade anterior | `INSUFFICIENT_STOCK` |
| Operação em estado que não a permite | Recusa | `INVALID_CART_STATE` |
| Carrinho inativo além do timeout | Estado gravado como Abandonado; escrita recusada, leitura devolve Abandonado | `INVALID_CART_STATE` (escrita) |
| Código de cupom ausente ou com formato inválido | Recusa | `VALIDATION_ERROR` |
| Cupom inexistente | Recusa | `COUPON_NOT_FOUND` |
| Cupom expirado | Recusa | `COUPON_EXPIRED` |
| Cupom já usado em outro pedido | Recusa (ao aplicar e na confirmação) | `COUPON_ALREADY_USED` |
| Subtotal abaixo do pedido mínimo | Recusa (ao aplicar e na confirmação) | `COUPON_MIN_ORDER_NOT_MET` |
| Segundo cupom no mesmo carrinho | Recusa; o cliente deve remover o atual | `COUPON_ALREADY_APPLIED` |
| Remover cupom sem cupom aplicado | Recusa | `COUPON_NOT_APPLIED` |
| Aplicar cupom em carrinho Vazio | Recusa | `INVALID_CART_STATE` |
| Cupom fixo maior que o subtotal | Desconto limitado ao subtotal; total 0 | n/a |
| Cupom expira entre aplicar e confirmar | Confirmação recusada; carrinho continua Em Checkout | `COUPON_EXPIRED` |
| Dois carrinhos com o mesmo cupom; o primeiro confirma | O segundo falha na confirmação; pode remover o cupom e confirmar sem ele | `COUPON_ALREADY_USED` |
| Estoque zerou depois de adicionar ao carrinho | Confirmação falha por inteiro; erro lista os itens, nada é alterado | `INSUFFICIENT_STOCK` |
| Duas confirmações simultâneas disputando o último item | Uma vence e a outra falha por estoque insuficiente (RN-008) | `INSUFFICIENT_STOCK` |
| Carrinho abandonado por timeout enquanto o cliente está na tela | A próxima escrita é recusada; a interface recarrega e exibe o carrinho Abandonado com "Novo carrinho" (RN-024) | `INVALID_CART_STATE` |
| Id de carrinho guardado no navegador não existe mais | O id é descartado; o cliente fica sem carrinho (RF-015) | `CART_NOT_FOUND` |
| Falha inesperada no meio da confirmação | Nada é persistido (RN-021); o carrinho permanece Em Checkout | `INTERNAL_ERROR` |
| Preço do produto muda após adicionar | O carrinho mantém o preço congelado | n/a |
| Remover o último item com cupom aplicado | Carrinho volta a Vazio e o cupom é removido | n/a |
| Subtotal cai abaixo do mínimo depois de aplicar | Cupom permanece até a confirmação, que falha se o mínimo não for atendido | `COUPON_MIN_ORDER_NOT_MET` (na confirmação) |

Mensagens ao usuário seguem o contrato de erro da API: `{ "error": { "code": "...", "message": "..." } }`. Erros inesperados retornam `INTERNAL_ERROR` sem detalhes internos. O mapeamento para status HTTP fica para o blueprint técnico.

## 8. Fora do Escopo

- Ciclo de vida do Pedido após a criação (Criado → Confirmado → Enviado → Entregue; cancelamento). O Pedido é apenas criado com status inicial **Criado**.
- Consulta e listagem de Pedidos além do necessário para devolver o pedido criado na confirmação.
- Autenticação, autorização e propriedade do carrinho por usuário.
- Pagamento real e notificações.
- Reserva de estoque (ao adicionar ao carrinho ou ao iniciar o checkout).
- Cupons cumulativos, limite de usos por cupom diferente de 1 e cupons por usuário.
- Criação, edição e remoção de cupons por interface ou API (cadastro via seed).
- Abandono por processo em segundo plano.
- Paginação, busca e remoção física de carrinhos antigos.

## 9. Premissas e Dependências

**Premissas**
1. Os cupons são cadastrados por seed, e o conjunto de cupons do seed cobre os casos: percentual, fixo, expirado, com pedido mínimo e já usado.
2. Iniciar o checkout (RF-008) não verifica estoque; a verificação definitiva é feita só na confirmação.
3. O timeout de abandono é configurável: 600 segundos em desenvolvimento e 10 segundos no ambiente de teste. Nos testes automatizados de unidade e integração, o relógio é injetável, sem espera real.
4. O desconto exibido ao visualizar o carrinho é sempre calculado sobre o subtotal atual (RN-015), mesmo que o pedido mínimo tenha deixado de ser atendido (RN-016).
5. Abandonar um carrinho não devolve estoque (nunca foi reservado) nem consome o cupom.
6. Valores monetários são inteiros em centavos; os identificadores são inteiros seriais.

**Dependências**
- Listagem de Produtos (produtos com preço e estoque).
- Cadastro de cupons (seed) e entidade de Pedido e Item do Pedido (criados por esta funcionalidade, sem ciclo de vida posterior).
- Banco de dados com suporte a transações e a bloqueio de linhas, para atender RN-008 e RN-021.
- Contrato de erros e de API do projeto (`AGENTS.md`).

## 10. Questões em Aberto

1. **Consulta de Pedidos:** este FRD só cria o Pedido. Se uma consulta de Pedido por id será necessária antes do FRD do ciclo de vida é uma decisão futura.
2. **Exposição de cupons ao cliente:** não há endpoint para listar cupons disponíveis; a interface usa um campo de texto para o código. Listar cupons disponíveis precisa de decisão futura.
3. **Limpeza de carrinhos abandonados:** não há política de retenção ou remoção; pode virar requisito se o volume crescer.
