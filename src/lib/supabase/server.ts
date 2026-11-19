import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/** Cliente do usuário logado (chave anon + sessão em cookie) → sujeito a RLS. */
export async function createSupabaseServerClient() {
  const jar = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          // chamado de Server Component: o proxy já renova a sessão
        }
      },
    },
  });
}
