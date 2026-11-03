# Relatório de revisão de segurança

Revisão estática (Red Team em papel) do repositório inteiro, contra a OWASP Top 10, feita com o skill `security-review`. Nada foi explorado em runtime. A validação das correções depende de `make test` e dos testes manuais abaixo, executados pelo desenvolvedor.

## O que já estava correto

- SQL injection: Drizzle parametrizado, sem `sql.raw`.
- Validação: Zod em todas as rotas, ids e quantidades limitados a int32, preço sempre lido do banco.
- Concorrência: estoque e cupom com `FOR UPDATE`, mais constraints no banco.
- XSS: o frontend usa só `textContent`, sem `innerHTML`.
- Erros 500 sem stack nem detalhes; containers sem root; portas publicadas só em `127.0.0.1`.

## Achados e tratamento

| # | Severidade | OWASP | Achado | Tratamento |
|---|------------|-------|--------|------------|
| 1 | Alta | A04 | Sem rate limiting: criação ilimitada de carrinhos e esgotamento de estoque sem pagamento | Corrigido: `express-rate-limit` no backend (global e mais estrito em `POST /api/carts` e `/coupon`) (limite por IP, configurável por variável de ambiente). Novo erro `RATE_LIMITED` 429 |
| 2 | Alta | A01 | IDOR: o id serial do carrinho é a única credencial | **Risco aceito.** Auth está fora de escopo e o `id` serial é contrato (AGENTS.md); projeto educacional sem CI/CD. Para uso real: token opaco por carrinho ou autenticação |
| 3 | Alta/Média | A05 | O seed de demonstração (cupons de 100% até 2099) rodava no Compose base com `NODE_ENV=production` | Corrigido: `seed.ts` não carrega dados quando `NODE_ENV=production` (sai com código 0, para o `migrate` não falhar) |
| 4 | Média | A05 | Sem helmet no backend; nginx sem CSP, `Permissions-Policy` e `server_tokens off` | Corrigido: `helmet()` no `app.ts`; CSP restritiva, `Permissions-Policy` e `server_tokens off` no nginx |
| 5 | Média | A04 | Enumeração de códigos de cupom | Mitigado pelo limite estrito em `/coupon`. As mensagens distintas (`NOT_FOUND`/`EXPIRED`/`USED`) seguem, porque fazem parte do contrato |
| 6 | Média | A04 | `preço × quantidade` podia estourar o int32 e gerar 500 na confirmação | Corrigido: `addItem` e `updateItemQuantity` retornam `VALIDATION_ERROR` 400 acima de 2.147.483.647 centavos |
| 7 | Média/Baixa | A05 | Proxy e servidor sem timeouts, sem `X-Forwarded-*` e sem `trust proxy` | Corrigido: timeouts e `client_max_body_size` no nginx; `headersTimeout`/`requestTimeout` no servidor; `statement_timeout` no pool; `trust proxy` 1 com `X-Forwarded-For` sobrescrito pelo nginx |
| 8 | Baixa | A09 | `console.error(err)` pode registrar a query SQL e seus parâmetros (erro do Drizzle) | Corrigido: `describeError` registra só nome, primeira linha da mensagem e código |
| 9 | Baixa | A05 | `make up` mantém `POSTGRES_PASSWORD=change-me` | Mitigado: `make up` avisa quando a senha ainda é `change-me` |
| 10 | Baixa | A06/A08 | Lockfiles apontam para registries internos; imagens fixadas por tag, não por digest | **Não alterado.** Recomendação: regenerar os lockfiles contra o registry público e avaliar digests |

## Limites e observações

- O limite do backend é em memória, por instância. Com mais de uma réplica, cada uma conta separado.
- Em dev, o backend também responde direto em `127.0.0.1:3000`. Nesse caminho o `X-Forwarded-For` vem do cliente e permite escapar do limite por IP. Pelo nginx não, porque ele sobrescreve o header.
- `.env.test` define limites altos (100000/min), porque o E2E envia tudo de um IP só. O nginx não limita requisições: um `limit_req` com `rate=100r/s burst=200` foi tentado e derrubou 4 testes E2E com 429 em HTML, porque os workers do Playwright passam desse ritmo. O controle fica só no backend.
## Auditoria de dependências (`npm audit`)

Executada pelo desenvolvedor, com Node 22.

- **Backend, produção (`npm --prefix backend audit --omit=dev`):** 0 vulnerabilidades. Isso inclui `helmet`, `express-rate-limit` e `ip-address`, adicionados nesta revisão.
- **Backend, completo:** 7 (5 moderadas, 2 críticas), todas em dependências de desenvolvimento:
  - `tinypool <=2.1.1` (crítica, prototype pollution com RCE por opções de worker) e `@vitest/mocker` (moderada), ambos via `vitest`;
  - `esbuild <=0.24.2` (moderada, servidor de desenvolvimento aceita requisições de qualquer site), via `drizzle-kit`.
- **Raiz (ferramentas de lint):** 12 moderadas, todas cadeia do `minimatch <11.0.1` (DoS por glob) no ESLint/typescript-eslint.
- **Risco aceito:** nenhum desses pacotes entra na imagem de produção. Os ataques exigem controle das opções do worker, de mocks ou do servidor de desenvolvimento, e o ambiente de testes é efêmero e local.
- **Não usar `npm audit fix --force`:** ele faz downgrade do `eslint` para 4.0.0 e do `drizzle-kit` para 0.18.1 e sobe o `vitest` para a 5.x, o que quebraria o lint, as migrations e os testes. O tratamento é manutenção planejada: atualizar `vitest` (≥ 4.1.11) e `drizzle-kit` quando houver versão compatível, ou usar `overrides`.

## Verificação sugerida

```bash
curl -sI http://localhost:8080/ | grep -iE 'content-security|permissions|server'
curl -sI http://localhost:8080/api/products | grep -iE 'content-security|strict-transport|x-content-type'
# Passa de 30 criações de carrinho em 1 minuto: a 31ª deve responder 429 RATE_LIMITED
for i in $(seq 1 35); do curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8080/api/carts; done | sort | uniq -c
```
