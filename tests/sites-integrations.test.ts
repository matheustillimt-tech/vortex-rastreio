import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_USER_ID } from "@/lib/db/client";
import { createPgliteDb } from "@/lib/db/pglite";
import { ingestEvents } from "@/lib/ingest/collect";
import { handleKiwifyWebhook } from "@/lib/ingest/kiwify-webhook";
import { encryptSecret, hmacHex } from "@/lib/security/crypto";
import { PostgresStore } from "@/lib/store/postgres";
import { DEV_WORKSPACE_ID } from "@/lib/store/memory";
import { normalizeOrigin, parseOrigins } from "@/lib/tracking/origins";
import {
  createKiwifyIntegration,
  createSite,
  listIntegrations,
  listSites,
  setIntegrationStatus,
  setKiwifySigningSecret,
  updateSite,
} from "@/lib/workspace/repo";
import { kiwifyPayload } from "./fixtures/kiwify";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

describe("domínios autorizados", () => {
  it("normaliza e valida", () => {
    expect(normalizeOrigin("Loja.com.br/")).toEqual({ ok: true, value: "https://loja.com.br" });
    expect(normalizeOrigin("https://lp.loja.com")).toEqual({ ok: true, value: "https://lp.loja.com" });
    expect(normalizeOrigin("*.loja.com")).toEqual({ ok: true, value: "*.loja.com" });
    expect(normalizeOrigin("http://localhost:3000")).toEqual({ ok: true, value: "http://localhost:3000" });
    expect(normalizeOrigin("http://loja.com").ok).toBe(false);
    expect(normalizeOrigin("https://loja.com/pagina").ok).toBe(false);
    expect(normalizeOrigin("https://user:pw@loja.com").ok).toBe(false);
    expect(normalizeOrigin("*.com").ok).toBe(false);
    expect(normalizeOrigin("javascript:alert(1)").ok).toBe(false);
    const p = parseOrigins("loja.com, loja.com\n*.loja.com, ruim/caminho");
    expect(p.origins).toEqual(["https://loja.com", "*.loja.com"]);
    expect(p.errors).toHaveLength(1);
  });
});

