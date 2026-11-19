import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_USER_ID } from "@/lib/db/client";
import { createPgliteDb } from "@/lib/db/pglite";
import { listActiveMetaIntegrations, syncMetaIntegration } from "@/lib/integrations/meta-sync";
import { encryptSecret } from "@/lib/security/crypto";
import { DEV_WORKSPACE_ID } from "@/lib/store/memory";
import { listIntegrations, loadWorkspaceData, saveMetaIntegration } from "@/lib/workspace/repo";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

const row = (date: string, spend: string) => ({
  date_start: date, campaign_id: "c1", campaign_name: "Campanha 1", adset_id: "s1", ad_id: "a1", ad_name: "Anúncio 1",
  spend, impressions: "1000", clicks: "20", actions: [{ action_type: "purchase", value: "2" }],
});

function fakeFetch(pages: unknown[], calls: string[] = []) {
  return (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-fake");
    return new Response(JSON.stringify(pages.shift() ?? { data: [] }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("sincronização Meta Ads (API simulada, banco local)", () => {
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  const now = new Date("2026-11-12T12:00:00Z");

  beforeAll(async () => {
    db = await createPgliteDb({ seed: true });
    await saveMetaIntegration(db, DEV_USER_ID, DEV_WORKSPACE_ID, "act_123", encryptSecret("token-fake"));
  }, 30_000);
  afterAll(() => db.close());

  it("1ª sincronização busca 30 dias, grava e registra data", async () => {
    const [integ] = await listActiveMetaIntegrations(db);
    const calls: string[] = [];
    const r = await syncMetaIntegration(db, integ, { now, fetchImpl: fakeFetch([{ data: [row("2026-11-11", "10.50"), row("2026-11-12", "5.00")] }], calls) });
    expect(r).toMatchObject({ outcome: "ok", rows: 2 });
    expect(JSON.parse(new URL(calls[0]).searchParams.get("time_range")!)).toEqual({ since: "2026-10-14", until: "2026-11-12" });
    const view = (await listIntegrations(db, DEV_USER_ID, DEV_WORKSPACE_ID)).find((i) => i.provider === "meta")!;
    expect(view.lastSyncAt).not.toBeNull();
    expect(view.syncStartedAt).toBeNull();
    expect(view.adAccountId).toBe("act_123");
  });

  it("de novo: só 3 dias e sem duplicar (upsert atualiza o valor)", async () => {
    const [integ] = await listActiveMetaIntegrations(db);
    const calls: string[] = [];
    await syncMetaIntegration(db, integ, { now, fetchImpl: fakeFetch([{ data: [row("2026-11-12", "7.25")] }], calls) });
    expect(JSON.parse(new URL(calls[0]).searchParams.get("time_range")!).since).toBe("2026-11-10");
    const data = await loadWorkspaceData(db, DEV_USER_ID, DEV_WORKSPACE_ID, "2026-11-01", "2026-11-30");
    expect(data.insights.map((i) => [i.date, i.spendCents]).sort()).toEqual([["2026-11-11", 1050], ["2026-11-12", 725]]);
    expect(data.insights[0].platformPurchases).toBe(2);
  });

  it("trava impede sincronização simultânea; trava velha expira", async () => {
    const [integ] = await listActiveMetaIntegrations(db);
    await db.sql.query("update rastro.integrations set sync_started_at = now() where id = $1", [integ.id]);
    expect((await syncMetaIntegration(db, integ, { now, fetchImpl: fakeFetch([]) })).outcome).toBe("skipped_locked");
    await db.sql.query("update rastro.integrations set sync_started_at = now() - interval '31 minutes' where id = $1", [integ.id]);
    expect((await syncMetaIntegration(db, integ, { now, fetchImpl: fakeFetch([{ data: [] }]) })).outcome).toBe("ok");
  });

  it("limite da API: erro retentável registrado e trava liberada", async () => {
    const [integ] = await listActiveMetaIntegrations(db);
    const limited = (async () =>
      new Response(JSON.stringify({ error: { message: "User request limit reached", code: 17 } }), { status: 400 })) as unknown as typeof fetch;
    const r = await syncMetaIntegration(db, integ, { now, fetchImpl: limited });
    expect(r).toMatchObject({ outcome: "error", retryable: true });
    const view = (await listIntegrations(db, DEV_USER_ID, DEV_WORKSPACE_ID)).find((i) => i.provider === "meta")!;
    expect(view.lastError).toMatch(/Temporário/);
    expect(view.syncStartedAt).toBeNull();
  });
});
