import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { brasiliaToIso, centsFromBrl, centsFromDecimal, centsFromInteger } from "@/lib/domain/money";
import { DEV_USER_ID } from "@/lib/db/client";
import { createPgliteDb } from "@/lib/db/pglite";
import { handleWebhook } from "@/lib/ingest/webhook";
import { getAdapter, isCheckoutProvider, PLANNED_PROVIDERS } from "@/lib/integrations/adapters";
import { kirvanoAdapter, mapKirvanoEvent } from "@/lib/integrations/adapters/kirvano";
import { kiwifyAdapter } from "@/lib/integrations/adapters/kiwify";
import { hashEmail, hmacHex, sha256Hex } from "@/lib/security/crypto";
import { DEV_KIWIFY_WEBHOOK_TOKEN, DEV_WORKSPACE_ID, MemoryStore } from "@/lib/store/memory";
import { PostgresStore } from "@/lib/store/postgres";
import type { Integration } from "@/lib/store/types";
import { healthState, loadIntegrationHealth, type IntegrationHealth } from "@/lib/workspace/health";
import { kirvanoPayload } from "./fixtures/kirvano";
import { kiwifyPayload } from "./fixtures/kiwify";

// tokens fictícios de URL de webhook (só testes)
const TOK_KIRVANO = "tok-kirvano-000000";
const TOK_OUTRA_KIWIFY = "outra-conta-kiwify-0001";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
const NOW = new Date("2026-11-01T15:00:00Z");

describe("valores e horários", () => {
  it("converte cada formato sem ponto flutuante e recusa o que não reconhece", () => {
    expect(centsFromInteger(19700)).toBe(19700);
    expect(centsFromInteger("9700")).toBe(9700);
    expect(centsFromInteger(19.7)).toBeNull();
    expect(centsFromInteger(-1)).toBeNull();
    expect(centsFromDecimal("197.00")).toBe(19700);
    expect(centsFromDecimal("0.1")).toBe(10);
    expect(centsFromDecimal(197.5)).toBe(19750);
    expect(centsFromDecimal("1,00")).toBeNull();
    expect(centsFromBrl("R$ 169,80")).toBe(16980);
    expect(centsFromBrl("R$ 1.169,80")).toBe(116980);
    expect(centsFromBrl("R$ 97")).toBe(9700);
    expect(centsFromBrl("169,8")).toBe(16980);
    expect(centsFromBrl("R$ 12.345.678,09")).toBe(1234567809);
    expect(centsFromBrl("R$ 1,169.80")).toBeNull();
    expect(centsFromBrl("abc")).toBeNull();
    expect(centsFromBrl(169.8)).toBeNull();
  });

  it("horário de Brasília sem fuso vira UTC; com fuso é respeitado", () => {
    expect(brasiliaToIso("2026-11-01 10:00:00")).toBe("2026-11-01T13:00:00.000Z");
    expect(brasiliaToIso("2026-11-01 10:00")).toBe("2026-11-01T13:00:00.000Z");
    expect(brasiliaToIso("2026-11-01T10:00:00Z")).toBe("2026-11-01T10:00:00.000Z");
    expect(brasiliaToIso("ontem")).toBeNull();
    expect(brasiliaToIso(null)).toBeNull();
  });
});

