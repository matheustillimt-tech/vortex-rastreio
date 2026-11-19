# Vórtex Rastreio — arquitetura

> Documento técnico, para quem quer entender ou mudar o código. Para instalar, use o [INSTALACAO.md](../INSTALACAO.md).
> "Rastro" é o nome técnico usado no código: schema `rastro` no banco, roles `rastro_app`/`rastro_user`,
> função `rastro(...)` do script e variáveis `RASTRO_*`.

## 1. Stack escolhida e por quê

| Camada | Escolha | Motivo |
|---|---|---|
| App + API | **Next.js 16 (App Router) + TypeScript** | Um único deploy serve painel, API de coleta (`/api/collect`), webhooks e o script de rastreamento. Route Handlers rodam como funções serverless (custo ~zero em baixo volume). |
| Estilo | **Tailwind CSS v4** + tokens CSS próprios | Tema claro/escuro por variáveis, sem biblioteca de componentes pesada. |
| Gráficos | **Recharts** | Leve, SSR-friendly via client components, suficiente para séries temporais e barras. |
| Banco + Auth | **Supabase, schema próprio `rastro`** · local: **PGlite** em `.data/` | Funciona num projeto só seu ou num projeto que já tem outras tabelas; RLS por workspace; `UNIQUE` para idempotência. Acesso por `postgres.js` com role dedicada `rastro_app` (nunca service_role). |
| Validação | **zod** | Todo payload externo (script, webhook, API de anúncios) é validado na borda. |
| Testes | **Vitest** (+ jsdom para o script) | Rápido, sem config pesada. |

Alternativas descartadas no MVP: ClickHouse/Tinybird (só compensa com milhões de eventos/mês), Redis/fila dedicada (a tabela `webhook_events` já funciona como fila de reprocessamento), ORM (SQL direto nas migrations é mais transparente para RLS).

## 2. Visão geral

```
Página de venda ──(t.js)──► POST /api/collect ──► sessions / events
      │  (decora links do checkout com sck=<visitor_id>)
      ▼
Checkout (Kiwify) ──webhook──► POST /api/webhooks/{provedor}/{token}
                                   │ 1. autentica (token da URL + assinatura)
                                   │ 2. grava webhook_events (dedupe_key UNIQUE)
                                   │ 3. normaliza → orders (UNIQUE provider+external_id)
                                   │ 4. atribui: sck/src → visitor → sessão (observada)
                                   ▼
Meta Ads Insights API ──sync diário──► ad_insights_daily
                                   ▼
                     Dashboard (KPIs, campanhas, vendas)
```

## 3. Escopo atual

**Dentro**
- Painel: KPIs (vendas por status, faturamento bruto/líquido, investimento, CPA, CPC, CTR, CPM, ROAS, lucro estimado), gráfico diário, tabela de campanhas, tabela de vendas, filtros (período, campanha, produto, plataforma).
- Script `t.js`: UTMs, `fbclid`/`gclid`/`ttclid`, ids de campanha/conjunto/anúncio via macros de URL, pageview, lead, evento customizado, `event_id` para deduplicação, consentimento (LGPD), decoração de links de checkout.
- API de coleta com validação, CORS por site, rate limit e dedupe.
- Webhook Kiwify: autenticação, idempotência, ordem de status monotônica (um `refunded` não volta a `approved`), atribuição observada.
- Cliente Meta Ads Insights (leitura, `ads_read`), normalização e cálculo de métricas. **Sem chamada real até haver token autorizado.**
- Schema Postgres com RLS, criptografia de credenciais (AES-256-GCM) e retenção.

**Fora (fases seguintes)**: Google Ads, TikTok Ads, Hotmart, Mercado Pago, WhatsApp, Conversions API (envio de eventos de volta para Meta), regras automáticas, multiusuário com convites, atribuição estimada.

## 4. Modelo de atribuição

Cada pedido recebe **um** `attribution_method`:

