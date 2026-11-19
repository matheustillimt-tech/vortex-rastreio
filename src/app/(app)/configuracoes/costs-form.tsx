"use client";

import { useActionState } from "react";
import type { CostSettings } from "@/lib/domain/types";
import { saveCosts, type SaveCostsState } from "./actions";

const input = "h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm tabular outline-none focus-visible:border-brand";

function bpsToText(bps: number) {
  return (bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}
function centsToText(c: number) {
  return (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CostsForm({ initial }: { initial: CostSettings }) {
  const [state, action, pending] = useActionState<SaveCostsState, FormData>(saveCosts, { ok: true, message: "" });
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Imposto sobre faturamento (%)</span>
        <input name="tax" inputMode="decimal" defaultValue={bpsToText(initial.taxRateBps)} className={input} />
        <span className="text-xs text-fg-3">Ex.: Simples Nacional 6%</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Taxa de gateway (%)</span>
        <input name="gateway" inputMode="decimal" defaultValue={bpsToText(initial.gatewayFeeBps)} className={input} />
        <span className="text-xs text-fg-3">Usada só quando o checkout não informa a taxa</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Custo por venda (R$)</span>
        <input name="perSale" inputMode="decimal" defaultValue={centsToText(initial.costPerSaleCents)} className={input} />
        <span className="text-xs text-fg-3">Produto físico, entrega, bônus</span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Custos fixos mensais (R$)</span>
        <input name="fixed" inputMode="decimal" defaultValue={centsToText(initial.fixedMonthlyCents)} className={input} />
        <span className="text-xs text-fg-3">Rateados pelos dias do período filtrado</span>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-fg px-4 py-2 text-sm font-medium text-bg disabled:opacity-60">
          {pending ? "Salvando…" : "Salvar custos"}
        </button>
        {state.message && (
          <p role="status" className={`text-sm ${state.ok ? "text-fg-2" : "text-critical"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