describe("registro de adaptadores", () => {
  it("só Kiwify e Kirvano têm rota; as demais são previstas", () => {
    expect(getAdapter("kiwify")).toBe(kiwifyAdapter);
    expect(getAdapter("kirvano")).toBe(kirvanoAdapter);
    for (const p of ["hotmart", "payt", "pagtrust", "perfectpay", "meta", "toString", "__proto__"]) expect(getAdapter(p)).toBeNull();
    expect(PLANNED_PROVIDERS.every((p) => p.auth.documented === false)).toBe(true);
    expect(isCheckoutProvider("payt")).toBe(true);
    expect(isCheckoutProvider("meta")).toBe(false);
  });

  it("autenticação: Kiwify documentada; Kirvano não (recusa fora do banco local)", () => {
    expect(kiwifyAdapter.auth.documented).toBe(true);
    expect(kirvanoAdapter.auth.documented).toBe(false);
    const real: Integration = { id: "i", workspaceId: "w", provider: "kirvano", workspaceKind: "production", signingSecrets: ["qualquer"], allowUnsigned: false };
    const req = { rawBody: "{}", query: new URLSearchParams(), headers: new Headers({ authorization: "Bearer x" }) };
    expect(kirvanoAdapter.authenticate(req, real)).toMatchObject({ ok: false });
    expect(kirvanoAdapter.authenticate(req, { ...real, allowUnsigned: true })).toEqual({ ok: true });
  });
});

describe("Kirvano: leitura do payload oficial", () => {
  it("normaliza valor em reais, produto principal (não o order bump), datas e rastreio por src", () => {
    const r = kirvanoAdapter.parse(kirvanoPayload(), NOW);
    expect(r.kind).toBe("order");
    if (r.kind !== "order") return;
    expect(r.eventType).toBe("SALE_APPROVED");
    expect(r.isTest).toBe(false);
    expect(r.order).toMatchObject({
      provider: "kirvano",
      externalId: "kv-0001",
      status: "approved",
      grossCents: 116980,
      netCents: null,
      feeCents: null,
      productId: "prod-kv",
      productName: "Curso Kirvano",
      paymentMethod: "PIX",
      createdAt: "2026-11-01T13:00:00.000Z",
      approvedAt: "2026-11-01T13:02:00.000Z",
      refundedAt: null,
      tracking: { src: "rst_visitor000001", utm_campaign: "Black Friday" },
    });
    expect(r.order.tracking.sck).toBeUndefined();
    expect(r.order.customerEmailHash).toBe(hashEmail("pessoa@exemplo.com"));
  });

  it("mapeia os eventos documentados", () => {
    expect(mapKirvanoEvent("SALE_APPROVED")).toBe("approved");
    expect(mapKirvanoEvent("PIX_GENERATED")).toBe("pending");
    expect(mapKirvanoEvent("BANK_SLIP_GENERATED")).toBe("pending");
    expect(mapKirvanoEvent("SALE_REFUSED")).toBe("cancelled");
    expect(mapKirvanoEvent("PIX_EXPIRED")).toBe("cancelled");
    expect(mapKirvanoEvent("BANK_SLIP_EXPIRED")).toBe("cancelled");
    expect(mapKirvanoEvent("SALE_REFUNDED")).toBe("refunded");
    expect(mapKirvanoEvent("SALE_CHARGEBACK")).toBe("chargeback");
    for (const e of ["ABANDONED_CART", "SUBSCRIPTION_RENEWED", "SUBSCRIPTION_CANCELED", "SUBSCRIPTION_EXPIRED", "ALGO_NOVO"]) {
      expect(mapKirvanoEvent(e)).toBeNull();
    }
    const refund = kirvanoAdapter.parse(kirvanoPayload({ event: "SALE_REFUNDED" }), NOW);
    expect(refund.kind === "order" && refund.order.refundedAt).toBe(NOW.toISOString());
  });

  it("eventos sem venda são ignorados; formato inesperado é inválido (nunca inventa valor)", () => {
    expect(kirvanoAdapter.parse(kirvanoPayload({ event: "ABANDONED_CART" }))).toMatchObject({ kind: "ignored" });
    expect(kirvanoAdapter.parse({ foo: 1 })).toMatchObject({ kind: "invalid" });
    expect(kirvanoAdapter.parse(kirvanoPayload({ total_price: "US$ 10.00" }))).toMatchObject({ kind: "invalid" });
    expect(kirvanoAdapter.parse(kirvanoPayload({ total_price: 169.8 }))).toMatchObject({ kind: "invalid" });
  });

  it("remove dados pessoais e de pagamento do payload guardado", () => {
    const s = kirvanoAdapter.stripPii(kirvanoPayload({ checkout_url: "https://pay.kirvano.com/x" })) as Record<string, unknown>;
    expect(s.customer).toBeUndefined();
    expect(s.checkout_url).toBeUndefined();
    expect((s.payment as Record<string, unknown>).qrcode).toBeUndefined();
    expect((s.payment as Record<string, unknown>).method).toBe("PIX");
    expect(JSON.stringify(s)).not.toMatch(/Exemplo\.com|00000000000/);
  });

  it("chave de duplicidade inclui a plataforma: mesma id na Kiwify e na Kirvano não colide", () => {
    const o = { externalId: "123", status: "approved" as const };
    expect(kirvanoAdapter.dedupeKey("w", o, "SALE_APPROVED")).not.toBe(kiwifyAdapter.dedupeKey("w", o, "SALE_APPROVED"));
    expect(kirvanoAdapter.dedupeKey("w", o, "sale_approved")).toBe(kirvanoAdapter.dedupeKey("w", o, "SALE_APPROVED"));
    // Kiwify mantém exatamente a chave antiga (webhooks já gravados continuam deduplicando)
    expect(kiwifyAdapter.dedupeKey("w", o, "order_approved")).toBe(sha256Hex("w:kiwify:123:order_approved"));
  });
});

