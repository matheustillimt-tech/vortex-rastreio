import type { Metadata } from "next";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { AdPerformanceTable } from "@/components/dashboard/ad-performance-table";
import { LevelTabs } from "@/components/dashboard/level-tabs";
import { Card, DemoBadge, DemoModeBanner, EmptyDataNotice, NoWorkspace, Notice, PageHeader, SchemaPending } from "@/components/ui";
import { parseFilters, parseLevel } from "@/lib/dashboard/filters";
import { loadDashboard } from "@/lib/dashboard/load";

export const metadata: Metadata = { title: "Campanhas" };

export default async function CampaignsPage({ searchParams }: PageProps<"/campanhas">) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const level = parseLevel(sp);
  const result = await loadDashboard(filters, { demo: sp.demo === "1" });
  if (result.kind === "no-workspace") return <NoWorkspace />;
  if (result.kind === "schema-pending") return <SchemaPending />;
  const data = result.data;
  return (
    <>
      <PageHeader title="Campanhas" description="Investimento da plataforma × vendas que rastreamos, por campanha, conjunto ou anúncio">
        {data.source === "demo" && <DemoBadge />}
      </PageHeader>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <LevelTabs />
        <FilterBar campaigns={data.options.campaigns} products={data.options.products} />
      </div>

      {(data.source === "demo" || result.empty) && (
        <div className="mb-5">{data.source === "demo" ? <DemoModeBanner /> : <EmptyDataNotice />}</div>
      )}
      <Card>
        <AdPerformanceTable rows={data.performance[level]} level={level} />
      </Card>
      <div className="mt-5">
        <Notice>
          <strong className="text-fg">Vendas</strong> = pedidos aprovados que nós atribuímos à campanha (observados).{" "}
          <strong className="text-fg">Vendas (plataforma)</strong> = o que a própria plataforma de anúncios reporta pelo modelo dela. A diferença
          entre as duas é normal e ajuda a calibrar decisões. <strong className="text-fg">Lucro</strong> desconta taxas, impostos e custo por
          venda configurados, mas não os custos fixos. Venda da campanha sem anúncio reconhecido aparece como “Sem anúncio identificado”.
        </Notice>
      </div>
    </>
  );
}
