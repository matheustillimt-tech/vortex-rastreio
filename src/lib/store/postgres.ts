import type { TouchSession } from "@/lib/domain/attribution";
import { statusRank } from "@/lib/domain/order-status";
import type { AdInsightDaily, AttributionParams, NormalizedOrder, Order } from "@/lib/domain/types";
import { asApp, iso, num, numOrNull, type Db } from "@/lib/db/client";
import { decryptSecret } from "@/lib/security/crypto";
import { VALID_OUTCOMES, type EventRecord, type Integration, type IntegrationOutcome, type SessionRecord, type Site, type Store, type WebhookEventRecord } from "./types";

const PARAM_COLS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "ttclid", "campaign_id", "adset_id", "ad_id",
] as const;

type Row = Record<string, unknown>;

/** desfecho → coluna do contador (lista fechada: nunca vem do usuário) */
const OUTCOME_COL: Record<IntegrationOutcome, string> = {
  processed: "processed",
  duplicate: "duplicates",
  ignored: "ignored",
  failed: "failed",
  auth_failed: "auth_failed",
  invalid: "invalid",
};

/**
 * Store de ingestão sobre Postgres (Supabase em produção, PGlite local).
 * Todas as operações rodam com os privilégios de `rastro_app`: só o schema rastro, só as tabelas
 * de ingestão. Idempotência garantida por UNIQUE no banco, não só pela aplicação.
 */
