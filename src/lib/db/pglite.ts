import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { Db, SqlClient } from "./client";
import { prepareLocal } from "./migrations";

type Queryable = PGlite | Transaction;

function wrap(q: Queryable, root: PGlite): SqlClient {
  return {
    async query<T>(text: string, params?: unknown[]) {
      return (await q.query<T>(text, params as unknown[] | undefined)).rows;
    },
    async exec(text: string) {
      await q.exec(text);
    },
    async transaction<T>(fn: (tx: SqlClient) => Promise<T>) {
      // PGlite não aninha transações: dentro de uma já aberta, reaproveita
      if (q !== root) return fn(wrap(q, root));
      return root.transaction((tx) => fn(wrap(tx, root)));
    },
  };
}

/** Banco local. `dataDir` persiste em disco (sobrevive a reinício); sem ele, fica em memória. */
export async function createPgliteDb(opts: { dataDir?: string; seed?: boolean } = {}): Promise<Db & { close(): Promise<void> }> {
  if (opts.dataDir) mkdirSync(dirname(opts.dataDir), { recursive: true });
  const pg = opts.dataDir ? new PGlite(opts.dataDir) : new PGlite();
  const sql = wrap(pg, pg);
  await prepareLocal(sql, { seed: opts.seed ?? true });
  return { sql, kind: "pglite", assumeAppRole: true, close: () => pg.close() };
}
