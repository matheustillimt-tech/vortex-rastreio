import type { AttributionParams } from "@/lib/domain/types";

/** Parâmetros que o script captura da URL. Qualquer outro parâmetro é descartado (minimização). */
export const TRACKED_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "ttclid",
  "campaign_id",
  "adset_id",
  "ad_id",
] as const satisfies readonly (keyof AttributionParams)[];

/** Prefixo do visitor id quando ele viaja no `sck`/`src` do checkout. */
export const VISITOR_PREFIX = "rst_";

const MAX_LEN = 300;

function clean(value: string | null): string | undefined {
  if (value == null) return undefined;
  const v = value.trim().slice(0, MAX_LEN);
  // macros não substituídas ({{campaign.id}}, __CAMPAIGN_ID__) não são dado real
  if (!v || /^\{\{.*\}\}$/.test(v) || /^__[A-Z_]+__$/.test(v)) return undefined;
  return v;
}

export function parseAttributionParams(search: string | URLSearchParams): AttributionParams {
  const sp = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
  const out: AttributionParams = {};
  for (const key of TRACKED_KEYS) {
    const v = clean(sp.get(key));
    if (v) out[key] = v;
  }
  // aliases comuns de macros de anúncio
  out.campaign_id ??= clean(sp.get("utm_id"));
  if (out.campaign_id === undefined) delete out.campaign_id;
  return out;
}

/** Extrai o visitor id do valor de sck/src devolvido pelo checkout. */
export function visitorIdFromCheckoutParam(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const part of value.split(/[|,;]/)) {
    const p = part.trim();
    if (p.startsWith(VISITOR_PREFIX)) {
      const id = p.slice(VISITOR_PREFIX.length);
      if (/^[A-Za-z0-9_-]{8,64}$/.test(id)) return id;
    }
  }
  return null;
}

/** Remove query string e fragmento: no banco guardamos só o caminho (sem e-mail/token que vazam na URL). */
export function sanitizePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.slice(0, 500) || "/";
  } catch {
    return "/";
  }
}

export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.slice(0, 200) || null;
  } catch {
    return null;
  }
}