export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  constructor(private db: Db) {}

  async findSiteByPublicKey(publicKey: string): Promise<Site | null> {
    const rows = await asApp(this.db, (tx) =>
      tx.query<Row>("select id, workspace_id, public_key, allowed_origins from rastro.sites where public_key = $1 and status = 'active'", [publicKey]),
    );
    const r = rows[0];
    return r
      ? { id: String(r.id), workspaceId: String(r.workspace_id), publicKey: String(r.public_key), allowedOrigins: (r.allowed_origins as string[]) ?? [] }
      : null;
  }

  async ensureSession(s: SessionRecord): Promise<void> {
    const values = [s.id, s.workspaceId, s.siteId, s.visitorId, s.startedAt, s.landingPath, s.referrerHost, ...PARAM_COLS.map((c) => s.params[c] ?? null)];
    const cols = ["id", "workspace_id", "site_id", "visitor_id", "started_at", "landing_path", "referrer_host", ...PARAM_COLS];
    await asApp(this.db, (tx) =>
      tx.query(
        `insert into rastro.sessions (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (id) do nothing`,
        values,
      ),
    );
  }

  async insertEvents(events: EventRecord[]) {
    if (events.length === 0) return { inserted: 0, duplicates: 0 };
    return asApp(this.db, async (tx) => {
      let inserted = 0;
      for (const e of events) {
        const r = await tx.query(
          `insert into rastro.events (workspace_id, site_id, event_id, visitor_id, session_id, type, name, path, occurred_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (site_id, event_id) do nothing returning id`,
          [e.workspaceId, e.siteId, e.eventId, e.visitorId, e.sessionId, e.type, e.name, e.path, e.occurredAt],
        );
        inserted += r.length;
      }
      return { inserted, duplicates: events.length - inserted };
    });
  }

  async findIntegrationByWebhookToken(provider: string, tokenHash: string): Promise<Integration | null> {
    const rows = await asApp(this.db, (tx) =>
      tx.query<Row>(
        `select i.id, i.workspace_id, i.provider, i.signing_secret_encrypted,
                case when i.signing_secret_rotated_at > now() - interval '48 hours'
                     then i.signing_secret_previous_encrypted end as signing_secret_previous,
                coalesce((i.config ->> 'allow_unsigned')::boolean, false) as allow_unsigned,
                w.kind as workspace_kind
         from rastro.integrations i join rastro.workspaces w on w.id = i.workspace_id
         where i.provider = $1 and i.webhook_token_hash = $2 and i.status = 'active'`,
        [provider, tokenHash],
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      provider: r.provider as Integration["provider"],
      workspaceKind: r.workspace_kind === "sandbox" ? "sandbox" : "production",
      // atual + anterior (só durante as 48 h após a troca do token)
      signingSecrets: [r.signing_secret_encrypted, r.signing_secret_previous]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .map((v) => decryptSecret(v)),
      allowUnsigned: r.allow_unsigned === true,
    };
  }

  private toWebhook(r: Row): WebhookEventRecord {
    return {
      id: String(r.id),
      workspaceId: String(r.workspace_id),
      integrationId: String(r.integration_id),
      provider: String(r.provider),
      dedupeKey: String(r.dedupe_key),
      status: r.status as WebhookEventRecord["status"],
      attempts: num(r.attempts),
      normalized: (r.normalized as NormalizedOrder | null) ?? null,
    };
  }

  async recordWebhookEvent(input: Parameters<Store["recordWebhookEvent"]>[0]) {
    return asApp(this.db, async (tx) => {
      const inserted = await tx.query<Row>(
        `insert into rastro.webhook_events (workspace_id, integration_id, provider, dedupe_key, payload, normalized)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb) on conflict (dedupe_key) do nothing returning *`,
        [input.workspaceId, input.integrationId, input.provider, input.dedupeKey, JSON.stringify(input.payload), JSON.stringify(input.normalized)],
      );
      if (inserted[0]) return { event: this.toWebhook(inserted[0]), duplicate: false };
      const existing = await tx.query<Row>("select * from rastro.webhook_events where dedupe_key = $1", [input.dedupeKey]);
      return { event: this.toWebhook(existing[0]), duplicate: true };
    });
  }

  async updateWebhookEvent(id: string, patch: Parameters<Store["updateWebhookEvent"]>[1]) {
    await asApp(this.db, (tx) =>
      tx.query(
        `update rastro.webhook_events set
           status = $2,
           last_error = case when $3::boolean then $4 else last_error end,
           next_retry_at = case when $5::boolean then $6::timestamptz else next_retry_at end,
           attempts = attempts + case when $7::boolean then 1 else 0 end,
           processed_at = case when $2 = 'processed' then now() else processed_at end
         where id = $1`,
        [
          id,
          patch.status,
          patch.error !== undefined,
          patch.error ?? null,
          patch.nextRetryAt !== undefined,
          patch.nextRetryAt ?? null,
          patch.incrementAttempts ?? false,
        ],
      ),
    );
  }

  async listRetryableWebhookEvents(now: string, limit: number) {
    const rows = await asApp(this.db, (tx) =>
      tx.query<Row>(
        `select * from rastro.webhook_events where status = 'failed' and next_retry_at <= $1 order by next_retry_at limit $2`,
        [now, limit],
      ),
    );
    return rows.map((r) => this.toWebhook(r));
  }

  async getOrder(workspaceId: string, provider: string, externalId: string): Promise<Order | null> {
    const rows = await asApp(this.db, (tx) =>
      tx.query<Row>("select * from rastro.orders where workspace_id = $1 and provider = $2 and external_id = $3", [workspaceId, provider, externalId]),
    );
    return rows[0] ? rowToOrder(rows[0]) : null;
  }

  async saveOrder(workspaceId: string, o: Order) {
    await asApp(this.db, (tx) =>
      tx.query(
        `insert into rastro.orders (id, workspace_id, provider, external_id, status, status_rank, product_id, product_name,
           gross_cents, net_cents, fee_cents, currency, payment_method, customer_email_hash, tracking, attribution_method,
           platform, campaign_id, campaign_name, ad_id, order_created_at, approved_at, refunded_at, integration_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         on conflict (workspace_id, provider, external_id) do update set
           status = excluded.status, status_rank = excluded.status_rank, product_id = excluded.product_id,
           product_name = excluded.product_name, gross_cents = excluded.gross_cents, net_cents = excluded.net_cents,
           fee_cents = excluded.fee_cents, currency = excluded.currency, payment_method = excluded.payment_method,
           customer_email_hash = excluded.customer_email_hash, tracking = excluded.tracking,
           attribution_method = excluded.attribution_method, platform = excluded.platform,
           campaign_id = excluded.campaign_id, campaign_name = excluded.campaign_name, ad_id = excluded.ad_id,
           approved_at = excluded.approved_at, refunded_at = excluded.refunded_at,
           integration_id = coalesce(rastro.orders.integration_id, excluded.integration_id)`,
        [
          o.id, workspaceId, o.provider, o.externalId, o.status, statusRank(o.status), o.productId, o.productName,
          o.grossCents, o.netCents, o.feeCents, o.currency, o.paymentMethod, o.customerEmailHash, JSON.stringify(o.tracking),
          o.attributionMethod, o.platform, o.campaignId, o.campaignName, o.adId, o.createdAt, o.approvedAt, o.refundedAt,
          o.integrationId ?? null,
        ],
      ),
    );
  }

  async sessionsForVisitor(workspaceId: string, visitorId: string): Promise<TouchSession[]> {
    const rows = await asApp(this.db, (tx) =>
      tx.query<Row>(
        `select id, visitor_id, started_at, ${PARAM_COLS.join(", ")} from rastro.sessions
         where workspace_id = $1 and visitor_id = $2 order by started_at desc limit 100`,
        [workspaceId, visitorId],
      ),
    );
    return rows.map((r) => {
      const params: AttributionParams = {};
      for (const c of PARAM_COLS) if (r[c] != null) params[c] = String(r[c]);
      return { sessionId: String(r.id), visitorId: String(r.visitor_id), startedAt: iso(r.started_at)!, params };
    });
  }

  async recordIntegrationActivity(
    integration: { id: string; workspaceId: string },
    outcome: IntegrationOutcome,
    opts: { error?: string; now?: Date } = {},
  ) {
    const now = (opts.now ?? new Date()).toISOString();
    const valid = VALID_OUTCOMES.has(outcome);
    // um comando só: soma no contador do dia (Brasília) e atualiza o estado da integração
    await asApp(this.db, (tx) =>
      tx.query(
        `with s as (
           insert into rastro.integration_daily_stats (integration_id, workspace_id, day, received, ${OUTCOME_COL[outcome]}, updated_at)
           values ($1, $2, ($3::timestamptz at time zone 'America/Sao_Paulo')::date, 1, 1, $3::timestamptz)
           on conflict (integration_id, day) do update set
             received = rastro.integration_daily_stats.received + 1,
             ${OUTCOME_COL[outcome]} = rastro.integration_daily_stats.${OUTCOME_COL[outcome]} + 1,
             updated_at = excluded.updated_at
         )
         update rastro.integrations set
           last_received_at = $3::timestamptz,
           last_event_at = case when $4::boolean then $3::timestamptz else last_event_at end,
           last_error = case when $4::boolean then null when $5::text is not null then $5 else last_error end
         where id = $1`,
        [integration.id, integration.workspaceId, now, valid, opts.error ? opts.error.slice(0, 300) : null],
      ),
    );
  }

  async markIntegrationHealth(id: string, h: { ok: true } | { ok: false; error: string }) {
    await asApp(this.db, (tx) =>
      h.ok
        ? tx.query("update rastro.integrations set last_event_at = now(), last_error = null where id = $1", [id])
        : tx.query("update rastro.integrations set last_error = $2 where id = $1", [id, h.error.slice(0, 300)]),
    );
  }

  async saveSandboxAdInsights(workspaceId: string, rows: AdInsightDaily[]): Promise<number> {
    if (rows.length === 0) return 0;
    return asApp(this.db, async (tx) => {
      let n = 0;
      for (const r of rows) {
        // a condição kind = 'sandbox' está no próprio INSERT: workspace de produção nunca recebe gasto simulado
        const out = await tx.query(
          `insert into rastro.ad_insights_daily (workspace_id, platform, account_id, date, campaign_id, campaign_name, adset_id, adset_name,
             ad_id, ad_name, spend_cents, impressions, clicks, platform_purchases, synced_at)
           select w.id, $2, $3, $4::date, $5, $6, $7, $8, coalesce($9, ''), $10, $11, $12, $13, $14, now()
           from rastro.workspaces w where w.id = $1 and w.kind = 'sandbox'
           on conflict (workspace_id, platform, account_id, date, campaign_id, ad_id) do update set
             campaign_name = excluded.campaign_name, adset_id = excluded.adset_id, adset_name = excluded.adset_name,
             ad_name = excluded.ad_name, spend_cents = excluded.spend_cents, impressions = excluded.impressions,
             clicks = excluded.clicks, platform_purchases = excluded.platform_purchases, synced_at = now()
           returning 1`,
          [workspaceId, r.platform, r.accountId, r.date, r.campaignId, r.campaignName, r.adsetId, r.adsetName, r.adId, r.adName, r.spendCents, r.impressions, r.clicks, r.platformPurchases],
        );
        n += out.length;
      }
      return n;
    });
  }

  async recentEvents(workspaceId: string, limit: number): Promise<EventRecord[]> {
    const rows = await asApp(this.db, (tx) =>
      tx.query<Row>(
        `select workspace_id, site_id, event_id, visitor_id, session_id, type, name, path, occurred_at
         from rastro.events where workspace_id = $1 order by occurred_at desc limit $2`,
        [workspaceId, limit],
      ),
    );
    return rows.map((r) => ({
      workspaceId: String(r.workspace_id),
      siteId: String(r.site_id),
      eventId: String(r.event_id),
      visitorId: String(r.visitor_id),
      sessionId: String(r.session_id),
      type: String(r.type),
      name: (r.name as string) ?? null,
      path: String(r.path),
      occurredAt: iso(r.occurred_at)!,
    }));
  }
}

export function rowToOrder(r: Row): Order {
  return {
    id: String(r.id),
    provider: r.provider as Order["provider"],
    externalId: String(r.external_id),
    status: r.status as Order["status"],
    productId: String(r.product_id),
    productName: String(r.product_name),
    grossCents: num(r.gross_cents),
    netCents: numOrNull(r.net_cents),
    feeCents: numOrNull(r.fee_cents),
    currency: String(r.currency),
    paymentMethod: (r.payment_method as string) ?? null,
    customerEmailHash: (r.customer_email_hash as string) ?? null,
    tracking: (typeof r.tracking === "string" ? JSON.parse(r.tracking) : r.tracking) ?? {},
    createdAt: iso(r.order_created_at)!,
    approvedAt: iso(r.approved_at),
    refundedAt: iso(r.refunded_at),
    attributionMethod: r.attribution_method as Order["attributionMethod"],
    platform: (r.platform as Order["platform"]) ?? null,
    campaignId: (r.campaign_id as string) ?? null,
    campaignName: (r.campaign_name as string) ?? null,
    adId: (r.ad_id as string) ?? null,
    integrationId: (r.integration_id as string) ?? null,
  };
}
