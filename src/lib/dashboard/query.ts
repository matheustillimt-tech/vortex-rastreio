import { demoDataset } from "@/lib/demo/data";
import { adPerformance, campaignTable, computeSummary, dailySeries } from "@/lib/domain/metrics";
import type { AdInsightDaily, AdPlatform, CostSettings, Order } from "@/lib/domain/types";
import { dateRange, type Filters } from "./filters";

/** live = dados do banco do workspace · demo = fictícios (workspace ainda sem dados) */
export type DataSource = "demo" | "live";

/** Aplica filtros. Exportado para teste. */
export function applyFilters(orders: Order[], insights: AdInsightDaily[], f: Filters, from: string, to: string) {
  const inRange = (iso: string) => {
    const d = iso.slice(0, 10);
    return d >= from && d <= to;
  };
  const fo = orders.filter(
    (o) =>
      inRange(o.createdAt) &&
      (!f.campaign || o.campaignId === f.campaign) &&
      (!f.product || o.productId === f.product) &&
      (!f.platform || o.platform === f.platform),
  );
  // gasto não tem produto: com filtro de produto o gasto continua o da campanha/plataforma (avisado na UI)
  const fi = insights.filter(
    (i) => i.date >= from && i.date <= to && (!f.campaign || i.campaignId === f.campaign) && (!f.platform || i.platform === f.platform),
  );
  return { orders: fo, insights: fi };
}

export function buildDashboard(input: {
  source: DataSource;
  orders: Order[];
  insights: AdInsightDaily[];
  options: { campaigns: Array<{ platform: AdPlatform; id: string; name: string }>; products: Array<{ id: string; name: string }> };
  costs: CostSettings;
  filters: Filters;
  today?: Date;
}) {
  const { from, to } = dateRange(input.filters.days, input.today);
  const { orders, insights } = applyFilters(input.orders, input.insights, input.filters, from, to);
  return {
    source: input.source,
    range: { from, to },
    summary: computeSummary(orders, insights, input.costs, input.filters.days),
    series: dailySeries(orders, insights, from, to),
    campaigns: campaignTable(orders, insights),
    performance: {
      campaign: adPerformance(orders, insights, input.costs, "campaign"),
      adset: adPerformance(orders, insights, input.costs, "adset"),
      ad: adPerformance(orders, insights, input.costs, "ad"),
    },
    orders: [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    options: input.options,
  };
}

export type DashboardData = ReturnType<typeof buildDashboard>;

export function getDemoDashboard(filters: Filters, costs: CostSettings): DashboardData {
  const data = demoDataset();
  return buildDashboard({
    source: "demo",
    orders: data.orders,
    insights: data.insights,
    options: { campaigns: data.campaigns, products: data.products },
    costs,
    filters,
  });
}
