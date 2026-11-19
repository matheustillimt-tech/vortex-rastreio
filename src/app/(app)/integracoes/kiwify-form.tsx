"use client";

import { useActionState } from "react";
import { createKiwifyWebhook, saveKiwifySecret, saveMetaConfig, type CreateWebhookState, type SimpleState } from "./actions";

const input = "h-9 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus-visible:border-brand";

function Msg({ state }: { state: { ok: boolean; message: string } }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-fg-2" : "text-critical"}`}>
      {state.message}
    </p>
  );
}

export function KiwifyWebhookForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<CreateWebhookState, FormData>(createKiwifyWebhook, { ok: true, message: "" });
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex w-full flex-col gap-1.5 text-sm sm:w-auto">
          Nome
          <input name="label" placeholder="Ex.: Kiwify · Curso principal" maxLength={120} disabled={disabled} className={`${input} w-full sm:w-64`} />
        </label>
        <button type="submit" disabled={disabled || pending} className="h-9 rounded-lg bg-fg px-4 text-sm font-medium text-bg disabled:opacity-50">
          {pending ? "Gerando…" : "Gerar URL de webhook"}
        </button>
      </div>
      <Msg state={state} />
      {state.url && (
        <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs">
          <code>{state.url}</code>
        </pre>
      )}
    </form>
  );
}

/** Campo só de escrita: o token nunca volta para a tela depois de salvo. */
export function KiwifySecretForm({ integrationId, hasSecret, disabled }: { integrationId: string; hasSecret: boolean; disabled: boolean }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(saveKiwifySecret, { ok: true, message: "" });
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="integrationId" value={integrationId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex w-full flex-col gap-1.5 text-sm sm:w-auto">
          {hasSecret ? "Trocar token de assinatura" : "Token de assinatura da Kiwify"}
          <input
            name="secret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={hasSecret ? "•••••••• (configurado)" : "Cole o token do webhook"}
            disabled={disabled}
            className={`${input} w-full sm:w-72`}
          />
        </label>
        <button type="submit" disabled={disabled || pending} className="h-9 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-50">
          {pending ? "Salvando…" : "Salvar token"}
        </button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function MetaForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<SimpleState, FormData>(saveMetaConfig, { ok: true, message: "" });
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex w-full flex-col gap-1.5 text-sm sm:w-auto">
          Conta de anúncios
          <input name="adAccountId" placeholder="act_1234567890" disabled={!enabled} className={`${input} w-full sm:w-48`} />
        </label>
        <label className="flex w-full flex-col gap-1.5 text-sm sm:w-auto">
          Token de acesso (ads_read)
          <input name="token" type="password" autoComplete="off" disabled={!enabled} className={`${input} w-full sm:w-72`} />
        </label>
        <button type="submit" disabled={!enabled || pending} className="h-9 rounded-lg border border-border px-3 text-sm font-medium disabled:opacity-50">
          Conectar
        </button>
      </div>
      <Msg state={state} />
    </form>
  );
}
