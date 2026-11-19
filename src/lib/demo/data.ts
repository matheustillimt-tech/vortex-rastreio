import type { AdInsightDaily, AdPlatform, AttributionMethod, Order, OrderStatus } from "@/lib/domain/types";

/**
 * DADOS DEMONSTRATIVOS — totalmente fictícios, gerados por semente fixa.
 * Servem só para visualizar o painel antes de conectar Meta Ads e um checkout.
 * Toda tela que usa isso mostra o selo "Dados demonstrativos".
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoCampaign {
  platform: AdPlatform;
  id: string;
  name: string;
  dailySpendCents: number;
  cpmCents: number;
  ctr: number;
  /** conversão clique → venda */
  cvr: number;
}

const CAMPAIGNS: DemoCampaign[] = [
  { platform: "meta", id: "demo-m-01", name: "[DEMO] Conversão · Público frio", dailySpendCents: 42_000, cpmCents: 2_800, ctr: 0.014, cvr: 0.018 },
  { platform: "meta", id: "demo-m-02", name: "[DEMO] Remarketing 7 dias", dailySpendCents: 15_000, cpmCents: 4_500, ctr: 0.024, cvr: 0.045 },
  { platform: "meta", id: "demo-m-03", name: "[DEMO] Lookalike compradores", dailySpendCents: 28_000, cpmCents: 3_100, ctr: 0.012, cvr: 0.016 },
  { platform: "meta", id: "demo-m-04", name: "[DEMO] Teste de criativos", dailySpendCents: 9_000, cpmCents: 2_200, ctr: 0.009, cvr: 0.006 },
  { platform: "google", id: "demo-g-01", name: "[DEMO] Pesquisa · Marca", dailySpendCents: 6_000, cpmCents: 9_000, ctr: 0.08, cvr: 0.05 },
  { platform: "tiktok", id: "demo-t-01", name: "[DEMO] Spark Ads · UGC", dailySpendCents: 11_000, cpmCents: 1_400, ctr: 0.008, cvr: 0.008 },
];

export const DEMO_PRODUCTS = [
  { id: "demo-p-01", name: "[DEMO] Curso Principal", priceCents: 49_700 },
  { id: "demo-p-02", name: "[DEMO] Mentoria em Grupo", priceCents: 149_700 },
  { id: "demo-p-03", name: "[DEMO] E-book de Entrada", priceCents: 4_700 },
];

const FEE_BPS = 899; // taxa fictícia de checkout

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export interface DemoDataset {
  orders: Order[];
  insights: AdInsightDaily[];
  campaigns: Array<{ platform: AdPlatform; id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
}

let cache: { key: string; data: DemoDataset } | null = null;

/** Gera 90 dias terminando em `today`. Determinístico para a mesma data. */
export function demoDataset(today = new Date()): DemoDataset {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const key = ymd(end);
  if (cache?.key === key) return cache.data;

  const rand = mulberry32(20261111);
  const insights: AdInsightDaily[] = [];
  const orders: Order[] = [];
  let n = 0;

  for (let back = 89; back >= 0; back--) {
    const day = new Date(end.getTime() - back * 86_400_000);
    const date = ymd(day);
    const weekday = day.getUTCDay();
    const seasonal = 1 + 0.25 * Math.sin((89 - back) / 9) + (weekday === 0 || weekday === 6 ? -0.15 : 0.05);

    for (const c of CAMPAIGNS) {
      const spend = Math.round(c.dailySpendCents * seasonal * (0.75 + rand() * 0.5));
      const impressions = Math.round((spend / c.cpmCents) * 1000);
      const clicks = Math.round(impressions * c.ctr * (0.8 + rand() * 0.4));
      const sales = Math.round(clicks * c.cvr * (0.6 + rand() * 0.8));
      insights.push({
        platform: c.platform,
        accountId: `demo-act-${c.platform}`,
        date,
        campaignId: c.id,
        campaignName: c.name,
        adsetId: null,
        adsetName: null,
        adId: `${c.id}-ad`,
        adName: null,
        spendCents: spend,
        impressions,
        clicks,
        // a plataforma "vê" um pouco diferente de nós — comum na vida real
        platformPurchases: Math.round(sales * (0.85 + rand() * 0.4)),
      });

      for (let i = 0; i < sales; i++) orders.push(makeOrder(rand, ++n, day, c));
    }
    // vendas orgânicas/sem origem
    const organic = Math.round(rand() * 3);
    for (let i = 0; i < organic; i++) orders.push(makeOrder(rand, ++n, day, null));
  }

  const data: DemoDataset = {
    orders,
    insights,
    campaigns: CAMPAIGNS.map(({ platform, id, name }) => ({ platform, id, name })),
    products: DEMO_PRODUCTS.map(({ id, name }) => ({ id, name })),
  };
  cache = { key, data };
  return data;
}

function makeOrder(rand: () => number, n: number, day: Date, c: DemoCampaign | null): Order {
  const r = rand();
  const product = r < 0.62 ? DEMO_PRODUCTS[0] : r < 0.8 ? DEMO_PRODUCTS[1] : DEMO_PRODUCTS[2];
  const s = rand();
  const status: OrderStatus = s < 0.78 ? "approved" : s < 0.88 ? "pending" : s < 0.94 ? "cancelled" : s < 0.99 ? "refunded" : "chargeback";
  const created = new Date(day.getTime() + Math.floor(rand() * 86_400_000));
  const createdAt = created.toISOString();
  const fee = Math.round((product.priceCents * FEE_BPS) / 10_000);
  const method: AttributionMethod = c ? (rand() < 0.82 ? "click_id" : "utm") : "unattributed";

  return {
    id: `demo-o-${n}`,
    provider: "kiwify",
    externalId: `DEMO-${String(n).padStart(6, "0")}`,
    status,
    productId: product.id,
    productName: product.name,
    grossCents: product.priceCents,
    netCents: product.priceCents - fee,
    feeCents: fee,
    currency: "BRL",
    paymentMethod: rand() < 0.55 ? "pix" : rand() < 0.85 ? "credit_card" : "boleto",
    customerEmailHash: null,
    tracking: {},
    createdAt,
    approvedAt: status === "approved" || status === "refunded" || status === "chargeback" ? createdAt : null,
    refundedAt: status === "refunded" || status === "chargeback" ? createdAt : null,
    attributionMethod: method,
    platform: c?.platform ?? null,
    campaignId: c?.id ?? null,
    campaignName: c?.name ?? null,
    adId: c ? `${c.id}-ad` : null,
  };
}
