import { AD_PLATFORMS, type AdPlatform } from "@/lib/domain/types";

export const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
] as const;

export interface Filters {
  days: number;
  campaign: string | null;
  product: string | null;
  platform: AdPlatform | null;
}

type SP = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length <= 100 ? s : null;
}

export function parseFilters(sp: SP): Filters {
  const days = Number(one(sp.periodo));
  const platform = one(sp.plataforma);
  return {
    days: PERIODS.some((p) => Number(p.value) === days) ? days : 30,
    campaign: one(sp.campanha),
    product: one(sp.produto),
    platform: platform && (AD_PLATFORMS as readonly string[]).includes(platform) ? (platform as AdPlatform) : null,
  };
}

export function dateRange(days: number, today = new Date()) {
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Nível da tabela de campanhas na URL (?nivel=campanha|conjunto|anuncio). Padrão: campanha. */
export const LEVELS = [
  { value: "campanha", level: "campaign", label: "Campanhas" },
  { value: "conjunto", level: "adset", label: "Conjuntos" },
  { value: "anuncio", level: "ad", label: "Anúncios" },
] as const;

export function parseLevel(sp: SP): (typeof LEVELS)[number]["level"] {
  const v = one(sp.nivel);
  return LEVELS.find((l) => l.value === v)?.level ?? "campaign";
}