| Método | Tipo | Como |
|---|---|---|
| `click_id` | **Observada** | O checkout devolveu nosso `visitor_id` em `sck`/`src`; ligamos à última sessão com origem paga desse visitante dentro da janela (30 dias). |
| `utm` | **Observada** | O checkout devolveu UTMs no pedido, mas sem visitante conhecido. Atribui à campanha das UTMs. |
| `unattributed` | — | Nenhum sinal. Aparece em "sem origem", nunca é distribuído entre campanhas. |
| `estimated` | **Estimada** (futuro) | Modelagem (ex.: proporcional a cliques). Será exibida separada e marcada; nunca somada às observadas sem rótulo. |

Regra: **último clique pago** (last paid touch) dentro da janela. O painel mostra a contagem por método para que a pessoa saiba quanto da receita é observada.

## 5. Segurança e LGPD

- **Isolamento**: schema `rastro` fora da Data API; toda tabela tem `workspace_id`. Leituras do painel rodam como `rastro_user` com o id do usuário em `request.jwt.claims` (RLS por workspace). Ingestão roda como `rastro_app`, que só alcança as tabelas de ingestão do schema `rastro`.
- **Credenciais**: tokens de API ficam em `integrations.credentials_encrypted` com AES-256-GCM (`ENCRYPTION_KEY` só no ambiente). O token do webhook é guardado como hash SHA-256.
- **Webhooks**: URL com token aleatório por integração + verificação da assinatura do provedor (comparação em tempo constante). Payload bruto guardado **sem PII** (nome, CPF, telefone, endereço removidos).
- **Idempotência**: `webhook_events.dedupe_key` UNIQUE; `orders (workspace_id, provider, external_id)` UNIQUE; `events (site_id, event_id)` UNIQUE.
- **Falhas**: evento gravado como `received` antes de processar; erro vira `failed` com `attempts`/`next_retry_at` (backoff exponencial) para reprocessamento.
- **Minimização**: e-mail do comprador só como SHA-256 normalizado (útil para CAPI); sem IP completo; sem nome/CPF/telefone. Eventos de navegação expiram em 13 meses (`purge_old_tracking_data`).
- **Consentimento**: o script pode exigir consentimento (`data-consent="required"`) e só grava cookie/envia eventos após `rastro('consent', true)`.
- **Logs**: `logger` redige chaves sensíveis (token, email, cpf, phone, authorization…).

## 6. Organização do código

```
src/
  app/(app)/          páginas do painel (dashboard, campanhas, vendas, integrações, rastreamento, configurações)
  app/api/collect     ingestão do script
  app/api/webhooks/   um handler por provedor
  components/         UI (layout, kpis, gráficos, tabelas)
  lib/domain/         tipos e regras puras (métricas, atribuição, status) — 100% testável
  lib/tracking/       parsing de UTMs/click ids, schema do evento
  lib/integrations/   um módulo por provedor (kiwify, meta-ads, …) com normalização isolada
  lib/security/       criptografia, assinatura, rate limit, logger
  lib/db/             conexão (postgres.js em produção, PGlite local), asApp/asUser, runner de migrations
  lib/store/          ingestão sobre Postgres (memória só em testes unitários)
  lib/workspace/      leituras e configurações do usuário (sempre via RLS)
  lib/demo/           dados demonstrativos determinísticos
public/t.js           script de rastreamento (sem dependências)
supabase/migrations/  schema rastro + RLS (aplicar com supabase db push, sempre na ordem)
db/preflight.sql      checagem opcional, só leitura · db/rollback/ desfaz cada migração
db/ops/               SQL do primeiro workspace (gerado por scripts/primeiro-workspace.mjs)
db/local/             só banco local e testes (imitação mínima do Supabase + dados de desenvolvimento)
```

Para adicionar um provedor de checkout: criar um adaptador em `lib/integrations/adapters/{provedor}.ts` (autenticação + leitura do payload → pedido normalizado) e registrá-lo em `lib/integrations/adapters/index.ts`. A rota `app/api/webhooks/[provider]/[token]` já atende qualquer adaptador registrado. O resto (idempotência, atribuição, painel) é reaproveitado.

O **Laboratório** (`/laboratorio`) cria um workspace separado do tipo `sandbox` com vendas, visitas e gasto de anúncios fictícios, para testar o painel sem conta real. As funções que apagam dados só funcionam em workspace `sandbox`.
