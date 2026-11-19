import { describe, expect, it } from "vitest";
import { attributeOrder, detectPlatform, isPaidTouch } from "@/lib/domain/attribution";
import { shouldApplyStatus } from "@/lib/domain/order-status";

describe("detectPlatform", () => {
  it("prioriza click id", () => {
    expect(detectPlatform({ fbclid: "x", utm_source: "google" })).toBe("meta");
    expect(detectPlatform({ gclid: "x" })).toBe("google");
    expect(detectPlatform({ ttclid: "x" })).toBe("tiktok");
  });
  it("reconhece utm_source comuns", () => {
    expect(detectPlatform({ utm_source: "FB" })).toBe("meta");
    expect(detectPlatform({ utm_source: "instagram" })).toBe("meta");
    expect(detectPlatform({ utm_source: "tiktok_ads" })).toBe("tiktok");
    expect(detectPlatform({ utm_source: "newsletter" })).toBeNull();
    expect(detectPlatform({ utm_source: "fbnews" })).toBeNull();
  });
});

describe("isPaidTouch", () => {
  it("orgânico não é pago", () => {
    expect(isPaidTouch({})).toBe(false);
    expect(isPaidTouch({ utm_source: "newsletter", utm_medium: "email" })).toBe(false);
    expect(isPaidTouch({ utm_source: "parceiro", utm_medium: "cpc" })).toBe(true);
  });
});

describe("attributeOrder", () => {
  const sessions = [
    { sessionId: "s-old", visitorId: "v1", startedAt: "2026-09-01T00:00:00Z", params: { fbclid: "old", campaign_id: "c-old" } },
    { sessionId: "s1", visitorId: "v1", startedAt: "2026-10-30T00:00:00Z", params: { fbclid: "a", utm_campaign: "Black", campaign_id: "c1", ad_id: "ad1" } },
    { sessionId: "s2", visitorId: "v1", startedAt: "2026-10-31T00:00:00Z", params: {} },
    { sessionId: "s-after", visitorId: "v1", startedAt: "2026-11-02T00:00:00Z", params: { gclid: "z" } },
    { sessionId: "s-other", visitorId: "v2", startedAt: "2026-10-31T00:00:00Z", params: { gclid: "y" } },
  ];

  it("último clique pago do visitante, dentro da janela e antes do pedido", () => {
    const r = attributeOrder({ orderCreatedAt: "2026-11-01T00:00:00Z", visitorId: "v1", sessions, orderParams: {} });
    expect(r).toMatchObject({ method: "click_id", sessionId: "s1", platform: "meta", campaignId: "c1", adId: "ad1", campaign: "Black" });
  });

  it("cai para UTM do pedido quando não há sessão", () => {
    const r = attributeOrder({ orderCreatedAt: "2026-11-01T00:00:00Z", visitorId: null, sessions, orderParams: { utm_source: "facebook", utm_campaign: "X" } });
    expect(r).toMatchObject({ method: "utm", platform: "meta", campaign: "X" });
  });

  it("sem sinal fica sem origem (nunca inventa)", () => {
    const r = attributeOrder({ orderCreatedAt: "2026-11-01T00:00:00Z", visitorId: "desconhecido", sessions, orderParams: {} });
    expect(r.method).toBe("unattributed");
  });

  it("respeita a janela de atribuição", () => {
    const r = attributeOrder({ orderCreatedAt: "2026-11-01T00:00:00Z", visitorId: "v1", sessions: [sessions[0]], orderParams: {} });
    expect(r.method).toBe("unattributed");
  });
});

describe("shouldApplyStatus", () => {
  it("status só avança", () => {
    expect(shouldApplyStatus(null, "pending")).toBe(true);
    expect(shouldApplyStatus("pending", "approved")).toBe(true);
    expect(shouldApplyStatus("approved", "refunded")).toBe(true);
    expect(shouldApplyStatus("refunded", "approved")).toBe(false);
    expect(shouldApplyStatus("approved", "pending")).toBe(false);
    expect(shouldApplyStatus("cancelled", "approved")).toBe(true);
    expect(shouldApplyStatus("chargeback", "refunded")).toBe(false);
  });
});
