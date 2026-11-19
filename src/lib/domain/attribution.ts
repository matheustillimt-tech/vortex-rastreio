import type { AdPlatform, AttributionMethod, AttributionParams } from "./types";

export const ATTRIBUTION_WINDOW_DAYS = 30;

export interface TouchSession {
  sessionId: string;
  visitorId: string;
  startedAt: string;
  params: AttributionParams;
}

export interface AttributionResult {
  method: AttributionMethod;
  sessionId: string | null;
  platform: AdPlatform | null;
  campaign: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
}

const UNATTRIBUTED: AttributionResult = {
  method: "unattributed",
  sessionId: null,
  platform: null,
  campaign: null,
  campaignId: null,
  adsetId: null,
  adId: null,
};

/** Descobre a plataforma pelo click id (mais confiável) ou pelo utm_source. */
export function detectPlatform(p: AttributionParams): AdPlatform | null {
  if (p.fbclid) return "meta";
  if (p.gclid) return "google";
  if (p.ttclid) return "tiktok";
  const src = (p.utm_source ?? "").toLowerCase();
  if (/(^|[^a-z])(fb|facebook|instagram|ig|meta)([^a-z]|$)/.test(src)) return "meta";
  if (/(google|adwords|youtube)/.test(src)) return "google";
  if (/tiktok/.test(src)) return "tiktok";
  return null;
}

export function isPaidTouch(p: AttributionParams): boolean {
  if (p.fbclid || p.gclid || p.ttclid || p.ad_id || p.campaign_id) return true;
  const medium = (p.utm_medium ?? "").toLowerCase();
  return /(cpc|ppc|paid|cpm|ads?$|social[-_]?paid)/.test(medium) || detectPlatform(p) != null;
}

function fromParams(method: AttributionMethod, sessionId: string | null, p: AttributionParams): AttributionResult {
  return {
    method,
    sessionId,
    platform: detectPlatform(p),
    campaign: p.utm_campaign ?? null,
    campaignId: p.campaign_id ?? null,
    adsetId: p.adset_id ?? null,
    adId: p.ad_id ?? null,
  };
}

/**
 * Último clique pago dentro da janela.
 * 1) visitor id devolvido pelo checkout (sck/src) → sessões desse visitante → observada "click_id"
 * 2) UTMs do próprio pedido → observada "utm"
 * 3) nada → "unattributed" (nunca rateamos sem marcar como estimado)
 */
export function attributeOrder(input: {
  orderCreatedAt: string;
  visitorId: string | null;
  sessions: TouchSession[];
  orderParams: AttributionParams;
  windowDays?: number;
}): AttributionResult {
  const windowMs = (input.windowDays ?? ATTRIBUTION_WINDOW_DAYS) * 86_400_000;
  const orderTime = Date.parse(input.orderCreatedAt);

  if (input.visitorId) {
    const candidates = input.sessions
      .filter((s) => s.visitorId === input.visitorId)
      .filter((s) => {
        const t = Date.parse(s.startedAt);
        return t <= orderTime && orderTime - t <= windowMs;
      })
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    const paid = candidates.find((s) => isPaidTouch(s.params));
    if (paid) return fromParams("click_id", paid.sessionId, paid.params);
  }

  const op = input.orderParams;
  if (op.utm_source || op.utm_campaign || op.campaign_id) return fromParams("utm", null, op);

  return UNATTRIBUTED;
}
