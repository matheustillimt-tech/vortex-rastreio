# Instalação do Vórtex Rastreio (passo a passo manual)

Este guia instala o Vórtex Rastreio nas **suas** contas, do zero. Se preferir que o Claude Code faça com você,
use o [PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md): ele segue exatamente esta ordem.

Tempo estimado: 40 a 60 minutos na primeira vez.

> **Regra de ouro:** chave, senha e token nunca vão pra chat, e-mail ou grupo. Eles ficam no arquivo
> `.env.local` e na pasta `.secrets/` do seu computador (os dois ficam fora do Git) e nas variáveis da Vercel.

---

## 1. Contas

| Conta | Pra quê | Plano grátis? |
|---|---|---|
| [GitHub](https://github.com) | Guardar o seu código | Sim |
| [Supabase](https://supabase.com) | Banco de dados (Postgres) e login do painel | Sim (500 MB). Projeto grátis parado por uma semana é pausado |
| [Vercel](https://vercel.com) | Colocar o painel, a coleta e os webhooks no ar | Sim (Hobby), com cron só 1x por dia. Uso comercial pede o Pro |
| [Kiwify](https://kiwify.com.br) | Checkout que manda os avisos de venda | É a sua conta de vendas (sem custo extra) |
| [Meta for Developers](https://developers.facebook.com) (opcional) | Ler o investimento das campanhas do Meta Ads | Sim |

No computador: **Node.js 24** (22 ou mais novo costuma funcionar), **Git**, a **CLI do Supabase** e a **CLI da Vercel**.

```bash
node -v
git --version
brew install supabase/tap/supabase   # Mac. No Windows: https://supabase.com/docs/guides/cli
npm i -g vercel
```

## 2. Baixar o código

```bash
git clone https://github.com/matheustillimt-tech/vortex-rastreio.git
cd vortex-rastreio
npm install
```

### (Opcional) Ver funcionando antes de criar as contas

```bash
npm run dev
```

Abra http://localhost:3000/dashboard. Sem configuração o app roda em **modo local**: banco no próprio computador
(pasta `.data/`), sem login, com um botão "Ver demonstração com dados fictícios" e o **Laboratório**, que gera vendas,
visitas e gasto de anúncio de mentira para você entender o painel. Pare com `Ctrl + C` quando terminar.

O Laboratório precisa de uma chave pra cifrar os dados dele. Crie um arquivo `.env.local` só com ela (o app continua
em modo local) e rode `npm run dev` de novo:

```bash
echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" > .env.local
```

## 3. Supabase: criar o projeto e aplicar o banco

1. Em supabase.com, crie um **projeto novo só para o Vórtex Rastreio**. Região: **South America (São Paulo)**.
   Anote a senha do banco num lugar seguro.
2. Anote o **id do projeto**: são as 20 letras do endereço `https://ID.supabase.co` (também aparece em
   Project Settings › General).
3. Anote o endereço do **Transaction pooler**: botão **Connect** (no topo) › aba **Connection String** › método
   **Transaction pooler**. O endereço fica entre o `@` e o `:6543`, algo como `aws-0-sa-east-1.pooler.supabase.com`.
4. No terminal, dentro da pasta do projeto:

   ```bash
   supabase login
   supabase link --project-ref ID-DO-PROJETO      # pede a senha do banco: digite no terminal
   supabase db push                               # aplica supabase/migrations/0001 a 0006, na ordem
   ```

   O que as migrações criam: um schema (área separada do banco) chamado `rastro`, com todas as tabelas protegidas
   por RLS (regras que fazem cada pessoa ver só os dados do próprio workspace), e 3 roles (usuários do banco)
   exclusivas do app: `rastro_app`, `rastro_app_prod` e `rastro_user`. Nada fica exposto na API pública do Supabase.

> "Rastro" é o **nome técnico** usado dentro do código e do banco (schema, roles, a função `rastro(...)` do script e
> as variáveis `RASTRO_*`). Não troque: o nome que aparece na tela é configurável (veja a seção 9).

## 4. Credenciais do banco (sem mostrar segredos)

O app **não usa** a senha do `postgres` nem a chave `service_role`. Ele entra no banco com a role própria
`rastro_app_prod`, que só alcança as tabelas do schema `rastro`. O script abaixo gera a senha dela e os outros segredos.

1. Crie o arquivo de variáveis local e abra:

   ```bash
   cp .env.example .env.local
   open -e .env.local      # Mac. No Windows: notepad .env.local
   ```

2. Cole **só** a chave pública em `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase › Project Settings › API Keys ›
   `anon` ou `publishable`). Deixe `NEXT_PUBLIC_SUPABASE_URL` e `DATABASE_URL` vazios aqui: assim o seu computador
   continua em modo local. Salve.
3. Gere as variáveis de produção:

   ```bash
   node scripts/gerar-env-producao.mjs --ref ID-DO-PROJETO --pooler-host ENDERECO-DO-POOLER
   ```

   Ele cria, sem mostrar nada na tela:
   - `.secrets/producao.env`: as variáveis que vão para a Vercel;
   - `.secrets/rastro_app_prod_password.sql`: um comando `ALTER ROLE` com o **hash** da senha (não a senha).
4. Abra `.secrets/rastro_app_prod_password.sql`, copie tudo, cole no **SQL Editor** do Supabase e clique em **Run**.
5. Confira a conexão (só leitura, não grava nada):

   ```bash
   node scripts/verify-connection.mjs --env .secrets/producao.env
   ```

   Tem que terminar com "Todas as verificações passaram".

## 5. Variáveis de ambiente

| Nome | Pra que serve | Onde pegar | Obrigatória? |
|---|---|---|---|
| `DATABASE_URL` | Conexão do app com o banco, pela role `rastro_app_prod` e o pooler (porta 6543) | Gerada em `.secrets/producao.env` | **Sim** em produção |
| `NEXT_PUBLIC_SUPABASE_URL` | Endereço do seu projeto, usado no login | Gerada (`https://ID.supabase.co`) | **Sim** em produção |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública do login (não é segredo) | Project Settings › API Keys (copiada do `.env.local`) | **Sim** em produção |
| `ENCRYPTION_KEY` | Cifra os tokens da Kiwify e da Meta no banco (32 bytes em base64) | Gerada. **Guarde**: se trocar, os tokens salvos precisam ser colados de novo | **Sim** |
| `CRON_SECRET` | Protege as rotas de agendamento `/api/cron/*` (a Vercel envia sozinha) | Gerada | **Sim** em produção |
| `META_API_VERSION` | Versão da API de anúncios da Meta | Padrão `v23.0` | Não |
| `RASTRO_ENABLE_META` | `1` liga a conexão com a Meta Ads | Você decide | Não (só para usar Meta Ads) |
| `RASTRO_LAB_ADMIN_IDS` | Ids de quem pode usar o Laboratório em produção (separados por vírgula) | Supabase › Authentication › Users › coluna UID | Não |
| `NEXT_PUBLIC_BRAND_NAME` | Nome exibido no painel e na aba do navegador | Você decide (padrão "Vórtex Rastreio") | Não |
| `RASTRO_LOCAL` | `1` força o modo local no seu computador, mesmo com o `.env.local` preenchido | Você decide | Não (nunca em produção) |

## 6. Publicar na Vercel

1. Suba o código para um repositório **privado** seu no GitHub. Antes do primeiro push, rode `git status` e confira
   que `.env.local` e `.secrets/` **não** aparecem.
2. Na Vercel: **Add New › Project** › importe o repositório. Framework: Next.js (detectado sozinho).
3. **Environment Variables:** abra `.secrets/producao.env`, copie as linhas e cole na tela de variáveis (a Vercel aceita
   colar o arquivo inteiro). Ambiente: **Production**.
4. **Crons:** o `vercel.json` agenda duas rotas: `/api/cron/retry-webhooks` (reprocessa avisos de venda que falharam,
   a cada 30 minutos) e `/api/cron/sync-meta` (busca o investimento da Meta, a cada 6 horas).
   - No plano **Hobby** a Vercel só aceita cron 1x por dia e a publicação **falha** com os horários acima. Troque no
     `vercel.json` `"*/30 * * * *"` por `"0 12 * * *"` e `"20 */6 * * *"` por `"20 6 * * *"`, faça commit e publique.
   - O `vercel.json` também fixa a região `gru1` (São Paulo), perto do banco. Se o seu Supabase estiver em outra
     região, troque ou apague essa linha.
5. Clique em **Deploy** e anote o endereço (ex.: `https://seu-projeto.vercel.app`, ou o seu domínio).
6. No Supabase › **Authentication › URL Configuration**, coloque esse endereço em **Site URL**.

Pelo terminal, se preferir: `vercel link` e depois `vercel env add NOME production` para cada variável (cole o valor
quando ele pedir, nunca no chat).

## 7. Criar o primeiro administrador

O painel não tem tela de cadastro: quem entra é criado por você no Supabase e ligado a um workspace (o espaço da sua
empresa dentro do painel).

1. Supabase › **Authentication › Users › Add user › Create new user**: seu e-mail, uma senha forte e marque
   **Auto Confirm User**.
2. No terminal:

   ```bash
   node scripts/primeiro-workspace.mjs --email voce@exemplo.com --nome "Minha Empresa"
   ```

   Ele gera `.secrets/primeiro-workspace.sql` (não conecta em nada).
3. Abra esse arquivo, copie tudo, cole no **SQL Editor** e clique em **Run**. Ele cria o workspace, coloca você como
   dono e cadastra um "Site de teste". Se o e-mail não existir ou não estiver confirmado, ele para com um aviso.
4. Recomendado: em **Authentication › Sign In / Providers**, desligue **Allow new users to sign up**. Assim ninguém cria
   conta sozinho pela API pública do Supabase (mesmo que criasse, ficaria sem acesso a nenhum workspace).
5. Entre no endereço publicado com o seu e-mail e senha.

## 8. Ligar as integrações

Roteiro resumido em [docs/ATIVAR-INTEGRACOES.md](docs/ATIVAR-INTEGRACOES.md).

1. **Script nas páginas:** painel › **Sites** › edite o "Site de teste" (ou cadastre o seu) com os **domínios
   autorizados** e copie o código. Cole antes de `</head>` nas páginas de venda e captura. O código já vem com
   `data-consent="required"`: o script só grava cookie depois que o seu banner de cookies chamar
   `rastro('consent', true)` (LGPD). Se você não tem banner, tire esse atributo sabendo do risco.
2. **Parâmetros nos anúncios:** painel › **Rastreamento** mostra o texto para colar nos parâmetros de URL dos anúncios
   (Meta, Google, TikTok).
3. **Kiwify:** siga [docs/GUIA-KIWIFY.md](docs/GUIA-KIWIFY.md). Resumo: gerar a URL no painel › criar o webhook na
   Kiwify › colar o token da Kiwify no painel › "Testar webhook".
4. **Meta Ads (opcional):** coloque `RASTRO_ENABLE_META=1` na Vercel, faça um novo deploy e siga
   [docs/GUIA-META-ADS.md](docs/GUIA-META-ADS.md) (token de usuário do sistema com `ads_read`).
5. **Kirvano:** o adaptador está pronto mas recusa vendas reais até a autenticação da Kirvano ser confirmada (a
   documentação dela não diz onde o token chega). Hotmart, Payt, Pagtrust e Perfect Pay aparecem como "previstas".

## 9. Personalizar

- **Nome na tela:** variável `NEXT_PUBLIC_BRAND_NAME` (depois, novo deploy). O código fica em `src/lib/brand.ts`.
- **Logo:** `src/components/brand.tsx` (um SVG simples).
- **Cores:** `src/app/globals.css` (variáveis de tema claro e escuro).
- **Custos para o lucro estimado:** painel › **Configurações** › Custos.
- **Limpeza de dados antigos (LGPD):** o banco tem a função `rastro.purge_old_tracking_data()`, que apaga visitas e
  eventos com mais de 13 meses e esvazia o conteúdo bruto dos webhooks com mais de 90 dias. Ela não roda sozinha:
  rode `select rastro.purge_old_tracking_data();` no SQL Editor de vez em quando, ou agende no Supabase › Integrations ›
  Cron (pg_cron), por exemplo uma vez por semana.

## 10. Checklist de teste

- [ ] `supabase db push` aplicou 0001 a 0006 sem erro.
- [ ] `node scripts/verify-connection.mjs --env .secrets/producao.env` terminou com "Todas as verificações passaram".
- [ ] O login no endereço publicado funciona e o painel abre sem aviso de "Atualização do banco pendente".
- [ ] Abrindo uma página sua com o script (com `?utm_source=teste`), o evento aparece em **Rastreamento**.
- [ ] Na Kiwify, "Testar webhook" deixa a integração como **Assinatura validada** e o pedido de teste aparece em **Vendas**.
- [ ] Na Vercel, **Settings › Cron Jobs** mostra `/api/cron/retry-webhooks` e `/api/cron/sync-meta`.
- [ ] (Se ligou a Meta) Em **Campanhas**, o investimento bate com o Gerenciador de Anúncios no mesmo período.

## 11. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `supabase db push` para com "execute como postgres" | A CLI entrou com outra role. Rode cada arquivo de `supabase/migrations/` na ordem, colando no SQL Editor (lá você é `postgres`). |
| `supabase db push` para com "role rastro_app/rastro_user já existe" ou "schema rastro já existe" | O banco já tem uma instalação anterior. Use um projeto novo, ou desfaça com os arquivos de `db/rollback/` (apagam os dados do app). |
| Publicação na Vercel falha falando de cron | Plano Hobby: troque os horários do `vercel.json` (seção 6). |
| Painel mostra "Sem acesso a um workspace" | O seu usuário não foi ligado a um workspace: refaça a seção 7 com o mesmo e-mail. |
| Painel mostra "Atualização do banco pendente" | Falta migração: rode `supabase db push` de novo. |
| `verify-connection` falha em "autenticou" | O `ALTER ROLE` da seção 4 não foi rodado, ou o `--pooler-host`/`--ref` está errado. Gere de novo com `--force` e rode o `.sql` novo. |
| Kiwify: o estado não vira "Assinatura validada" (e a Saúde das integrações conta eventos "Inválidos") | O token salvo no painel não é o desse webhook. Copie de novo na Kiwify e salve. |
| No computador: "Tokens de integração no banco real só podem ser salvos..." | De propósito: com `DATABASE_URL` no `.env.local`, só a produção grava tokens (cada ambiente tem a sua `ENCRYPTION_KEY`). Salve pelo painel publicado. |
| Formulário da Meta bloqueado | Falta `RASTRO_ENABLE_META=1` na Vercel e um novo deploy. |
| Script não registra visitas | Confira os domínios autorizados do site, a chave `data-key` e se o consentimento foi dado (`rastro('consent', true)`). |

### Rodar no computador ligado ao Supabase de verdade (opcional, avançado)

`node scripts/setup-credentials.mjs --ref ID --pooler-host ENDERECO` grava no `.env.local` uma conexão com a role
`rastro_app` (outra senha, separada da de produção) e cria `.secrets/rastro_app_password.sql` para rodar no SQL Editor.
Depois preencha `NEXT_PUBLIC_SUPABASE_URL` no `.env.local`. Para voltar ao modo local sem apagar nada: `RASTRO_LOCAL=1 npm run dev`.
