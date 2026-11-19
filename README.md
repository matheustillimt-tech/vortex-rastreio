# Vórtex Rastreio

Painel de **rastreamento e atribuição de vendas** que você instala nas suas contas: liga **anúncio → visita → venda**
e mostra faturamento, ROAS, CPA e lucro por campanha, conjunto e anúncio.

## O que ele faz

- **Script de rastreamento** (`t.js`, ~4 KB, sem dependências) para colar nas suas páginas de venda e captura: guarda
  UTMs, `fbclid`/`gclid`/`ttclid`, ids de campanha, conjunto e anúncio, registra visita, lead e início de checkout, e
  marca os links do checkout com o visitante (`sck`) para ligar a venda à visita.
- **Avisos de venda do checkout (webhooks)**: Kiwify pronta (compra aprovada, recusada, reembolsada, chargeback, PIX e
  boleto gerados), com verificação de assinatura, sem duplicar venda e sem um reembolso "voltar" a aprovado.
  Kirvano com adaptador pronto, aguardando a confirmação da autenticação.
- **Investimento do Meta Ads**: lê gasto, impressões e cliques (só leitura, permissão `ads_read`) a cada 6 horas.
- **Painel**: faturamento bruto e líquido, investimento, ROAS, CPA, CPC, CTR, CPM e lucro estimado, gráfico diário,
  filtros por período, campanha, produto e plataforma.
- **Campanhas, Conjuntos e Anúncios**: uma aba para cada nível, com vendas atribuídas ao lado das vendas que a Meta reporta.
- **Vendas**: lista de pedidos com status e de onde veio cada um.
- **Sites**: cada site com a sua chave e os domínios autorizados a enviar eventos.
- **Rastreamento**: código de instalação, parâmetros de URL prontos para Meta, Google e TikTok, e os últimos eventos.
- **Integrações** e **Saúde das integrações**: estado de cada conexão, eventos recebidos, recusados e com erro por dia.
- **Custos**: custo por venda e custos fixos para o lucro estimado.
- **Laboratório**: um espaço separado com vendas, visitas e gasto de anúncio **fictícios** para testar o painel sem conta real.
- **Privacidade (LGPD)**: e-mail do comprador só como código embaralhado (hash), sem nome, CPF, telefone ou IP; modo de
  consentimento no script; função pronta no banco para apagar visitas com mais de 13 meses (você roda ou agenda).

## Como funciona

1. O script nas suas páginas registra a visita e de qual anúncio ela veio.
2. Quando a pessoa compra, a Kiwify avisa o painel (webhook) e o painel liga a venda à visita (último clique pago, janela de 30 dias).
3. A cada 6 horas o painel busca na Meta quanto você investiu em cada campanha, conjunto e anúncio.
4. O painel cruza tudo: quanto entrou, quanto custou e o lucro estimado de cada anúncio.

Venda sem nenhum sinal de origem aparece como "sem origem": nunca é distribuída entre campanhas por estimativa.

## Com o que é feito

- **Next.js 16** (React) + TypeScript + Tailwind CSS: o painel, a coleta (`/api/collect`) e os webhooks num só lugar
- **Supabase**: banco Postgres (schema próprio `rastro`, com RLS) e login
- **postgres.js** (no servidor) e **PGlite** (banco no próprio computador, para testar sem conta)
- **Recharts** (gráficos), **zod** (validação), **Vitest** (testes)
- **Vercel**: hospedagem, com 2 agendamentos (cron)

## De quais contas você precisa

