"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PERIODS } from "@/lib/dashboard/filters";

interface Props {
  campaigns: Array<{ id: string; name: string; platform: string }>;
  products: Array<{ id: string; name: string }>;
  showPlatform?: boolean;
}

const selectCls =
  "h-9 min-w-0 rounded-lg border border-border bg-surface px-2.5 text-sm text-fg outline-none hover:border-fg-3 focus-visible:border-brand";

/** Filtros numa linha só, acima dos gráficos; estado na URL (compartilhável). */
export function FilterBar({ campaigns, products, showPlatform = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
      <div role="group" aria-label="Período" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
        {PERIODS.map((p) => {
          const active = (params.get("periodo") ?? "30") === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => set("periodo", p.value === "30" ? "" : p.value)}
              aria-pressed={active}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${active ? "bg-fg text-bg" : "text-fg-2 hover:text-fg"}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {showPlatform && (
        <select aria-label="Plataforma" className={selectCls} value={params.get("plataforma") ?? ""} onChange={(e) => set("plataforma", e.target.value)}>
          <option value="">Todas as plataformas</option>
          <option value="meta">Meta Ads</option>
          <option value="google">Google Ads</option>
          <option value="tiktok">TikTok Ads</option>
        </select>
      )}
      <select aria-label="Campanha" className={`${selectCls} max-w-[16rem]`} value={params.get("campanha") ?? ""} onChange={(e) => set("campanha", e.target.value)}>
        <option value="">Todas as campanhas</option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select aria-label="Produto" className={`${selectCls} max-w-[14rem]`} value={params.get("produto") ?? ""} onChange={(e) => set("produto", e.target.value)}>
        <option value="">Todos os produtos</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
