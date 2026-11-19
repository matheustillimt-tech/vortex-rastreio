# Guia rápido: ligar a Kiwify ao Vórtex Rastreio

**Para quem:** a pessoa que administra a conta da Kiwify (e quem administra o painel do Vórtex Rastreio, se for outra pessoa).
**Tempo:** uns 5 minutos.
**O que muda:** cada venda, PIX gerado, reembolso ou chargeback passa a chegar no painel na hora, com a origem (anúncio, campanha).
O painel **só recebe** avisos da Kiwify: ele não acessa a sua conta, não mexe em produtos nem em dinheiro.

---

## Parte 1 — no painel (quem administra o painel faz)

1. Entre no endereço do seu painel (ex.: `https://seu-dominio.com.br`) › **Integrações** › **Kiwify**.
2. Em "Nova integração Kiwify", dê um nome (ex.: `Kiwify · Minha Empresa`) e clique em **Gerar URL de webhook**.
3. A URL aparece **uma única vez**. Copie e envie para o responsável da Kiwify.
   A URL não é senha, mas também não deve ser publicada: mande direto para a pessoa.

## Parte 2 — na Kiwify (responsável pela conta faz)

1. Entre na Kiwify › **Apps** › **Webhooks** › **Criar webhook**.
2. Em **URL**, cole a URL recebida do painel.
3. Em **Produtos**, escolha **todos** (ou os que devem ser rastreados).
4. Marque estes gatilhos:
   - Compra aprovada
   - Compra recusada
   - Compra reembolsada
   - Chargeback
   - Boleto gerado
   - PIX gerado

   Os gatilhos de assinatura podem ficar marcados: o painel ignora o que não usa.
5. Salve. A Kiwify mostra um **token** para esse webhook. Ele é o que prova que o aviso veio mesmo da Kiwify.

## Parte 3 — o token (sem ele, o painel recusa tudo)

O token é secreto. O melhor caminho é **quem tem acesso ao painel colar ele direto lá**:

- No painel › **Integrações** › **Kiwify** › na integração criada, campo **"Cole o token do webhook"** › **Salvar token**.
- O token é gravado cifrado e não aparece mais na tela.

Se o responsável da Kiwify não tem acesso ao painel, mande o token **numa conversa privada** (nunca em grupo) e apague a mensagem depois que
ele for salvo.

## Parte 4 — conferir

1. Na Kiwify, no webhook criado, clique em **Testar webhook**.
2. No painel › **Integrações** (ou **Saúde das integrações**), o estado deve mudar para **"Assinatura validada"**, com o horário do último evento.
3. Se aparecer erro de assinatura, o token salvo não é o desse webhook: copie de novo na Kiwify e salve outra vez.

Pronto. A partir daqui, as vendas reais aparecem em **Vendas** e no **Painel**.

---

### Dúvidas comuns

- **Tenho mais de uma conta Kiwify.** Repita tudo para cada conta: cada uma ganha a sua URL e o seu token.
- **Troquei o token na Kiwify.** Salve o novo no painel. O anterior continua valendo por 48 horas, então nada se perde na troca.
- **Quero pausar.** No painel › Integrações › **Pausar**. Para voltar, **Reativar**.
