import type { CampaignRow } from "@/lib/domain/metrics";
import type { Order } from "@/lib/domain/types";
import { brl, dateTime, int, multiple, pct } from "@/lib/format";
import { AttributionTag, PlatformTag, StatusBadge } from "../ui";

const th = "px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg-3 whitespace-nowrap";
const thR = `${th} text-right`;
const td = "px-4 py-2.5 whitespace-nowrap";
const tdR = `${td} text-right tabular`;

export function CampaignsTable({ rows, limit }: { rows: CampaignRow[]; limit?: number }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  if (shown.length === 0) return <p className="px-5 py-8 text-center text-sm text-fg-2">Sem campanhas com gasto no período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className={th}>Campanha</th>
            <th className={th}>Plataforma</th>
            <th className={thR}>Investimento</th>
            <th className={thR}>Vendas</th>
            <th className={thR} title="Compras reportadas pela própria plataforma de anúncios (modelo dela)">
              Vendas (plataforma)
            </th>
            <th className={thR}>Faturamento</th>
            <th className={thR}>CPA</th>
            <th className={thR}>CTR</th>
            <th className={thR}>ROAS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shown.map((r) => (
            <tr key={`${r.platform}:${r.campaignId}`} className="hover:bg-surface-2">
              <td className={`${td} max-w-[18rem] truncate font-medium`} title={r.campaignName}>
                {r.campaignName}
              </td>
              <td className={td}>
                <PlatformTag platform={r.platform} />
              </td>
              <td className={tdR}>{brl(r.spendCents)}</td>
              <td className={tdR}>{int(r.approved)}</td>
              <td className={`${tdR} text-fg-2`}>{int(r.platformPurchases)}</td>
              <td className={tdR}>{brl(r.revenueCents)}</td>
              <td className={tdR}>{brl(r.cpaCents == null ? null : Math.round(r.cpaCents))}</td>
              <td className={tdR}>{pct(r.ctr)}</td>
              <td className={`${tdR} font-medium`}>{multiple(r.roas)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalesTable({ orders, limit }: { orders: Order[]; limit?: number }) {
  const shown = limit ? orders.slice(0, limit) : orders;
  if (shown.length === 0) return <p className="px-5 py-8 text-center text-sm text-fg-2">Nenhuma venda no período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className={th}>Data</th>
            <th className={th}>Pedido</th>
            <th className={th}>Status</th>
            <th className={th}>Produto</th>
            <th className={th}>Origem</th>
            <th className={th}>Campanha</th>
            <th className={th}>Atribuição</th>
            <th className={thR}>Valor</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shown.map((o) => (
            <tr key={o.id} className="hover:bg-surface-2">
              <td className={`${td} tabular text-fg-2`}>{dateTime(o.createdAt)}</td>
              <td className={`${td} font-mono text-xs`}>{o.externalId}</td>
              <td className={td}>
                <StatusBadge status={o.status} />
              </td>
              <td className={`${td} max-w-[12rem] truncate`} title={o.productName}>
                {o.productName}
              </td>
              <td className={td}>
                <PlatformTag platform={o.platform} />
              </td>
              <td className={`${td} max-w-[14rem] truncate text-fg-2`} title={o.campaignName ?? ""}>
                {o.campaignName ?? "—"}
              </td>
              <td className={td}>
                <AttributionTag method={o.attributionMethod} />
              </td>
              <td className={tdR}>{brl(o.grossCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
