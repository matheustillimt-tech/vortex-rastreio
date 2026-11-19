import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, DEV_USER_ID } from "@/lib/db/client";
import { createPgliteDb } from "@/lib/db/pglite";
import { handleKiwifyWebhook } from "@/lib/ingest/kiwify-webhook";
import { simulateSandboxDelivery } from "@/lib/ingest/webhook";
import { labAdInsights, runScenarios, SCENARIOS } from "@/lib/lab/scenarios";
import { ensureLab, labAdsReady, labAllowed, labCounts, labKeys, labSchemaReady, purgeExpiredLabs, resetLab, type Lab } from "@/lib/lab/setup";
import { sha256Hex } from "@/lib/security/crypto";
import { DEV_KIWIFY_WEBHOOK_TOKEN, DEV_WORKSPACE_ID } from "@/lib/store/memory";
import { PostgresStore } from "@/lib/store/postgres";
import { getMembership, loadWorkspaceData } from "@/lib/workspace/repo";
import { kirvanoPayload } from "./fixtures/kirvano";
import { kiwifyPayload } from "./fixtures/kiwify";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

describe("acesso ao laboratório", () => {
  it("negado por padrão; liberado só para ids configurados (e o usuário de dev no banco local)", () => {
    const old = process.env.RASTRO_LAB_ADMIN_IDS;
    delete process.env.RASTRO_LAB_ADMIN_IDS;
    expect(labAllowed(null)).toBe(false);
    expect(labAllowed("00000000-0000-4000-8000-0000000000ee")).toBe(false);
    process.env.RASTRO_LAB_ADMIN_IDS = " 00000000-0000-4000-8000-0000000000ee , x ";
    expect(labAllowed("00000000-0000-4000-8000-0000000000ee")).toBe(true);
    expect(labAllowed("00000000-0000-4000-8000-0000000000ff")).toBe(false);
    if (old === undefined) delete process.env.RASTRO_LAB_ADMIN_IDS;
    else process.env.RASTRO_LAB_ADMIN_IDS = old;
  });

  it("chaves derivadas: estáveis por usuário, diferentes entre usuários, no formato aceito pelas rotas", () => {
    const a = labKeys("u1");
    expect(labKeys("u1")).toEqual(a);
    expect(labKeys("u2").kiwifyToken).not.toBe(a.kiwifyToken);
    expect(a.siteKey).toMatch(/^pk_lab[a-f0-9]{32}$/);
    expect(a.kiwifyToken).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(a.kirvanoToken).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe("laboratório no banco (PGlite, roles reais)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rastro-lab-"));
  const OTHER = "00000000-0000-4000-8000-0000000000bb";
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  let store: PostgresStore;
  let lab: Lab;

  beforeAll(async () => {
    db = await createPgliteDb({ dataDir: dir, seed: true });
    store = new PostgresStore(db);
    await db.sql.query("insert into auth.users (id) values ($1) on conflict do nothing", [OTHER]);
    // uma venda REAL de produção (workspace de dev), para provar que nada do laboratório a toca
    await handleKiwifyWebhook({ store, urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: JSON.stringify(kiwifyPayload({ order_id: "real-001" })), signature: null });
  });
  afterAll(async () => {
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("abre um workspace sandbox separado, idempotente, com site fechado para a coleta pública", async () => {
    expect(await labSchemaReady(db)).toBe(true);
    lab = await ensureLab(db, DEV_USER_ID);
    expect(lab.workspaceId).not.toBe(DEV_WORKSPACE_ID);
    expect(await ensureLab(db, DEV_USER_ID)).toEqual(lab);
    const ws = await db.sql.query<{ kind: string; name: string }>("select kind, name from rastro.workspaces where id = $1", [lab.workspaceId]);
    expect(ws[0]).toEqual({ kind: "sandbox", name: "Laboratório — simulação" });
    const members = await db.sql.query<{ user_id: string; role: string }>("select user_id, role from rastro.workspace_members where workspace_id = $1", [lab.workspaceId]);
    expect(members).toEqual([{ user_id: DEV_USER_ID, role: "owner" }]);
    // coleta pública não aceita o site do laboratório
    expect(await store.findSiteByPublicKey(lab.siteKey)).toBeNull();
    // nenhum segredo em texto puro no banco
    const integ = await db.sql.query<Record<string, string>>("select webhook_token_hash, signing_secret_encrypted from rastro.integrations where workspace_id = $1", [lab.workspaceId]);
    expect(JSON.stringify(integ)).not.toContain(lab.kiwifySecret);
    expect(JSON.stringify(integ)).not.toContain(lab.kiwifyToken);
  });

  it("o painel real continua no workspace de produção", async () => {
    expect(await getMembership(db, DEV_USER_ID)).toMatchObject({ workspaceId: DEV_WORKSPACE_ID });
  });

  it("todos os cenários passam, comparando esperado × encontrado", async () => {
    expect(await labAdsReady(db)).toBe(true);
    const results = await runScenarios(store, lab, "all", new Date(), { adsReady: true });
    expect(results).toHaveLength(SCENARIOS.length);
    const failed = results.filter((r) => !r.pass).map((r) => ({ id: r.id, error: r.error, steps: r.steps.filter((s) => !s.pass) }));
    expect(failed).toEqual([]);
    // rodar de novo não colide com a rodada anterior
    const again = await runScenarios(store, lab, ["venda-aprovada", "duplicado"]);
    expect(again.every((r) => r.pass)).toBe(true);
  });

  it("um cenário que não confere aparece como falha (não esconde divergência)", async () => {
    const [r] = await runScenarios(store, { ...lab, kiwifySecret: "segredo-trocado" }, ["reembolso"]);
    expect(r.pass).toBe(false);
    expect(r.steps.find((s) => !s.pass)).toMatchObject({ expected: "refunded" });
  });

  it("dados de simulação nunca aparecem no workspace de produção", async () => {
    const prod = await loadWorkspaceData(db, DEV_USER_ID, DEV_WORKSPACE_ID, "2000-01-01", "2100-01-01");
    expect(prod.orders.map((o) => o.externalId)).toEqual(["real-001"]);
    const labOrders = await db.sql.query<{ n: number }>("select count(*)::int n from rastro.orders where workspace_id = $1", [lab.workspaceId]);
    expect(labOrders[0].n).toBeGreaterThan(10);
    const leaked = await db.sql.query<{ n: number }>("select count(*)::int n from rastro.orders where external_id like 'lab-%' and workspace_id <> $1", [lab.workspaceId]);
    expect(leaked[0].n).toBe(0);
  });

  it("Kirvano: rota pública recusa o laboratório; simulação interna só aceita integração sandbox", async () => {
    const prodIntegration = (await store.findIntegrationByWebhookToken("kiwify", sha256Hex(DEV_KIWIFY_WEBHOOK_TOKEN)))!;
    await expect(
      simulateSandboxDelivery({ store, provider: "kiwify", integration: prodIntegration, rawBody: JSON.stringify(kiwifyPayload()) }),
    ).rejects.toThrow(/laboratório/);
    const labKirvano = (await store.findIntegrationByWebhookToken("kirvano", sha256Hex(lab.kirvanoToken)))!;
    await expect(
      simulateSandboxDelivery({ store, provider: "kiwify", integration: labKirvano, rawBody: JSON.stringify(kirvanoPayload()) }),
    ).rejects.toThrow(/plataforma/);
  });

  it("quem não é dono de workspace de produção não abre laboratório", async () => {
    await expect(ensureLab(db, OTHER)).rejects.toThrow(/dono de workspace de produção/);
  });

  it("zerar: recusa produção e laboratório alheio; apaga só a simulação", async () => {
    await expect(resetLab(db, DEV_USER_ID, DEV_WORKSPACE_ID)).rejects.toThrow(/laboratório próprio/);
    await expect(resetLab(db, OTHER, lab.workspaceId)).rejects.toThrow(/laboratório próprio/);
    const n = await resetLab(db, DEV_USER_ID, lab.workspaceId);
    expect(n).toBeGreaterThan(0);
    expect(await labCounts(db, DEV_USER_ID, lab.workspaceId)).toEqual({ sessions: 0, events: 0, orders: 0, webhooks: 0, insights: 0 });
    expect(await store.getOrder(DEV_WORKSPACE_ID, "kiwify", "real-001")).toMatchObject({ status: "approved" });
    // configuração continua: dá para rodar de novo
    expect((await runScenarios(store, lab, ["pix"]))[0].pass).toBe(true);
  });

  it("limpeza automática de 7 dias apaga só dados de laboratório antigos", async () => {
    await runScenarios(store, lab, ["visita-utm", "venda-aprovada", "anuncios-meta"], new Date(), { adsReady: true });
    expect((await labCounts(db, DEV_USER_ID, lab.workspaceId)).insights).toBe(21);
    // envelhece TUDO (laboratório e produção) para 10 dias atrás, sem disparar triggers
    await db.sql.transaction(async (tx) => {
      await tx.exec("set local session_replication_role = replica");
      await tx.exec("update rastro.orders set updated_at = now() - interval '10 days'");
      await tx.exec("update rastro.events set received_at = now() - interval '10 days'");
      await tx.exec("update rastro.sessions set created_at = now() - interval '10 days'");
      await tx.exec("update rastro.webhook_events set received_at = now() - interval '10 days'");
      await tx.exec("update rastro.integration_daily_stats set updated_at = now() - interval '10 days'");
      await tx.exec("update rastro.ad_insights_daily set synced_at = now() - interval '10 days'");
    });
    const prodBefore = await db.sql.query<{ n: number }>(
      `select (select count(*) from rastro.orders where workspace_id = $1) + (select count(*) from rastro.webhook_events where workspace_id = $1)
            + (select count(*) from rastro.integration_daily_stats where workspace_id = $1) as n`,
      [DEV_WORKSPACE_ID],
    );
    const purged = await purgeExpiredLabs(db);
    expect(purged).toBeGreaterThan(0);
    expect(await labCounts(db, DEV_USER_ID, lab.workspaceId)).toEqual({ sessions: 0, events: 0, orders: 0, webhooks: 0, insights: 0 });
    const prodAfter = await db.sql.query<{ n: number }>(
      `select (select count(*) from rastro.orders where workspace_id = $1) + (select count(*) from rastro.webhook_events where workspace_id = $1)
            + (select count(*) from rastro.integration_daily_stats where workspace_id = $1) as n`,
      [DEV_WORKSPACE_ID],
    );
    expect(Number(prodAfter[0].n)).toBe(Number(prodBefore[0].n));
    expect(Number(prodAfter[0].n)).toBeGreaterThan(0);
  });

  it("permissões: só o dono roda as funções do laboratório; roles do Supabase não", async () => {
    const can = (role: string, fn: string) =>
      db.sql.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]).then((r) => r[0].ok);
    expect(await can("rastro_user", "rastro.lab_reset(uuid)")).toBe(true);
    expect(await can("rastro_app", "rastro.lab_reset(uuid)")).toBe(false);
    expect(await can("rastro_app", "rastro.lab_purge_expired(integer)")).toBe(true);
    expect(await can("rastro_user", "rastro.lab_purge_expired(integer)")).toBe(false);
    for (const r of ["anon", "authenticated", "service_role"]) {
      const exists = await db.sql.query<{ n: number }>("select count(*)::int n from pg_roles where rolname = $1", [r]);
      if (exists[0].n === 0) continue;
      for (const f of ["rastro.lab_ensure(text,text,text,text)", "rastro.lab_reset(uuid)", "rastro.lab_purge_expired(integer)"]) expect(await can(r, f), `${r} ${f}`).toBe(false);
    }
    // rastro_user não apaga nada diretamente
    await expect(asUser(db, DEV_USER_ID, (tx) => tx.query("delete from rastro.orders where workspace_id = $1", [lab.workspaceId]))).rejects.toThrow(/permission denied/);
  });
});

describe("laboratório: tentativas indevidas não alcançam produção", () => {
  const dir = mkdtempSync(join(tmpdir(), "rastro-lab-adv-"));
  const VIEWER = "00000000-0000-4000-8000-0000000000c1";
  const STRANGER = "00000000-0000-4000-8000-0000000000c2";
  let db: Awaited<ReturnType<typeof createPgliteDb>>;
  let store: PostgresStore;
  let lab: Lab;

  /** retrato completo do workspace de produção */
  const prodSnapshot = () =>
    db.sql.query(
      `select (select json_agg(o order by o.id) from rastro.orders o where workspace_id = $1) orders,
              (select count(*) from rastro.sessions where workspace_id = $1) sessions,
              (select count(*) from rastro.events where workspace_id = $1) events,
              (select count(*) from rastro.webhook_events where workspace_id = $1) webhooks,
              (select count(*) from rastro.integration_daily_stats where workspace_id = $1) stats,
              (select json_agg(i.id order by i.id) from rastro.integrations i where workspace_id = $1) integrations,
              (select json_agg(s.id order by s.id) from rastro.sites s where workspace_id = $1) sites,
              (select json_agg(m.user_id order by m.user_id) from rastro.workspace_members m where workspace_id = $1) members,
              (select kind from rastro.workspaces where id = $1) kind`,
      [DEV_WORKSPACE_ID],
    );

  beforeAll(async () => {
    db = await createPgliteDb({ dataDir: dir, seed: true });
    store = new PostgresStore(db);
    await db.sql.query("insert into auth.users (id) values ($1), ($2) on conflict do nothing", [VIEWER, STRANGER]);
    await db.sql.query("insert into rastro.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [DEV_WORKSPACE_ID, VIEWER]);
    // dados REAIS de produção: venda, webhook, contadores
    await handleKiwifyWebhook({ store, urlToken: DEV_KIWIFY_WEBHOOK_TOKEN, rawBody: JSON.stringify(kiwifyPayload({ order_id: "real-adv" })), signature: null });
    lab = await ensureLab(db, DEV_USER_ID);
    await runScenarios(store, lab, ["visita-utm", "venda-aprovada"]);
  });
  afterAll(async () => {
    await db?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("zerar com parâmetros errados ou por quem não é dono: sempre recusado, produção intacta", async () => {
    const before = await prodSnapshot();
    const attempts: Array<[string, string | null]> = [
      [DEV_USER_ID, DEV_WORKSPACE_ID], // dono, mas workspace de produção
      [DEV_USER_ID, null],
      [DEV_USER_ID, "00000000-0000-4000-8000-00000000dead"],
      [VIEWER, lab.workspaceId], // leitor da produção, não dono do laboratório
      [STRANGER, lab.workspaceId],
      [VIEWER, DEV_WORKSPACE_ID],
    ];
    for (const [user, ws] of attempts) {
      await expect(asUser(db, user, (tx) => tx.query("select rastro.lab_reset($1::uuid)", [ws])), `${user} ${ws}`).rejects.toThrow(/laboratório próprio/);
    }
    // a role do app nem executa a função de zerar
    await expect(db.sql.transaction(async (tx) => {
      await tx.exec("set local role rastro_app");
      return tx.query("select rastro.lab_reset($1)", [lab.workspaceId]);
    })).rejects.toThrow(/permission denied/);
    expect(await prodSnapshot()).toEqual(before);
  });

  it("limpeza automática com parâmetro inválido nunca encurta os 7 dias e nunca toca produção", async () => {
    // produção MUITO antiga (400 dias) e laboratório com 3 dias
    await db.sql.transaction(async (tx) => {
      await tx.exec("set local session_replication_role = replica");
      await tx.query("update rastro.orders set updated_at = now() - interval '400 days' where workspace_id = $1", [DEV_WORKSPACE_ID]);
      await tx.query("update rastro.webhook_events set received_at = now() - interval '400 days' where workspace_id = $1", [DEV_WORKSPACE_ID]);
      await tx.query("update rastro.integration_daily_stats set updated_at = now() - interval '400 days' where workspace_id = $1", [DEV_WORKSPACE_ID]);
      for (const t of ["orders", "integration_daily_stats"]) await tx.query(`update rastro.${t} set updated_at = now() - interval '3 days' where workspace_id = $1`, [lab.workspaceId]);
      await tx.query("update rastro.events set received_at = now() - interval '3 days' where workspace_id = $1", [lab.workspaceId]);
      await tx.query("update rastro.sessions set created_at = now() - interval '3 days' where workspace_id = $1", [lab.workspaceId]);
      await tx.query("update rastro.webhook_events set received_at = now() - interval '3 days' where workspace_id = $1", [lab.workspaceId]);
      await tx.query("update rastro.ad_insights_daily set synced_at = now() - interval '3 days' where workspace_id = $1", [lab.workspaceId]);
    });
    const before = await prodSnapshot();
    const labBefore = await labCounts(db, DEV_USER_ID, lab.workspaceId);
    const purge = (arg: string) =>
      db.sql.transaction(async (tx) => {
        await tx.exec("set local role rastro_app");
        return tx.query<{ n: number }>(`select rastro.lab_purge_expired(${arg}) as n`);
      });
    for (const arg of ["-100", "0", "null", "1", "6", "", "2147483647"]) expect((await purge(arg))[0].n, `p_days=${arg}`).toBe(0);
    expect(await labCounts(db, DEV_USER_ID, lab.workspaceId)).toEqual(labBefore);
    expect(await prodSnapshot()).toEqual(before);
  });

  it("produção não vira laboratório e ninguém além do dono abre laboratório", async () => {
    await expect(db.sql.query("update rastro.workspaces set kind = 'sandbox' where id = $1", [DEV_WORKSPACE_ID])).rejects.toThrow(/não pode ser alterado/);
    for (const role of ["rastro_app", "rastro_user"]) {
      await expect(db.sql.transaction(async (tx) => {
        await tx.exec(`set local role ${role}`);
        return tx.query("update rastro.workspaces set kind = 'sandbox' where id = $1", [DEV_WORKSPACE_ID]);
      }), role).rejects.toThrow(/permission denied/);
    }
    await expect(ensureLab(db, VIEWER)).rejects.toThrow(/dono de workspace de produção/);
    await expect(ensureLab(db, STRANGER)).rejects.toThrow(/dono de workspace de produção/);
    // parâmetros fora do formato
    await expect(asUser(db, DEV_USER_ID, (tx) => tx.query("select * from rastro.lab_ensure('pk_x', 'a', 'b', 'c')"))).rejects.toThrow(/inválidos/);
    // o leitor não enxerga nada do laboratório do dono
    const seen = await asUser(db, VIEWER, (tx) => tx.query<{ n: number }>("select count(*)::int n from rastro.orders where workspace_id = $1", [lab.workspaceId]));
    expect(seen[0].n).toBe(0);
  });

  it("gasto simulado: nunca grava em workspace de produção; zerar e limpeza apagam só o do laboratório", async () => {
    const rows = labAdInsights("prodtest", new Date());
    expect(await store.saveSandboxAdInsights(DEV_WORKSPACE_ID, rows)).toBe(0);
    const prodCount = () =>
      db.sql.query<{ n: number }>("select count(*)::int n from rastro.ad_insights_daily where workspace_id = $1", [DEV_WORKSPACE_ID]).then((r) => r[0].n);
    const before = await prodCount();
    // gasto REAL de produção (como a sincronização da Meta gravaria), antigo de propósito
    await db.sql.query(
      `insert into rastro.ad_insights_daily (workspace_id, platform, account_id, date, campaign_id, campaign_name, ad_id, spend_cents, synced_at)
       values ($1, 'meta', 'act_real', current_date - 400, 'real-c', 'Campanha real', 'real-a', 12345, now() - interval '400 days')`,
      [DEV_WORKSPACE_ID],
    );
    expect(await store.saveSandboxAdInsights(lab.workspaceId, rows)).toBe(rows.length);
    await db.sql.query("update rastro.ad_insights_daily set synced_at = now() - interval '30 days' where workspace_id = $1", [lab.workspaceId]);
    expect(await purgeExpiredLabs(db)).toBeGreaterThanOrEqual(rows.length);
    expect((await labCounts(db, DEV_USER_ID, lab.workspaceId)).insights).toBe(0);
    expect(await store.saveSandboxAdInsights(lab.workspaceId, rows)).toBe(rows.length);
    await resetLab(db, DEV_USER_ID, lab.workspaceId);
    expect((await labCounts(db, DEV_USER_ID, lab.workspaceId)).insights).toBe(0);
    expect(await prodCount()).toBe(before + 1);
    await db.sql.query("delete from rastro.ad_insights_daily where workspace_id = $1 and campaign_id = 'real-c'", [DEV_WORKSPACE_ID]);
  });

  it("sem a 0006, o cenário de anúncios falha avisando e não grava gasto", async () => {
    await resetLab(db, DEV_USER_ID, lab.workspaceId);
    const [r] = await runScenarios(store, lab, ["anuncios-meta"]);
    expect(r.pass).toBe(false);
    expect(r.steps[0]).toMatchObject({ label: expect.stringContaining("0006"), found: "não" });
    expect((await labCounts(db, DEV_USER_ID, lab.workspaceId)).insights).toBe(0);
  });

  it("cenários não fazem nenhuma chamada de rede (fetch bloqueado) e os 16 passam", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error("rede bloqueada no teste");
    }) as typeof fetch;
    try {
      const results = await runScenarios(store, lab, "all", new Date(), { adsReady: true });
      expect(results.filter((r) => !r.pass).map((r) => r.id)).toEqual([]);
      expect(results).toHaveLength(16);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toBe(0);
  });
});
