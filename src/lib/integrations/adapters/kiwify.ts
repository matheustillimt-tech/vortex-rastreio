import { kiwifyDedupeKey, normalizeKiwify, stripKiwifyPii, verifyKiwifySignature } from "@/lib/integrations/kiwify";
import type { CheckoutAdapter } from "./types";

/**
 * Kiwify — embrulha o módulo já validado (src/lib/integrations/kiwify.ts) sem mudar comportamento.
 * Autenticação oficial: HMAC-SHA1 do corpo bruto com o token do webhook, em `?signature=`.
 */
export const kiwifyAdapter: CheckoutAdapter = {
  provider: "kiwify",
  label: "Kiwify",
  auth: {
    method: "HMAC-SHA1 do corpo bruto em ?signature= (token do webhook como chave)",
    documented: true,
    source: "docs.kiwify.com.br › Webhooks › Receber e validar webhooks",
  },
  trackingParam: "sck",
  checkoutHosts: ["pay.kiwify.com.br", "kiwify.app"],

  authenticate(req, integration) {
    // sem segredo configurado a integração não recebe eventos (exceto a do banco local de dev)
    if (integration.signingSecrets.length === 0) {
      return integration.allowUnsigned ? { ok: true } : { ok: false, error: "Evento recusado: configure o token de assinatura da Kiwify" };
    }
    return verifyKiwifySignature(req.rawBody, req.query.get("signature"), integration.signingSecrets)
      ? { ok: true }
      : { ok: false, error: "Evento recusado: assinatura inválida" };
  },

  parse(body, now) {
    const r = normalizeKiwify(body, now);
    if (r.ok) return { kind: "order", order: r.order, eventType: r.eventType, isTest: false };
    if (r.reason === "unsupported_event") return { kind: "ignored", eventType: r.detail ?? null };
    return { kind: "invalid", detail: r.detail };
  },

  // mesma chave de antes (compatível com os webhooks já gravados em produção)
  dedupeKey: (workspaceId, order, eventType) => kiwifyDedupeKey(workspaceId, order, eventType),
  stripPii: stripKiwifyPii,
};
