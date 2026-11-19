import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlClient } from "./client";

export const DB_DIR = join(process.cwd(), "db");

export const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

export function migrationFiles(dir = MIGRATIONS_DIR): Array<{ version: string; sql: string }> {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ""), sql: readFileSync(join(dir, f), "utf8") }));
}

/** Aplica as migrations pendentes (cada arquivo tem begin/commit e grava a própria versão). */
export async function migrate(sql: SqlClient, dir?: string): Promise<string[]> {
  const exists = await sql.query<{ t: string | null }>("select to_regclass('rastro.schema_migrations')::text as t");
  const applied = new Set<string>();
  if (exists[0]?.t) {
    for (const r of await sql.query<{ version: string }>("select version from rastro.schema_migrations")) applied.add(r.version);
  }
  const done: string[] = [];
  for (const m of migrationFiles(dir)) {
    if (applied.has(m.version)) continue;
    await sql.exec(m.sql);
    done.push(m.version);
  }
  return done;
}

/** Só banco local/testes: ambiente mínimo do Supabase + seed de desenvolvimento. */
export async function prepareLocal(sql: SqlClient, opts: { seed: boolean }) {
  const auth = await sql.query<{ t: string | null }>("select to_regclass('auth.users')::text as t");
  if (!auth[0]?.t) await sql.exec(readFileSync(join(DB_DIR, "local", "00_supabase_shim.sql"), "utf8"));
  const done = await migrate(sql);
  if (opts.seed) await sql.exec(readFileSync(join(DB_DIR, "local", "10_dev_seed.sql"), "utf8"));
  return done;
}
