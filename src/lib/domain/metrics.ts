import type { AdInsightDaily, Cents, CostSettings, Order, OrderStatus } from "./types";

/** Divisão que devolve null em vez de Infinity/NaN — o painel mostra "—". */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

export interface Summary {
  counts: Record<OrderStatus, number>;
  /** soma bruta das vendas aprovadas */
  grossRevenueCents: Cents;
  /** bruto − taxas de plataforma/gateway − impostos */
  netRevenueCents: Cents;
  refundedCents: Cents;
  adSpendCents: Cents;
  impressions: number;
  clicks: number;
  /** custo por aquisição (venda aprovada), em centavos */
  cpaCents: number | null;
  cpcCents: number | null;
  /** fração 0..1 */
  ctr: number | null;
  cpmCents: number | null;
  /** faturamento bruto / investimento */
  roas: number | null;
  /** líquido − investimento − custo por venda − fixos rateados */
  profitCents: Cents;
  /** fração de vendas aprovadas com atribuição observada */
  observedShare: number | null;
}

function emptyCounts(): Record<OrderStatus, number> {
  return { pending: 0, approved: 0, cancelled: 0, refunded: 0, chargeback: 0 };
}

/** Taxa de plataforma: usa o que o provedor informou; senão aplica a taxa configurada. */
export function platformFee(order: Order, costs: CostSettings): Cents {
  if (order.feeCents != null) return order.feeCents;
  if (order.netCents != null) return Math.max(0, order.grossCents - order.netCents);
  return Math.round((order.grossCents * costs.gatewayFeeBps) / 10_000);
}

export function computeSummary(
  orders: Order[],
  insights: AdInsightDaily[],
  costs: CostSettings,
  periodDays: number,
): Summary {
  const counts = emptyCounts();
  let gross = 0;
  let fees = 0;
  let refunded = 0;
  let observed = 0;

  for (const o of orders) {
    counts[o.status] += 1;
    if (o.status === "approved") {
      gross += o.grossCents;
      fees += platformFee(o, costs);
      if (o.attributionMethod === "click_id" || o.attributionMethod === "utm") observed += 1;
    } else if (o.status === "refunded" || o.status === "chargeback") {
      refunded += o.grossCents;
    }
  }

  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  for (const row of insights) {
    spend += row.spendCents;
    impressions += row.impressions;
    clicks += row.clicks;
  }

  const taxes = Math.round((gross * costs.taxRateBps) / 10_000);
  const net = gross - fees - taxes;
  const variableCosts = counts.approved * costs.costPerSaleCents;
  const fixedCosts = Math.round((costs.fixedMonthlyCents * periodDays) / 30);
  const profit = net - spend - variableCosts - fixedCosts;

  const cpm = ratio(spend, impressions);

  return {
    counts,
    grossRevenueCents: gross,
    netRevenueCents: net,
    refundedCents: refunded,
    adSpendCents: spend,
    impressions,
    clicks,
    // sem gasto conhecido, CPA não é zero: é desconhecido
    cpaCents: spend > 0 ? ratio(spend, counts.approved) : null,
    cpcCents: ratio(spend, clicks),
    ctr: ratio(clicks, impressions),
    cpmCents: cpm == null ? null : cpm * 1000,
    roas: ratio(gross, spend),
    profitCents: profit,
    observedShare: ratio(observed, counts.approved),
  };
}

export interface DailyPoint {
  date: string;
  revenueCents: Cents;
  spendCents: Cents;
  approved: number;
}

/** Série diária contínua (dias sem dado viram zero), para o gráfico. */
export function dailySeries(
  orders: Order[],
  insights: AdInsightDaily[],
  from: string,
  to: string,
): DailyPoint[] {
  const map = new Map<string, DailyPoint>();
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    map.set(key, { date: key, revenueCents: 0, spendCents: 0, approved: 0 });
  }
  for (const o of orders) {
    if (o.status !== "approved" || !o.approvedAt) continue;
    const p = map.get(o.approvedAt.slice(0, 10));
    if (p) {
      p.revenueCents += o.grossCents;
      p.approved += 1;
    }
  }
  for (const row of insights) {
    const p = map.get(row.date);
    if (p) p.spendCents += row.spendCents;
  }
  return [...map.values()];
}

