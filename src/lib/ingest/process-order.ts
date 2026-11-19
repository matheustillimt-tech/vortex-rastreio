import { randomUUID } from "node:crypto";
import { attributeOrder } from "@/lib/domain/attribution";
import { shouldApplyStatus } from "@/lib/domain/order-status";
import type { NormalizedOrder, Order } from "@/lib/domain/types";
import { visitorIdFromCheckoutParam } from "@/lib/tracking/params";
import type { Store } from "@/lib/store/types";

/**
 * Aplica um pedido normalizado ao banco. Idempotente:
 * - mesmo pedido repetido → mesmo resultado;
 * - status só avança (ver order-status.ts);
 * - atribuição calculada na primeira vez e refeita só se ainda estiver sem origem.
 */
/**
 * Pedido que já pertence a OUTRA integração (outra conta da mesma plataforma no mesmo workspace).
 * Nunca mesclamos: o evento é recusado e não entra em reprocessamento automático.
 */
export class OrderIntegrationConflictError extends Error {
  constructor() {
    super("pedido já pertence a outra integração desta plataforma");
    this.name = "OrderIntegrationConflictError";
  }
}

export async function applyOrder(store: Store, workspaceId: string, incoming: NormalizedOrder): Promise<{ order: Order; statusChanged: boolean }> {
  const existing = await store.getOrder(workspaceId, incoming.provider, incoming.externalId);
  if (existing?.integrationId && incoming.integrationId && existing.integrationId !== incoming.integrationId) {
    throw new OrderIntegrationConflictError();
  }

  let attribution = existing
    ? {
        method: existing.attributionMethod,
        platform: existing.platform,
        campaignId: existing.campaignId,
        campaignName: existing.campaignName,
        adId: existing.adId,
      }
    : null;

  if (!attribution || attribution.method === "unattributed") {
    const visitorId = visitorIdFromCheckoutParam(incoming.tracking.sck) ?? visitorIdFromCheckoutParam(incoming.tracking.src);
    const sessions = visitorId ? await store.sessionsForVisitor(workspaceId, visitorId) : [];
    const r = attributeOrder({ orderCreatedAt: incoming.createdAt, visitorId, sessions, orderParams: incoming.tracking });
    attribution = { method: r.method, platform: r.platform, campaignId: r.campaignId, campaignName: r.campaign, adId: r.adId };
  }

  const applyStatus = shouldApplyStatus(existing?.status ?? null, incoming.status);
  const base: NormalizedOrder = existing && !applyStatus ? existing : { ...existing, ...incoming };

  const order: Order = {
    ...base,
    // datas: nunca apagar uma data já conhecida
    approvedAt: incoming.approvedAt ?? existing?.approvedAt ?? null,
    refundedAt: applyStatus ? incoming.refundedAt ?? existing?.refundedAt ?? null : existing?.refundedAt ?? null,
    customerEmailHash: incoming.customerEmailHash ?? existing?.customerEmailHash ?? null,
    // parâmetros de rastreio: o que já sabíamos continua valendo se o evento novo vier sem
    tracking: { ...existing?.tracking, ...definedOnly(incoming.tracking) },
    id: existing?.id ?? randomUUID(),
    // a integração de origem é a primeira que entregou o pedido
    integrationId: existing?.integrationId ?? incoming.integrationId ?? null,
    attributionMethod: attribution.method,
    platform: attribution.platform,
    campaignId: attribution.campaignId,
    campaignName: attribution.campaignName,
    adId: attribution.adId,
  };

  await store.saveOrder(workspaceId, order);
  return { order, statusChanged: applyStatus && existing?.status !== incoming.status };
}

function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Partial<T>;
}

/** Backoff exponencial para reprocessamento: 1min, 2, 4, 8 … até 6h. Depois de 10 tentativas, desiste. */
export const MAX_WEBHOOK_ATTEMPTS = 10;
export function nextRetryAt(attempts: number, now = new Date()): string | null {
  if (attempts >= MAX_WEBHOOK_ATTEMPTS) return null;
  const minutes = Math.min(2 ** attempts, 360);
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Reprocessa webhooks que falharam (chamado por um cron). */
export async function retryFailedWebhooks(store: Store, now = new Date(), limit = 50) {
  const pending = await store.listRetryableWebhookEvents(now.toISOString(), limit);
  let ok = 0;
  let failed = 0;
  for (const ev of pending) {
    if (!ev.normalized) {
      await store.updateWebhookEvent(ev.id, { status: "ignored", nextRetryAt: null });
      continue;
    }
    try {
      await applyOrder(store, ev.workspaceId, ev.normalized);
      await store.updateWebhookEvent(ev.id, { status: "processed", error: null, nextRetryAt: null, incrementAttempts: true });
      ok++;
    } catch (err) {
      await store.updateWebhookEvent(ev.id, {
        status: "failed",
        error: err instanceof Error ? err.message.slice(0, 500) : "erro desconhecido",
        nextRetryAt: err instanceof OrderIntegrationConflictError ? null : nextRetryAt(ev.attempts + 1, now),
        incrementAttempts: true,
      });
      failed++;
    }
  }
  return { ok, failed, total: pending.length };
}
