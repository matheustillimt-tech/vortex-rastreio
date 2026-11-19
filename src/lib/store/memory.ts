import { randomUUID } from "node:crypto";
import type { TouchSession } from "@/lib/domain/attribution";
import type { Order } from "@/lib/domain/types";
import { sha256Hex } from "@/lib/security/crypto";
import { VALID_OUTCOMES, type EventRecord, type Integration, type IntegrationOutcome, type SessionRecord, type Site, type Store, type WebhookEventRecord, type WebhookStatus } from "./types";

/**
 * Store em memória: usado em desenvolvimento (sem Supabase configurado) e nos testes.
 * Nunca é usado em produção — ver getStore().
 */
export const DEV_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_SITE_KEY = "pk_devlocal000000000000";
export const DEV_KIWIFY_WEBHOOK_TOKEN: string = "dev-kiwify-token-local"; // fictício, só banco local e testes

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  sites: Site[] = [];
  integrations: Array<Integration & { tokenHash: string }> = [];
  sessions = new Map<string, SessionRecord>();
  events = new Map<string, EventRecord>();
  webhooks = new Map<string, WebhookEventRecord & { nextRetryAt: string | null; error: string | null; payload: unknown }>();
  orders = new Map<string, Order>();

  static withDevFixtures(): MemoryStore {
    const s = new MemoryStore();
    s.sites.push({ id: "site-dev", workspaceId: DEV_WORKSPACE_ID, publicKey: DEV_SITE_KEY, allowedOrigins: [] });
    s.integrations.push({
      id: "int-kiwify-dev",
      workspaceId: DEV_WORKSPACE_ID,
      provider: "kiwify",
      workspaceKind: "production",
      signingSecrets: [],
      allowUnsigned: true,
      tokenHash: sha256Hex(DEV_KIWIFY_WEBHOOK_TOKEN),
    });
    return s;
  }

  async findSiteByPublicKey(publicKey: string) {
    return this.sites.find((s) => s.publicKey === publicKey && s.status !== "disabled") ?? null;
  }

  async ensureSession(session: SessionRecord) {
    if (!this.sessions.has(session.id)) this.sessions.set(session.id, session);
  }

  async insertEvents(events: EventRecord[]) {
    let inserted = 0;
    let duplicates = 0;
    for (const e of events) {
      const k = `${e.siteId}:${e.eventId}`;
      if (this.events.has(k)) duplicates++;
      else {
        this.events.set(k, e);
        inserted++;
      }
    }
    return { inserted, duplicates };
  }

  async findIntegrationByWebhookToken(provider: string, tokenHash: string) {
    const i = this.integrations.find((x) => x.provider === provider && x.tokenHash === tokenHash);
    if (!i) return null;
    const { tokenHash: _omit, ...rest } = i;
    void _omit;
    return rest;
  }

  async recordWebhookEvent(input: Parameters<Store["recordWebhookEvent"]>[0]) {
    const existing = [...this.webhooks.values()].find((w) => w.dedupeKey === input.dedupeKey);
    if (existing) return { event: existing, duplicate: true };
    const event = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      integrationId: input.integrationId,
      provider: input.provider,
      dedupeKey: input.dedupeKey,
      status: "received" as WebhookStatus,
      attempts: 0,
      normalized: input.normalized,
      nextRetryAt: null,
      error: null,
      payload: input.payload,
    };
    this.webhooks.set(event.id, event);
    return { event, duplicate: false };
  }

  async updateWebhookEvent(id: string, patch: Parameters<Store["updateWebhookEvent"]>[1]) {
    const w = this.webhooks.get(id);
    if (!w) return;
    w.status = patch.status;
    if (patch.error !== undefined) w.error = patch.error;
    if (patch.nextRetryAt !== undefined) w.nextRetryAt = patch.nextRetryAt;
    if (patch.incrementAttempts) w.attempts += 1;
  }

  async listRetryableWebhookEvents(now: string, limit: number) {
    return [...this.webhooks.values()]
      .filter((w) => w.status === "failed" && w.nextRetryAt != null && w.nextRetryAt <= now)
      .slice(0, limit);
  }

  async getOrder(workspaceId: string, provider: string, externalId: string) {
    return this.orders.get(`${workspaceId}:${provider}:${externalId}`) ?? null;
  }

  async saveOrder(workspaceId: string, order: Order) {
    this.orders.set(`${workspaceId}:${order.provider}:${order.externalId}`, order);
  }

  async sessionsForVisitor(workspaceId: string, visitorId: string): Promise<TouchSession[]> {
    return [...this.sessions.values()]
      .filter((s) => s.workspaceId === workspaceId && s.visitorId === visitorId)
      .map((s) => ({ sessionId: s.id, visitorId: s.visitorId, startedAt: s.startedAt, params: s.params }));
  }

  health = new Map<string, { ok: boolean; error?: string; at: string }>();
  /** contadores por `${integrationId}:${dia}` (dia em horário de Brasília) */
  activity = new Map<string, Record<IntegrationOutcome | "received", number>>();
  lastReceived = new Map<string, string>();
  async recordIntegrationActivity(integration: { id: string; workspaceId: string }, outcome: IntegrationOutcome, opts: { error?: string; now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const day = new Date(now.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    const k = `${integration.id}:${day}`;
    const c = this.activity.get(k) ?? { received: 0, processed: 0, duplicate: 0, ignored: 0, failed: 0, auth_failed: 0, invalid: 0 };
    c.received++;
    c[outcome]++;
    this.activity.set(k, c);
    this.lastReceived.set(integration.id, now.toISOString());
    if (VALID_OUTCOMES.has(outcome)) this.health.set(integration.id, { ok: true, at: now.toISOString() });
    else if (opts.error) this.health.set(integration.id, { ok: false, error: opts.error, at: now.toISOString() });
  }
  async markIntegrationHealth(id: string, h: { ok: true } | { ok: false; error: string }) {
    this.health.set(id, { ...h, at: new Date().toISOString() });
  }

  /** o banco em memória não tem laboratório (nenhum workspace sandbox): nada é gravado */
  async saveSandboxAdInsights(): Promise<number> {
    return 0;
  }

  async recentEvents(workspaceId: string, limit: number) {
    return [...this.events.values()]
      .filter((e) => e.workspaceId === workspaceId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, limit);
  }
}
