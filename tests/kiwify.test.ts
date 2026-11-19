import { describe, expect, it } from "vitest";
import { handleKiwifyWebhook } from "@/lib/ingest/kiwify-webhook";
import { mapKiwifyStatus, normalizeKiwify, stripKiwifyPii, verifyKiwifySignature } from "@/lib/integrations/kiwify";
import { hashEmail, hmacHex, sha256Hex } from "@/lib/security/crypto";
import { DEV_KIWIFY_WEBHOOK_TOKEN, DEV_WORKSPACE_ID, MemoryStore } from "@/lib/store/memory";
import { kiwifyPayload } from "./fixtures/kiwify";

describe("normalizeKiwify", () => {
  it("normaliza valores, datas e rastreio", () => {
    const r = normalizeKiwify(kiwifyPayload());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order).toMatchObject({
      externalId: "kw-0001",
      status: "approved",
      grossCents: 19700,
      feeCents: 1970,
      netCents: 17730,
      productName: "Curso Exemplo",
      approvedAt: "2026-11-01T13:01:00.000Z",
      tracking: { sck: "rst_visitor000001", utm_campaign: "Black Friday" },
    });
    expect(r.order.customerEmailHash).toBe(hashEmail("pessoa@exemplo.com"));
  });

  it("aceita valores como string", () => {
    const r = normalizeKiwify(kiwifyPayload({ Commissions: { charge_amount: "9700" } }));
    expect(r.ok && r.order.grossCents).toBe(9700);
  });

  it("mapeia status e eventos", () => {
    expect(mapKiwifyStatus({ order_status: "refunded" })).toBe("refunded");
    expect(mapKiwifyStatus({ order_status: "chargedback" })).toBe("chargeback");
    expect(mapKiwifyStatus({ order_status: "waiting_payment" })).toBe("pending");
    expect(mapKiwifyStatus({ webhook_event_type: "pix_created" })).toBe("pending");
    expect(mapKiwifyStatus({ order_status: "algo_novo" })).toBeNull();
  });

  it("evento não suportado não é erro", () => {
    const r = normalizeKiwify(kiwifyPayload({ order_status: "abandoned", webhook_event_type: "carrinho_abandonado" }));
    expect(r).toMatchObject({ ok: false, reason: "unsupported_event" });
  });

  it("rejeita payload sem order_id", () => {
    expect(normalizeKiwify({ foo: 1 })).toMatchObject({ ok: false, reason: "invalid_payload" });
  });
});

describe("assinatura e PII", () => {
  it("vetor de teste OFICIAL da Kiwify (docs › Receber e validar webhooks)", () => {
    const body = '{"order_id":"9b1c2d3e-0000-4000-8000-000000000001","order_status":"paid","webhook_event_type":"order_approved"}';
    expect(hmacHex("sha1", "kiwify-token-de-teste", body)).toBe("bf18f352a4f981b91dfa3f6d8742a81080ab8c86");
    expect(verifyKiwifySignature(body, "bf18f352a4f981b91dfa3f6d8742a81080ab8c86", "kiwify-token-de-teste")).toBe(true);
    expect(verifyKiwifySignature(body, "BF18F352A4F981B91DFA3F6D8742A81080AB8C86", "kiwify-token-de-teste")).toBe(true);
    expect(verifyKiwifySignature(body + " ", "bf18f352a4f981b91dfa3f6d8742a81080ab8c86", "kiwify-token-de-teste")).toBe(false);
  });

  it("verifica HMAC-SHA1 em tempo constante", () => {
    const body = JSON.stringify(kiwifyPayload());
    const sig = hmacHex("sha1", "segredo", body);
    expect(verifyKiwifySignature(body, sig, "segredo")).toBe(true);
    expect(verifyKiwifySignature(body, sig, "outro")).toBe(false);
    expect(verifyKiwifySignature(body + " ", sig, "segredo")).toBe(false);
    expect(verifyKiwifySignature(body, null, "segredo")).toBe(false);
  });

  it("remove dados pessoais do payload guardado", () => {
    const stripped = stripKiwifyPii(kiwifyPayload()) as Record<string, unknown>;
    expect(stripped.Customer).toBeUndefined();
    expect(stripped.card_last4digits).toBeUndefined();
    expect(JSON.stringify(stripped)).not.toContain("Exemplo.com");
  });
});