describe("sites e integrações (banco local, RLS real)", () => {
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  let store: PostgresStore;
  const OTHER = "00000000-0000-4000-8000-0000000000bb";
  let otherWs = "";

  beforeAll(async () => {
    db = await createPgliteDb({ seed: true });
    store = new PostgresStore(db);
    await db.sql.exec(`insert into auth.users (id, email_confirmed_at) values ('${OTHER}', now())`);
    otherWs = (await db.sql.query<{ id: string }>("select rastro.create_workspace($1, 'Outro') id", [OTHER]))[0].id;
  }, 30_000);
  afterAll(() => db.close());

  it("cria site com chave exclusiva e só no próprio workspace", async () => {
    const site = await createSite(db, DEV_USER_ID, DEV_WORKSPACE_ID, "Loja", ["https://loja.com"]);
    expect(site?.publicKey).toMatch(/^pk_[a-f0-9]{32}$/);
    await expect(createSite(db, DEV_USER_ID, otherWs, "Invasão", [])).rejects.toThrow(/row-level security/);
    const mine = await listSites(db, DEV_USER_ID, DEV_WORKSPACE_ID);
    expect(mine.map((s) => s.name)).toEqual(["Site local", "Loja"]);
    expect(await listSites(db, OTHER, DEV_WORKSPACE_ID)).toEqual([]);
  });

  it("edita, desativa (para de receber eventos) e reativa", async () => {
    const site = (await listSites(db, DEV_USER_ID, DEV_WORKSPACE_ID)).find((s) => s.name === "Loja")!;
    expect(await updateSite(db, DEV_USER_ID, DEV_WORKSPACE_ID, site.id, { name: "Loja oficial", origins: ["https://loja.com", "*.loja.com"] })).toBe(true);
    expect(await updateSite(db, OTHER, DEV_WORKSPACE_ID, site.id, { name: "x" })).toBe(false);
    expect(await updateSite(db, OTHER, otherWs, site.id, { name: "x" })).toBe(false);

    expect(await updateSite(db, DEV_USER_ID, DEV_WORKSPACE_ID, site.id, { status: "disabled" })).toBe(true);
    expect(await store.findSiteByPublicKey(site.publicKey)).toBeNull();
    await updateSite(db, DEV_USER_ID, DEV_WORKSPACE_ID, site.id, { status: "active" });
    const active = await store.findSiteByPublicKey(site.publicKey);
    expect(active?.allowedOrigins).toEqual(["https://loja.com", "*.loja.com"]);
    const r = await ingestEvents(store, active!, [
      { k: site.publicKey, eid: "evtsite00001", vid: "visitsite0001", sid: "sesssite0001", type: "pageview", url: "https://loja.com/", ts: Date.now() },
    ]);
    expect(r.inserted).toBe(1);
  });

  it("Kiwify: sem token não recebe; com token valida assinatura; mostra estado; troca de token aceita o anterior", async () => {
    const { id, token } = await createKiwifyIntegration(db, DEV_USER_ID, DEV_WORKSPACE_ID, "Kiwify teste");
    const send = (body: object, secret?: string) => {
      const raw = JSON.stringify(body);
      return handleKiwifyWebhook({ store, urlToken: token, rawBody: raw, signature: secret ? hmacHex("sha1", secret, raw) : null });
    };
    // 1) sem token configurado → recusa e registra o motivo
    expect((await send(kiwifyPayload({ order_id: "k1" }))).status).toBe(401);
    let view = (await listIntegrations(db, DEV_USER_ID, DEV_WORKSPACE_ID)).find((i) => i.id === id)!;
    expect(view).toMatchObject({ hasSigningSecret: false, lastEventAt: null, lastError: expect.stringMatching(/token de assinatura/) });

    // 2) outro workspace não consegue configurar o token
    expect(await setKiwifySigningSecret(db, OTHER, id, encryptSecret("intruso"))).toBe(false);
    // 3) admin configura
    expect(await setKiwifySigningSecret(db, DEV_USER_ID, id, encryptSecret("token-1"))).toBe(true);
    expect((await send(kiwifyPayload({ order_id: "k1" }), "token-1")).status).toBe(200);
    view = (await listIntegrations(db, DEV_USER_ID, DEV_WORKSPACE_ID)).find((i) => i.id === id)!;
    expect(view).toMatchObject({ hasSigningSecret: true, lastError: null });
    expect(view.lastEventAt).not.toBeNull();

    // 4) troca: token novo e antigo valem; terceiro não
    expect(await setKiwifySigningSecret(db, DEV_USER_ID, id, encryptSecret("token-2"))).toBe(true);
    expect((await send(kiwifyPayload({ order_id: "k2" }), "token-2")).status).toBe(200);
    expect((await send(kiwifyPayload({ order_id: "k3" }), "token-1")).status).toBe(200);
    expect((await send(kiwifyPayload({ order_id: "k4" }), "token-x")).status).toBe(401);
    // 5) depois de 48 h o antigo deixa de valer
    await db.sql.query("update rastro.integrations set signing_secret_rotated_at = now() - interval '49 hours' where id = $1", [id]);
    expect((await send(kiwifyPayload({ order_id: "k5" }), "token-1")).status).toBe(401);
    // 6) pausada → não recebe
    expect(await setIntegrationStatus(db, DEV_USER_ID, DEV_WORKSPACE_ID, id, "paused")).toBe(true);
    expect((await send(kiwifyPayload({ order_id: "k6" }), "token-2")).status).toBe(401);
  });

  it("segredo precisa chegar cifrado (a função recusa texto puro)", async () => {
    const { id } = await createKiwifyIntegration(db, DEV_USER_ID, DEV_WORKSPACE_ID, "outra");
    await expect(setKiwifySigningSecret(db, DEV_USER_ID, id, "texto-puro")).rejects.toThrow(/cifrado/);
  });
});
