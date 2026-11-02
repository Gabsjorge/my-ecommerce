# Relatório de Revisão — my-ecommerce (Scaffolding)

Referência: [scaffolding-specification.md](scaffolding-specification.md). Revisão feita em 2026-11-01, branch `chore/scaffolding`.

## Resumo

- Total de findings: 8 (0 críticos, 0 altos, 2 médios, 6 baixos). Os avisos de `npm audit` de desenvolvimento (abaixo) ficam como BAIXO, sem risco para produção
- Conformidade geral com a spec: **Alta**
- Avaliação de segurança: **Riscos menores** (corrigidos). Produção sem vulnerabilidades conhecidas; só tooling de dev tem avisos

## Findings

### [MÉDIO] Portas de dev publicadas em todas as interfaces

**Eixo**: Segurança
**Localização**: `docker-compose.dev.yml`, `docker-compose.test.local.yml`
**Problema**: db (`5433`), backend e frontend eram publicados em `0.0.0.0`; o Postgres com senha padrão `change-me` ficava acessível pela rede local.
**Correção aplicada**: prefixo `127.0.0.1:` em todas as portas publicadas; spec §7 atualizada.

### [MÉDIO] `nginx.conf` divergia da spec

**Eixo**: Conformidade
**Localização**: `frontend/nginx.conf`, spec §4 e §7
**Problema**: o código tem `location ~ ^/api/.+\.js$` (commit e92f8bf), necessário porque `frontend/src/api/` colide com o prefixo `/api/`. A spec não documentava a exceção.
**Correção aplicada**: código mantido; spec atualizada (§4 e §7).

### [BAIXO] `express.json()` sem uso

**Eixo**: Boas práticas
**Localização**: `backend/src/app.ts`
**Problema**: só existem rotas GET; corpo JSON malformado em qualquer rota resultaria em `500 INTERNAL_ERROR` em vez de `400`.
**Correção aplicada**: middleware removido. Ao introduzir rotas com corpo (Step 2), reintroduzir com tratamento de erro 400.

### [BAIXO] Header `X-Powered-By`

**Eixo**: Segurança
**Localização**: `backend/src/app.ts`
**Correção aplicada**: `app.disable('x-powered-by')` e teste de integração em `product.routes.integration.test.ts`.

### [BAIXO] nginx sem headers de segurança básicos

