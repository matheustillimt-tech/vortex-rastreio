# Ligar as integrações (roteiro)

Pré-requisito: o painel publicado num endereço HTTPS público (a Vercel já entrega um `https://...vercel.app`; um domínio
próprio sofre menos bloqueio de extensões de privacidade). Passo a passo da instalação: [INSTALACAO.md](../INSTALACAO.md).

## 1. Kiwify (vendas)
Guia detalhado: [GUIA-KIWIFY.md](GUIA-KIWIFY.md).

1. No painel › **Integrações › Kiwify**, gere a URL de webhook. Ela aparece uma única vez: copie.
2. Na Kiwify › **Apps › Webhooks › Criar**: cole a URL e marque os gatilhos compra aprovada, compra recusada,
   compra reembolsada, chargeback, boleto gerado e PIX gerado. Os de assinatura podem ficar ligados: o painel ignora.
3. Copie o **token** que a Kiwify mostra nesse webhook e salve no painel (campo "Token de assinatura"). Ele fica gravado cifrado.
   Até isso ser feito, a integração recusa todos os eventos.
4. Na Kiwify, clique em **Testar webhook**. O estado no painel deve virar "Assinatura validada · último evento em …".
5. Confira em **Vendas** o pedido de teste.

> **Kirvano:** o adaptador já lê o formato oficial da Kirvano, mas recusa entregas reais até a forma de autenticação
> ser confirmada (a documentação da Kirvano não diz onde o token chega). Veja `src/lib/integrations/adapters/kirvano.ts`.

## 2. Script de rastreamento nos sites
1. Painel › **Sites**: cadastre cada site com os **domínios autorizados**. Sem domínio, a chave aceita qualquer origem.
2. Copie o código de instalação e cole antes de `</head>` nas páginas de venda e de captura.
3. Se você usa banner de cookies, depois do aceite chame `rastro('consent', true)` (LGPD).
4. Nos anúncios, cole os parâmetros de URL que aparecem na página **Rastreamento** (Meta, Google, TikTok).
5. Confira os eventos em **Rastreamento** e, numa compra, se o link do checkout leva o `sck=rst_…`.

## 3. Meta Ads (investimento por campanha, conjunto e anúncio)
Guia detalhado: [GUIA-META-ADS.md](GUIA-META-ADS.md).

1. Crie um app em developers.facebook.com (tipo Business) e gere um token com permissão **`ads_read`** para a conta de anúncios.
   Prefira o token de **usuário do sistema** (Gerenciador de Negócios), que não expira em 60 dias.
2. Coloque `RASTRO_ENABLE_META=1` nas variáveis da Vercel (ambiente Production) e publique de novo.
3. Painel › **Integrações › Meta Ads**: informe `act_…` e o token, que é gravado cifrado.
4. A rota `/api/cron/sync-meta` roda a cada 6 horas (`vercel.json`): na primeira vez busca 30 dias, depois só 3.
   Uma trava impede sincronizações sobrepostas e erros de limite aparecem na tela.
5. Em **Campanhas**, compare "Vendas" (atribuídas pelo painel) com "Vendas (plataforma)" (o que a Meta reporta).

## Conferir depois de ligar
- `node scripts/verify-connection.mjs --env .secrets/producao.env` confere se a role do banco só alcança o que deve (só leitura,
  não grava nada).
- Painel sem a faixa de demonstração e com números batendo com a Kiwify e o Gerenciador de Anúncios no mesmo período.
