import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  const enabled = isSupabaseConfigured();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-7">
        <Logo />
        <h1 className="mt-6 text-lg font-semibold">Entrar</h1>
        <p className="mb-5 mt-1 text-sm text-fg-2">Acesse o painel de rastreamento.</p>
        {!enabled && (
          <p className="mb-4 rounded-lg border border-dashed border-border bg-surface-2 p-3 text-xs text-fg-2">
            Modo local: o login fica ativo depois de configurar o Supabase.{" "}
            <Link href="/dashboard" className="font-medium text-brand underline">
              Abrir o painel demonstrativo
            </Link>
          </p>
        )}
        <LoginForm enabled={enabled} />
      </div>
    </main>
  );
}
