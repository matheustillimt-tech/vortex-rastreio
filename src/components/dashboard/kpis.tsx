import type { Summary } from "@/lib/domain/metrics";
import type { OrderStatus } from "@/lib/domain/types";

const STRIP_ORDER: OrderStatus[] = ["approved", "pending", "cancelled", "refunded", "chargeback"];
import { STATUS_LABEL } from "@/lib/domain/order-status";
import { brl, int, multiple, pct } from "@/lib/format";
import { StatusIcon } from "../ui";

function Tile({ label, value, hint, emphasis = false }: { label: string; value: string; hint?: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <p className="text-xs text-fg-2">{label}</p>
      <p className={`tabular mt-1 font-semibold tracking-tight ${emphasis ? "text-xl 2xl:text-2xl" : "text-lg"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-fg-3">{hint}</p>}
    </div>
  );
}

export function KpiGrid({ s }: { s: Summary }) {
  const profitPositive = s.profitCents >= 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile emphasis label="Faturamento bruto" value={brl(s.grossRevenueCents)} hint={`${int(s.counts.approved)} vendas aprovadas`} />
        <Tile emphasis label="Faturamento líquido" value={brl(s.netRevenueCents)} hint="após taxas e impostos" />
        <Tile emphasis label="Investimento em anúncios" value={brl(s.adSpendCents)} />
        <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
          <p className="text-xs text-fg-2">Lucro estimado</p>
          <p className={`tabular mt-1 text-xl font-semibold tracking-tight 2xl:text-2xl ${profitPositive ? "" : "text-critical"}`}>
            {profitPositive ? "" : "− "}
            {brl(Math.abs(s.profitCents))}
          </p>
          <p className="mt-0.5 text-[11px] text-fg-3">líquido − anúncios − custos configurados</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="ROAS" value={multiple(s.roas)} hint="bruto ÷ investimento" />
        <Tile label="CPA" value={brl(s.cpaCents == null ? null : Math.round(s.cpaCents))} hint="por venda aprovada" />
        <Tile label="CPC" value={brl(s.cpcCents == null ? null : Math.round(s.cpcCents))} />
        <Tile label="CTR" value={pct(s.ctr)} />
        <Tile label="CPM" value={brl(s.cpmCents == null ? null : Math.round(s.cpmCents))} />
      </div>
    </div>
  );
}

export function StatusStrip({ s }: { s: Summary }) {
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-5" aria-label="Vendas por status">
      {STRIP_ORDER.map((st) => (
        <li key={st} className="flex items-center gap-2.5 bg-surface px-4 py-3">
          <StatusIcon status={st} size={18} />
          <div>
            <p className="text-xs text-fg-2">{STATUS_LABEL[st]}</p>
            <p className="tabular text-base font-semibold">{int(s.counts[st])}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
