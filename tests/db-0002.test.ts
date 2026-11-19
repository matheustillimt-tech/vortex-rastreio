import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asUser } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrations";
import { hostDb } from "./db-helpers";
describe("migration 0002 (sites e integrações)", () => {
  let host: Awaited<ReturnType<typeof hostDb>>;
  const A = "00000000-0000-4000-8000-0000000000aa";
  const V = "00000000-0000-4000-8000-0000000000ab"; // viewer
  let ws = "";
  let integ = "";

  beforeAll(async () => {
    host = await hostDb();
    await migrate(host.sql);
    await host.sql.exec(`insert into auth.users (id) values ('${A}'), ('${V}')`);
    ws = (await host.sql.query<{ id: string }>("select rastro.create_workspace($1, 'W') id", [A]))[0].id;
    await host.sql.query("insert into rastro.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [ws, V]);
    await host.sql.query("insert into rastro.sites (workspace_id, name, public_key) values ($1, 's', 'pk_aaaaaaaaaaaaaaaaaaaaaaaa')", [ws]);
    integ = (await host.sql.query<{ id: string }>("insert into rastro.integrations (workspace_id, provider, signing_secret_encrypted, signing_secret_previous_encrypted) values ($1, 'kiwify', 'v1.x', 'v1.y') returning id", [ws]))[0].id;
  });
  afterAll(() => host.pg.close());

  it("usuário vê se há segredo, mas nunca o segredo (atual nem anterior)", async () => {
    const r = await asUser(host.db, A, (tx) => tx.query<{ has_signing_secret: boolean }>("select has_signing_secret from rastro.integrations"));
    expect(r).toEqual([{ has_signing_secret: true }]);
    await expect(asUser(host.db, A, (tx) => tx.query("select signing_secret_previous_encrypted from rastro.integrations"))).rejects.toThrow(/permission denied/);
  });

  it("só admin desativa site; viewer não", async () => {
    const viewer = await asUser(host.db, V, (tx) => tx.query("update rastro.sites set status = 'disabled' returning id"));
    expect(viewer).toEqual([]);
    const admin = await asUser(host.db, A, (tx) => tx.query("update rastro.sites set status = 'disabled' returning id"));
    expect(admin).toHaveLength(1);
  });

  it("rastro_app atualiza trava de sincronização e último evento, e nada mais de configuração", async () => {
    await asApp(host.db, (tx) => tx.query("update rastro.integrations set sync_started_at = now(), last_event_at = now() where id = $1", [integ]));
    await expect(asApp(host.db, (tx) => tx.query("update rastro.integrations set signing_secret_encrypted = 'x' where id = $1", [integ]))).rejects.toThrow(/permission denied/);
    await expect(asApp(host.db, (tx) => tx.query("update rastro.sites set status = 'active'"))).rejects.toThrow(/permission denied/);
  });

  it("roles padrão do Supabase continuam sem acesso às colunas novas", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const r = await host.sql.query<{ ok: boolean }>("select has_column_privilege($1, 'rastro.integrations', 'has_signing_secret', 'SELECT') ok", [role]);
      expect(r[0].ok, role).toBe(false);
    }
  });
});


describe("migration 0003 (role de produção)", () => {
  let host: Awaited<ReturnType<typeof hostDb>>;
  const asProd = <T,>(fn: (tx: { query: (t: string, p?: unknown[]) => Promise<unknown[]> }) => Promise<T>) =>
    host.sql.transaction(async (tx) => {
      await tx.exec("set local role rastro_app_prod");
      return fn(tx);
    });

  beforeAll(async () => {
    host = await hostDb();
    await migrate(host.sql);
    await host.sql.exec("insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000a9')");
    const ws = (await host.sql.query<{ id: string }>("select rastro.create_workspace('00000000-0000-4000-8000-0000000000a9', 'P') id"))[0].id;
    await host.sql.query("insert into rastro.sites (workspace_id, name, public_key) values ($1, 's', 'pk_bbbbbbbbbbbbbbbbbbbbbbbb')", [ws]);
  });
  afterAll(() => host.pg.close());

  it("não tem nenhum grant próprio: tudo vem de rastro_app", async () => {
    const own = await host.sql.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'rastro' and c.relacl::text like '%rastro_app_prod=%'`,
    );
    expect(own).toEqual([]);
  });

  it("faz a ingestão como rastro_app (mesmas tabelas, mesmas RLS)", async () => {
    const r = await asProd((tx) =>
      tx.query(
        `insert into rastro.events (workspace_id, site_id, event_id, visitor_id, session_id, type, path, occurred_at)
         select workspace_id, id, 'evtprod00001', 'visprod00001', 'sesprod00001', 'pageview', '/', now() from rastro.sites returning id`,
      ),
    );
    expect(r).toHaveLength(1);
  });

  it("tem as mesmas restrições: sem membros, sem apagar, sem segredos para escrever, sem outros schemas", async () => {
    for (const stmt of [
      "select * from rastro.workspace_members",
      "delete from rastro.events",
      "update rastro.integrations set signing_secret_encrypted = 'x'",
      "select * from public.leads",
      "select * from auth.users",
      "select rastro.create_workspace('00000000-0000-4000-8000-0000000000a9', 'x')",
    ]) {
      await expect(asProd((tx) => tx.query(stmt)), stmt).rejects.toThrow(/permission denied/);
    }
  });

  it("pode assumir rastro_user (leituras do painel com RLS) e nenhuma role do Supabase", async () => {
    // no PGlite a sessão é superusuário, então SET ROLE sempre passa; pg_has_role avalia a permissão da própria role
    const can = async (role: string) =>
      (await host.sql.query<{ ok: boolean }>("select pg_has_role('rastro_app_prod', $1, 'SET') ok", [role]))[0].ok;
    expect(await can("rastro_user")).toBe(true);
    expect(await can("rastro_app")).toBe(true);
    for (const r of ["postgres", "authenticated", "service_role", "anon"]) expect(await can(r), r).toBe(false);
    const rows = await host.sql.transaction(async (tx) => {
      await tx.exec("set local role rastro_app_prod");
      await tx.exec("set local role rastro_user");
      return tx.query("select count(*)::int n from rastro.orders");
    });
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("rollback da 0003 remove só a role de produção", async () => {
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0003_down.sql"), "utf8"));
    const roles = await host.sql.query<{ rolname: string }>("select rolname from pg_roles where rolname like 'rastro%' order by 1");
    expect(roles.map((r) => r.rolname)).toEqual(["rastro_app", "rastro_user"]);
    const v = await host.sql.query<{ version: string }>("select version from rastro.schema_migrations order by 1");
    // só a versão 0003 sai; as demais (inclusive posteriores) permanecem
    expect(v.map((x) => x.version)).toEqual(["0001_rastro_init", "0002_sites_integracoes", "0004_multiplataforma", "0005_laboratorio", "0006_lab_anuncios"]);
  });
});
