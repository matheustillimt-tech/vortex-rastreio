import "server-only";
import { getDb } from "@/lib/db";
import { PostgresStore } from "./postgres";
import type { Store } from "./types";

const g = globalThis as unknown as { __rastroStore?: Store };

/** Store de ingestão sobre o banco (Supabase em produção, PGlite persistido em dev). */
export async function getStore(): Promise<Store> {
  if (g.__rastroStore) return g.__rastroStore;
  const store = new PostgresStore(await getDb());
  g.__rastroStore = store;
  return store;
}
