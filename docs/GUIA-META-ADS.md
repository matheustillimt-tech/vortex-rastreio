# Guia rápido: ligar o Meta Ads ao Vórtex Rastreio

**Para quem:** a pessoa que é **administradora do Gerenciador de Negócios (Business Manager)** onde fica a conta de anúncios.
**Tempo:** uns 10 minutos.
**O que muda:** o painel passa a ler o investimento, as impressões e os cliques de cada campanha, conjunto e anúncio, e cruza com as
vendas reais. É assim que aparecem ROAS, CPA e lucro por anúncio.

**O que o painel pode fazer com esse acesso:** só **ler** os números dos anúncios (permissão `ads_read`). Ele **não** cria, pausa,
edita anúncios nem mexe em orçamento ou forma de pagamento.

> Os nomes dos menus da Meta mudam de vez em quando. Se algum item estiver com nome um pouco diferente, procure o equivalente.

---

## Passo 1 — criar um app (uma vez só)

1. Acesse https://developers.facebook.com › **Meus apps** › **Criar app**.
2. Tipo: **Empresa** (Business). Nome: `Vortex Rastreio` (ou o nome que preferir).
3. Vincule ao **Gerenciador de Negócios** da sua empresa.
4. Não precisa publicar o app nem adicionar produtos além do que a Meta pedir por padrão.

## Passo 2 — criar o usuário do sistema

Usuário do sistema é uma "conta de robô" do Gerenciador de Negócios. O token dele **não expira em 60 dias** como o de uma pessoa.

1. Acesse https://business.facebook.com/settings › **Usuários** › **Usuários do sistema** › **Adicionar**.
2. Nome: `Vortex Rastreio` (ou o nome que preferir). Função: **Funcionário** (não precisa ser administrador).
3. Com o usuário criado, clique em **Atribuir ativos** › **Contas de anúncios** › marque a conta (ou as contas) que o painel deve ler.
4. Permissão: só **Ver desempenho**. Não marque "Gerenciar campanhas".
5. Ainda em **Atribuir ativos**, em **Apps**, adicione o app do passo 1.

## Passo 3 — gerar o token

1. No usuário do sistema que você criou, clique em **Gerar novo token**.
2. App: o do passo 1. Validade: **Nunca**.
3. Permissões: marque **somente `ads_read`**.
4. Clique em **Gerar** e **copie o token**. A Meta mostra ele uma única vez.

## Passo 4 — pegar o ID da conta de anúncios

No Gerenciador de Anúncios, o endereço mostra `act=123456789…`. O ID para o painel é esse número com `act_` na frente:
`act_123456789…`. (Também aparece em Configurações do negócio › **Contas de anúncios**.)

## Passo 5 — entregar ao painel

O token é **secreto**: com ele dá para ler todos os números da conta de anúncios.

- **Melhor caminho:** quem tem acesso ao painel cola direto no painel › **Integrações** › **Meta Ads**: `act_…` no primeiro campo, token no
  segundo. Ele é gravado cifrado e não aparece mais.
- Se precisar mandar para alguém, use **conversa privada** (nunca grupo) e apague a mensagem depois de salvo.

> Enquanto a conexão com a Meta estiver desligada (aviso amarelo na tela), o formulário fica bloqueado. Para ligar, coloque a
> variável `RASTRO_ENABLE_META=1` na Vercel (Settings › Environment Variables) e publique de novo (Deployments › Redeploy).

## Passo 6 — conferir

- O painel busca os últimos **30 dias** na primeira vez e depois atualiza **a cada 6 horas**.
- Em **Campanhas**, compare o investimento com o Gerenciador de Anúncios no mesmo período. Use as abas **Conjuntos** e **Anúncios** para
  descer de nível.
- "Vendas" é o que o painel atribuiu; "Vendas (plataforma)" é o que a Meta reporta pelo modelo dela. Diferença entre as duas é normal.

---

### Para tirar o acesso

Configurações do negócio › Usuários do sistema › (o usuário que você criou) › remover a conta de anúncios (ou **Revogar token**). O painel para de ler na
hora e mostra o erro na tela de integrações.
