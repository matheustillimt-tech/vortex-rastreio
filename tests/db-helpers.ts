import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { Db, SqlClient } from "@/lib/db/client";

/** Banco simulado: shim do Supabase + outro sistema no mesmo banco, sem seed do Vórtex Rastreio. */
export async function hostDb() {
  const pg = new PGlite();
  const sql: SqlClient = {
    query: async (t, p) => (await pg.query(t, p as unknown[])).rows as never,
    exec: async (t) => void (await pg.exec(t)),
    transaction: (fn) => pg.transaction((tx) => fn({
      query: async (t, p) => (await tx.query(t, p as unknown[])).rows as never,
      exec: async (t) => void (await tx.exec(t)),
      transaction: (inner) => inner(sql),
    })),
  };
  await pg.exec(readFileSync(join(process.cwd(), "db", "local", "00_supabase_shim.sql"), "utf8"));
  const db: Db = { sql, kind: "pglite", assumeAppRole: true };
  return { pg, sql, db };
}

/** Tudo que existe FORA do schema rastro: deve ser idêntico antes e depois da migration. */
export async function footprint(sql: SqlClient) {
  const q = (t: string) => sql.query(t);
  return {
    schemas: await q("select nspname from pg_namespace where nspname not like 'pg\\_%' and nspname not in ('information_schema', 'rastro') order by 1"),
    relations: await q(`select n.nspname, c.relname, c.relkind, coalesce(c.relacl::text, '') acl, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname not in ('rastro', 'pg_catalog', 'information_schema', 'pg_toast') order by 1, 2`),
    functions: await q(`select n.nspname, p.proname, coalesce(p.proacl::text, '') acl from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('rastro', 'pg_catalog', 'information_schema') order by 1, 2`),
    triggers: await q(`select t.tgname, t.tgrelid::regclass::text rel from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname <> 'rastro' order by 1`),
    policies: await q("select schemaname, tablename, policyname, roles::text, qual from pg_policies where schemaname <> 'rastro' order by 1, 2, 3"),
    defaultAcl: await q("select defaclrole::regrole::text, defaclnamespace, defaclobjtype, defaclacl::text from pg_default_acl order by 1, 2, 3"),
    columnsAuthUsers: await q("select column_name, data_type from information_schema.columns where table_schema = 'auth' and table_name = 'users' order by 1"),
    neighborRows: await q("select count(*)::int n from public.leads"),
  };
}

export const roles = async (sql: SqlClient) => (await sql.query<{ rolname: string }>("select rolname from pg_roles order by 1")).map((r) => r.rolname);
