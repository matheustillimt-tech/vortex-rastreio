/**
 * Interface mínima de SQL usada pelo Rastro. Duas implementações:
 *  - postgres.js (produção: conecta como a role `rastro_app`, nunca como service_role)
 *  - PGlite (desenvolvimento e testes: Postgres real em WASM, persistido em .data/)
 */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** vários comandos sem parâmetros (migrations, SET LOCAL) */
  exec(text: string): Promise<void>;
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}

export interface Db {
  sql: SqlClient;
  kind: "postgres" | "pglite";
  /**
   * PGlite conecta como superusuário: para exercitar grants/RLS de verdade, cada operação
   * assume `rastro_app` explicitamente. Em produção a conexão já É `rastro_app`.
   */
  assumeAppRole: boolean;
}

export const DEV_USER_ID = "00000000-0000-4000-8000-0000000000aa";

/** Operações de ingestão (script, webhooks, sync): privilégios de rastro_app. */
export async function asApp<T>(db: Db, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  if (!db.assumeAppRole) return fn(db.sql);
  return db.sql.transaction(async (tx) => {
    await tx.exec("set local role rastro_app");
    return fn(tx);
  });
}

/**
 * Leitura/configuração em nome de um usuário: SET LOCAL ROLE rastro_user + claims com o id
 * verificado pelo Supabase Auth. A RLS do schema rastro limita ao(s) workspace(s) dele.
 */
export async function asUser<T>(db: Db, userId: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("userId inválido");
  return db.sql.transaction(async (tx) => {
    await tx.exec("set local role rastro_user");
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "rastro_user" })]);
    return fn(tx);
  });
}

/** Normaliza timestamps vindos de qualquer driver para ISO. */
export function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function num(v: unknown): number {
  return v == null ? 0 : Number(v);
}

export function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}
