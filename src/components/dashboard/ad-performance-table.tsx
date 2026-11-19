import type { AdLevel, AdPerformanceRow } from "@/lib/domain/metrics";
import { UNIDENTIFIED } from "@/lib/domain/metrics";
import { brl, int, multiple, pct } from "@/lib/format";
import { PlatformTag } from "../ui";

const th = "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg-3 whitespace-nowrap";
const thR = `${th} text-right`;
const td = "px-4 py-2.5 whitespace-nowrap";
const tdR = `${td} text-right tabular`;

const TITLE: Record<AdLevel, string> = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" };
const EMPTY: Record<AdLevel, string> = {
  campaign: "Sem campanhas com investimento no período.",
  adset: "Sem conjuntos com investimento no período.",
  ad: "Sem anúncios com investimento no período.",
};

const cents = (v: number | null) => brl(v == null ? null : Math.round(v));

/** Investimento × vendas atribuídas por campanha, conjunto ou anúncio. */
export function AdPerformanceTable({ rows, level }: { rows: AdPerformanceRow[]; level: AdLevel }) {
  if (rows.length === 0) return <p className="px-5 py-8 text-center text-sm text-fg-2">{EMPTY[level]}</p>;
  const total = rows.reduce(
    (t, r) => ({
      spend: t.spend + r.spendCents,
      approved: t.approved + r.approved,
      revenue: t.revenue + r.revenueCents,
      profit: t.profit + r.profitCents,
    }),
    { spend: 0, approved: 0, revenue: 0, profit: 0 },
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className={th}>{TITLE[level]}</th>
            <th className={th}>Plataforma</th>
            <th className={thR}>Investimento</th>
            <th className={thR}>Vendas</th>
            <th className={thR}>Faturamento</th>
            <th className={thR} title="Faturamento − taxas − impostos − custo por venda − investimento (sem custos fixos)">
              Lucro
            </th>
            <th className={thR}>ROAS</th>
            <th className={thR}>CPA</th>
            <th className={thR}>CPC</th>
            <th className={thR}>CTR</th>
            <th className={thR} title="Compras reportadas pela própria plataforma de anúncios (modelo dela)">
              Vendas (plataforma)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const unknown = r.id === UNIDENTIFIED;
            return (
              <tr key={`${r.platform}:${r.campaignId}:${r.id}`} className="hover:bg-surface-2">
                <td className={`${td} max-w-[22rem]`}>
                  <p className={`truncate font-medium ${unknown ? "text-fg-2 italic" : ""}`} title={r.name}>
                    {r.name}
                  </p>
                  {level !== "campaign" && (
                    <p className="truncate text-xs text-fg-3" title={r.parentName ? `${r.campaignName} › ${r.parentName}` : r.campaignName}>
                      {r.parentName ? `${r.campaignName} › ${r.parentName}` : r.campaignName}
                    </p>
                  )}
                </td>
                <td className={td}>
                  <PlatformTag platform={r.platform} />
                </td>
                <td className={tdR}>{brl(r.spendCents)}</td>
                <td className={tdR}>{int(r.approved)}</td>
                <td className={tdR}>{brl(r.revenueCents)}</td>
                <td className={`${tdR} ${r.profitCents < 0 ? "text-critical" : ""}`}>{brl(r.profitCents)}</td>
                <td className={`${tdR} font-medium`}>{multiple(r.roas)}</td>
                <td className={tdR}>{cents(r.cpaCents)}</td>
                <td className={tdR}>{cents(r.cpcCents)}</td>
                <td className={tdR}>{pct(r.ctr)}</td>
                <td className={`${tdR} text-fg-2`}>{int(r.platformPurchases)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-border font-medium">
          <tr>
            <td className={td} colSpan={2}>
              Total
            </td>
            <td className={tdR}>{brl(total.spend)}</td>
            <td className={tdR}>{int(total.approved)}</td>
            <td className={tdR}>{brl(total.revenue)}</td>
            <td className={`${tdR} ${total.profit < 0 ? "text-critical" : ""}`}>{brl(total.profit)}</td>
            <td className={tdR}>{multiple(total.spend > 0 ? total.revenue / total.spend : null)}</td>
            <td className={tdR}>{cents(total.spend > 0 && total.approved > 0 ? total.spend / total.approved : null)}</td>
            <td className={tdR} colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
