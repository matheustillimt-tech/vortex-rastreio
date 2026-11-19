import { describe, expect, it } from "vitest";
import { dateRange, parseFilters } from "@/lib/dashboard/filters";
import { applyFilters, getDemoDashboard } from "@/lib/dashboard/query";
import { demoDataset } from "@/lib/demo/data";
import { DEFAULT_COSTS } from "@/lib/domain/types";
import { costSettingsSchema, moneyToCents, percentToBps } from "@/lib/settings/costs";
import { makeInsight, makeOrder } from "./helpers";

describe("filtros", () => {
  it("valida e usa padrões seguros", () => {
    expect(parseFilters({})).toEqual({ days: 30, campaign: null, product: null, platform: null });
    expect(parseFilters({ periodo: "7", plataforma: "meta", campanha: "c1" })).toMatchObject({ days: 7, platform: "meta", campaign: "c1" });
    expect(parseFilters({ periodo: "9999", plataforma: "orkut" })).toMatchObject({ days: 30, platform: null });
  });

  it("intervalo inclui hoje", () => {
    expect(dateRange(7, new Date("2026-11-11T15:00:00Z"))).toEqual({ from: "2026-11-05", to: "2026-11-11" });
  });

  it("filtra pedidos e gasto por campanha/plataforma/produto", () => {
    const orders = [makeOrder({ id: "1", campaignId: "c1", platform: "meta" }), makeOrder({ id: "2", campaignId: "c2", platform: "google", productId: "p2" })];
    const insights = [makeInsight(), makeInsight({ campaignId: "c2", platform: "google" })];
    const f = { days: 30, campaign: null, product: "p2", platform: null };
    const r = applyFilters(orders, insights, f, "2026-10-01", "2026-11-30");
    expect(r.orders.map((o) => o.id)).toEqual(["2"]);
    expect(r.insights).toHaveLength(2); // gasto não tem produto
    const byPlatform = applyFilters(orders, insights, { ...f, product: null, platform: "meta" }, "2026-10-01", "2026-11-30");
    expect(byPlatform.orders).toHaveLength(1);
    expect(byPlatform.insights).toHaveLength(1);
  });
});

describe("dados demonstrativos", () => {
  it("são determinísticos e claramente marcados", () => {
    const a = demoDataset(new Date("2026-11-11T00:00:00Z"));
    expect(a.orders.length).toBeGreaterThan(100);
    expect(a.campaigns.every((c) => c.name.startsWith("[DEMO]"))).toBe(true);
    expect(a.orders.every((o) => o.externalId.startsWith("DEMO-"))).toBe(true);
    const d = getDemoDashboard(parseFilters({}), DEFAULT_COSTS);
    expect(d.source).toBe("demo");
    expect(d.series).toHaveLength(30);
  });
});

describe("custos", () => {
  it("converte entradas em pt-BR", () => {
    expect(percentToBps("6,5")).toBe(650);
    expect(percentToBps("101")).toBeNull();
    expect(moneyToCents("R$ 1.234,56")).toBe(123456);
    expect(moneyToCents("10")).toBe(1000);
    expect(moneyToCents("")).toBe(0);
    expect(moneyToCents("-5")).toBeNull();
  });
  it("schema recusa valores fora da faixa", () => {
    expect(costSettingsSchema.safeParse({ ...DEFAULT_COSTS, taxRateBps: -1 }).success).toBe(false);
    expect(costSettingsSchema.safeParse(DEFAULT_COSTS).success).toBe(true);
  });
});

describe("painel sem dados reais", () => {
  it("mostra zero ou “—”, nunca números inventados", async () => {
    const { buildDashboard } = await import("@/lib/dashboard/query");
    const d = buildDashboard({
      source: "live",
      orders: [],
      insights: [],
      options: { campaigns: [], products: [] },
      costs: { taxRateBps: 600, gatewayFeeBps: 0, costPerSaleCents: 0, fixedMonthlyCents: 0 },
      filters: parseFilters({}),
    });
    expect(d.source).toBe("live");
    expect(d.summary).toMatchObject({
      grossRevenueCents: 0, netRevenueCents: 0, adSpendCents: 0, profitCents: 0,
      roas: null, cpaCents: null, cpcCents: null, ctr: null, cpmCents: null, observedShare: null,
    });
    expect(Object.values(d.summary.counts).every((n) => n === 0)).toBe(true);
    expect(d.series.every((p) => p.revenueCents === 0 && p.spendCents === 0)).toBe(true);
    expect(d.campaigns).toEqual([]);
    expect(d.orders).toEqual([]);
  });
});
