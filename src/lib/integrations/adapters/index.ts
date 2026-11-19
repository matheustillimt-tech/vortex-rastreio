import type { CheckoutProvider } from "@/lib/domain/types";
import { kirvanoAdapter } from "./kirvano";
import { kiwifyAdapter } from "./kiwify";
import type { CheckoutAdapter, PlannedProvider } from "./types";

export type { CheckoutAdapter, ParseResult, PlannedProvider, WebhookRequest } from "./types";

/** Adaptadores com rota de webhook. Só estes provedores são aceitos em /api/webhooks/{provider}/{token}. */
const ADAPTERS: Record<string, CheckoutAdapter> = {
  kiwify: kiwifyAdapter,
  kirvano: kirvanoAdapter,
};

export function getAdapter(provider: string): CheckoutAdapter | null {
  return Object.hasOwn(ADAPTERS, provider) ? ADAPTERS[provider] : null;
}

export function listAdapters(): CheckoutAdapter[] {
  return Object.values(ADAPTERS);
}

/** Previstas, sem adaptador: a rota recusa entregas até existir um adaptador com autenticação confirmada. */
export const PLANNED_PROVIDERS: PlannedProvider[] = [
  { provider: "hotmart", label: "Hotmart", auth: { method: "cabeçalho X-HOTMART-HOTTOK", documented: false, source: "guias de terceiros; confirmar na doc oficial" } },
  { provider: "payt", label: "Payt", auth: { method: "integration_key no corpo; envia test: true", documented: false, source: "não confirmado; conferir na doc oficial" } },
  { provider: "pagtrust", label: "Pagtrust", auth: { method: "não encontrada", documented: false, source: "—" } },
  { provider: "perfectpay", label: "Perfect Pay", auth: { method: "não encontrada", documented: false, source: "—" } },
];

export function providerLabel(provider: string): string {
  return getAdapter(provider)?.label ?? PLANNED_PROVIDERS.find((p) => p.provider === provider)?.label ?? provider;
}

export function isCheckoutProvider(provider: string): provider is CheckoutProvider {
  return getAdapter(provider) !== null || PLANNED_PROVIDERS.some((p) => p.provider === provider);
}