export interface CampaignRow {
  platform: string;
  campaignId: string;
  campaignName: string;
  spendCents: Cents;
  impressions: number;
  clicks: number;
  approved: number;
  revenueCents: Cents;
  cpaCents: number | null;
  ctr: number | null;
  roas: number | null;
  /** compras reportadas pela plataforma, para comparar com as nossas */
  platformPurchases: number | null;
}

/** Junta gasto (API de anúncios) com vendas atribuídas (nossas) por campanha. */
export function campaignTable(orders: Order[], insights: AdInsightDaily[]): CampaignRow[] {
  const rows = new Map<string, CampaignRow>();
  const key = (platform: string, id: string) => `${platform}:${id}`;

  for (const i of insights) {
    const k = key(i.platform, i.campaignId);
    const r =
      rows.get(k) ??
      ({
        platform: i.platform,
        campaignId: i.campaignId,
        campaignName: i.campaignName,
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        approved: 0,
        revenueCents: 0,
        cpaCents: null,
        ctr: null,
        roas: null,
        platformPurchases: null,
      } satisfies CampaignRow);
    r.spendCents += i.spendCents;
    r.impressions += i.impressions;
    r.clicks += i.clicks;
    if (i.platformPurchases != null) r.platformPurchases = (r.platformPurchases ?? 0) + i.platformPurchases;
    rows.set(k, r);
  }

  for (const o of orders) {
    if (o.status !== "approved" || !o.campaignId || !o.platform) continue;
    const k = key(o.platform, o.campaignId);
    const r = rows.get(k);
    if (!r) continue; // venda atribuída a campanha sem gasto no período: fica só na tabela de vendas
    r.approved += 1;
    r.revenueCents += o.grossCents;
  }

  for (const r of rows.values()) {
    r.cpaCents = r.spendCents > 0 ? ratio(r.spendCents, r.approved) : null;
    r.ctr = ratio(r.clicks, r.impressions);
    r.roas = ratio(r.revenueCents, r.spendCents);
  }
  return [...rows.values()].sort((a, b) => b.spendCents - a.spendCents);
}

/** Nível da tabela de desempenho: campanha, conjunto de anúncios ou anúncio. */
export type AdLevel = "campaign" | "adset" | "ad";
export const AD_LEVELS: readonly AdLevel[] = ["campaign", "adset", "ad"];

/** id usado quando a venda é da campanha mas não dá para saber de qual conjunto/anúncio veio */
export const UNIDENTIFIED = "__sem_id__";

export interface AdPerformanceRow {
  level: AdLevel;
  platform: string;
  campaignId: string;
  campaignName: string;
  /** id do conjunto (nível adset) ou do anúncio (nível ad); o mesmo da campanha no nível campaign */
  id: string;
  name: string;
  /** conjunto ao qual o anúncio pertence (só nível ad) */
  parentName: string | null;
  spendCents: Cents;
  impressions: number;
  clicks: number;
  approved: number;
  revenueCents: Cents;
  /** faturamento − taxas − impostos − custo por venda − investimento (sem custos fixos, que não são de campanha) */
  profitCents: Cents;
  cpaCents: number | null;
  cpcCents: number | null;
  ctr: number | null;
  roas: number | null;
  platformPurchases: number | null;
}

/**
 * Desempenho por campanha, conjunto ou anúncio: gasto (API de anúncios) × vendas aprovadas atribuídas (nossas).
 * - O pedido guarda campanha e anúncio; o conjunto vem do anúncio, pelo que a plataforma informou no gasto.
 * - Venda atribuída a campanha sem gasto no período não entra (fica só na tabela de vendas), como na tabela de campanhas.
 * - Venda da campanha sem anúncio reconhecido vira a linha "Sem anúncio identificado" daquela campanha.
 */
