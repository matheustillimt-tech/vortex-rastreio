import { describe, expect, it } from "vitest";
import { adPerformance, campaignTable, UNIDENTIFIED } from "@/lib/domain/metrics";
import { makeInsight, makeOrder } from "./helpers";

const noCosts = { taxRateBps: 0, gatewayFeeBps: 0, costPerSaleCents: 0, fixedMonthlyCents: 0 };

// campanha c1: conjunto s1 com anúncios a1 e a2; conjunto s2 com a3. Campanha c2 com a4.
const insights = [
  makeInsight({ adsetId: "s1", adsetName: "Público frio", adId: "a1", adName: "Vídeo 1", spendCents: 10_000, impressions: 20_000, clicks: 400, platformPurchases: 3 }),
  makeInsight({ adsetId: "s1", adsetName: "Público frio", adId: "a2", adName: "Vídeo 2", spendCents: 5_000, impressions: 10_000, clicks: 100 }),
  makeInsight({ date: "2026-11-02", adsetId: "s1", adsetName: "Público frio", adId: "a1", adName: "Vídeo 1", spendCents: 10_000, impressions: 20_000, clicks: 400, platformPurchases: 1 }),
  makeInsight({ adsetId: "s2", adsetName: "Remarketing", adId: "a3", adName: "Carrossel", spendCents: 4_000, impressions: 5_000, clicks: 50 }),
  makeInsight({ campaignId: "c2", campaignName: "Campanha 2", adsetId: "s9", adsetName: "Aberto", adId: "a4", adName: "Imagem", spendCents: 1_000, impressions: 2_000, clicks: 10 }),
];
const meta = { status: "approved" as const, platform: "meta" as const, campaignId: "c1", attributionMethod: "click_id" as const };
const orders = [
  makeOrder({ ...meta, id: "1", adId: "a1", grossCents: 30_000 }),
  makeOrder({ ...meta, id: "2", adId: "a1", grossCents: 30_000 }),
  makeOrder({ ...meta, id: "3", adId: "a3", grossCents: 10_000 }),
  makeOrder({ ...meta, id: "4", adId: null, grossCents: 5_000 }), // campanha conhecida, anúncio não
  makeOrder({ ...meta, id: "5", adId: "a1", status: "refunded" }), // não aprovada: fora
  makeOrder({ ...meta, id: "6", campaignId: "sem-gasto", adId: "x" }), // campanha sem gasto: fora
];

describe("adPerformance", () => {
  it("nível campanha bate com a tabela de campanhas existente", () => {
    const rows = adPerformance(orders, insights, noCosts, "campaign");
    const old = campaignTable(orders, insights);
    expect(rows.map((r) => [r.campaignId, r.spendCents, r.approved, r.revenueCents, r.roas])).toEqual(
      old.map((r) => [r.campaignId, r.spendCents, r.approved, r.revenueCents, r.roas]),
    );
    const c1 = rows.find((r) => r.campaignId === "c1")!;
    expect(c1).toMatchObject({ spendCents: 29_000, approved: 4, revenueCents: 75_000, platformPurchases: 4 });
    expect(c1.profitCents).toBe(75_000 - 29_000);
  });

  it("nível conjunto: soma os anúncios do conjunto e separa venda sem conjunto conhecido", () => {
    const rows = adPerformance(orders, insights, noCosts, "adset");
    const by = (id: string) => rows.find((r) => r.campaignId === "c1" && r.id === id)!;
    expect(by("s1")).toMatchObject({ name: "Público frio", spendCents: 25_000, approved: 2, revenueCents: 60_000, clicks: 900 });
    expect(by("s2")).toMatchObject({ name: "Remarketing", spendCents: 4_000, approved: 1, revenueCents: 10_000 });
    expect(by(UNIDENTIFIED)).toMatchObject({ name: "Sem conjunto identificado", spendCents: 0, approved: 1, revenueCents: 5_000, roas: null, cpaCents: null });
    // a soma dos conjuntos é a campanha
    const c1 = rows.filter((r) => r.campaignId === "c1");
    expect(c1.reduce((s, r) => s + r.spendCents, 0)).toBe(29_000);
    expect(c1.reduce((s, r) => s + r.approved, 0)).toBe(4);
  });

  it("nível anúncio: ROAS, CPA, CPC e CTR por anúncio, com o conjunto como referência", () => {
    const rows = adPerformance(orders, insights, noCosts, "ad");
    const a1 = rows.find((r) => r.id === "a1")!;
    expect(a1).toMatchObject({ name: "Vídeo 1", parentName: "Público frio", spendCents: 20_000, approved: 2, revenueCents: 60_000, roas: 3, cpaCents: 10_000, cpcCents: 25 });
    expect(a1.ctr).toBeCloseTo(0.02);
    const a2 = rows.find((r) => r.id === "a2")!;
    expect(a2).toMatchObject({ approved: 0, revenueCents: 0, roas: 0, cpaCents: null, profitCents: -5_000 });
    expect(rows.find((r) => r.id === UNIDENTIFIED)).toMatchObject({ name: "Sem anúncio identificado", approved: 1 });
    expect(rows.reduce((s, r) => s + r.revenueCents, 0)).toBe(75_000);
  });

  it("lucro desconta taxa, imposto e custo por venda (sem custo fixo)", () => {
    const costs = { taxRateBps: 1_000, gatewayFeeBps: 500, costPerSaleCents: 1_000, fixedMonthlyCents: 999_999 };
    const a1 = adPerformance(orders, insights, costs, "ad").find((r) => r.id === "a1")!;
    // 60.000 − taxa 5% (3.000) − imposto 10% (6.000) − 2 × 1.000 − investimento 20.000
    expect(a1.profitCents).toBe(60_000 - 3_000 - 6_000 - 2_000 - 20_000);
  });

  it("sem dados: lista vazia, sem divisões por zero", () => {
    expect(adPerformance([], [], noCosts, "ad")).toEqual([]);
    expect(adPerformance(orders, [], noCosts, "campaign")).toEqual([]);
  });
});
