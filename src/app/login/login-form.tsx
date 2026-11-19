"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

const input = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus-visible:border-brand";

export function LoginForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        E-mail
        <input name="email" type="email" autoComplete="email" required disabled={!enabled} className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Senha
        <input name="password" type="password" autoComplete="current-password" minLength={8} required disabled={!enabled} className={input} />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-critical">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={!enabled || pending} className="mt-1 h-10 rounded-lg bg-fg text-sm font-medium text-bg disabled:opacity-50">
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