describe("handler genérico (memória)", () => {
  function storeWithKirvano(allowUnsigned: boolean) {
    const s = MemoryStore.withDevFixtures();
    s.integrations.push({
      id: "int-kirvano",
      workspaceId: DEV_WORKSPACE_ID,
      provider: "kirvano",
      workspaceKind: "production",
      signingSecrets: [],
      allowUnsigned,
      tokenHash: sha256Hex(TOK_KIRVANO),
    });
    return s;
  }
  const kirvano = (store: MemoryStore, body: object) =>
    handleWebhook({ store, provider: "kirvano", urlToken: TOK_KIRVANO, rawBody: JSON.stringify(body), now: NOW });

  it("plataforma sem adaptador: 404 sem consultar integrações", async () => {
    const r = await handleWebhook({ store: new MemoryStore(), provider: "hotmart", urlToken: "x", rawBody: "{}" });
    expect(r.status).toBe(404);
  });

  it("token da URL não substitui a autenticação oficial: Kirvano real é recusada e contada", async () => {
    const store = storeWithKirvano(false);
    const r = await kirvano(store, kirvanoPayload());
    expect(r).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(store.orders.size).toBe(0);
    expect(store.webhooks.size).toBe(0);
    expect(store.activity.get("int-kirvano:2026-11-01")).toMatchObject({ received: 1, auth_failed: 1, processed: 0 });
    expect(store.health.get("int-kirvano")).toMatchObject({ ok: false, error: expect.stringMatching(/Kirvano/) });
  });

  it("token de outra plataforma não abre a rota da Kirvano", async () => {
    const store = storeWithKirvano(true);
    const r = await handleWebhook({ store, provider: "kirvano", urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: JSON.stringify(kirvanoPayload()) });
    expect(r.status).toBe(401);
  });

  it("Kirvano no banco local: fluxo completo, duplicado, fora de ordem e contadores", async () => {
    const store = storeWithKirvano(true);
    expect(await kirvano(store, kirvanoPayload())).toMatchObject({ status: 200, body: { ok: true, status: "approved" } });
    expect((await kirvano(store, kirvanoPayload())).body).toMatchObject({ duplicate: true });
    // reembolso, e depois um "aprovado" atrasado de outra entrega: não desfaz
    await kirvano(store, kirvanoPayload({ event: "SALE_REFUNDED" }));
    await kirvano(store, kirvanoPayload({ event: "PIX_GENERATED" }));
    const o = await store.getOrder(DEV_WORKSPACE_ID, "kirvano", "kv-0001");
    expect(o).toMatchObject({ status: "refunded", grossCents: 116980, integrationId: "int-kirvano" });
    expect((await kirvano(store, kirvanoPayload({ event: "ABANDONED_CART" }))).body).toEqual({ ignored: true });
    expect((await handleWebhook({ store, provider: "kirvano", urlToken: TOK_KIRVANO, rawBody: "{nao json", now: NOW })).status).toBe(400);
    expect(store.activity.get("int-kirvano:2026-11-01")).toEqual({
      received: 6, processed: 3, duplicate: 1, ignored: 1, failed: 0, auth_failed: 0, invalid: 1,
    });
  });

  it("mesma id em Kiwify e Kirvano viram dois pedidos separados", async () => {
    const store = storeWithKirvano(true);
    await kirvano(store, kirvanoPayload({ sale_id: "123" }));
    await handleWebhook({ store, provider: "kiwify", urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: JSON.stringify(kiwifyPayload({ order_id: "123" })) });
    expect(await store.getOrder(DEV_WORKSPACE_ID, "kirvano", "123")).toMatchObject({ integrationId: "int-kirvano", grossCents: 116980 });
    expect(await store.getOrder(DEV_WORKSPACE_ID, "kiwify", "123")).toMatchObject({ integrationId: "int-kiwify-dev", grossCents: 19700 });
  });

  it("pedido de outra conta da mesma plataforma não é mesclado (409, sem reprocessar)", async () => {
    const store = MemoryStore.withDevFixtures();
    store.integrations.push({ ...store.integrations[0], id: "int-kiwify-2", tokenHash: sha256Hex(TOK_OUTRA_KIWIFY) });
    const raw = JSON.stringify(kiwifyPayload());
    expect((await handleWebhook({ store, provider: "kiwify", urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: raw })).status).toBe(200);
    const r = await handleWebhook({ store, provider: "kiwify", urlToken: TOK_OUTRA_KIWIFY, rawBody: JSON.stringify(kiwifyPayload({ order_status: "refunded", webhook_event_type: "order_refunded" })) });
    expect(r.status).toBe(409);
    expect((await store.getOrder(DEV_WORKSPACE_ID, "kiwify", "kw-0001"))?.status).toBe("approved");
    const failed = [...store.webhooks.values()].find((w) => w.integrationId === "int-kiwify-2")!;
    expect(failed).toMatchObject({ status: "failed", nextRetryAt: null });
  });

  describe("evento marcado como teste pela plataforma", () => {
    afterEach(() => vi.restoreAllMocks());
    // nenhuma plataforma ativa marca teste hoje (a Payt fará): simulamos o adaptador devolvendo isTest
    function markAsTest() {
      const real = kirvanoAdapter.parse.bind(kirvanoAdapter);
      vi.spyOn(kirvanoAdapter, "parse").mockImplementation((body, now) => {
        const r = real(body, now);
        return r.kind === "order" ? { ...r, isTest: true } : r;
      });
    }

    it("em workspace de PRODUÇÃO não vira venda, não grava webhook e conta como ignorado", async () => {
      const store = storeWithKirvano(true);
      markAsTest();
      const r = await kirvano(store, kirvanoPayload());
      expect(r).toEqual({ status: 200, body: { ignored: true, test: true } });
      expect(store.orders.size).toBe(0);
      expect(store.webhooks.size).toBe(0);
      expect(store.activity.get("int-kirvano:2026-11-01")).toMatchObject({ received: 1, ignored: 1, processed: 0 });
    });

    it("em workspace de LABORATÓRIO entra normalmente (para simular)", async () => {
      const store = storeWithKirvano(true);
      store.integrations.find((i) => i.id === "int-kirvano")!.workspaceKind = "sandbox";
      markAsTest();
      expect((await kirvano(store, kirvanoPayload())).status).toBe(200);
      expect(await store.getOrder(DEV_WORKSPACE_ID, "kirvano", "kv-0001")).toMatchObject({ status: "approved" });
    });
  });

  it("Kiwify pelo handler genérico: assinatura oficial na query", async () => {
    const store = MemoryStore.withDevFixtures();
    store.integrations[0].signingSecrets = ["kiwify-token-de-teste"];
    store.integrations[0].allowUnsigned = false;
    const raw = '{"order_id":"9b1c2d3e-0000-4000-8000-000000000001","order_status":"paid","webhook_event_type":"order_approved"}';
    const send = (sig: string | null) =>
      handleWebhook({ store, provider: "kiwify", urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: raw, query: new URLSearchParams(sig ? { signature: sig } : {}) });
    expect((await send("bf18f352a4f981b91dfa3f6d8742a81080ab8c86")).status).toBe(200);
    expect((await send(hmacHex("sha1", "errado", raw))).status).toBe(401);
    expect((await send(null)).status).toBe(401);
  });
});

