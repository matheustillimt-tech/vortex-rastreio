"use client";

import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("rastro-theme", next);
    } catch {
      /* armazenamento bloqueado: vale só nesta aba */
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-fg-2 hover:text-fg"
      aria-label="Alternar tema claro/escuro"
      title="Alternar tema"
    >
      <Sun size={16} className="hidden dark:block" />
      <Moon size={16} className="block dark:hidden" />
    </button>
  );
}
