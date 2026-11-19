import type { AdInsightDaily, Order } from "@/lib/domain/types";

export function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "o1",
    provider: "kiwify",
    externalId: "ext1",
    status: "approved",
    productId: "p1",
    productName: "Curso",
    grossCents: 10_000,
    netCents: null,
    feeCents: null,
    currency: "BRL",
    paymentMethod: "pix",
    customerEmailHash: null,
    tracking: {},
    createdAt: "2026-11-01T12:00:00.000Z",
    approvedAt: "2026-11-01T12:00:00.000Z",
    refundedAt: null,
    attributionMethod: "unattributed",
    platform: null,
    campaignId: null,
    campaignName: null,
    adId: null,
    ...over,
  };
}

export function makeInsight(over: Partial<AdInsightDaily> = {}): AdInsightDaily {
  return {
    platform: "meta",
    accountId: "act_1",
    date: "2026-11-01",
    campaignId: "c1",
    campaignName: "Campanha 1",
    adsetId: null,
    adsetName: null,
    adId: "a1",
    adName: "Anúncio 1",
    spendCents: 5_000,
    impressions: 10_000,
    clicks: 200,
    platformPurchases: null,
    ...over,
  };
}
