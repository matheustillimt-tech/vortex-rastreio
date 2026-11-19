import type { TouchSession } from "@/lib/domain/attribution";
import type { AdInsightDaily, AttributionParams, CheckoutProvider, NormalizedOrder, Order } from "@/lib/domain/types";

export interface Site {
  id: string;
  workspaceId: string;
  publicKey: string;
  /** origens permitidas para CORS do /api/collect; vazio = qualquer uma (só em dev) */
  allowedOrigins: string[];
  /** sites desativados não recebem eventos */
  status?: "active" | "disabled";
}

export interface Integration {
  id: string;
  workspaceId: string;
  provider: CheckoutProvider | "meta";
  /** produção ou laboratório (definido na criação do workspace, imutável) */
  workspaceKind: "production" | "sandbox";
  /** segredos aceitos para a assinatura (atual e, durante troca de token, o anterior) */
  signingSecrets: string[];
  /** só a integração do banco local de desenvolvimento pode aceitar eventos sem assinatura */
  allowUnsigned: boolean;
}

export interface SessionRecord {
  id: string;
  workspaceId: string;
  siteId: string;
  visitorId: string;
  startedAt: string;
  landingPath: string;
  referrerHost: string | null;
  params: AttributionParams;
}

export interface EventRecord {
  workspaceId: string;
  siteId: string;
  eventId: string;
  visitorId: string;
  sessionId: string;
  type: string;
  name: string | null;
  path: string;
  occurredAt: string;
}

export type WebhookStatus = "received" | "processed" | "failed" | "ignored";

export interface WebhookEventRecord {
  id: string;
  workspaceId: string;
  integrationId: string;
  provider: string;
  dedupeKey: string;
  status: WebhookStatus;
  attempts: number;
  normalized: NormalizedOrder | null;
}

/** desfecho de uma entrega de webhook (cada um tem seu contador diário) */
export const INTEGRATION_OUTCOMES = ["processed", "duplicate", "ignored", "failed", "auth_failed", "invalid"] as const;
export type IntegrationOutcome = (typeof INTEGRATION_OUTCOMES)[number];
/** autenticado e bem formado: conta como "último evento válido" e limpa o último erro */
export const VALID_OUTCOMES: ReadonlySet<IntegrationOutcome> = new Set(["processed", "duplicate", "ignored"]);

export interface Store {
  readonly kind: "memory" | "postgres";
  findSiteByPublicKey(publicKey: string): Promise<Site | null>;
  /** insere a sessão só se ainda não existir (primeiro toque da sessão manda) */
  ensureSession(session: SessionRecord): Promise<void>;
  /** ignora eventos já vistos (mesmo site + event_id) */
  insertEvents(events: EventRecord[]): Promise<{ inserted: number; duplicates: number }>;
  findIntegrationByWebhookToken(provider: string, tokenHash: string): Promise<Integration | null>;
  /** grava o webhook; se a dedupe_key já existir devolve o registro existente com duplicate=true */
  recordWebhookEvent(input: {
    workspaceId: string;
    integrationId: string;
    provider: string;
    dedupeKey: string;
    payload: unknown;
    normalized: NormalizedOrder | null;
  }): Promise<{ event: WebhookEventRecord; duplicate: boolean }>;
  updateWebhookEvent(id: string, patch: { status: WebhookStatus; error?: string | null; nextRetryAt?: string | null; incrementAttempts?: boolean }): Promise<void>;
  listRetryableWebhookEvents(now: string, limit: number): Promise<WebhookEventRecord[]>;
  getOrder(workspaceId: string, provider: string, externalId: string): Promise<Order | null>;
  saveOrder(workspaceId: string, order: Order): Promise<void>;
  sessionsForVisitor(workspaceId: string, visitorId: string): Promise<TouchSession[]>;
  /**
   * Saúde da integração, numa escrita por webhook: soma no contador do dia (horário de Brasília),
   * marca a última requisição recebida e, conforme o desfecho, o último evento válido ou o último erro.
   */
  recordIntegrationActivity(
    integration: { id: string; workspaceId: string },
    outcome: IntegrationOutcome,
    opts?: { error?: string; now?: Date },
  ): Promise<void>;
  /** estado visível na tela de integrações: último evento válido ou último erro */
  markIntegrationHealth(id: string, health: { ok: true } | { ok: false; error: string }): Promise<void>;
  /** últimos eventos (diagnóstico de instalação do script) */
  recentEvents(workspaceId: string, limit: number): Promise<EventRecord[]>;
  /**
   * Gasto de anúncios FICTÍCIO do laboratório. Só grava se o workspace for sandbox (conferido no próprio SQL):
   * em workspace de produção não grava nada e devolve 0. Gasto real vem só da sincronização com a plataforma.
   */
  saveSandboxAdInsights(workspaceId: string, rows: AdInsightDaily[]): Promise<number>;
}
