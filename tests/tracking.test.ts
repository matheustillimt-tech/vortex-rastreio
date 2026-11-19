import { describe, expect, it } from "vitest";
import { ingestEvents, isOriginAllowed } from "@/lib/ingest/collect";
import { DEV_SITE_KEY, MemoryStore } from "@/lib/store/memory";
import { collectBatchSchema, type CollectEvent } from "@/lib/tracking/event-schema";
import { parseAttributionParams, referrerHost, sanitizePath, visitorIdFromCheckoutParam } from "@/lib/tracking/params";

describe("parseAttributionParams", () => {
  it("captura UTMs, click ids e ids de anúncio; ignora o resto", () => {
    const p = parseAttributionParams("?utm_source=fb&utm_campaign=BF&fbclid=abc&ad_id=123&email=a@b.com&token=x");
    expect(p).toEqual({ utm_source: "fb", utm_campaign: "BF", fbclid: "abc", ad_id: "123" });
  });

  it("descarta macros não substituídas", () => {
    expect(parseAttributionParams("campaign_id={{campaign.id}}&ad_id=__CID__&utm_source=x")).toEqual({ utm_source: "x" });
  });

  it("usa utm_id como campaign_id", () => {
    expect(parseAttributionParams("utm_id=999").campaign_id).toBe("999");
  });
});

describe("helpers", () => {
  it("visitor id do sck", () => {
    expect(visitorIdFromCheckoutParam("rst_abcdef123456")).toBe("abcdef123456");
    expect(visitorIdFromCheckoutParam("afiliado|rst_abcdef123456")).toBe("abcdef123456");
    expect(visitorIdFromCheckoutParam("rst_<script>")).toBeNull();
    expect(visitorIdFromCheckoutParam(null)).toBeNull();
  });

  it("guarda só o caminho e o host", () => {
    expect(sanitizePath("https://site.com/obrigado?email=a@b.com#x")).toBe("/obrigado");
    expect(referrerHost("https://l.facebook.com/l.php?u=x")).toBe("l.facebook.com");
    expect(referrerHost("lixo")).toBeNull();
  });
});

function ev(over: Partial<CollectEvent> = {}): CollectEvent {
  return {
    k: DEV_SITE_KEY,
    eid: "evt000000001",
    vid: "visitor000001",
    sid: "session00001",
    type: "pageview",
    url: "https://loja.com/oferta?utm_source=facebook&fbclid=abc",
    ref: "https://l.facebook.com/",
    q: "utm_source=facebook&fbclid=abc",
    ts: Date.parse("2026-11-01T12:00:00Z"),
    ...over,
  };
}

describe("ingestEvents", () => {
  it("grava sessão com origem e deduplica eventos", async () => {
    const store = MemoryStore.withDevFixtures();
    const site = (await store.findSiteByPublicKey(DEV_SITE_KEY))!;
    const now = Date.parse("2026-11-01T12:00:05Z");
    const r1 = await ingestEvents(store, site, [ev(), ev({ eid: "evt000000002", type: "lead" })], now);
    const r2 = await ingestEvents(store, site, [ev()], now);
    expect(r1).toEqual({ inserted: 2, duplicates: 0 });
    expect(r2).toEqual({ inserted: 0, duplicates: 1 });
    const session = [...store.sessions.values()][0];
    expect(session).toMatchObject({ visitorId: "visitor000001", landingPath: "/oferta", referrerHost: "l.facebook.com", params: { utm_source: "facebook", fbclid: "abc" } });
  });

  it("corrige relógio do navegador muito errado", async () => {
    const store = MemoryStore.withDevFixtures();
    const site = (await store.findSiteByPublicKey(DEV_SITE_KEY))!;
    const now = Date.parse("2026-11-01T12:00:00Z");
    await ingestEvents(store, site, [ev({ ts: Date.parse("2030-01-01T00:00:00Z") })], now);
    expect([...store.events.values()][0].occurredAt).toBe("2026-11-01T12:00:00.000Z");
  });

  it("valida o schema do lote", () => {
    expect(collectBatchSchema.safeParse({ events: [ev()] }).success).toBe(true);
    expect(collectBatchSchema.safeParse({ events: [ev({ k: "chave-ruim" })] }).success).toBe(false);
    expect(collectBatchSchema.safeParse({ events: [] }).success).toBe(false);
  });

  it("CORS por origem com curinga", () => {
    const site = { id: "s", workspaceId: "w", publicKey: "k", allowedOrigins: ["https://loja.com", "*.minhaloja.com.br"] };
    expect(isOriginAllowed(site, "https://loja.com")).toBe(true);
    expect(isOriginAllowed(site, "https://lp.minhaloja.com.br")).toBe(true);
    expect(isOriginAllowed(site, "https://evil.com")).toBe(false);
    expect(isOriginAllowed(site, "https://minhaloja.com.br.evil.com")).toBe(false);
    expect(isOriginAllowed(site, null)).toBe(false);
  });
});