describe("handleKiwifyWebhook", () => {
  function setup() {
    const store = MemoryStore.withDevFixtures();
    const call = (body: object, opts: { token?: string; signature?: string | null } = {}) =>
      handleKiwifyWebhook({
        store,
        urlToken: opts.token ?? DEV_KIWIFY_WEBHOOK_TOKEN,
        rawBody: JSON.stringify(body),
        signature: opts.signature ?? null,
        now: new Date("2026-11-02T00:00:00Z"),
      });
    return { store, call };
  }

  it("recusa token desconhecido", async () => {
    const { call } = setup();
    expect((await call(kiwifyPayload(), { token: "errado" })).status).toBe(401);
  });

  it("exige assinatura quando o segredo está configurado", async () => {
    const { store, call } = setup();
    store.integrations[0].signingSecrets = ["segredo"];
    const body = kiwifyPayload();
    expect((await call(body)).status).toBe(401);
    const sig = hmacHex("sha1", "segredo", JSON.stringify(body));
    expect((await call(body, { signature: sig })).status).toBe(200);
    expect(store.health.get(store.integrations[0].id)).toMatchObject({ ok: true });
  });

  it("integração real sem segredo não recebe eventos (só a de dev local pode)", async () => {
    const { store, call } = setup();
    store.integrations[0].allowUnsigned = false;
    expect((await call(kiwifyPayload())).status).toBe(401);
    expect(store.orders.size).toBe(0);
    expect(store.health.get(store.integrations[0].id)).toMatchObject({ ok: false, error: expect.stringMatching(/token de assinatura/) });
  });

  it("durante a troca de token aceita o antigo e o novo", async () => {
    const { store, call } = setup();
    store.integrations[0].signingSecrets = ["novo", "antigo"];
    const body = kiwifyPayload();
    expect((await call(body, { signature: hmacHex("sha1", "antigo", JSON.stringify(body)) })).status).toBe(200);
    expect((await call(body, { signature: hmacHex("sha1", "outro", JSON.stringify(body)) })).status).toBe(401);
  });

  it("eventos de assinatura (subscription_*) não mexem no status da venda", async () => {
    const { store, call } = setup();
    await call(kiwifyPayload());
    const r = await call(kiwifyPayload({ webhook_event_type: "subscription_canceled", order_status: "refunded" }));
    expect(r.body).toMatchObject({ ignored: true });
    expect((await store.getOrder(store.integrations[0].workspaceId, "kiwify", "kw-0001"))?.status).toBe("approved");
  });

  it("atribui pela sessão do visitante devolvida no sck", async () => {
    const { store, call } = setup();
    await store.ensureSession({
      id: "site-dev:s1",
      workspaceId: DEV_WORKSPACE_ID,
      siteId: "site-dev",
      visitorId: "visitor000001",
      startedAt: "2026-10-31T12:00:00Z",
      landingPath: "/",
      referrerHost: null,
      params: { fbclid: "abc", utm_campaign: "Black Friday", campaign_id: "120000001", ad_id: "120000009" },
    });
    const res = await call(kiwifyPayload());
    expect(res).toMatchObject({ status: 200, body: { attribution: "click_id" } });
    const order = await store.getOrder(DEV_WORKSPACE_ID, "kiwify", "kw-0001");
    expect(order).toMatchObject({ platform: "meta", campaignId: "120000001", adId: "120000009" });
  });

  it("é idempotente: o mesmo webhook 3x gera um pedido e um evento", async () => {
    const { store, call } = setup();
    await call(kiwifyPayload());
    const second = await call(kiwifyPayload());
    await call(kiwifyPayload());
    expect(second.body).toMatchObject({ duplicate: true });
    expect(store.orders.size).toBe(1);
    expect(store.webhooks.size).toBe(1);
  });

  it("reembolso fora de ordem não volta para aprovado", async () => {
    const { store, call } = setup();
    await call(kiwifyPayload({ order_status: "refunded", webhook_event_type: "order_refunded", refunded_at: "2026-11-03 09:00" }));
    await call(kiwifyPayload()); // aprovado chega atrasado
    const order = await store.getOrder(DEV_WORKSPACE_ID, "kiwify", "kw-0001");
    expect(order?.status).toBe("refunded");
    expect(order?.approvedAt).not.toBeNull();
    expect(store.webhooks.size).toBe(2);
  });

  it("guarda o webhook sem PII", async () => {
    const { store, call } = setup();
    await call(kiwifyPayload());
    const saved = [...store.webhooks.values()][0];
    expect(JSON.stringify(saved.payload)).not.toMatch(/Pessoa|mobile|CPF/);
    expect(saved.dedupeKey).not.toBe(sha256Hex("kiwify:kw-0001:approved"));
  });
});
