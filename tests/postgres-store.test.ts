import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DEV_USER_ID } from "@/lib/db/client";
import { createPgliteDb } from "@/lib/db/pglite";
import { ingestEvents } from "@/lib/ingest/collect";
import { handleKiwifyWebhook } from "@/lib/ingest/kiwify-webhook";
import { PostgresStore } from "@/lib/store/postgres";
import { DEV_KIWIFY_WEBHOOK_TOKEN, DEV_SITE_KEY, DEV_WORKSPACE_ID } from "@/lib/store/memory";
import { getMembership, loadWorkspaceData } from "@/lib/workspace/repo";
import { kiwifyPayload } from "./fixtures/kiwify";

const dir = mkdtempSync(join(tmpdir(), "rastro-pglite-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOW = Date.parse("2026-11-01T12:00:00Z");

describe("PostgresStore sobre o schema rastro (role rastro_app)", () => {
  it("fluxo completo persiste e sobrevive a reinício", async () => {
    // 1ª "execução do servidor"
    const db1 = await createPgliteDb({ dataDir: dir, seed: true });
    const store1 = new PostgresStore(db1);
    const site = (await store1.findSiteByPublicKey(DEV_SITE_KEY))!;
    expect(site.workspaceId).toBe(DEV_WORKSPACE_ID);

    const event = {
      k: DEV_SITE_KEY, eid: "evt000000001", vid: "visitor000001", sid: "session00001", type: "pageview" as const,
      url: "https://loja.com/oferta?utm_source=facebook&fbclid=abc", ref: null,
      q: "utm_source=facebook&utm_campaign=Black%20Friday&fbclid=abc&campaign_id=120000001&ad_id=120000009", ts: NOW - 3600_000,
    };
    expect(await ingestEvents(store1, site, [event, { ...event, eid: "evt000000002", type: "lead" }], NOW)).toEqual({ inserted: 2, duplicates: 0 });
    expect(await ingestEvents(store1, site, [event], NOW)).toEqual({ inserted: 0, duplicates: 1 });

    const call = (store: PostgresStore, body: object) =>
      handleKiwifyWebhook({ store, urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: JSON.stringify(body), signature: null, now: new Date(NOW) });

    const first = await call(store1, kiwifyPayload());
    expect(first).toMatchObject({ status: 200, body: { attribution: "click_id" } });
    expect((await call(store1, kiwifyPayload())).body).toMatchObject({ duplicate: true });
    expect((await call(store1, kiwifyPayload({ order_status: "nao_existe" }))).status).toBe(200); // ignorado
    expect((await call(store1, kiwifyPayload(), )).status).toBe(200);
    await db1.close();

    // 2ª "execução": mesmo diretório, nada se perde, migrations não reaplicam
    const db2 = await createPgliteDb({ dataDir: dir, seed: true });
    const store2 = new PostgresStore(db2);
    const order = await store2.getOrder(DEV_WORKSPACE_ID, "kiwify", "kw-0001");
    expect(order).toMatchObject({ status: "approved", platform: "meta", campaignId: "120000001", adId: "120000009", grossCents: 19700 });
    expect(await store2.recentEvents(DEV_WORKSPACE_ID, 10)).toHaveLength(2);

    // reembolso chega depois do reinício; aprovado atrasado não desfaz
    await call(store2, kiwifyPayload({ order_status: "refunded", webhook_event_type: "order_refunded", refunded_at: "2026-11-02 09:00" }));
    await call(store2, kiwifyPayload());
    expect((await store2.getOrder(DEV_WORKSPACE_ID, "kiwify", "kw-0001"))?.status).toBe("refunded");

    // painel do usuário dev lê o que foi persistido
    const m = await getMembership(db2, DEV_USER_ID);
    expect(m).toMatchObject({ workspaceId: DEV_WORKSPACE_ID, role: "owner" });
    const data = await loadWorkspaceData(db2, DEV_USER_ID, DEV_WORKSPACE_ID, "2026-10-01", "2026-11-30");
    expect(data.hasAnyData).toBe(true);
    expect(data.orders).toHaveLength(1);
    expect(data.products).toEqual([{ id: "prod-1", name: "Curso Exemplo" }]);
    expect(data.campaigns).toEqual([{ platform: "meta", id: "120000001", name: "Black Friday" }]);

    // payload guardado sem PII
    const raw = await db2.sql.query<{ p: string }>("select payload::text p from rastro.webhook_events");
    expect(raw.map((r) => r.p).join()).not.toMatch(/Pessoa|mobile|CPF|Exemplo\.com/);
    await db2.close();
  }, 60_000);

  it("webhook com token desconhecido não grava nada", async () => {
    const db = await createPgliteDb({ seed: true });
    const store = new PostgresStore(db);
    const r = await handleKiwifyWebhook({ store, urlToken: "x", rawBody: JSON.stringify(kiwifyPayload()), signature: null });
    expect(r.status).toBe(401);
    expect(await db.sql.query("select 1 from rastro.webhook_events")).toEqual([]);
    await db.close();
  }, 30_000);
});
