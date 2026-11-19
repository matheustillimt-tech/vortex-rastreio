import type { Metadata } from "next";
import Link from "next/link";
import { AttributionBar } from "@/components/dashboard/attribution-bar";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiGrid, StatusStrip } from "@/components/dashboard/kpis";
import { RevenueChart } from "@/components/dashboard/revenue-chart";
import { CampaignsTable, SalesTable } from "@/components/dashboard/tables";
import { Card, CardHeader, DemoBadge, DemoModeBanner, EmptyDataNotice, NoWorkspace, Notice, PageHeader, SchemaPending } from "@/components/ui";
import { parseFilters } from "@/lib/dashboard/filters";
import { loadDashboard } from "@/lib/dashboard/load";
import { brl } from "@/lib/format";

export const metadata: Metadata = { title: "Painel" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const result = await loadDashboard(filters, { demo: sp.demo === "1" });
  if (result.kind === "no-workspace") return <NoWorkspace />;
  if (result.kind === "schema-pending") return <SchemaPending />;
  const data = result.data;
  const s = data.summary;

  return (
    <>
      <PageHeader title="Painel" description={`De ${data.range.from.split("-").reverse().join("/")} a ${data.range.to.split("-").reverse().join("/")}`}>
        {data.source === "demo" && <DemoBadge />}
      </PageHeader>

      <div className="mb-5">
        <FilterBar campaigns={data.options.campaigns} products={data.options.products} />
      </div>

      {(data.source === "demo" || result.empty) && (
        <div className="mb-5">{data.source === "demo" ? <DemoModeBanner /> : <EmptyDataNotice />}</div>
      )}


      {filters.product && (
        <div className="mb-5">
          <Notice>
            Filtrando por produto: o investimento continua sendo o das campanhas, porque as plataformas de anúncio não informam gasto por
            produto. ROAS e CPA ficam aproximados.
          </Notice>
        </div>
      )}

      <div className="flex flex-col gap-5">
        <KpiGrid s={s} />
        <StatusStrip s={s} />

        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title="Faturamento × investimento" description="Por dia, vendas aprovadas na data do pedido" />
            <div className="p-5">
              <RevenueChart data={data.series} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Origem das vendas" description="Vendas aprovadas por tipo de atribuição" />
            <div className="p-5">
              <AttributionBar orders={data.orders} />
              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                <div>
                  <dt className="text-xs text-fg-2">Reembolsos + chargebacks</dt>
                  <dd className="tabular font-medium">{brl(s.refundedCents)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-2">Cliques</dt>
                  <dd className="tabular font-medium">{s.clicks.toLocaleString("pt-BR")}</dd>
                </div>
              </dl>
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Campanhas"
            description="Investimento vem da API de anúncios; vendas são as nossas, atribuídas"
            action={
              <Link href="/campanhas" className="text-xs font-medium text-brand hover:underline">
                Ver todas
              </Link>
            }
          />
          <CampaignsTable rows={data.campaigns} limit={6} />
        </Card>

        <Card>
          <CardHeader
            title="Últimas vendas"
            action={
              <Link href="/vendas" className="text-xs font-medium text-brand hover:underline">
                Ver todas
              </Link>
            }
          />
          <SalesTable orders={data.orders} limit={8} />
        </Card>
      </div>
    </>
  );
}
