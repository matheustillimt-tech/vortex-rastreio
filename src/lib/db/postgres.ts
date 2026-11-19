import "server-only";
import postgres from "postgres";
import type { Db, SqlClient } from "./client";

type Pg = postgres.Sql | postgres.TransactionSql;

function wrap(q: Pg, root: postgres.Sql): SqlClient {
  return {
    async query<T>(text: string, params?: unknown[]) {
      return (await q.unsafe(text, (params ?? []) as postgres.ParameterOrJSON<never>[])) as unknown as T[];
    },
    async exec(text: string) {
      await q.unsafe(text);
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) {
      if (q !== root) return fn(wrap(q, root));
      return root.begin((tx) => fn(wrap(tx, root))) as Promise<T>;
    },
  };
}

/**
 * Conexão de produção. DATABASE_URL deve usar a role dedicada `rastro_app` pelo pooler
 * (Supavisor, modo transação, porta 6543): postgresql://rastro_app.<ref>:<senha>@<host>:6543/postgres
 * prepare:false é obrigatório no modo transação do pooler.
 */
export function createPostgresDb(url: string): Db {
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10, ssl: "require" });
  return { sql: wrap(sql, sql), kind: "postgres", assumeAppRole: false };
}
