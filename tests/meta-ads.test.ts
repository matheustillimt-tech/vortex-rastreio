import { describe, expect, it } from "vitest";
import { buildInsightsUrl, fetchMetaInsights, maxUsagePercent, MetaApiError, normalizeInsightRow, spendToCents } from "@/lib/integrations/meta-ads";

const row = {
  date_start: "2026-11-01",
  campaign_id: "120000001",
  campaign_name: "Black Friday",
  adset_id: "120000002",
  ad_id: "120000003",
  ad_name: "Vídeo 1",
  spend: "123.45",
  impressions: "10000",
  clicks: "250",
  actions: [
    { action_type: "link_click", value: "250" },
    { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
    { action_type: "purchase", value: "4" },
  ],
};

describe("Meta Ads insights", () => {
  it("monta a URL em nível de anúncio, diária, sem token na URL", () => {
    const url = new URL(buildInsightsUrl({ adAccountId: "123", since: "2026-11-01", until: "2026-11-07", version: "v23.0" }));
    expect(url.pathname).toBe("/v23.0/act_123/insights");
    expect(url.searchParams.get("level")).toBe("ad");
    expect(url.searchParams.get("time_increment")).toBe("1");
    expect(url.searchParams.get("access_token")).toBeNull();
    expect(() => buildInsightsUrl({ adAccountId: "act_abc", since: "", until: "" })).toThrow();
  });

  it("converte gasto para centavos sem erro de ponto flutuante", () => {
    expect(spendToCents("123.45")).toBe(12345);
    expect(spendToCents("0.1")).toBe(10);
    expect(spendToCents("x")).toBe(0);
  });

  it("normaliza linha e usa a maior contagem de compra", () => {
    expect(normalizeInsightRow(row, "act_1")).toMatchObject({
      platform: "meta",
      spendCents: 12345,
      impressions: 10000,
      clicks: 250,
      platformPurchases: 4,
      adId: "120000003",
    });
    expect(normalizeInsightRow({ foo: 1 }, "act_1")).toBeNull();
  });

  it("lê o uso de rate limit do header", () => {
    expect(maxUsagePercent(JSON.stringify({ "123": [{ call_count: 10, total_cputime: 80, total_time: 5 }] }))).toBe(80);
    expect(maxUsagePercent(null)).toBe(0);
    expect(maxUsagePercent("lixo")).toBe(0);
  });

  it("pagina e manda o token no header", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const pages = [
      { data: [row], paging: { cursors: { after: "c1" }, next: "https://next" } },
      { data: [{ ...row, date_start: "2026-11-02" }], paging: { cursors: { after: "c2" } } },
    ];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(pages[calls.length - 1]), { status: 200 });
    }) as typeof fetch;
    const out = await fetchMetaInsights({ accessToken: "tok", adAccountId: "1", since: "2026-11-01", until: "2026-11-02", fetchImpl: fakeFetch });
    expect(out).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[0].auth).toBe("Bearer tok");
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("c1");
  });

  it("marca limite de chamadas como erro retentável", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: "User request limit reached", code: 17 } }), { status: 400 })) as unknown as typeof fetch;
    const err = await fetchMetaInsights({ accessToken: "t", adAccountId: "1", since: "a", until: "b", fetchImpl: fakeFetch }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaApiError);
    expect(err.retryable).toBe(true);
  });
});
