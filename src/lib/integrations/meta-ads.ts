import { z } from "zod";
import type { AdInsightDaily } from "@/lib/domain/types";

/**
 * Meta Marketing API — leitura de Insights (permissão `ads_read`).
 * Nada aqui é chamado sem um token autorizado pelo dono da conta.
 * Docs: https://developers.facebook.com/docs/marketing-api/insights
 *
 * Limites: a API aplica rate limit por conta de anúncio (Business Use Case).
 * Respeitamos o header `x-business-use-case-usage` e paramos ao passar de 75%.
 */
export const META_API_VERSION = process.env.META_API_VERSION ?? "v23.0";

export const INSIGHT_FIELDS = [
  "date_start",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "clicks",
  "actions",
] as const;

export function buildInsightsUrl(opts: {
  adAccountId: string;
  since: string;
  until: string;
  after?: string;
  version?: string;
}): string {
  const account = opts.adAccountId.startsWith("act_") ? opts.adAccountId : `act_${opts.adAccountId}`;
  if (!/^act_\d+$/.test(account)) throw new Error("adAccountId inválido");
  const url = new URL(`https://graph.facebook.com/${opts.version ?? META_API_VERSION}/${account}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_increment", "1");
  url.searchParams.set("fields", INSIGHT_FIELDS.join(","));
  url.searchParams.set("time_range", JSON.stringify({ since: opts.since, until: opts.until }));
  url.searchParams.set("limit", "500");
  if (opts.after) url.searchParams.set("after", opts.after);
  return url.toString();
}

const actionSchema = z.object({ action_type: z.string(), value: z.string() });

export const insightRowSchema = z.object({
  date_start: z.string(),
  campaign_id: z.string(),
  campaign_name: z.string().optional().default(""),
  adset_id: z.string().optional(),
  adset_name: z.string().optional(),
  ad_id: z.string().optional(),
  ad_name: z.string().optional(),
  spend: z.string().optional().default("0"),
  impressions: z.string().optional().default("0"),
  clicks: z.string().optional().default("0"),
  actions: z.array(actionSchema).optional(),
});

const pageSchema = z.object({
  data: z.array(z.unknown()),
  paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional(),
});

const PURCHASE_TYPES = new Set(["purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"]);

/** `spend` vem em unidade da moeda da conta como string ("123.45") → centavos. */
export function spendToCents(spend: string): number {
  const n = Number(spend);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function normalizeInsightRow(raw: unknown, accountId: string): AdInsightDaily | null {
  const r = insightRowSchema.safeParse(raw);
  if (!r.success) return null;
  const row = r.data;
  // Se a conta reporta mais de um tipo de compra, usamos o maior (são visões sobrepostas do mesmo evento).
  const purchaseValues = (row.actions ?? []).filter((a) => PURCHASE_TYPES.has(a.action_type)).map((a) => Number(a.value));
  return {
    platform: "meta",
    accountId,
    date: row.date_start,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    adsetId: row.adset_id ?? null,
    adsetName: row.adset_name ?? null,
    adId: row.ad_id ?? null,
    adName: row.ad_name ?? null,
    spendCents: spendToCents(row.spend),
    impressions: Number.parseInt(row.impressions, 10) || 0,
    clicks: Number.parseInt(row.clicks, 10) || 0,
    platformPurchases: purchaseValues.length ? Math.max(...purchaseValues) : null,
  };
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** Uso máximo reportado no header de rate limit (0..100). */
export function maxUsagePercent(header: string | null): number {
  if (!header) return 0;
  try {
    const parsed = JSON.parse(header) as Record<string, Array<Record<string, number>>>;
    let max = 0;
    for (const entries of Object.values(parsed)) {
      for (const e of entries) {
        max = Math.max(max, e.call_count ?? 0, e.total_cputime ?? 0, e.total_time ?? 0);
      }
    }
    return max;
  } catch {
    return 0;
  }
}

/**
 * Busca todas as páginas de insights. `fetchImpl` é injetável para testes.
 * O token vai no header Authorization, nunca na URL (não aparece em log de proxy).
 */
export async function fetchMetaInsights(opts: {
  accessToken: string;
  adAccountId: string;
  since: string;
  until: string;
  fetchImpl?: typeof fetch;
  maxPages?: number;
}): Promise<AdInsightDaily[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const out: AdInsightDaily[] = [];
  let after: string | undefined;
  for (let page = 0; page < (opts.maxPages ?? 50); page++) {
    const res = await doFetch(buildInsightsUrl({ ...opts, after }), {
      headers: { Authorization: `Bearer ${opts.accessToken}` },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
      const code = body.error?.code;
      // 4/17/32/613 = limites de chamada; 1/2 = erro temporário
      const retryable = res.status >= 500 || [1, 2, 4, 17, 32, 613].includes(code ?? -1);
      throw new MetaApiError(body.error?.message ?? `HTTP ${res.status}`, res.status, code, retryable);
    }
    const json = pageSchema.parse(await res.json());
    for (const raw of json.data) {
      const row = normalizeInsightRow(raw, opts.adAccountId);
      if (row) out.push(row);
    }
    if (maxUsagePercent(res.headers.get("x-business-use-case-usage")) >= 75) {
      throw new MetaApiError("Limite de uso da conta perto do teto; retomar depois", 429, 17, true);
    }
    after = json.paging?.next ? json.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}
