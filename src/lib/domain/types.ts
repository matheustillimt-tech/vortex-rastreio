/** Valores monetários sempre em centavos (inteiro) para evitar erro de ponto flutuante. */
export type Cents = number;

export const ORDER_STATUSES = [
  "pending",
  "approved",
  "cancelled",
  "refunded",
  "chargeback",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const AD_PLATFORMS = ["meta", "google", "tiktok"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

/** Plataformas de checkout conhecidas (a lista do banco fica em integrations_provider_check, migration 0004). */
export const CHECKOUT_PROVIDERS = ["kiwify", "kirvano", "hotmart", "perfectpay", "payt", "pagtrust", "mercadopago", "manual"] as const;
export type CheckoutProvider = (typeof CHECKOUT_PROVIDERS)[number];

/**
 * observed  → ligação direta (click id/visitor id ou UTM vinda do próprio pedido)
 * estimated → modelada (fase futura; sempre exibida separada)
 */
export type AttributionMethod = "click_id" | "utm" | "estimated" | "unattributed";

export interface AttributionParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
  ttclid?: string;
  /** ids numéricos vindos de macros de URL ({{campaign.id}} etc.) */
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
}

/** Pedido normalizado, independente do checkout de origem. */
export interface NormalizedOrder {
  provider: CheckoutProvider;
  /** integração (conta) que entregou o pedido; um pedido nunca troca de integração */
  integrationId?: string | null;
  externalId: string;
  status: OrderStatus;
  productId: string;
  productName: string;
  grossCents: Cents;
  /** valor que chega ao vendedor após taxa da plataforma, quando o provedor informa */
  netCents: Cents | null;
  feeCents: Cents | null;
  currency: string;
  paymentMethod: string | null;
  customerEmailHash: string | null;
  tracking: AttributionParams & { src?: string; sck?: string };
  createdAt: string;
  approvedAt: string | null;
  refundedAt: string | null;
}

export interface Order extends NormalizedOrder {
  id: string;
  attributionMethod: AttributionMethod;
  platform: AdPlatform | null;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
}

/** Linha diária de desempenho de anúncio (nível anúncio). */
export interface AdInsightDaily {
  platform: AdPlatform;
  accountId: string;
  date: string; // YYYY-MM-DD
  campaignId: string;
  campaignName: string;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  spendCents: Cents;
  impressions: number;
  clicks: number;
  /** compras reportadas pela plataforma (modelo dela, não o nosso) */
  platformPurchases: number | null;
}

export interface CostSettings {
  /** imposto sobre faturamento, em pontos-base (1% = 100) */
  taxRateBps: number;
  /** taxa extra de gateway quando o provedor não informa o líquido */
  gatewayFeeBps: number;
  /** custo variável por venda aprovada (produto, entrega, bônus) */
  costPerSaleCents: Cents;
  /** custos fixos mensais (ferramentas, equipe); rateados pelo período */
  fixedMonthlyCents: Cents;
}

export const DEFAULT_COSTS: CostSettings = {
  taxRateBps: 600,
  gatewayFeeBps: 0,
  costPerSaleCents: 0,
  fixedMonthlyCents: 0,
};
