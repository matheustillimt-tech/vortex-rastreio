import { asApp, iso, type Db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/security/crypto";
import { logger } from "@/lib/security/logger";
import { fetchMetaInsights, MetaApiError } from "./meta-ads";

/**
 * Sincronização periódica da Meta Ads (gasto por campanha/conjunto/anúncio, por dia).
 *  - trava por integração (sync_started_at) impede duas sincronizações simultâneas; trava velha (>30 min) expira;
 *  - 1ª sincronização: últimos 30 dias; depois: últimos 3 dias (a Meta ainda ajusta números recentes);
 *  - upsert pela chave (workspace, plataforma, conta, dia, campanha, anúncio) → rodar de novo não duplica;
 *  - erro de limite/instabilidade da API fica registrado como retentável e a trava é liberada.
 */
export const LOCK_MINUTES = 30;

export interface MetaSyncResult {
  integrationId: string;
  outcome: "ok" | "skipped_locked" | "error";
  rows?: number;
  error?: string;
  retryable?: boolean;
}

interface MetaIntegrationRow {
  id: string;
  workspace_id: string;
  credentials_encrypted: string | null;
  ad_account_id: string | null;
  last_sync_at: unknown;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function listActiveMetaIntegrations(db: Db): Promise<MetaIntegrationRow[]> {
  return asApp(db, (tx) =>
    tx.query<MetaIntegrationRow>(
      `select id, workspace_id, credentials_encrypted, config ->> 'ad_account_id' as ad_account_id, last_sync_at
       from rastro.integrations where provider = 'meta' and status = 'active'`,
    ),
  );
}

export async function syncMetaIntegration(
  db: Db,
  integ: MetaIntegrationRow,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<MetaSyncResult> {
  const now = opts.now ?? new Date();
  // 1) trava: só um processo por integração
  const claimed = await asApp(db, (tx) =>
    tx.query(
      `update rastro.integrations set sync_started_at = now()
       where id = $1 and status = 'active'
         and (sync_started_at is null or sync_started_at < now() - ($2 || ' minutes')::interval)
       returning id`,
      [integ.id, String(LOCK_MINUTES)],
    ),
  );
  if (claimed.length === 0) return { integrationId: integ.id, outcome: "skipped_locked" };

  const release = (patch: { ok: true } | { ok: false; error: string }) =>
    asApp(db, (tx) =>
      patch.ok
        ? tx.query("update rastro.integrations set sync_started_at = null, last_sync_at = now(), last_error = null where id = $1", [integ.id])
        : tx.query("update rastro.integrations set sync_started_at = null, last_error = $2 where id = $1", [integ.id, patch.error.slice(0, 300)]),
    );

  try {
    if (!integ.credentials_encrypted || !integ.ad_account_id) throw new Error("integração sem conta de anúncios ou token");
    const lookback = iso(integ.last_sync_at) ? 3 : 30;
    const since = ymd(new Date(now.getTime() - (lookback - 1) * 86_400_000));
    const until = ymd(now);
    const rows = await fetchMetaInsights({
      accessToken: decryptSecret(integ.credentials_encrypted),
      adAccountId: integ.ad_account_id,
      since,
      until,
      fetchImpl: opts.fetchImpl,
    });

    await asApp(db, async (tx) => {
      for (const r of rows) {
        await tx.query(
          `insert into rastro.ad_insights_daily (workspace_id, platform, account_id, date, campaign_id, campaign_name, adset_id, adset_name,
             ad_id, ad_name, spend_cents, impressions, clicks, platform_purchases, synced_at)
           values ($1, 'meta', $2, $3::date, $4, $5, $6, $7, coalesce($8, ''), $9, $10, $11, $12, $13, now())
           on conflict (workspace_id, platform, account_id, date, campaign_id, ad_id) do update set
             campaign_name = excluded.campaign_name, adset_id = excluded.adset_id, adset_name = excluded.adset_name,
             ad_name = excluded.ad_name, spend_cents = excluded.spend_cents, impressions = excluded.impressions,
             clicks = excluded.clicks, platform_purchases = excluded.platform_purchases, synced_at = now()`,
          [integ.workspace_id, integ.ad_account_id, r.date, r.campaignId, r.campaignName, r.adsetId, r.adsetName, r.adId, r.adName, r.spendCents, r.impressions, r.clicks, r.platformPurchases],
        );
      }
    });
    await release({ ok: true });
    return { integrationId: integ.id, outcome: "ok", rows: rows.length };
  } catch (err) {
    const retryable = err instanceof MetaApiError ? err.retryable : false;
    const message = err instanceof Error ? err.message : "erro desconhecido";
    await release({ ok: false, error: `${retryable ? "Temporário (será tentado de novo): " : ""}${message}` });
    logger.warn("meta_sync_failed", { integrationId: integ.id, retryable, err: message });
    return { integrationId: integ.id, outcome: "error", error: message, retryable };
  }
}

/** Roda todas as integrações Meta ativas, uma por vez (respeita limites da API). */
export async function syncAllMeta(db: Db, opts: { fetchImpl?: typeof fetch; now?: Date } = {}) {
  const results: MetaSyncResult[] = [];
  for (const integ of await listActiveMetaIntegrations(db)) results.push(await syncMetaIntegration(db, integ, opts));
  return results;
}
