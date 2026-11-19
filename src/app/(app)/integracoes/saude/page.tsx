import { AlertTriangle, CheckCircle2, Clock, PauseCircle, PlugZap, ShieldAlert, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { Card, CardHeader, NoWorkspace, PageHeader, SchemaPending } from "@/components/ui";
import { requireWorkspace } from "@/lib/dashboard/load";
import { getDb } from "@/lib/db";
import { dateTime, int } from "@/lib/format";
import { listAdapters, PLANNED_PROVIDERS } from "@/lib/integrations/adapters";
import { healthState, isConnected, loadIntegrationHealth, type HealthCounts, type HealthState } from "@/lib/workspace/health";

export const metadata: Metadata = { title: "Saúde das integrações" };

/** Estado sempre com ícone + texto (cor nunca sozinha). */
const STATE_UI: Record<HealthState, { icon: typeof CheckCircle2; color: string; label: string }> = {
  healthy: { icon: CheckCircle2, color: "text-good", label: "Saudável" },
  waiting: { icon: Clock, color: "text-fg-2", label: "Aguardando" },
  attention: { icon: AlertTriangle, color: "text-warning", label: "Atenção" },
  failing: { icon: XCircle, color: "text-critical", label: "Falhando" },
  disconnected: { icon: PlugZap, color: "text-warning", label: "Desconectada" },
  blocked: { icon: ShieldAlert, color: "text-warning", label: "Bloqueada" },
  paused: { icon: PauseCircle, color: "text-fg-3", label: "Pausada" },
};

const COUNTS: Array<{ key: keyof HealthCounts; label: string }> = [
  { key: "received", label: "Recebidos" },
  { key: "processed", label: "Processados" },
  { key: "duplicates", label: "Duplicados" },
  { key: "ignored", label: "Ignorados" },
  { key: "failed", label: "Falhas" },
  { key: "authFailed", label: "Recusados (autenticação)" },
  { key: "invalid", label: "Inválidos" },
];

export default async function IntegrationHealthPage() {
  const ctx = await requireWorkspace();
  if (ctx.kind === "no-workspace") return <NoWorkspace />;
  if (ctx.kind === "schema-pending") return <SchemaPending />;
  const now = new Date();
  const all = await loadIntegrationHealth(await getDb(), ctx.userId, ctx.membership.workspaceId, now);
  const connected = all.filter((h) => isConnected(h)).length;
  const retriesHidden = all.some((h) => h.pendingRetries === null);
  const retries = all.reduce((s, h) => s + (h.pendingRetries ?? 0), 0);
  const platforms = [
    ...listAdapters().map((a) => ({ provider: a.provider, label: a.label, auth: a.auth, planned: false })),
    ...PLANNED_PROVIDERS.map((p) => ({ ...p, planned: true })),
  ];

  return (
    <>
      <PageHeader
        title="Saúde das integrações"
        description="Entregas recebidas das plataformas de checkout. “Hoje” e “7 dias” seguem o horário de Brasília."
      />
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Summary label="Conectadas" value={connected} />
          <Summary label="Desconectadas, bloqueadas ou pausadas" value={all.length - connected} />
          <Summary label="Retentativas pendentes" value={retriesHidden ? null : retries} />
        </div>

        {all.length === 0 && (
          <Card>
            <p className="p-5 text-sm text-fg-2">Nenhuma integração de checkout neste workspace. Crie uma em Integrações.</p>
          </Card>
        )}

        {all.map((h) => {
          const st = healthState(h, now);
          const ui = STATE_UI[st.state];
          const Icon = ui.icon;
          return (
            <Card key={h.id}>
              <CardHeader
                title={h.label ? `${h.providerLabel} · ${h.label}` : h.providerLabel}
                description={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Icon size={14} className={ui.color} aria-hidden="true" />
                    <span className="font-medium text-fg">{ui.label}</span>
                    <span>· {st.text}</span>
                  </span>
                }
              />
              <div className="flex flex-col gap-4 p-5">
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <Item label="Última entrega recebida" value={h.lastReceivedAt ? dateTime(h.lastReceivedAt) : "Nenhuma"} />
                  <Item label="Último evento válido" value={h.lastEventAt ? dateTime(h.lastEventAt) : "Nenhum"} />
                  <Item label="Retentativas pendentes" value={h.pendingRetries === null ? "Visível só para administradores" : int(h.pendingRetries)} />
                  <Item label="Falhas sem nova tentativa" value={h.failedPermanently === null ? "Visível só para administradores" : int(h.failedPermanently)} />
                </dl>
                <div className="min-w-0 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <caption className="sr-only">Contadores de entregas de {h.providerLabel}</caption>
                    <thead>
                      <tr className="text-left text-xs text-fg-3">
                        <th scope="col" className="py-1.5 pr-3 font-medium">Período</th>
                        {COUNTS.map((c) => (
                          <th key={c.key} scope="col" className="px-2 py-1.5 text-right font-medium">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {(
                        [
                          ["Hoje", h.today],
                          ["7 dias", h.last7d],
                        ] as const
                      ).map(([label, c]) => (
                        <tr key={label} className="border-t border-border">
                          <th scope="row" className="py-2 pr-3 text-left font-medium">
                            {label}
                          </th>
                          {COUNTS.map((k) => (
                            <td key={k.key} className="px-2 py-2 text-right">
                              {int(c[k.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          );
        })}

        <Card>
          <CardHeader
            title="Plataformas e autenticação"
            description="O token secreto da URL só localiza a integração. Cada plataforma precisa do seu mecanismo oficial de autenticação."
          />
          <ul className="divide-y divide-border">
            {platforms.map((p) => (
              <li key={p.provider} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{p.label}</span>
                <span className="text-xs text-fg-2">
                  {p.planned ? "Prevista, sem adaptador" : p.auth.documented ? "Autenticação oficial confirmada" : "Autenticação não confirmada: recusa entregas"}
                  {" · "}
                  {p.auth.method}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}

function Summary({ label, value }: { label: string; value: number | null }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-fg-2">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value === null ? "—" : int(value)}</p>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="mt-0.5 break-words">{value}</dd>
    </div>
  );
}