**Eixo**: Segurança
**Localização**: `frontend/nginx.conf`
**Correção aplicada**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` no nível `server`; spec §7 atualizada.

### [BAIXO] Árvore da spec incompleta

**Eixo**: Conformidade
**Localização**: spec §2
**Problema**: faltavam `docs/scaffolding-blueprint.md`, `seed.test.ts` e `seed.integration.test.ts`.
**Correção aplicada**: árvore atualizada.

### [BAIXO] Container `e2e` roda como root

**Eixo**: Segurança
**Localização**: `e2e/Dockerfile`
**Problema**: a imagem do Playwright roda como root por padrão.
**Decisão**: sem alteração. É um serviço só de teste e a spec define o Dockerfile assim.

### [BAIXO] Avisos de `npm audit` em dependências de desenvolvimento

**Eixo**: Segurança / Boas práticas
**Localização**: `package.json` (raiz) e `backend/package.json`; seção "Known `npm audit` warnings" do `README.md`
**Evidência**: `npm audit` executado pelo desenvolvedor (o agente não tem acesso ao registry corporativo).

| Pacote | `npm audit` | `npm audit --omit=dev` |
|---|---|---|
| raiz | 12 moderadas (`minimatch` via ESLint/typescript-eslint) | 0 |
| `backend/` | 7: 5 moderadas, 2 críticas (`tinypool`, `@vitest/mocker`, `esbuild` via `drizzle-kit`) | 0 |
| `frontend/` | 0 | 0 |
| `e2e/` | 0 | 0 |

**Problema**: nada vulnerável chega à imagem de produção. O `tinypool` crítico (prototype pollution → RCE) exige controle das opções de worker do test runner, o que não ocorre aqui. O `esbuild` antigo do `drizzle-kit` só afeta o servidor de desenvolvimento do esbuild, que o `generate` não usa. O README omitia os avisos da raiz e dizia que a correção era Vitest 4 (hoje é 5.x).
**Correção aplicada**: README reescrito com o estado real. `npm audit fix --force` **não** deve ser usado (propõe downgrades para `eslint@4` e `drizzle-kit@0.18`).
**Adiado por decisão do usuário**: atualizar Vitest (5.x) e `drizzle-kit`, que é breaking change.

## O que está correto

- Estrutura de diretórios e arquivos 100% presente conforme spec §2.
- Camadas Controller → Service → Repository respeitadas; só o repository importa `db/schema`; `process.env` lido só em `config/env.ts`.
- Contrato da API (envelope, erros, `priceCents` inteiro, `/health` 200/503) conforme spec.
- Schema com `generated always as identity` e `CHECK`s; migration commitada; seed idempotente com os 6 produtos.
- Dockerfiles multi-stage, usuário não-root (backend, frontend), imagens com versão fixada, `.dockerignore` em cada pacote, healthchecks e `depends_on` com condições.
- `@playwright/test` em versão exata (1.64.1), igual à imagem; `retries: 0`.
- Sem segredos no repositório; `.env` ignorado; `.env.test` só com valores descartáveis.
- Frontend: renderização por `textContent` (sem `innerHTML`), view sem `fetch`, `data-testid` conforme spec.
- Todos os casos de teste obrigatórios da spec §9 existem.

## Verificação

| Verificação | Resultado |
|---|---|
| `npm run lint` (ESLint), `format:check`, `tsc --noEmit` nos 3 pacotes | Passou (antes e depois das correções) |
| `vitest --project unit` (Node 22.15) | Passou: 11 testes |
| `make test-backend` (executado pelo desenvolvedor) | Passou: 6 arquivos, 19 testes (unit + integration, incluindo o teste de `X-Powered-By`); teardown ok |
| `make test-e2e` (executado pelo desenvolvedor) | Passou: 11 testes (5 api + 6 ui); stack sobe na ordem db → migrate → backend → frontend e é derrubada; o `migrate` `Exited` não bloqueou o `run` no Compose v2.13.0 |
| `make up` (critério 1) | Passou: db, backend e frontend `Healthy`, `migrate` `Exited` (`up --wait` do Compose v2.13.0 aceitou o one-shot); `make down` ok |
| `curl localhost:3000/health` e `curl localhost:8080/api/products` (critério 2) | Passou: `{"status":"ok"}` e envelope com `total: 6` |
| `curl -I localhost:8080` | Passou: headers `X-Content-Type-Options`, `X-Frame-Options` e `Referrer-Policy` presentes |
| `nc -vz 192.168.15.11 5433` / `nc -vz 127.0.0.1 5433` | Passou: conexão recusada pelo IP da rede, aceita em `127.0.0.1` (finding das portas confirmado) |
| `make test-env-up` + `make test-e2e-local` + `make test-env-down` (critério 7) | Passou: ambiente `ecommerce-test-local` saudável com a porta em `127.0.0.1`, 11 testes passando no host (2 workers), teardown ok |
| Quebra proposital do seed (critério 4) | Passou: com `stock: 0` trocado por `stock: 5`, o teste unitário "has at least one product out of stock" falhou, `make test` terminou com `exit=2` (parou no `test-backend`, sem rodar o E2E) e `docker ps -a --filter name=ecommerce-test` não listou containers; seed revertido |
| Pre-commit bloqueando erro de lint (critério 6) | Passou: commit com `const x = 1` (variável não usada) bloqueado pelo `lint-staged`/ESLint (`@typescript-eslint/no-unused-vars`), `exit=1`; arquivo temporário removido e árvore de trabalho intacta |
| `npm audit` | Executado pelo desenvolvedor (ver finding acima) |

Observações:

- O Node padrão do shell é 18.16; o projeto exige 22 (`.nvmrc`). O Vitest falha em Node 18. Use `nvm use`.
- Compose instalado: v2.13.0. O comportamento de `up --wait` com o `migrate` one-shot (spec §12) não foi confirmado.

## Próximos passos sugeridos

1. Futuramente: atualizar Vitest para 5.x e `drizzle-kit` (adiado).
2. Ao implementar o Step 2, reintroduzir `express.json()` com tratamento de JSON inválido (400).

Todos os critérios de aceite da spec §13 (1 a 7) foram verificados. Nenhuma alteração foi commitada.
