import type { Metadata } from "next";
import { headers } from "next/headers";
import { Card, CardHeader, Code, NoWorkspace, Notice, PageHeader, SchemaPending } from "@/components/ui";
import { requireWorkspace } from "@/lib/dashboard/load";
import { getDb } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { listSites, recentEventsForUser } from "@/lib/workspace/repo";

export const metadata: Metadata = { title: "Rastreamento" };
export const dynamic = "force-dynamic";

const META_UTMS =
  "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}";
const GOOGLE_UTMS =
  "{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaignid}&utm_content={creative}&utm_term={keyword}&campaign_id={campaignid}&adset_id={adgroupid}&ad_id={creative}";
const TIKTOK_UTMS =
  "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__&campaign_id=__CAMPAIGN_ID__&adset_id=__AID__&ad_id=__CID__";

export default async function TrackingPage() {
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const ctx = await requireWorkspace();
  if (ctx.kind === "no-workspace") return <NoWorkspace />;
  if (ctx.kind === "schema-pending") return <SchemaPending />;
  const { userId, membership } = ctx;
  const db = await getDb();
  const [sites, events] = await Promise.all([
    listSites(db, userId, membership.workspaceId),
    recentEventsForUser(db, userId, membership.workspaceId, 15),
  ]);
  const site = sites.find((s) => s.status === "active");
  const siteKey = site?.publicKey ?? "pk_SEM_SITE_ATIVO";

  const snippet = `<script async src="${origin}/t.js"
  data-key="${siteKey}"
  data-consent="required"
  data-auto-lead="true"></script>

<!-- depois do aceite no seu banner de cookies: -->
<script>window.rastro=window.rastro||function(){(rastro.q=rastro.q||[]).push(arguments)};
rastro('consent', true);</script>`;

  return (
    <>
      <PageHeader title="Rastreamento" description="Instale o script nas páginas e padronize os parâmetros dos anúncios" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="1. Script nas páginas" description="Cole antes de </head> em todas as páginas de venda e captura" />
          <div className="flex flex-col gap-4 p-5">
            <Code>{snippet}</Code>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg-2">
              <li>Captura UTMs, fbclid/gclid/ttclid e ids de campanha, conjunto e anúncio.</li>
              <li>Registra visualização de página, lead e início de checkout, cada um com id único (sem duplicar).</li>
              <li>Acrescenta o identificador do visitante (<code className="font-mono">sck</code>) nos links do checkout para ligar a venda à visita.</li>
              <li>
                Com <code className="font-mono">data-consent=&quot;required&quot;</code> nada é gravado nem enviado antes do aceite (LGPD).
              </li>
              <li>Nunca envia nome, e-mail, telefone ou parâmetros de URL fora da lista acima.</li>
            </ul>
            <Notice>
              Chave do site <code className="font-mono">{siteKey}</code> ({site?.name ?? "nenhum site ativo"} · gerencie em Sites). Teste agora em{" "}
              <a className="font-medium text-brand underline" href="/lp-teste.html?utm_source=facebook&utm_medium=paid&utm_campaign=Teste&fbclid=teste123&campaign_id=111&ad_id=222">
                /lp-teste.html
              </a>{" "}
              e volte aqui para ver os eventos.
            </Notice>
          </div>
        </Card>

        <Card>
          <CardHeader title="2. Parâmetros de URL dos anúncios" description="Cole no campo de parâmetros de URL de cada plataforma" />
          <div className="flex flex-col gap-4 p-5">
            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-2">Meta Ads · Parâmetros de URL</p>
              <Code>{META_UTMS}</Code>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-2">Google Ads · Modelo de rastreamento</p>
              <Code>{GOOGLE_UTMS}</Code>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-fg-2">TikTok Ads · Parâmetros de URL</p>
              <Code>{TIKTOK_UTMS}</Code>
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Eventos recebidos"
            description="Últimos eventos gravados no banco deste workspace"
          />
          {events.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-fg-2">Nenhum evento ainda. Abra a página de teste para gerar alguns.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-[11px] uppercase tracking-wider text-fg-3">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Quando</th>
                    <th className="px-4 py-2.5 font-medium">Tipo</th>
                    <th className="px-4 py-2.5 font-medium">Página</th>
                    <th className="px-4 py-2.5 font-medium">Visitante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((e) => (
                    <tr key={e.eventId}>
                      <td className="tabular px-4 py-2.5 text-fg-2">{dateTime(e.occurredAt)}</td>
                      <td className="px-4 py-2.5">{e.name ?? e.type}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{e.path}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-fg-2">{e.visitorId.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