export function adPerformance(orders: Order[], insights: AdInsightDaily[], costs: CostSettings, level: AdLevel): AdPerformanceRow[] {
  const rows = new Map<string, AdPerformanceRow>();
  const campaigns = new Set<string>();
  const adIndex = new Map<string, { adsetId: string; adsetName: string; adName: string }>();
  const ck = (platform: string, campaignId: string) => `${platform}:${campaignId}`;

  const idOf = (adsetId: string | null, adId: string | null, campaignId: string) =>
    level === "campaign" ? campaignId : level === "adset" ? adsetId || UNIDENTIFIED : adId || UNIDENTIFIED;

  const getRow = (platform: string, campaignId: string, campaignName: string, id: string, name: string, parentName: string | null) => {
    const k = `${ck(platform, campaignId)}:${id}`;
    let r = rows.get(k);
    if (!r) {
      r = {
        level,
        platform,
        campaignId,
        campaignName,
        id,
        name,
        parentName,
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        approved: 0,
        revenueCents: 0,
        profitCents: 0,
        cpaCents: null,
        cpcCents: null,
        ctr: null,
        roas: null,
        platformPurchases: null,
      };
      rows.set(k, r);
    }
    return r;
  };

  for (const i of insights) {
    campaigns.add(ck(i.platform, i.campaignId));
    if (i.adId) adIndex.set(`${ck(i.platform, i.campaignId)}:${i.adId}`, { adsetId: i.adsetId ?? "", adsetName: i.adsetName ?? "", adName: i.adName ?? "" });
    const id = idOf(i.adsetId, i.adId, i.campaignId);
    const name =
      level === "campaign" ? i.campaignName : level === "adset" ? i.adsetName || i.adsetId || "Sem conjunto" : i.adName || i.adId || "Sem anúncio";
    const r = getRow(i.platform, i.campaignId, i.campaignName, id, name, level === "ad" ? i.adsetName || null : null);
    r.spendCents += i.spendCents;
    r.impressions += i.impressions;
    r.clicks += i.clicks;
    if (i.platformPurchases != null) r.platformPurchases = (r.platformPurchases ?? 0) + i.platformPurchases;
  }

  const variable = new Map<AdPerformanceRow, number>();
  for (const o of orders) {
    if (o.status !== "approved" || !o.campaignId || !o.platform) continue;
    if (!campaigns.has(ck(o.platform, o.campaignId))) continue;
    const ad = o.adId ? adIndex.get(`${ck(o.platform, o.campaignId)}:${o.adId}`) : undefined;
    const id = level === "campaign" ? o.campaignId : level === "adset" ? ad?.adsetId || UNIDENTIFIED : ad ? o.adId! : UNIDENTIFIED;
    const existing = rows.get(`${ck(o.platform, o.campaignId)}:${id}`);
    const campaignName = existing?.campaignName ?? o.campaignName ?? o.campaignId;
    const name =
      id === UNIDENTIFIED ? (level === "adset" ? "Sem conjunto identificado" : "Sem anúncio identificado") : (existing?.name ?? id);
    const r = existing ?? getRow(o.platform, o.campaignId, campaignName, id, name, null);
    r.approved += 1;
    r.revenueCents += o.grossCents;
    const taxes = Math.round((o.grossCents * costs.taxRateBps) / 10_000);
    variable.set(r, (variable.get(r) ?? 0) + platformFee(o, costs) + taxes + costs.costPerSaleCents);
  }

  for (const r of rows.values()) {
    r.profitCents = r.revenueCents - (variable.get(r) ?? 0) - r.spendCents;
    r.cpaCents = r.spendCents > 0 ? ratio(r.spendCents, r.approved) : null;
    r.cpcCents = ratio(r.spendCents, r.clicks);
    r.ctr = ratio(r.clicks, r.impressions);
    r.roas = ratio(r.revenueCents, r.spendCents);
  }
  return [...rows.values()].sort((a, b) => b.spendCents - a.spendCents || b.revenueCents - a.revenueCents);
}
