"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ email: z.string().email().max(254), password: z.string().min(8).max(200) });

export async function signIn(_prev: { error: string }, form: FormData): Promise<{ error: string }> {
  if (!isSupabaseConfigured()) return { error: "Login desativado no modo local." };
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "E-mail ou senha inválidos." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // mensagem genérica: não revela se o e-mail existe
  if (error) return { error: "E-mail ou senha incorretos." };
  redirect("/dashboard");
}
