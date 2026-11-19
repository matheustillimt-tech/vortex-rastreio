import { AlertTriangle, CheckCircle2, Clock, FlaskConical, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL } from "@/lib/domain/order-status";
import type { AttributionMethod, OrderStatus } from "@/lib/domain/types";
import { BRAND_NAME } from "@/lib/brand";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-xl border border-border bg-surface ${className}`}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-fg-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-2">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function DemoBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-warning px-2.5 py-1 text-xs font-medium text-fg"
      title="Números fictícios gerados localmente. Conecte Meta Ads e um checkout para ver dados reais."
    >
      <FlaskConical size={13} className="text-warning" /> Dados demonstrativos
    </span>
  );
}

const STATUS_META: Record<OrderStatus, { icon: typeof CheckCircle2; color: string }> = {
  approved: { icon: CheckCircle2, color: "text-good" },
  pending: { icon: Clock, color: "text-warning" },
  cancelled: { icon: XCircle, color: "text-fg-3" },
  refunded: { icon: RotateCcw, color: "text-serious" },
  chargeback: { icon: ShieldAlert, color: "text-critical" },
};

/** Status sempre com ícone + texto (cor nunca carrega significado sozinha). */
export function StatusBadge({ status }: { status: OrderStatus }) {
  const { icon: Icon, color } = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <Icon size={14} className={color} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusIcon({ status, size = 16 }: { status: OrderStatus; size?: number }) {
  const { icon: Icon, color } = STATUS_META[status];
  return <Icon size={size} className={color} aria-hidden="true" />;
}

export const ATTRIBUTION_LABEL: Record<AttributionMethod, string> = {
  click_id: "Observada · visitante",
  utm: "Observada · UTM",
  estimated: "Estimada",
  unattributed: "Sem origem",
};

export function AttributionTag({ method }: { method: AttributionMethod }) {
  const style =
    method === "click_id" || method === "utm"
      ? "border-border text-fg"
      : method === "estimated"
        ? "border-dashed border-warning text-fg"
        : "border-dashed border-border text-fg-3";
  return <span className={`inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] ${style}`}>{ATTRIBUTION_LABEL[method]}</span>;
}

export function PlatformTag({ platform }: { platform: string | null }) {
  const label = platform === "meta" ? "Meta" : platform === "google" ? "Google" : platform === "tiktok" ? "TikTok" : "—";
  return <span className="text-xs text-fg-2">{label}</span>;
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${tone === "warn" ? "border-warning/50 bg-warning/5" : "border-border bg-surface-2"}`}>
      {tone === "warn" && <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />}
      <div className="text-fg-2">{children}</div>
    </div>
  );
}

/** Banco conectado ainda sem a migration exigida por esta versão do app. */
export function SchemaPending() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-dashed border-warning bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">Atualização do banco pendente</h1>
      <p className="mt-2 text-sm text-fg-2">
        Esta versão do {BRAND_NAME} precisa da migração <code className="font-mono">0004_multiplataforma</code>. Aplique as migrações
        pendentes com <code className="font-mono">supabase db push</code> (veja o INSTALACAO.md).
      </p>
    </div>
  );
}

/** Painel de dados reais ainda vazio: diz isso com clareza, sem inventar números. */
export function EmptyDataNotice() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm">
      <p className="text-fg-2">
        <strong className="text-fg">Ainda não há vendas nem investimento registrados.</strong> Os indicadores abaixo são os valores reais
        do workspace (zero ou “—” quando não há base de cálculo).
      </p>
      <a href="?demo=1" className="whitespace-nowrap text-xs font-medium text-brand underline">
        Ver demonstração com dados fictícios
      </a>
    </div>
  );
}

/** Faixa forte do modo demonstração: impossível confundir com dados reais. */
export function DemoModeBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-dashed border-warning bg-warning/10 px-4 py-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-fg">
        <FlaskConical size={16} className="text-warning" /> Modo demonstração: todos os números desta tela são fictícios.
      </p>
      <a href="?" className="whitespace-nowrap text-xs font-medium text-brand underline">
        Voltar aos dados reais
      </a>
    </div>
  );
}

/** Usuário autenticado (ex.: de outro sistema que divide o mesmo Supabase) sem acesso a nenhum workspace. */
export function NoWorkspace() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-border bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">Sem acesso a um workspace</h1>
      <p className="mt-2 text-sm text-fg-2">
        Sua conta ainda não foi adicionada a nenhum workspace do {BRAND_NAME}. Peça a um administrador para liberar o acesso.
      </p>
    </div>
  );
}

export function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 p-3.5 font-mono text-xs leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  );
}
