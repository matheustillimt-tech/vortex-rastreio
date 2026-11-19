"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { LEVELS } from "@/lib/dashboard/filters";

/** Abas Campanhas / Conjuntos / Anúncios; o nível fica na URL (?nivel=), como os outros filtros. */
export function LevelTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const current = params.get("nivel") ?? "campanha";

  function go(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "campanha") next.delete("nivel");
    else next.set("nivel", value);
    startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div role="tablist" aria-label="Nível" className={`inline-flex rounded-lg border border-border bg-surface p-0.5 ${pending ? "opacity-60" : ""}`}>
      {LEVELS.map((l) => {
        const active = current === l.value;
        return (
          <button
            key={l.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => go(l.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${active ? "bg-fg text-bg" : "text-fg-2 hover:text-fg"}`}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
