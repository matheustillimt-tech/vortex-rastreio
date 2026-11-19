import type { Order } from "@/lib/domain/types";
import { int, pct } from "@/lib/format";

/**
 * Quanto das vendas aprovadas tem origem observada. Barra segmentada com legenda e
 * números visíveis (a cor nunca é o único código).
 */
export function AttributionBar({ orders }: { orders: Order[] }) {
  const approved = orders.filter((o) => o.status === "approved");
  const total = approved.length;
  const parts = [
    { key: "click_id", label: "Observada · visitante", color: "var(--series-1)", n: approved.filter((o) => o.attributionMethod === "click_id").length },
    { key: "utm", label: "Observada · UTM do pedido", color: "var(--series-3)", n: approved.filter((o) => o.attributionMethod === "utm").length },
    { key: "none", label: "Sem origem", color: "var(--fg-3)", n: approved.filter((o) => o.attributionMethod === "unattributed").length },
  ];

  if (total === 0) return <p className="text-sm text-fg-2">Nenhuma venda aprovada no período.</p>;

  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label="Distribuição da atribuição das vendas aprovadas">
        {parts
          .filter((p) => p.n > 0)
          .map((p) => (
            <div key={p.key} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} title={`${p.label}: ${p.n}`} />
          ))}
      </div>
      <ul className="mt-4 flex flex-col gap-2.5 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-fg-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="tabular text-fg">
              {int(p.n)} <span className="text-fg-3">· {pct(p.n / total, 0)}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-fg-3">
        Atribuição estimada ainda não está ativa: vendas sem origem nunca são distribuídas entre campanhas.
      </p>
    </div>
  );
}
