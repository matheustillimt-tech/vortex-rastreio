@AGENTS.md

# Vórtex Rastreio — guia para o Claude Code

Template de rastreamento e atribuição de vendas: script `public/t.js` nas páginas de venda → coleta em
`/api/collect` → avisos de venda do checkout em `/api/webhooks/[provider]/[token]` → investimento do Meta Ads
(cron) → painel com faturamento, ROAS, CPA e lucro. Next.js 16 + Supabase (Postgres + Auth) + PGlite no modo local.
Quem usa normalmente **não é programador**: explique em português simples, passo a passo.

## Onde está cada coisa

- `public/t.js` — script de rastreamento (sem dependências; a função global se chama `rastro`).
- `src/app/(app)/` — telas do painel. `src/app/api/` — coleta, webhooks e crons. `src/app/login/` — login (Supabase Auth, só e-mail e senha).
- `src/lib/domain/` — regras puras (métricas, atribuição, status de pedido). Mexa aqui com teste.
- `src/lib/integrations/adapters/` — um adaptador por checkout (Kiwify, Kirvano), registrado em `index.ts`.
- `src/lib/integrations/meta-*.ts` — leitura da Meta Ads (`ads_read`).
- `src/lib/db/` — conexão (postgres.js em produção, PGlite local) e o executor de migrações.
- `src/lib/store/` — gravação da ingestão (role `rastro_app`). `src/lib/workspace/` — leituras do usuário (role `rastro_user` + RLS).
- `src/lib/brand.ts` — nome exibido (variável `NEXT_PUBLIC_BRAND_NAME`). `src/components/brand.tsx` — logo. `src/app/globals.css` — cores.
- `supabase/migrations/` — banco, aplicado com `supabase db push`. `db/rollback/` desfaz cada migração. `db/local/` só para PGlite e testes.
- `scripts/` — `gerar-env-producao.mjs`, `setup-credentials.mjs`, `primeiro-workspace.mjs`, `verify-connection.mjs` (nenhum imprime segredo).
- `docs/` — arquitetura e guias (Kiwify, Meta Ads, ativar integrações). Instalação: `INSTALACAO.md`.

## Nome técnico "rastro"

O produto se chama Vórtex Rastreio, mas o código usa `rastro` como nome técnico: schema `rastro`, roles
`rastro_app` / `rastro_app_prod` / `rastro_user`, a função `rastro(...)` do script, o prefixo `rst_` do visitante e as
variáveis `RASTRO_*`. **Não renomeie**: as migrações, as políticas de RLS, os testes e os sites que já têm o script dependem disso.
Para trocar o nome que aparece na tela, use `NEXT_PUBLIC_BRAND_NAME`.

## Como rodar

```bash
npm install
npm run dev                 # modo local se não houver .env.local (PGlite em .data/, sem login)
RASTRO_LOCAL=1 npm run dev  # força o modo local mesmo com .env.local preenchido
npm test                    # Vitest, um arquivo por vez (cada banco PGlite usa ~250 MB)
npm run check               # tipos + lint + testes + build
```

Build com pouca memória: `NODE_OPTIONS=--max-old-space-size=1536 npm run build`. Não rode build e testes ao mesmo tempo.

## Regras

- **Nunca versione** `.env`, `.env.local` nem a pasta `.secrets/`. Nunca mostre o conteúdo deles no chat; abra o
  arquivo para a pessoa colar o valor.
- **Migração nova sempre no fim da fila** (`supabase/migrations/0007_...sql`), com `begin;`/`commit;`, a checagem da
  versão anterior em `rastro.schema_migrations` e o `insert` da própria versão no fim, como as existentes. Crie também
  o `db/rollback/0007_down.sql`. Nunca edite uma migração que já foi aplicada.
- O app **nunca** usa `service_role` nem a senha do `postgres`: só as roles `rastro_*`. Não conceda nada a
  `anon`/`authenticated` no schema `rastro` (ele fica fora da Data API de propósito).
- Payload externo (script, webhook, Meta) é sempre validado com zod na borda. Logs passam pelo `logger` (que esconde
  token, e-mail, CPF, telefone).
- Não guarde dados pessoais do comprador: e-mail só como hash, sem nome, CPF, telefone ou IP.
- Comandos que apagam dados (`supabase db reset`, arquivos de `db/rollback/`) só com o OK explícito da pessoa.
- Se a Vercel estiver ligada ao repositório, **push na `main` publica em produção**. Rode `npm run check` antes.
