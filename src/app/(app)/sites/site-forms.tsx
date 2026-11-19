"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useState } from "react";
import { createSiteAction, updateSiteAction, type SiteActionState } from "./actions";

const input = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus-visible:border-brand";
const area = "min-h-20 w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs outline-none focus-visible:border-brand";
const initial: SiteActionState = { ok: true, message: "" };

function Status({ state }: { state: SiteActionState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-fg-2" : "text-critical"}`}>
      {state.message}
    </p>
  );
}

export function CopyButton({ value, label = "Copiar" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* área de transferência bloqueada: o valor continua visível para copiar à mão */
        }
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-fg-2 hover:text-fg"
      aria-label={`${label}: ${value}`}
    >
      {done ? <Check size={14} className="text-good" /> : <Copy size={14} />}
      {done ? "Copiado" : label}
    </button>
  );
}

export function NewSiteForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(createSiteAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm">
        Nome
        <input name="name" required maxLength={120} placeholder="Ex.: Página de vendas do curso" disabled={disabled} className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm sm:row-span-2">
        Domínios autorizados (um por linha)
        <textarea name="origins" placeholder={"meusite.com.br\n*.meusite.com.br"} disabled={disabled} className={area} />
        <span className="text-xs text-fg-3">Vazio = aceita qualquer domínio (só para testes).</span>
      </label>
      <div className="flex items-end gap-3">
        <button type="submit" disabled={disabled || pending} className="h-9 rounded-lg bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50">
          {pending ? "Criando…" : "Cadastrar site"}
        </button>
      </div>
      <div className="sm:col-span-2">
        <Status state={state} />
      </div>
    </form>
  );
}

export function EditSiteForm({ siteId, name, origins, disabled }: { siteId: string; name: string; origins: string[]; disabled: boolean }) {
  const [state, action, pending] = useActionState(updateSiteAction, initial);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="siteId" value={siteId} />
      <label className="flex flex-col gap-1.5 text-sm">
        Nome
        <input name="name" required maxLength={120} defaultValue={name} disabled={disabled} className={input} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Domínios autorizados
        <textarea name="origins" defaultValue={origins.join("\n")} disabled={disabled} className={area} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={disabled || pending} className="h-8 rounded-lg border border-border px-3 text-xs font-medium disabled:opacity-50">
          {pending ? "Salvando…" : "Salvar alterações"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