describe("contadores e saúde no banco (PGlite, roles reais)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rastro-adapters-"));
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  let store: PostgresStore;
  let kirvanoId = "";
  const VIEWER = "00000000-0000-4000-8000-0000000000cc";

  beforeAll(async () => {
    db = await createPgliteDb({ dataDir: dir, seed: true });
    store = new PostgresStore(db);
    const rows = await db.sql.query<{ id: string }>(
      `insert into rastro.integrations (workspace_id, provider, label, webhook_token_hash, config)
       values ($1, 'kirvano', 'Kirvano local', $2, '{"allow_unsigned": true}'::jsonb) returning id`,
      [DEV_WORKSPACE_ID, sha256Hex(TOK_KIRVANO)],
    );
    kirvanoId = rows[0].id;
    await db.sql.query("insert into auth.users (id, email) values ($1, 'viewer@exemplo.com') on conflict do nothing", [VIEWER]).catch(() => undefined);
    await db.sql.query("insert into rastro.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [DEV_WORKSPACE_ID, VIEWER]);
  });
  afterAll(async () => {
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("o webhook lê o tipo do workspace e grava integration_id no pedido", async () => {
    const integ = await store.findIntegrationByWebhookToken("kirvano", sha256Hex(TOK_KIRVANO));
    expect(integ).toMatchObject({ id: kirvanoId, workspaceKind: "production", allowUnsigned: true });
    const send = (body: object) => handleWebhook({ store, provider: "kirvano", urlToken: TOK_KIRVANO, rawBody: JSON.stringify(body), now: NOW });
    expect((await send(kirvanoPayload({ sale_id: "777" }))).status).toBe(200);
    expect((await send(kirvanoPayload({ sale_id: "777" }))).body).toMatchObject({ duplicate: true });
    expect((await send({ event: "SALE_APPROVED" })).status).toBe(400);
    await handleWebhook({ store, provider: "kiwify", urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: JSON.stringify(kiwifyPayload({ order_id: "777" })), now: NOW });

    const orders = await db.sql.query<{ provider: string; integration_id: string }>(
      "select provider, integration_id from rastro.orders where external_id = '777' order by provider",
    );
    expect(orders.map((o) => o.provider)).toEqual(["kirvano", "kiwify"]);
    expect(orders[1].integration_id).not.toBe(orders[0].integration_id);
    expect(orders[0].integration_id).toBe(kirvanoId);
  });

  it("contadores do dia (Brasília) e estado da integração, numa escrita por entrega", async () => {
    const stats = await db.sql.query<Record<string, number | string>>(
      "select day::text as day, received, processed, duplicates, ignored, failed, auth_failed, invalid from rastro.integration_daily_stats where integration_id = $1",
      [kirvanoId],
    );
    expect(stats).toEqual([{ day: "2026-11-01", received: 3, processed: 1, duplicates: 1, ignored: 0, failed: 0, auth_failed: 0, invalid: 1 }]);
    // inválido depois do válido: o erro fica visível; o último válido continua sendo o anterior
    const i = (await db.sql.query<Record<string, unknown>>("select last_received_at, last_event_at, last_error from rastro.integrations where id = $1", [kirvanoId]))[0];
    expect(i.last_received_at).not.toBeNull();
    expect(i.last_event_at).not.toBeNull();
    expect(String(i.last_error)).toMatch(/formato inesperado/);

    // uma entrega às 23h30 de Brasília conta no mesmo dia, não no seguinte (UTC)
    await store.recordIntegrationActivity({ id: kirvanoId, workspaceId: DEV_WORKSPACE_ID }, "processed", { now: new Date("2026-11-02T02:30:00Z") });
    const day1 = await db.sql.query<{ received: number }>("select received from rastro.integration_daily_stats where integration_id = $1 and day = '2026-11-01'", [kirvanoId]);
    expect(day1[0].received).toBe(4);
  });

  it("tela de saúde: dono vê contadores e fila; leitor não vê a fila; nenhum segredo sai", async () => {
    const owner = await loadIntegrationHealth(db, DEV_USER_ID, DEV_WORKSPACE_ID, new Date("2026-11-02T12:00:00Z"));
    const kv = owner.find((h) => h.id === kirvanoId)!;
    expect(kv).toMatchObject({ provider: "kirvano", providerLabel: "Kirvano", authDocumented: false, allowUnsigned: true, pendingRetries: 0, failedPermanently: 0 });
    expect(kv.last7d).toMatchObject({ received: 4, processed: 2, duplicates: 1, invalid: 1 });
    expect(kv.today.received).toBe(0);
    expect(JSON.stringify(owner)).not.toMatch(/signing_secret|token_hash|credentials/);
    expect(owner.some((h) => h.provider === "meta")).toBe(false);

    const viewer = await loadIntegrationHealth(db, VIEWER, DEV_WORKSPACE_ID, NOW);
    expect(viewer.find((h) => h.id === kirvanoId)).toMatchObject({ pendingRetries: null, failedPermanently: null });
    // outro workspace: nada
    expect(await loadIntegrationHealth(db, "00000000-0000-4000-8000-0000000000dd", DEV_WORKSPACE_ID, NOW)).toEqual([]);
  });
});

describe("estado de saúde (função pura)", () => {
  const base: IntegrationHealth = {
    id: "i", provider: "kiwify", providerLabel: "Kiwify", label: null, status: "active", hasSigningSecret: true, allowUnsigned: false,
    authDocumented: true, lastReceivedAt: null, lastEventAt: null, lastError: null,
    today: { received: 0, processed: 0, duplicates: 0, ignored: 0, failed: 0, authFailed: 0, invalid: 0 },
    last7d: { received: 0, processed: 0, duplicates: 0, ignored: 0, failed: 0, authFailed: 0, invalid: 0 },
    pendingRetries: 0, failedPermanently: 0,
  };
  const now = new Date("2026-11-10T12:00:00Z");
  it("cobre todos os estados", () => {
    expect(healthState({ ...base, status: "paused" }, now).state).toBe("paused");
    expect(healthState({ ...base, hasSigningSecret: false }, now).state).toBe("disconnected");
    expect(healthState({ ...base, provider: "kirvano", authDocumented: false }, now).state).toBe("blocked");
    expect(healthState({ ...base, provider: "payt", authDocumented: false }, now).state).toBe("blocked");
    expect(healthState(base, now).state).toBe("waiting");
    const recv = { ...base, lastReceivedAt: "2026-11-10T11:00:00Z", lastEventAt: "2026-11-10T11:00:00Z" };
    expect(healthState(recv, now).state).toBe("healthy");
    expect(healthState({ ...recv, lastError: "Evento recusado: assinatura inválida" }, now).state).toBe("failing");
    expect(healthState({ ...recv, pendingRetries: 2 }, now).state).toBe("attention");
    expect(healthState({ ...recv, lastEventAt: "2026-11-01T11:00:00Z" }, now)).toMatchObject({ state: "attention", text: expect.stringMatching(/9 dias/) });
  });
});
