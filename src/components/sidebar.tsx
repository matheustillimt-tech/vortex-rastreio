"use client";

import { Activity, BarChart3, Cable, FlaskConical, Globe, LayoutDashboard, Megaphone, Menu, Radar, Receipt, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "./brand";

const NAV = [
  {
    group: "Análise",
    items: [
      { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
      { href: "/campanhas", label: "Campanhas", icon: Megaphone },
      { href: "/vendas", label: "Vendas", icon: Receipt },
    ],
  },
  {
    group: "Configuração",
    items: [
      { href: "/sites", label: "Sites", icon: Globe },
      { href: "/rastreamento", label: "Rastreamento", icon: Radar },
      { href: "/integracoes", label: "Integrações", icon: Cable },
      { href: "/integracoes/saude", label: "Saúde das integrações", icon: Activity },
      { href: "/configuracoes", label: "Custos e conta", icon: Settings },
    ],
  },
];

const LAB_SECTION = { group: "Simulação", items: [{ href: "/laboratorio", label: "Laboratório", icon: FlaskConical }] };
const ALL_HREFS = [...NAV, LAB_SECTION].flatMap((s) => s.items.map((i) => i.href));

function NavList({ onNavigate, showLab }: { onNavigate?: () => void; showLab: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-6" aria-label="Navegação principal">
      {(showLab ? [...NAV, LAB_SECTION] : NAV).map((section) => (
        <div key={section.group}>
          <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-fg-3">{section.group}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              // o item mais específico vence (/integracoes/saude não acende /integracoes)
              const active =
                (pathname === href || pathname.startsWith(`${href}/`)) &&
                !ALL_HREFS.some((h) => h.length > href.length && (pathname === h || pathname.startsWith(`${h}/`)));
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      active ? "bg-brand-soft font-medium text-fg" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
                    }`}
                  >
                    <Icon size={16} className={active ? "text-brand" : ""} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ showLab = false }: { showLab?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* desktop */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
        <div className="mb-8 px-3">
          <Logo />
        </div>
        <NavList showLab={showLab} />
        <div className="mt-auto rounded-lg border border-border bg-surface-2 p-3 text-xs text-fg-2">
          <p className="flex items-center gap-1.5 font-medium text-fg">
            <BarChart3 size={14} /> MVP local
          </p>
          <p className="mt-1">Nenhuma conta externa conectada.</p>
        </div>
      </aside>

      {/* mobile */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border"
          aria-label="Abrir menu"
          aria-expanded={open}
        >
          <Menu size={18} />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40" aria-label="Fechar menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-surface px-3 py-5 shadow-xl">
            <div className="mb-8 flex items-center justify-between px-3">
              <Logo />
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu" className="text-fg-2">
                <X size={18} />
              </button>
            </div>
            <NavList showLab={showLab} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
