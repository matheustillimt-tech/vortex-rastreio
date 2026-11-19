"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DailyPoint } from "@/lib/domain/metrics";
import { brl, brlCompact, shortDay } from "@/lib/format";

const SERIES = [
  { key: "revenueCents", label: "Faturamento bruto", color: "var(--series-1)" },
  { key: "spendCents", label: "Investimento", color: "var(--series-2)" },
] as const;

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; value: number }>;
}

function ChartTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg">{shortDay(label)}</p>
      {SERIES.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value ?? 0;
        return (
          <p key={s.key} className="flex items-center justify-between gap-4 text-fg-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular font-medium text-fg">{brl(v)}</span>
          </p>
        );
      })}
    </div>
  );
}

/** Faturamento × investimento por dia. Mesma unidade (R$) → um único eixo. */
export function RevenueChart({ data }: { data: DailyPoint[] }) {
  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-4 text-xs text-fg-2" aria-label="Legenda">
        {SERIES.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDay}
              tick={{ fill: "var(--fg-3)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => brlCompact(v)}
              tick={{ fill: "var(--fg-3)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--fg-3)", strokeDasharray: "3 3" }} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
