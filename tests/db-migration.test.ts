import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, migrationFiles } from "@/lib/db/migrations";
import { footprint, hostDb, roles } from "./db-helpers";
describe("migration 0001 num projeto Supabase (simulado)", () => {
  let host: Awaited<ReturnType<typeof hostDb>>;
  let before: Awaited<ReturnType<typeof footprint>>;
  let rolesBefore: string[];

  beforeAll(async () => {
    host = await hostDb();
    before = await footprint(host.sql);
    rolesBefore = await roles(host.sql);
    expect(await migrate(host.sql)).toEqual(["0001_rastro_init", "0002_sites_integracoes", "0003_role_producao", "0004_multiplataforma", "0005_laboratorio", "0006_lab_anuncios"]);
  });
  afterAll(() => host.pg.close());

  it("não altera nada fora do schema rastro", async () => {
    expect(await footprint(host.sql)).toEqual(before);
  });

  it("cria só as duas roles próprias", async () => {
    const added = (await roles(host.sql)).filter((r) => !rolesBefore.includes(r));
    expect(added.sort()).toEqual(["rastro_app", "rastro_app_prod", "rastro_user"]);
  });

  it("não cria trigger em auth.users", async () => {
    const t = await host.sql.query("select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal");
    expect(t).toEqual([]);
  });

  it("schema fica fora da Data API: anon/authenticated/service_role sem nenhum privilégio, mesmo com default privileges globais", async () => {
    const tables = (await host.sql.query<{ t: string }>("select format('rastro.%I', tablename) t from pg_tables where schemaname = 'rastro'")).map((r) => r.t);
    expect(tables.length).toBeGreaterThanOrEqual(11);
    for (const role of ["anon", "authenticated", "service_role", "public"]) {
      const schema = await host.sql.query<{ ok: boolean }>("select has_schema_privilege($1, 'rastro', 'USAGE') ok", [role]);
      expect(schema[0].ok, `${role} usage`).toBe(false);
      for (const t of tables) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const r = await host.sql.query<{ ok: boolean }>("select has_table_privilege($1, $2, $3) ok", [role, t, priv]);
          expect(r[0].ok, `${role} ${priv} ${t}`).toBe(false);
        }
      }
      const fns = await host.sql.query<{ ok: boolean; f: string }>(
        `select p.proname f, has_function_privilege($1, p.oid, 'EXECUTE') ok from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'rastro'`,
        [role],
      );
      expect(fns.filter((f) => f.ok), `${role} execute`).toEqual([]);
    }
  });

  it("roles do Rastro não enxergam o sistema vizinho nem auth.users", async () => {
    for (const role of ["rastro_app", "rastro_app_prod", "rastro_user"]) {
      for (const table of ["public.leads", "public.webhooks", "auth.users"]) {
        await expect(
          host.sql.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.query(`select * from ${table}`);
          }),
          `${role} ${table}`,
        ).rejects.toThrow(/permission denied/);
      }
    }
  });

  it("funções administrativas só para postgres", async () => {
    for (const role of ["rastro_app", "rastro_app_prod", "rastro_user"]) {
      for (const fn of ["rastro.create_workspace(uuid,text)", "rastro.purge_old_tracking_data()"]) {
        const r = await host.sql.query<{ ok: boolean }>("select has_function_privilege($1, $2, 'EXECUTE') ok", [role, fn]);
        expect(r[0].ok, `${role} ${fn}`).toBe(false);
      }
    }
  });

  it("reaplicar é seguro: o runner pula e o SQL cru falha sem efeito colateral", async () => {
    expect(await migrate(host.sql)).toEqual([]);
    const sqlText = migrationFiles()[0].sql;
    await expect(host.pg.exec(sqlText)).rejects.toThrow();
    await host.pg.exec("rollback").catch(() => {});
    const v = await host.sql.query("select version from rastro.schema_migrations order by 1");
    expect(v).toEqual([{ version: "0001_rastro_init" }, { version: "0002_sites_integracoes" }, { version: "0003_role_producao" }, { version: "0004_multiplataforma" }, { version: "0005_laboratorio" }, { version: "0006_lab_anuncios" }]);
    expect(await footprint(host.sql)).toEqual(before);
  });
});

describe("rollback, preflight e conflitos", () => {
  // um único banco para os três testes (cada PGlite reserva ~250 MB que só voltam ao fim do processo):
  // a ordem importa — preflight (só leitura) → migração + rollback (volta ao original) → conflito de role
  let host: Awaited<ReturnType<typeof hostDb>>;
  let original: Awaited<ReturnType<typeof footprint>>;
  let rolesOriginais: string[];
  beforeAll(async () => {
    host = await hostDb();
    original = await footprint(host.sql);
    rolesOriginais = await roles(host.sql);
  });
  afterAll(() => host.pg.close());

  it("preflight é só leitura e não altera nada", async () => {
    const results = await host.pg.exec(readFileSync(join(process.cwd(), "db", "preflight.sql"), "utf8"));
    expect(results[0].rows[0]).toEqual({ schema_rastro_existe: false, roles_rastro_existem: false });
    expect(await footprint(host.sql)).toEqual(original);
  });

  it("rollback devolve o banco exatamente ao estado anterior", async () => {
    await migrate(host.sql);
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0006_down.sql"), "utf8"));
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0005_down.sql"), "utf8"));
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0004_down.sql"), "utf8"));
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0003_down.sql"), "utf8"));
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0002_down.sql"), "utf8"));
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0001_down.sql"), "utf8"));
    expect(await footprint(host.sql)).toEqual(original);
    expect(await roles(host.sql)).toEqual(rolesOriginais);
  });

  it("rollback só da 0002 devolve o schema rastro ao estado da 0001 (colunas, funções e grants)", async () => {
    const files = migrationFiles();
    const rastroShape = () =>
      host.sql.query(`
        select 'col' k, table_name || '.' || column_name || ':' || data_type v from information_schema.columns where table_schema = 'rastro'
        union all select 'fn', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || coalesce(p.proacl::text, '')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'rastro'
        union all select 'acl', c.relname || ':' || coalesce(c.relacl::text, '')
          from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rastro'
        union all select 'colacl', a.attrelid::regclass::text || '.' || a.attname || ':' || a.attacl::text
          from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'rastro' and a.attacl is not null
        union all select 'pol', tablename || '.' || policyname from pg_policies where schemaname = 'rastro'
        union all select 'mig', version from rastro.schema_migrations
        order by 1, 2`);
    await host.pg.exec(files[0].sql);
    const so0001 = await rastroShape();
    await host.pg.exec(files[1].sql);
    expect(await rastroShape()).not.toEqual(so0001);
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0002_down.sql"), "utf8"));
    expect(await rastroShape()).toEqual(so0001);
    // e a 0002 pode ser reaplicada depois do rollback
    await host.pg.exec(files[1].sql);
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0002_down.sql"), "utf8"));
    await host.pg.exec(readFileSync(join(process.cwd(), "db", "rollback", "0001_down.sql"), "utf8"));
    expect(await footprint(host.sql)).toEqual(original);
  });

  it("aborta se já existir role com o mesmo nome (não reaproveita permissões alheias)", async () => {
    await host.pg.exec("create role rastro_app");
    await expect(migrate(host.sql)).rejects.toThrow(/já existe/);
    await host.pg.exec("rollback").catch(() => {});
    const s = await host.sql.query("select 1 from pg_namespace where nspname = 'rastro'");
    expect(s).toEqual([]);
    await host.pg.exec("drop role rastro_app");
  });
});


