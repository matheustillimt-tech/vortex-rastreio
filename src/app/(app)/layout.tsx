import { Sidebar } from "@/components/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUserId } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { labAllowed, labEnabled } from "@/lib/lab/setup";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const showLab = labEnabled() && labAllowed(await getCurrentUserId());
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar showLab={showLab} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-border bg-surface/60 px-4 py-2.5 backdrop-blur sm:px-6">
          {!isSupabaseConfigured() && (
            <span className="text-xs text-fg-3" title="Sem Supabase configurado: login desativado e dados apenas locais">
              Modo local · sem login
            </span>
          )}
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
