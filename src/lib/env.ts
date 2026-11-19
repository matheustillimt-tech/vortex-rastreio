/**
 * Leitura centralizada de variáveis de ambiente.
 *
 * DATABASE_URL       → Postgres do seu projeto Supabase, com a role dedicada (`rastro_app_prod` em produção, `rastro_app` no dev).
 *                      Sem ele (fora de produção) usamos PGlite local, persistido em .data/.
 * SUPABASE_URL/ANON  → só para o Supabase Auth (login). A chave anon/publishable é pública por natureza.
 * RASTRO_LOCAL=1     → (só fora de produção) ignora banco e login reais e usa o banco local,
 *                      mesmo com .env.local preenchido. Para desenvolver sem tocar no Supabase.
 * RASTRO_ENABLE_META=1 → libera salvar credenciais da Meta Ads e sincronizar o investimento (desligado por padrão).
 * Não existe SUPABASE_SERVICE_ROLE_KEY aqui de propósito.
 */
const isProduction = process.env.NODE_ENV === "production";
const forceLocal = !isProduction && process.env.RASTRO_LOCAL === "1";

export const env = {
  databaseUrl: forceLocal ? "" : (process.env.DATABASE_URL ?? ""),
  supabaseUrl: forceLocal ? "" : (process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
  supabaseAnonKey: forceLocal ? "" : (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
  cronSecret: process.env.CRON_SECRET ?? "",
  metaEnabled: process.env.RASTRO_ENABLE_META === "1",
  forceLocal,
  isProduction,
};

/** Login via Supabase Auth habilitado. */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}