| Conta | Pra quê | Tem plano grátis? |
|---|---|---|
| [GitHub](https://github.com) | Guardar o seu código | Sim |
| [Supabase](https://supabase.com) | Banco de dados e login | Sim (500 MB). Projeto grátis parado por uma semana é pausado |
| [Vercel](https://vercel.com) | Colocar o painel no ar | Sim (Hobby), mas lá os agendamentos rodam só 1x por dia, e uso comercial pede o Pro |
| [Kiwify](https://kiwify.com.br) | O seu checkout, que avisa cada venda | É a sua conta de vendas |
| [Meta for Developers](https://developers.facebook.com) (opcional) | Ler o investimento do Meta Ads | Sim |
| Domínio próprio (opcional) | Ex.: `rastreio.seu-dominio.com.br`, sofre menos bloqueio que `*.vercel.app` | Não (registro anual) |

## Instalar com o Claude Code

Abra o **Claude Code** (aba **Code**) numa **pasta vazia**, cole o prompt abaixo e siga a conversa. Ele confere o que
falta no seu computador, baixa o código, te guia em cada conta (uma de cada vez), cria o banco, publica, cria o seu
acesso de administrador e roda o checklist. Ele nunca vai pedir pra você colar senha ou chave no chat.

```text
Você vai instalar o Vórtex Rastreio comigo, do zero, nesta pasta (que está vazia). O Vórtex Rastreio é um
painel de rastreamento e atribuição de vendas: um script nas minhas páginas de venda, os avisos de venda do
checkout (Kiwify) e o investimento do Meta Ads viram faturamento, ROAS, CPA e lucro por campanha e anúncio.
Repositório: https://github.com/matheustillimt-tech/vortex-rastreio
O passo a passo completo está no arquivo INSTALACAO.md do repositório: leia-o depois de baixar o código
e siga a mesma ordem.

Eu não sou programador. Explique cada passo em português simples, com frases curtas, e espere eu
confirmar antes de ir pro próximo.

REGRAS (siga sempre):
1. NUNCA me peça pra colar chave, senha, token ou segredo aqui no chat. Quando eu precisar colocar um
   valor secreto, abra o arquivo pra mim (ex.: `open -e .env.local` no Mac, `notepad .env.local` no
   Windows) e me diga em qual linha colar. Segredos gerados pelos scripts do projeto ficam em
   .secrets/ e no .env.local: nunca mostre o conteúdo desses arquivos na tela.
2. Nunca faça commit de .env.local nem da pasta .secrets/ (o .gitignore já cobre: confira com
   `git status` antes de qualquer push).
3. Uma conta por vez: me diga o site, o que clicar e o que copiar, e espere eu dizer "pronto".
4. Se der erro, me explique o erro numa frase e proponha a correção antes de tentar de novo.
5. Nunca rode comandos que apaguem dados (ex.: `supabase db reset`, os arquivos de db/rollback/) sem me
   perguntar. Migração nova vai sempre no fim da fila, nunca edite uma que já foi aplicada.

PASSOS:
1. Pré-requisitos: confira se tenho Node.js 24 (`node -v`; 22 ou mais novo costuma funcionar), Git
   (`git --version`), a CLI do Supabase (`supabase --version`) e a CLI da Vercel (`vercel --version`).
   Instale o que faltar (Mac: Homebrew, ex.: `brew install supabase/tap/supabase`; Windows: me passe o
   instalador oficial e espere).
2. Baixe o código nesta pasta: `git clone https://github.com/matheustillimt-tech/vortex-rastreio.git .`
   e depois `npm install`.
3. (Opcional, recomendo) Mostre funcionando no meu computador antes de criar contas: `npm run dev` e abra
   http://localhost:3000/dashboard. Sem configuração ele roda em "modo local", com um banco no próprio
   computador e o botão de demonstração com dados fictícios. Mostre também o Laboratório. Depois pare o
   servidor.
4. Supabase (banco de dados e login, plano grátis): me guie pra criar a conta em supabase.com e um
   projeto NOVO só pra isso (região São Paulo). Eu escolho e guardo a senha do banco. Me ajude a achar o
   id do projeto (as 20 letras de https://ID.supabase.co) e o endereço do "Transaction pooler" (botão
   Connect, algo como aws-0-sa-east-1.pooler.supabase.com).
5. Banco: rode `supabase login`, depois `supabase link --project-ref ID` (eu digito a senha do banco no
   terminal, não no chat) e `supabase db push`. Confira que as 6 migrações (0001 a 0006) foram aplicadas.
6. Credenciais: rode `cp .env.example .env.local` e abra o .env.local pra eu colar só a chave pública
   (anon/publishable) em NEXT_PUBLIC_SUPABASE_ANON_KEY (Project Settings › API Keys). Deixe
   NEXT_PUBLIC_SUPABASE_URL e DATABASE_URL vazios no .env.local (assim o computador continua em modo
   local). Depois rode
   `node scripts/gerar-env-producao.mjs --ref ID --pooler-host ENDERECO-DO-POOLER`.
   Ele cria .secrets/producao.env (variáveis da Vercel) e .secrets/rastro_app_prod_password.sql (só o hash
   da senha). Me guie pra abrir o .sql, copiar tudo e rodar no SQL Editor do Supabase.
   Depois rode `node scripts/verify-connection.mjs --env .secrets/producao.env` e me diga se passou.
7. Primeiro administrador: me guie no Supabase › Authentication › Users › Add user › Create new user
   (meu e-mail, uma senha forte que eu digito lá, marcando "Auto Confirm User"). Pergunte o e-mail e o
   nome da minha empresa e rode `node scripts/primeiro-workspace.mjs --email MEU-EMAIL --nome "MINHA EMPRESA"`.
   Me guie pra abrir .secrets/primeiro-workspace.sql, copiar e rodar no SQL Editor. Depois sugira desligar
   o cadastro aberto (Authentication › Sign In / Providers › "Allow new users to sign up").
8. GitHub: crie um repositório PRIVADO na minha conta e suba o código (use `gh` se eu tiver; se não, me
   guie pelo site). Antes do push, confira com `git status` que .env.local e .secrets/ NÃO estão indo.
9. Vercel: me guie pra criar a conta (entrar com o GitHub) e importar o repositório. Pergunte qual plano
   eu vou usar. No Hobby (grátis) a Vercel só aceita cron uma vez por dia: nesse caso troque no
   vercel.json "*/30 * * * *" por "0 12 * * *" e "20 */6 * * *" por "20 6 * * *" e faça commit antes de
   publicar. Variáveis: as do .secrets/producao.env. Jeito mais simples: eu abro o arquivo, copio as
   linhas e colo na tela de variáveis da Vercel (ela aceita colar o arquivo inteiro). Se eu preferir pelo
   terminal, rode um laço que lê o arquivo e passa cada valor pro `vercel env add NOME production` sem
   imprimir nada. Publique e me dê o link. No Supabase › Authentication › URL Configuration, coloque esse
   link em Site URL.
10. Teste do login: eu entro no link publicado com o e-mail e a senha do passo 7 e vejo o painel.
11. Integrações, uma de cada vez, perguntando se eu quero:
    - Sites e script: em Sites, conferir o "Site de teste" (ou cadastrar o meu com os domínios
      autorizados) e me mostrar onde colar o código antes do </head> das minhas páginas.
    - Kiwify: seguir docs/GUIA-KIWIFY.md comigo (gerar a URL no painel, criar o webhook na Kiwify, eu
      colo o token direto no painel, "Testar webhook").
    - Meta Ads: seguir docs/GUIA-META-ADS.md comigo. Antes, coloque RASTRO_ENABLE_META=1 na Vercel
      (`vercel env add RASTRO_ENABLE_META production`) e publique de novo. Eu colo o token direto no painel.
    - Laboratório em produção (opcional): pegue o meu id em Authentication › Users e coloque em
      RASTRO_LAB_ADMIN_IDS na Vercel.
    - Nome próprio no painel (opcional): NEXT_PUBLIC_BRAND_NAME. Depois de mudar variável, novo deploy.
12. Checklist final, comigo, no endereço publicado (está no INSTALACAO.md): login, painel sem erro,
    evento chegando em Rastreamento depois de abrir uma página com o script, "Assinatura validada" na
    Kiwify depois do teste, e os 2 crons aparecendo na Vercel em Settings › Cron Jobs.
```

Prefere fazer na mão? Siga o **[INSTALACAO.md](INSTALACAO.md)**.

## Rodar no seu computador (sem conta nenhuma)

```bash
npm install
npm run dev     # abre em http://localhost:3000/dashboard
```

Sem `.env.local` o app roda em **modo local**: banco PGlite na pasta `.data/`, sem login, com dados de demonstração
e o Laboratório. Para conferir o código: `npm run check` (tipos, lint, testes e build).

## Estrutura de pastas

```
public/t.js                    script de rastreamento (vai nas suas páginas)
src/app/(app)/                 telas do painel (dashboard, campanhas, vendas, sites, rastreamento, integrações, laboratório...)
src/app/api/collect            recebe os eventos do script
src/app/api/webhooks/          recebe os avisos de venda ([provider]/[token])
src/app/api/cron/              reprocessa webhooks com falha e sincroniza a Meta
src/lib/domain                 regras de métricas, atribuição e status
src/lib/integrations           Kiwify, Kirvano, Meta Ads
src/lib/security               criptografia, logs sem dados sensíveis, limite de requisições
src/lib/db, store, workspace   conexão com o banco, gravação e leituras com RLS
supabase/migrations/           banco (aplicado com supabase db push, na ordem)
db/                            rollback, checagem prévia, primeiro workspace e o banco local de testes
scripts/                       geração de credenciais, primeiro workspace e verificação da conexão
docs/                          arquitetura e guias da Kiwify e do Meta Ads
tests/                         testes (Vitest)
```

Mais detalhes técnicos em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Licença

[MIT](LICENSE): pode usar, mudar e vender, mantendo o aviso de copyright.

---

Feito pelo Grupo Vórtex · entregue na Plataforma Vórtex IA
