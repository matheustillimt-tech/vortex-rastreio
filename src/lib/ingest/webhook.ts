import { getAdapter, type CheckoutAdapter } from "@/lib/integrations/adapters";
import { logger } from "@/lib/security/logger";
import { sha256Hex } from "@/lib/security/crypto";
import type { Integration, IntegrationOutcome, Store } from "@/lib/store/types";
import { applyOrder, nextRetryAt, OrderIntegrationConflictError } from "./process-order";

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Fluxo de webhook de checkout, igual para toda plataforma, independente do Next (testável):
 * localiza a integração pelo token da URL → autentica pela regra OFICIAL da plataforma (adaptador) →
 * lê o payload → grava com deduplicação → aplica o pedido → conta o desfecho (saúde da integração).
 *
 * O token da URL só localiza a integração; quem decide se a entrega é autêntica é o adaptador.
 */
export async function handleWebhook(input: {
  store: Store;
  provider: string;
  urlToken: string;
  rawBody: string;
  query?: URLSearchParams;
  headers?: Headers;
  now?: Date;
}): Promise<WebhookResult> {
  const { store, rawBody } = input;
  const adapter = getAdapter(input.provider);
  // "reason" é interno (usado para cache na rota) e não é devolvido ao chamador
  if (!adapter) return { status: 404, body: { error: "unknown_provider", reason: "unknown_provider" } };

  const integration = await store.findIntegrationByWebhookToken(adapter.provider, sha256Hex(input.urlToken));
  // mesma resposta para token inexistente e autenticação recusada: não revela qual falhou
  if (!integration) return { status: 401, body: { error: "unauthorized", reason: "unknown_token" } };

  const track = (outcome: IntegrationOutcome, error?: string) =>
    store.recordIntegrationActivity(integration, outcome, { error, now: input.now });

  const auth = adapter.authenticate({ rawBody, query: input.query ?? new URLSearchParams(), headers: input.headers ?? new Headers() }, integration);
  if (!auth.ok) {
    logger.warn("webhook_auth_failed", { provider: adapter.provider, integrationId: integration.id });
    await track("auth_failed", auth.error);
    return { status: 401, body: { error: "unauthorized" } };
  }

  return processDelivery({ store, adapter, integration, rawBody, now: input.now });
}

/**
 * Simulação interna do LABORATÓRIO, sem passar pela rota pública: a autenticação é a sessão do dono
 * do laboratório (checada por quem chama) e a integração PRECISA ser de um workspace sandbox.
 * Usada para plataformas sem autenticação oficial confirmada (ex.: Kirvano), sem abrir a rota pública.
 */
export async function simulateSandboxDelivery(input: {
  store: Store;
  provider: string;
  integration: Integration;
  rawBody: string;
  now?: Date;
}): Promise<WebhookResult> {
  const adapter = getAdapter(input.provider);
  if (!adapter || input.integration.provider !== adapter.provider) throw new Error("plataforma inválida para simulação");
  if (input.integration.workspaceKind !== "sandbox") throw new Error("simulação interna só em workspace de laboratório");
  return processDelivery({ store: input.store, adapter, integration: input.integration, rawBody: input.rawBody, now: input.now });
}

/** Depois da autenticação: lê, deduplica, aplica e conta. Comum à rota pública e à simulação interna. */
async function processDelivery(input: {
  store: Store;
  adapter: CheckoutAdapter;
  integration: Integration;
  rawBody: string;
  now?: Date;
}): Promise<WebhookResult> {
  const { store, adapter, integration, rawBody } = input;
  const track = (outcome: IntegrationOutcome, error?: string) =>
    store.recordIntegrationActivity(integration, outcome, { error, now: input.now });

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    await track("invalid", "Evento recusado: corpo não é JSON");
    return { status: 400, body: { error: "invalid_json" } };
  }

  const parsed = adapter.parse(json, input.now);
  if (parsed.kind === "invalid") {
    logger.warn("webhook_invalid_payload", { provider: adapter.provider, integrationId: integration.id, detail: parsed.detail });
    await track("invalid", "Evento recusado: formato inesperado");
    return { status: 400, body: { error: "invalid_payload" } };
  }
  // evento que não muda venda (ex.: carrinho abandonado) → 200 para a plataforma não reenviar
  if (parsed.kind === "ignored") {
    await track("ignored");
    return { status: 200, body: { ignored: true } };
  }
  // evento de teste da plataforma nunca vira venda num workspace de produção
  if (parsed.isTest && integration.workspaceKind === "production") {
    await track("ignored");
    return { status: 200, body: { ignored: true, test: true } };
  }

  const order = { ...parsed.order, integrationId: integration.id };
  const { event, duplicate } = await store.recordWebhookEvent({
    workspaceId: integration.workspaceId,
    integrationId: integration.id,
    provider: adapter.provider,
    dedupeKey: adapter.dedupeKey(integration.workspaceId, order, parsed.eventType),
    payload: adapter.stripPii(json),
    normalized: order,
  });
  if (duplicate && event.status === "processed") {
    await track("duplicate");
    return { status: 200, body: { duplicate: true } };
  }

  try {
    const { order: saved } = await applyOrder(store, integration.workspaceId, order);
    await store.updateWebhookEvent(event.id, { status: "processed", error: null, nextRetryAt: null, incrementAttempts: true });
    await track("processed");
    return { status: 200, body: { ok: true, status: saved.status, attribution: saved.attributionMethod } };
  } catch (err) {
    const conflict = err instanceof OrderIntegrationConflictError;
    const message = err instanceof Error ? err.message : "erro desconhecido";
    await store.updateWebhookEvent(event.id, {
      status: "failed",
      error: message.slice(0, 500),
      nextRetryAt: conflict ? null : nextRetryAt(event.attempts + 1, input.now),
      incrementAttempts: true,
    });
    await track("failed", conflict ? "Evento recusado: o pedido pertence a outra integração" : "Falha ao processar evento (será reprocessado)");
    logger.error("webhook_apply_failed", { provider: adapter.provider, webhookEventId: event.id, err: message });
    // 500 faz a plataforma reenviar; como tudo é idempotente, reenvio é seguro
    return conflict ? { status: 409, body: { error: "conflict" } } : { status: 500, body: { error: "processing_failed" } };
  }
}
