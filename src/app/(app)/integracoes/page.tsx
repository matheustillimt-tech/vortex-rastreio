import { AlertTriangle, CheckCircle2, Clock, PauseCircle, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, NoWorkspace, Notice, PageHeader, SchemaPending } from "@/components/ui";
import { requireWorkspace } from "@/lib/dashboard/load";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { dateTime } from "@/lib/format";
import { listIntegrations, type IntegrationView } from "@/lib/workspace/repo";
import { setIntegrationStatusAction } from "./actions";
import { KiwifySecretForm, KiwifyWebhookForm, MetaForm } from "./kiwify-form";

export const metadata: Metadata = { title: "Integrações" };

/** Estado sempre com ícone + texto (cor nunca sozinha). */
function kiwifyState(i: IntegrationView) {
  if (i.status === "paused") return { icon: PauseCircle, color: "text-fg-3", text: "Pausada: eventos são recusados" };
  if (!i.hasSigningSecret && i.allowUnsigned) {
    return { icon: AlertTriangle, color: "text-warning", text: "Modo desenvolvimento: aceita eventos sem assinatura (só no banco local)" };
  }
  if (!i.hasSigningSecret) return { icon: ShieldAlert, color: "text-warning", text: "Aguardando token de assinatura: não recebe eventos" };
  // um evento válido limpa o erro; se há erro, ele é o mais recente
  if (i.lastError) {
    return { icon: AlertTriangle, color: "text-critical", text: `Último problema: ${i.lastError}` };
  }
  if (i.lastEventAt) return { icon: CheckCircle2, color: "text-good", text: `Assinatura validada · último evento em ${dateTime(i.lastEventAt)}` };
  return { icon: Clock, color: "text-fg-2", text: "Pronta: aguardando o primeiro evento assinado" };
}

function metaState(i: IntegrationView) {
  if (i.status === "paused") return { icon: PauseCircle, color: "text-fg-3", text: "Pausada" };
  if (i.syncStartedAt) return { icon: Clock, color: "text-fg-2", text: `Sincronizando desde ${dateTime(i.syncStartedAt)}` };
  if (i.lastError) return { icon: AlertTriangle, color: "text-critical", text: i.lastError };
  if (i.lastSyncAt) return { icon: CheckCircle2, color: "text-good", text: `Última sincronização: ${dateTime(i.lastSyncAt)}` };
  return { icon: Clock, color: "text-fg-2", text: "Aguardando a primeira sincronização" };
}

const LATER = [
  { name: "Kirvano", detail: "Adaptador pronto; recusa entregas até a autenticação oficial ser confirmada numa compra de teste." },
  { name: "Hotmart", detail: "Postback 2.0; autenticação a confirmar na documentação oficial." },
  { name: "Payt e Pagtrust", detail: "Adaptadores previstos; autenticação a confirmar na documentação oficial." },
  { name: "Mercado Pago", detail: "Notificações com assinatura x-signature." },
  { name: "Google Ads", detail: "Custo e cliques via Google Ads API (requer developer token)." },
  { name: "TikTok Ads", detail: "Relatórios via TikTok Marketing API." },
  { name: "WhatsApp", detail: "Links de clique com código de rastreio + registro da venda." },
];

export default async function IntegrationsPage() {
  const ctx = await requireWorkspace();
  if (ctx.kind === "no-workspace") return <NoWorkspace />;
  if (ctx.kind === "schema-pending") return <SchemaPending />;
  const isAdmin = ctx.membership.role !== "viewer";
  const all = await listIntegrations(await getDb(), ctx.userId, ctx.membership.workspaceId);
  const kiwify = all.filter((i) => i.provider === "kiwify");
  const meta = all.filter((i) => i.provider === "meta");

  return (
    <>
      <PageHeader title="Integrações" description="Fontes de vendas (checkouts) e de investimento (anúncios)">
        <Link href="/integracoes/saude" className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-medium text-fg-2 hover:text-fg">
          Ver saúde das integrações
        </Link>
      </PageHeader>
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Kiwify" description="Vendas, pendências, recusas, reembolsos e chargebacks por webhook assinado (HMAC-SHA1)" />
          <div className="flex flex-col gap-4 p-5">
            {kiwify.length === 0 && <p className="text-sm text-fg-2">Nenhuma integração Kiwify ainda.</p>}
            {kiwify.map((i) => {
              const st = kiwifyState(i);
              const Icon = st.icon;
              return (
                <div key={i.id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{i.label ?? "Kiwify"}</p>
                      <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-fg-2">
                        <Icon size={14} className={st.color} aria-hidden="true" /> {st.text}
                      </p>
                      {i.signingSecretRotatedAt && (
                        <p className="mt-1 text-xs text-fg-3">Token trocado em {dateTime(i.signingSecretRotatedAt)} (o anterior vale por 48 h).</p>
                      )}
                    </div>
                    {isAdmin && (
                      <form action={setIntegrationStatusAction}>
                        <input type="hidden" name="integrationId" value={i.id} />
                        <input type="hidden" name="status" value={i.status === "paused" ? "active" : "paused"} />
                        <button type="submit" className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-fg-2 hover:text-fg">
                          {i.status === "paused" ? "Reativar" : "Pausar"}
                        </button>
                      </form>
                    )}
                  </div>
                  <KiwifySecretForm integrationId={i.id} hasSecret={i.hasSigningSecret} disabled={!isAdmin} />
                </div>
              );
            })}
            <div className="border-t border-border pt-4">
              <p className="mb-2 text-sm font-medium">Nova integração Kiwify</p>
              <KiwifyWebhookForm disabled={!isAdmin} />
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-fg-2">
                <li>Gere a URL e cadastre-a na Kiwify em Apps › Webhooks, escolhendo os eventos de compra, reembolso e chargeback.</li>
                <li>Copie o token que a Kiwify mostra nesse webhook e salve aqui. Sem ele, a integração recusa tudo.</li>
                <li>Use “Testar Webhook” na Kiwify: o estado acima deve mudar para “Assinatura validada”.</li>
              </ol>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Meta Ads" description="Investimento, impressões e cliques por campanha, conjunto e anúncio (sincronização diária)" />
          <div className="flex flex-col gap-4 p-5">
            {meta.map((i) => {
              const st = metaState(i);
              const Icon = st.icon;
              return (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
                  <span className="font-medium">{i.adAccountId ?? "Conta"}</span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-fg-2">
                    <Icon size={14} className={st.color} aria-hidden="true" /> {st.text}
                  </span>
                </div>
              );
            })}
            {!env.metaEnabled && (
              <Notice tone="warn">
                Conexão desligada: nenhuma chamada é feita à Meta. Para ligar, defina <code className="font-mono">RASTRO_ENABLE_META=1</code> nas variáveis
                da Vercel e publique de novo. Você vai precisar de um token da Meta com permissão <code className="font-mono">ads_read</code> (veja docs/GUIA-META-ADS.md).
              </Notice>
            )}
            <MetaForm enabled={env.metaEnabled && isAdmin} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Próximas integrações" />
          <ul className="divide-y divide-border">
            {LATER.map((l) => (
              <li key={l.name} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span className="font-medium">{l.name}</span>
                <span className="text-xs text-fg-2">{l.detail}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
