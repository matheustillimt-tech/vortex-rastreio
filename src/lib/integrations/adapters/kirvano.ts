import { z } from "zod";
import { brasiliaToIso, centsFromBrl } from "@/lib/domain/money";
import type { OrderStatus } from "@/lib/domain/types";
import { hashEmail, sha256Hex } from "@/lib/security/crypto";
import type { CheckoutAdapter } from "./types";

/**
 * Kirvano — leitura conforme a central de ajuda oficial (help.kirvano.com › Webhooks), conferida em 12/11/2026:
 *  - campo `event` (SALE_APPROVED, SALE_REFUSED, SALE_REFUNDED, SALE_CHARGEBACK, PIX_GENERATED, PIX_EXPIRED,
 *    BANK_SLIP_GENERATED, BANK_SLIP_EXPIRED, ABANDONED_CART, SUBSCRIPTION_RENEWED/CANCELED/EXPIRED);
 *  - `sale_id` identifica a venda; `total_price` é TEXTO em reais ("R$ 169,80"), sem taxa nem líquido;
 *  - `created_at` "YYYY-MM-DD HH:mm:ss" sem fuso (tratado como Brasília; confirmar numa entrega real);
 *  - `products[]` com `is_order_bump`; `utm` com `src` e `utm_*` (sem `sck`: o visitante viaja no `src`).
 *
 * ⚠️ AUTENTICAÇÃO: a Kirvano documenta um token OPCIONAL, mas não diz onde ele chega (cabeçalho? corpo?).
 * Sem mecanismo oficial confirmado, este adaptador RECUSA eventos reais. O token secreto da URL do Vórtex Rastreio
 * não é usado como substituto. Só a integração do banco local de desenvolvimento (allowUnsigned) aceita,
 * para testes com os exemplos oficiais. Destravar exige confirmar o mecanismo numa entrega real.
 */

const text = z.string().nullish();

export const kirvanoPayloadSchema = z
  .object({
    event: z.string().min(1),
    sale_id: z.string().min(1),
    checkout_id: text,
    type: text,
    status: text,
    payment_method: text,
    total_price: z.union([z.string(), z.number()]).nullish(),
    created_at: text,
    customer: z.object({ email: text }).partial().passthrough().nullish(),
    payment: z.object({ method: text, finished_at: text }).partial().passthrough().nullish(),
    products: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number()]).nullish(),
            name: text,
            offer_name: text,
            price: z.union([z.string(), z.number()]).nullish(),
            is_order_bump: z.boolean().nullish(),
          })
          .partial()
          .passthrough(),
      )
      .nullish(),
    utm: z
      .object({ src: text, utm_source: text, utm_medium: text, utm_campaign: text, utm_content: text, utm_term: text })
      .partial()
      .passthrough()
      .nullish(),
  })
  .passthrough();

const EVENT_STATUS: Record<string, OrderStatus> = {
  SALE_APPROVED: "approved",
  PIX_GENERATED: "pending",
  BANK_SLIP_GENERATED: "pending",
  SALE_REFUSED: "cancelled",
  PIX_EXPIRED: "cancelled",
  BANK_SLIP_EXPIRED: "cancelled",
  SALE_REFUNDED: "refunded",
  SALE_CHARGEBACK: "chargeback",
};

/** Evento → status. Carrinho abandonado e eventos de assinatura não mudam venda no MVP (null = ignorar). */
export function mapKirvanoEvent(event: string): OrderStatus | null {
  return EVENT_STATUS[event.trim().toUpperCase()] ?? null;
}

function opt(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t.slice(0, 300) : undefined;
}

export const kirvanoAdapter: CheckoutAdapter = {
  provider: "kirvano",
  label: "Kirvano",
  auth: {
    method: "token opcional; local de envio não documentado",
    documented: false,
    source: "help.kirvano.com › Webhooks (sem especificação do token)",
  },
  trackingParam: "src",
  checkoutHosts: ["pay.kirvano.com"],

  authenticate(_req, integration) {
    if (integration.allowUnsigned) return { ok: true };
    return { ok: false, error: "Evento recusado: autenticação oficial da Kirvano ainda não confirmada" };
  },

  parse(body, now = new Date()) {
    const parsed = kirvanoPayloadSchema.safeParse(body);
    if (!parsed.success) return { kind: "invalid", detail: parsed.error.issues[0]?.message };
    const p = parsed.data;
    const eventType = p.event.trim().toUpperCase();
    const status = mapKirvanoEvent(eventType);
    if (!status) return { kind: "ignored", eventType };

    const gross = typeof p.total_price === "number" ? null : centsFromBrl(p.total_price);
    // valor fora do formato documentado: não inventa número
    if (gross === null) return { kind: "invalid", detail: "total_price fora do formato \"R$ 0,00\"" };

    const products = p.products ?? [];
    const main = products.find((x) => !x.is_order_bump) ?? products[0];
    const createdAt = brasiliaToIso(p.created_at) ?? now.toISOString();
    const u = p.utm ?? {};

    return {
      kind: "order",
      eventType,
      isTest: false,
      order: {
        provider: "kirvano",
        externalId: p.sale_id,
        status,
        productId: main?.id != null ? String(main.id) : "desconhecido",
        productName: opt(main?.name) ?? "Produto sem nome",
        grossCents: gross,
        // a Kirvano não informa taxa nem líquido: o painel usa a taxa configurada em Custos
        netCents: null,
        feeCents: null,
        currency: "BRL",
        paymentMethod: p.payment?.method ?? p.payment_method ?? null,
        customerEmailHash: hashEmail(p.customer?.email),
        tracking: {
          src: opt(u.src),
          utm_source: opt(u.utm_source),
          utm_medium: opt(u.utm_medium),
          utm_campaign: opt(u.utm_campaign),
          utm_content: opt(u.utm_content),
          utm_term: opt(u.utm_term),
        },
        createdAt,
        approvedAt: status === "approved" ? brasiliaToIso(p.payment?.finished_at) ?? createdAt : null,
        // a documentação não traz data de reembolso: vale o momento do recebimento
        refundedAt: status === "refunded" || status === "chargeback" ? now.toISOString() : null,
      },
    };
  },

  // provider na chave: a mesma sale_id em outra plataforma nunca é tratada como duplicada
  dedupeKey: (workspaceId, order, eventType) =>
    sha256Hex(`${workspaceId}:kirvano:${order.externalId}:${eventType?.toUpperCase() || order.status}`),

  stripPii(body) {
    if (!body || typeof body !== "object") return body;
    const copy = { ...(body as Record<string, unknown>) };
    delete copy.customer;
    delete copy.checkout_url;
    if (copy.payment && typeof copy.payment === "object") {
      const pay = { ...(copy.payment as Record<string, unknown>) };
      for (const k of ["qrcode", "qrcode_image", "barcode", "digitable_line", "link", "url", "card_last_digits"]) delete pay[k];
      copy.payment = pay;
    }
    return copy;
  },
};
