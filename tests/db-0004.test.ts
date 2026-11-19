import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asUser } from "@/lib/db/client";
import { migrate, migrationFiles } from "@/lib/db/migrations";
import { hostDb } from "./db-helpers";

const A = "00000000-0000-4000-8000-0000000000d1";
const B = "00000000-0000-4000-8000-0000000000d2";

describe("migration 0004 (multiplataforma)", () => {
  let host: Awaited<ReturnType<typeof hostDb>>;
  let wsA = "";
  let wsB = "";
  let intA = "";

  beforeAll(async () => {
    host = await hostDb();
    await migrate(host.sql);
    await host.sql.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`);
    wsA = (await host.sql.query<{ id: string }>("select rastro.create_workspace($1, 'A') id", [A]))[0].id;
    wsB = (await host.sql.query<{ id: string }>("select rastro.create_workspace($1, 'B') id", [B]))[0].id;
    intA = (await host.sql.query<{ id: string }>("insert into rastro.integrations (workspace_id, provider) values ($1, 'kirvano') returning id", [wsA]))[0].id;
  });
  afterAll(() => host.pg.close());

  it("workspaces nascem como produção e o tipo não pode mudar", async () => {
    const k = await host.sql.query<{ kind: string }>("select kind from rastro.workspaces where id = $1", [wsA]);
    expect(k[0].kind).toBe("production");
    await expect(host.sql.query("update rastro.workspaces set kind = 'sandbox' where id = $1", [wsA])).rejects.toThrow(/não pode ser alterado/);
    await expect(host.sql.query("insert into rastro.workspaces (name, kind) values ('x', 'outro')")).rejects.toThrow(/check/);
  });

  it("rastro_app lê só id e tipo dos workspaces (nada de nome, nada de escrita)", async () => {
    const rows = await asApp(host.db, (tx) => tx.query<{ id: string; kind: string }>("select id, kind from rastro.workspaces order by id"));
    expect(rows.map((r) => r.kind)).toEqual(["production", "production"]);
    await expect(asApp(host.db, (tx) => tx.query("select name from rastro.workspaces"))).rejects.toThrow(/permission denied/);
    await expect(asApp(host.db, (tx) => tx.query("update rastro.workspaces set kind = 'sandbox'"))).rejects.toThrow(/permission denied/);
  });

  it("aceita as novas plataformas e recusa as desconhecidas", async () => {
    for (const p of ["kirvano", "hotmart", "perfectpay", "payt", "pagtrust"]) {
      await host.sql.query("insert into rastro.integrations (workspace_id, provider) values ($1, $2)", [wsA, p]);
    }
    await expect(host.sql.query("insert into rastro.integrations (workspace_id, provider) values ($1, 'desconhecida')", [wsA])).rejects.toThrow(/check/);
  });

  it("pedido guarda a integração de origem; mesmo id em plataformas diferentes não colide", async () => {
    const ins = (provider: string, integration: string | null) =>
      host.sql.query(
        `insert into rastro.orders (workspace_id, provider, external_id, status, status_rank, product_id, product_name, gross_cents, attribution_method, order_created_at, integration_id)
         values ($1, $2, 'MESMO-ID', 'approved', 1, 'p', 'p', 100, 'utm', now(), $3)`,
        [wsA, provider, integration],
      );
    await ins("kirvano", intA);
    await ins("kiwify", null);
    await expect(ins("kirvano", intA)).rejects.toThrow(/duplicate key/);
    const rows = await host.sql.query<{ provider: string; integration_id: string | null }>("select provider, integration_id from rastro.orders where external_id = 'MESMO-ID' order by 1");
    expect(rows).toEqual([{ provider: "kirvano", integration_id: intA }, { provider: "kiwify", integration_id: null }]);
  });

  it("contadores: rastro_app grava; dono lê só os do próprio workspace; outros e roles do Supabase não leem", async () => {
    await asApp(host.db, (tx) =>
      tx.query("insert into rastro.integration_daily_stats (integration_id, workspace_id, day, received, processed) values ($1, $2, current_date, 3, 2)", [intA, wsA]),
    );
    const own = await asUser(host.db, A, (tx) => tx.query<{ received: number }>("select received from rastro.integration_daily_stats"));
    expect(own).toEqual([{ received: 3 }]);
    expect(await asUser(host.db, B, (tx) => tx.query("select * from rastro.integration_daily_stats"))).toEqual([]);
    await expect(asUser(host.db, A, (tx) => tx.query("update rastro.integration_daily_stats set received = 999"))).rejects.toThrow(/permission denied/);
    for (const r of ["anon", "authenticated", "service_role"]) {
      const p = await host.sql.query<{ ok: boolean }>("select has_table_privilege($1, 'rastro.integration_daily_stats', 'SELECT') ok", [r]);
      expect(p[0].ok, r).toBe(false);
    }
    void wsB;
  });

  it("last_received_at: app atualiza, usuário lê, segredos continuam fechados", async () => {
    await asApp(host.db, (tx) => tx.query("update rastro.integrations set last_received_at = now() where id = $1", [intA]));
    const r = await asUser(host.db, A, (tx) => tx.query<{ ok: boolean }>("select last_received_at is not null ok from rastro.integrations where id = $1", [intA]));
    expect(r[0].ok).toBe(true);
    await expect(asUser(host.db, A, (tx) => tx.query("select signing_secret_encrypted from rastro.integrations"))).rejects.toThrow(/permission denied/);
  });

  it("rollback aborta se houver dados das novas plataformas e funciona num banco sem eles", async () => {
    await expect(host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0004_down.sql"), "utf8"))).rejects.toThrow(/plataformas novas/);
    await host.pg.exec("rollback").catch(() => {});
    // banco limpo: aplica 0001..0004 e desfaz só a 0004
    const fresh = await hostDb();
    const files = migrationFiles();
    for (const f of files.slice(0, 3)) await fresh.pg.exec(f.sql);
    const shape = () =>
      fresh.sql.query(`select table_name || '.' || column_name c from information_schema.columns where table_schema = 'rastro' order by 1`);
    const before = await shape();
    await fresh.pg.exec(files[3].sql);
    expect(await shape()).not.toEqual(before);
    await fresh.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0004_down.sql"), "utf8"));
    expect(await shape()).toEqual(before);
    await fresh.pg.close();
  });
});
