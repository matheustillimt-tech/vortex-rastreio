import { z } from "zod";
import type { NormalizedOrder, OrderStatus } from "@/lib/domain/types";
import { hashEmail, hmacHex, safeEqual, sha256Hex } from "@/lib/security/crypto";

/**
 * Webhook de vendas da Kiwify.
 *
 * Mecanismo OFICIAL (docs.kiwify.com.br › Webhooks › "Receber e validar webhooks", conferido em 12/11/2026):
 *  - `?signature=` na URL = HMAC-SHA1, hex minúsculo, do corpo BRUTO, com o token do webhook como chave;
 *  - comparação em tempo constante; 401 se não bater; só 2xx confirma entrega (reenvios de 1 a 10 min);
 *  - deduplicar por order_id + webhook_event_type (a assinatura não impede replay);
 *  - troca de token: aceitar antigo OU novo por ~1 dia (reenvios antigos chegam com o token velho).
 * Vetor oficial testado em tests/kiwify.test.ts.
 *
 * Autenticação em duas camadas: token aleatório na URL (/api/webhooks/kiwify/{token}) + assinatura.
 *
 * ⚠️ Campos de valores (Commissions) e TrackingParameters não estão nessa página da documentação:
 * validar com o "Testar Webhook" do painel da Kiwify antes de ligar vendas reais.
 */

const money = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
});

export const kiwifyPayloadSchema = z
  .object({
    order_id: z.string().min(1),
    order_status: z.string().optional(),
    webhook_event_type: z.string().optional(),
    payment_method: z.string().nullish(),
    created_at: z.string().nullish(),
    approved_date: z.string().nullish(),
    refunded_at: z.string().nullish(),
    updated_at: z.string().nullish(),
    Product: z.object({ product_id: z.string().nullish(), product_name: z.string().nullish() }).partial().nullish(),
    Customer: z.object({ email: z.string().nullish() }).partial().passthrough().nullish(),
    Commissions: z
      .object({
        charge_amount: money.nullish(),
        product_base_price: money.nullish(),
        kiwify_fee: money.nullish(),
        my_commission: money.nullish(),
        currency: z.string().nullish(),
      })
      .partial()
      .passthrough()
      .nullish(),
    TrackingParameters: z
      .object({
        src: z.string().nullish(),
        sck: z.string().nullish(),
        utm_source: z.string().nullish(),
        utm_medium: z.string().nullish(),
        utm_campaign: z.string().nullish(),
        utm_content: z.string().nullish(),
        utm_term: z.string().nullish(),
      })
      .partial()
      .nullish(),
  })
  .passthrough();

export type KiwifyPayload = z.infer<typeof kiwifyPayloadSchema>;

const STATUS_MAP: Record<string, OrderStatus> = {
  paid: "approved",
  approved: "approved",
  waiting_payment: "pending",
  pending: "pending",
  refused: "cancelled",
  canceled: "cancelled",
  cancelled: "cancelled",
  refunded: "refunded",
  chargedback: "chargeback",
  chargeback: "chargeback",
};

const EVENT_MAP: Record<string, OrderStatus> = {
  order_approved: "approved",
  compra_aprovada: "approved",
  billet_created: "pending",
  boleto_gerado: "pending",
  pix_created: "pending",
  pix_gerado: "pending",
  order_rejected: "cancelled",
  compra_recusada: "cancelled",
  order_refunded: "refunded",
  compra_reembolsada: "refunded",
  chargeback: "chargeback",
};

export function mapKiwifyStatus(p: Pick<KiwifyPayload, "order_status" | "webhook_event_type">): OrderStatus | null {
  const e = p.webhook_event_type?.toLowerCase();
  // eventos de assinatura/período grátis trazem o status do pedido MAIS RECENTE: não são mudança de venda
  if (e && (e.startsWith("subscription_") || e.includes("trial"))) return null;
  if (e && EVENT_MAP[e]) return EVENT_MAP[e];
  const s = p.order_status?.toLowerCase();
  if (s && STATUS_MAP[s]) return STATUS_MAP[s];
  return null;
}

