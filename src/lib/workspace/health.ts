import { asUser, iso, num, type Db } from "@/lib/db/client";
import { getAdapter, PLANNED_PROVIDERS, providerLabel } from "@/lib/integrations/adapters";

/**
 * Saúde das integrações de checkout, lida em nome do usuário (rastro_user + RLS).
 * Nunca seleciona colunas de segredo (o rastro_user nem tem grant nelas).
 */

type Row = Record<string, unknown>;

export interface HealthCounts {
  received: number;
  processed: number;
  duplicates: number;
  ignored: number;
  failed: number;
  authFailed: number;
  invalid: number;
}

export interface IntegrationHealth {
  id: string;
  provider: string;
  providerLabel: string;
  label: string | null;
  status: string;
  hasSigningSecret: boolean;
  allowUnsigned: boolean;
  /** a plataforma tem autenticação oficial confirmada no adaptador */
  authDocumented: boolean;
  lastReceivedAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  today: HealthCounts;
  last7d: HealthCounts;
  /** null quando o usuário não é admin (a fila de webhooks só é visível para admin) */
  pendingRetries: number | null;
  /** falhas que esgotaram as tentativas automáticas */
  failedPermanently: number | null;
}

export type HealthState = "paused" | "disconnected" | "blocked" | "waiting" | "failing" | "attention" | "healthy";

const ZERO: HealthCounts = { received: 0, processed: 0, duplicates: 0, ignored: 0, failed: 0, authFailed: 0, invalid: 0 };

/** dia em horário de Brasília (o mesmo usado pelos contadores no banco) */
export function brasiliaDay(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

function add(a: HealthCounts, r: Row): HealthCounts {
  return {
    received: a.received + num(r.received),
    processed: a.processed + num(r.processed),
    duplicates: a.duplicates + num(r.duplicates),
    ignored: a.ignored + num(r.ignored),
    failed: a.failed + num(r.failed),
    authFailed: a.authFailed + num(r.auth_failed),
    invalid: a.invalid + num(r.invalid),
  };
}

export async function loadIntegrationHealth(db: Db, userId: string, workspaceId: string, now = new Date()): Promise<IntegrationHealth[]> {
  const today = brasiliaDay(now);
  const since = brasiliaDay(new Date(now.getTime() - 6 * 86_400_000));
  const checkout = ["kiwify", "kirvano", ...PLANNED_PROVIDERS.map((p) => p.provider)];

  const { integrations, stats, retries, isAdmin } = await asUser(db, userId, async (tx) => ({
    integrations: await tx.query<Row>(
      `select id, provider, status, label, has_signing_secret, last_received_at, last_event_at, last_error, created_at,
              coalesce((config ->> 'allow_unsigned')::boolean, false) as allow_unsigned
       from rastro.integrations where workspace_id = $1 and provider = any($2::text[]) order by created_at`,
      [workspaceId, checkout],
    ),
    stats: await tx.query<Row>(
      `select integration_id, day::text as day, received, processed, duplicates, ignored, failed, auth_failed, invalid
       from rastro.integration_daily_stats where workspace_id = $1 and day >= $2::date`,
      [workspaceId, since],
    ),
    retries: await tx.query<Row>(
      `select integration_id,
              count(*) filter (where next_retry_at is not null) as pending,
              count(*) filter (where next_retry_at is null) as exhausted
       from rastro.webhook_events where workspace_id = $1 and status = 'failed' group by integration_id`,
      [workspaceId],
    ),
    isAdmin: (await tx.query<{ a: boolean }>("select rastro.is_admin($1) as a", [workspaceId]))[0]?.a === true,
  }));

  return integrations.map((r) => {
    const id = String(r.id);
    const provider = String(r.provider);
    const mine = stats.filter((s) => String(s.integration_id) === id);
    const retry = retries.find((x) => String(x.integration_id) === id);
    return {
      id,
      provider,
      providerLabel: providerLabel(provider),
      label: (r.label as string) ?? null,
      status: String(r.status),
      hasSigningSecret: r.has_signing_secret === true,
      allowUnsigned: r.allow_unsigned === true,
      authDocumented: getAdapter(provider)?.auth.documented === true,
      lastReceivedAt: iso(r.last_received_at),
      lastEventAt: iso(r.last_event_at),
      lastError: (r.last_error as string) ?? null,
      today: mine.filter((s) => String(s.day) === today).reduce(add, ZERO),
      last7d: mine.reduce(add, ZERO),
      pendingRetries: isAdmin ? num(retry?.pending ?? 0) : null,
      failedPermanently: isAdmin ? num(retry?.exhausted ?? 0) : null,
    };
  });
}

/** Sem eventos válidos há mais que isso → atenção. */
export const STALE_DAYS = 7;

/** Estado resumido (sempre exibido com ícone + texto). Função pura, testada. */
export function healthState(h: IntegrationHealth, now = new Date()): { state: HealthState; text: string } {
  if (h.status === "paused") return { state: "paused", text: "Pausada: entregas são recusadas" };
  if (!getAdapter(h.provider)) return { state: "blocked", text: "Plataforma ainda sem adaptador: entregas são recusadas" };
  if (!h.authDocumented && !h.allowUnsigned) {
    return { state: "blocked", text: "Autenticação oficial ainda não confirmada: entregas são recusadas" };
  }
  if (h.provider === "kiwify" && !h.hasSigningSecret && !h.allowUnsigned) {
    return { state: "disconnected", text: "Desconectada: falta o token de assinatura" };
  }
  if (!h.lastReceivedAt && !h.lastEventAt) return { state: "waiting", text: "Conectada: aguardando a primeira entrega" };
  // um evento válido limpa o erro; se o erro existe, ele é mais recente que o último válido
  if (h.lastError) return { state: "failing", text: `Último problema: ${h.lastError}` };
  if ((h.pendingRetries ?? 0) > 0 || (h.failedPermanently ?? 0) > 0 || h.today.failed > 0 || h.today.authFailed > 0) {
    return { state: "attention", text: "Recebendo, com falhas recentes" };
  }
  if (h.lastEventAt) {
    const days = Math.floor((now.getTime() - Date.parse(h.lastEventAt)) / 86_400_000);
    if (days >= STALE_DAYS) return { state: "attention", text: `Sem eventos válidos há ${days} dias` };
  }
  return { state: "healthy", text: "Recebendo normalmente" };
}

export function isConnected(h: IntegrationHealth): boolean {
  const st = healthState(h).state;
  return st !== "paused" && st !== "disconnected" && st !== "blocked";
}
