import "server-only";
import { join } from "node:path";
import { env } from "@/lib/env";
import type { Db } from "./client";

const g = globalThis as unknown as { __rastroDb?: Promise<Db> };

/**
 * DATABASE_URL definido → Postgres do Supabase (role rastro_app).
 * Sem ele, fora de produção → PGlite persistido em .data/pglite (sobrevive a reinício).
 * Em produção sem banco → erro explícito (nunca aceitar dados que se perderiam).
 */
export function getDb(): Promise<Db> {
  if (g.__rastroDb) return g.__rastroDb;
  if (env.databaseUrl) {
    g.__rastroDb = import("./postgres").then((m) => m.createPostgresDb(env.databaseUrl));
  } else if (process.env.NODE_ENV !== "production") {
    // comparação literal: o Next substitui NODE_ENV no build e remove este ramo da produção
    g.__rastroDb = import("./pglite").then((m) => m.createPgliteDb({ dataDir: join(process.cwd(), ".data", "pglite"), seed: true }));
  } else {
    return Promise.reject(new Error("Banco não configurado: defina DATABASE_URL (role rastro_app)"));
  }
  g.__rastroDb.catch(() => {
    g.__rastroDb = undefined;
  });
  return g.__rastroDb;
}
