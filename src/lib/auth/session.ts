import "server-only";
import { DEV_USER_ID } from "@/lib/db/client";
import { env, isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Id do usuário da requisição, verificado pelo Supabase Auth (getUser valida o JWT no servidor).
 * Sem Supabase configurado e fora de produção: usuário de desenvolvimento do banco local.
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  }
  // usuário de desenvolvimento só existe no banco local (PGlite); com banco real, sem login = sem acesso
  return env.isProduction || env.databaseUrl ? null : DEV_USER_ID;
}
