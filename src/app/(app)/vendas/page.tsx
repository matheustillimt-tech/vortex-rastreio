import type { Metadata } from "next";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { StatusStrip } from "@/components/dashboard/kpis";
import { SalesTable } from "@/components/dashboard/tables";
import { Card, CardHeader, DemoBadge, DemoModeBanner, EmptyDataNotice, NoWorkspace, PageHeader, SchemaPending } from "@/components/ui";
import { parseFilters } from "@/lib/dashboard/filters";
import { loadDashboard } from "@/lib/dashboard/load";

export const metadata: Metadata = { title: "Vendas" };

const PAGE_SIZE = 100;

export default async function SalesPage({ searchParams }: PageProps<"/vendas">) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const result = await loadDashboard(filters, { demo: sp.demo === "1" });
  if (result.kind === "no-workspace") return <NoWorkspace />;
  if (result.kind === "schema-pending") return <SchemaPending />;
  const data = result.data;
  return (
    <>
      <PageHeader title="Vendas" description="Pedidos recebidos dos checkouts, com status e origem">
        {data.source === "demo" && <DemoBadge />}
      </PageHeader>
      <div className="mb-5">
        <FilterBar campaigns={data.options.campaigns} products={data.options.products} />
      </div>

      {(data.source === "demo" || result.empty) && (
        <div className="mb-5">{data.source === "demo" ? <DemoModeBanner /> : <EmptyDataNotice />}</div>
      )}
      <div className="mb-5">
        <StatusStrip s={data.summary} />
      </div>
      <Card>
        <CardHeader
          title="Pedidos"
          description={`${data.orders.length.toLocaleString("pt-BR")} no período${data.orders.length > PAGE_SIZE ? ` · mostrando os ${PAGE_SIZE} mais recentes` : ""}`}
        />
        <SalesTable orders={data.orders} limit={PAGE_SIZE} />
      </Card>
    </>
  );
}
