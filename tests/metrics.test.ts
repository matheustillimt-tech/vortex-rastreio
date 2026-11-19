import { describe, expect, it } from "vitest";
import { campaignTable, computeSummary, dailySeries, ratio } from "@/lib/domain/metrics";
import { DEFAULT_COSTS } from "@/lib/domain/types";
import { makeInsight, makeOrder } from "./helpers";

const noCosts = { taxRateBps: 0, gatewayFeeBps: 0, costPerSaleCents: 0, fixedMonthlyCents: 0 };

describe("ratio", () => {
  it("devolve null em divisão por zero", () => {
    expect(ratio(10, 0)).toBeNull();
    expect(ratio(10, 4)).toBe(2.5);
  });
});

describe("computeSummary", () => {
  it("calcula CPA, CPC, CTR, CPM e ROAS", () => {
    const orders = [makeOrder({ id: "1" }), makeOrder({ id: "2", grossCents: 20_000 })];
    const s = computeSummary(orders, [makeInsight()], noCosts, 30);
    expect(s.counts.approved).toBe(2);
    expect(s.grossRevenueCents).toBe(30_000);
    expect(s.adSpendCents).toBe(5_000);
    expect(s.cpaCents).toBe(2_500);
    expect(s.cpcCents).toBe(25);
    expect(s.ctr).toBeCloseTo(0.02);
    expect(s.cpmCents).toBe(500);
    expect(s.roas).toBe(6);
  });

  it("separa status e não soma reembolso no faturamento", () => {
    const orders = [
      makeOrder({ id: "1" }),
      makeOrder({ id: "2", status: "pending" }),
      makeOrder({ id: "3", status: "refunded" }),
      makeOrder({ id: "4", status: "chargeback" }),
      makeOrder({ id: "5", status: "cancelled" }),
    ];
    const s = computeSummary(orders, [], noCosts, 30);
    expect(s.counts).toEqual({ approved: 1, pending: 1, refunded: 1, chargeback: 1, cancelled: 1 });
    expect(s.grossRevenueCents).toBe(10_000);
    expect(s.refundedCents).toBe(20_000);
    expect(s.roas).toBeNull();
    expect(s.cpaCents).toBeNull(); // sem gasto, CPA é desconhecido (não zero)
  });

  it("lucro desconta taxa informada, imposto, custo por venda, fixo rateado e anúncios", () => {
    const orders = [makeOrder({ feeCents: 1_000 })];
    const costs = { taxRateBps: 1000, gatewayFeeBps: 0, costPerSaleCents: 500, fixedMonthlyCents: 3_000 };
    const s = computeSummary(orders, [makeInsight({ spendCents: 2_000 })], costs, 15);
    // bruto 10000 − taxa 1000 − imposto 1000 = líquido 8000
    expect(s.netRevenueCents).toBe(8_000);
    // 8000 − anúncios 2000 − custo/venda 500 − fixo 1500 (metade do mês)
    expect(s.profitCents).toBe(4_000);
  });

  it("usa a taxa de gateway configurada quando o provedor não informa", () => {
    const s = computeSummary([makeOrder()], [], { ...noCosts, gatewayFeeBps: 500 }, 30);
    expect(s.netRevenueCents).toBe(9_500);
  });

  it("mede a fração de vendas com atribuição observada", () => {
    const orders = [
      makeOrder({ id: "1", attributionMethod: "click_id" }),
      makeOrder({ id: "2", attributionMethod: "utm" }),
      makeOrder({ id: "3", attributionMethod: "unattributed" }),
      makeOrder({ id: "4", attributionMethod: "estimated" }),
    ];
    expect(computeSummary(orders, [], DEFAULT_COSTS, 30).observedShare).toBe(0.5);
  });
});

describe("dailySeries", () => {
  it("preenche dias vazios com zero", () => {
    const series = dailySeries([makeOrder()], [makeInsight({ date: "2026-11-03" })], "2026-11-01", "2026-11-03");
    expect(series.map((p) => p.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(series[0].revenueCents).toBe(10_000);
    expect(series[1]).toMatchObject({ revenueCents: 0, spendCents: 0 });
    expect(series[2].spendCents).toBe(5_000);
  });
});

describe("campaignTable", () => {
  it("junta gasto com vendas atribuídas por campanha", () => {
    const orders = [
      makeOrder({ id: "1", platform: "meta", campaignId: "c1" }),
      makeOrder({ id: "2", platform: "meta", campaignId: "c1", status: "refunded" }),
    ];
    const insights = [makeInsight(), makeInsight({ date: "2026-11-02", platformPurchases: 3 }), makeInsight({ campaignId: "c2", spendCents: 100 })];
    const rows = campaignTable(orders, insights);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ campaignId: "c1", spendCents: 10_000, approved: 1, revenueCents: 10_000, roas: 1, platformPurchases: 3 });
    expect(rows[1]).toMatchObject({ campaignId: "c2", approved: 0, cpaCents: null });
  });
});