/** Aceita qualquer um dos tokens informados (atual e, durante a troca, o anterior). */
export function verifyKiwifySignature(rawBody: string, signature: string | null, secrets: string | Array<string | null | undefined>): boolean {
  if (!signature || !/^[a-f0-9]{40}$/i.test(signature)) return false;
  const list = (Array.isArray(secrets) ? secrets : [secrets]).filter((x): x is string => Boolean(x));
  // calcula todos (sem curto-circuito) para não vazar por tempo qual token bateu
  let ok = false;
  for (const secret of list) ok = safeEqual(hmacHex("sha1", secret, rawBody), signature.toLowerCase()) || ok;
  return ok;
}

function iso(value: string | null | undefined): string | null {
  if (!value) return null;
  // Kiwify costuma mandar "YYYY-MM-DD HH:mm" (horário de Brasília)
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? `${value.replace(" ", "T")}-03:00` : value;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function opt(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t.slice(0, 300) : undefined;
}

export type KiwifyNormalizeResult =
  | { ok: true; order: NormalizedOrder; eventType: string | null }
  | { ok: false; reason: "invalid_payload" | "unsupported_event"; detail?: string };

export function normalizeKiwify(body: unknown, now = new Date()): KiwifyNormalizeResult {
  const parsed = kiwifyPayloadSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  const p = parsed.data;
  const status = mapKiwifyStatus(p);
  if (!status) return { ok: false, reason: "unsupported_event", detail: p.webhook_event_type ?? p.order_status };

  const c = p.Commissions ?? {};
  const gross = c.charge_amount ?? c.product_base_price ?? 0;
  const tp = p.TrackingParameters ?? {};
  const createdAt = iso(p.created_at) ?? now.toISOString();

  return {
    ok: true,
    eventType: p.webhook_event_type ?? null,
    order: {
      provider: "kiwify",
      externalId: p.order_id,
      status,
      productId: p.Product?.product_id ?? "desconhecido",
      productName: p.Product?.product_name ?? "Produto sem nome",
      grossCents: gross,
      netCents: c.my_commission ?? null,
      feeCents: c.kiwify_fee ?? null,
      currency: (c.currency ?? "BRL").toUpperCase(),
      paymentMethod: p.payment_method ?? null,
      customerEmailHash: hashEmail(p.Customer?.email),
      tracking: {
        src: opt(tp.src),
        sck: opt(tp.sck),
        utm_source: opt(tp.utm_source),
        utm_medium: opt(tp.utm_medium),
        utm_campaign: opt(tp.utm_campaign),
        utm_content: opt(tp.utm_content),
        utm_term: opt(tp.utm_term),
      },
      createdAt,
      approvedAt: status === "approved" ? iso(p.approved_date) ?? createdAt : null,
      refundedAt: status === "refunded" || status === "chargeback" ? iso(p.refunded_at) ?? iso(p.updated_at) ?? now.toISOString() : null,
    },
  };
}

/** Chave de idempotência: o mesmo pedido no mesmo status só é processado uma vez. */
/** Chave de idempotência oficial: order_id + webhook_event_type (status como reserva se o evento não vier). */
export function kiwifyDedupeKey(workspaceId: string, order: Pick<NormalizedOrder, "externalId" | "status">, eventType?: string | null): string {
  return sha256Hex(`${workspaceId}:kiwify:${order.externalId}:${eventType?.toLowerCase() || order.status}`);
}

/** Remove PII do payload antes de guardar o bruto (auditoria/reprocessamento). */
export function stripKiwifyPii(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const copy = { ...(body as Record<string, unknown>) };
  delete copy.Customer;
  for (const k of ["card_last4digits", "boleto_URL", "boleto_barcode", "pix_code", "access_url"]) delete copy[k];
  return copy;
}
