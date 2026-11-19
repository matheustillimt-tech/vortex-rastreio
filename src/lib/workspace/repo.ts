import { asUser, iso, num, numOrNull, type Db } from "@/lib/db/client";
import { DEFAULT_COSTS, type AdInsightDaily, type AdPlatform, type CostSettings, type Order } from "@/lib/domain/types";
import { randomBytes } from "node:crypto";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { rowToOrder } from "@/lib/store/postgres";

/**
 * Leituras e configurações em nome do usuário. Tudo passa por asUser → role rastro_user + RLS:
 * mesmo que um id de workspace errado chegue aqui, o banco não devolve dados de outro workspace.
 */

type Row = Record<string, unknown>;

export interface Membership {
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "viewer";
}

/** Sempre o workspace de PRODUÇÃO do usuário: o laboratório nunca aparece no painel real. */
export async function getMembership(db: Db, userId: string): Promise<Membership | null> {
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Row>(
      `select w.id, w.name, m.role from rastro.workspace_members m
       join rastro.workspaces w on w.id = m.workspace_id
       where m.user_id = rastro.current_user_id() and w.kind = 'production'
       order by m.created_at limit 1`,
    ),
  );
  const r = rows[0];
  return r ? { workspaceId: String(r.id), workspaceName: String(r.name), role: r.role as Membership["role"] } : null;
}

export interface WorkspaceData {
  hasAnyData: boolean;
  orders: Order[];
  insights: AdInsightDaily[];
  costs: CostSettings;
  campaigns: Array<{ platform: AdPlatform; id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
}

function rowToInsight(r: Row): AdInsightDaily {
  return {
    platform: r.platform as AdPlatform,
    accountId: String(r.account_id),
    date: String(r.date).slice(0, 10),
    campaignId: String(r.campaign_id),
    campaignName: String(r.campaign_name),
    adsetId: (r.adset_id as string) ?? null,
    adsetName: (r.adset_name as string) ?? null,
    adId: r.ad_id ? String(r.ad_id) : null,
    adName: (r.ad_name as string) ?? null,
    spendCents: num(r.spend_cents),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    platformPurchases: numOrNull(r.platform_purchases),
  };
}

export function rowToCosts(r: Row | undefined): CostSettings {
  if (!r) return DEFAULT_COSTS;
  return {
    taxRateBps: num(r.tax_rate_bps),
    gatewayFeeBps: num(r.gateway_fee_bps),
    costPerSaleCents: num(r.cost_per_sale_cents),
    fixedMonthlyCents: num(r.fixed_monthly_cents),
  };
}

/** Dados do período [from, to] (datas YYYY-MM-DD, inclusivas). */
export async function loadWorkspaceData(db: Db, userId: string, workspaceId: string, from: string, to: string): Promise<WorkspaceData> {
  return asUser(db, userId, async (tx) => {
    const flags = await tx.query<Row>(
      `select exists(select 1 from rastro.orders where workspace_id = $1) as o,
              exists(select 1 from rastro.ad_insights_daily where workspace_id = $1) as i`,
      [workspaceId],
    );
    const orders = await tx.query<Row>(
      `select * from rastro.orders where workspace_id = $1
         and order_created_at >= $2::date and order_created_at < ($3::date + 1)
       order by order_created_at desc`,
      [workspaceId, from, to],
    );
    const insights = await tx.query<Row>(
      `select platform, account_id, to_char(date, 'YYYY-MM-DD') as date, campaign_id, campaign_name, adset_id, adset_name,
              ad_id, ad_name, spend_cents, impressions, clicks, platform_purchases
       from rastro.ad_insights_daily where workspace_id = $1 and date between $2::date and $3::date`,
      [workspaceId, from, to],
    );
    const costs = await tx.query<Row>("select * from rastro.cost_settings where workspace_id = $1", [workspaceId]);
    const campaigns = await tx.query<Row>(
      `select platform, campaign_id as id, max(campaign_name) as name from (
         select platform, campaign_id, campaign_name from rastro.ad_insights_daily where workspace_id = $1
         union all
         select platform, campaign_id, campaign_name from rastro.orders
           where workspace_id = $1 and campaign_id is not null and platform is not null
       ) c group by platform, campaign_id order by 3`,
      [workspaceId],
    );
    const products = await tx.query<Row>(
      "select product_id as id, max(product_name) as name from rastro.orders where workspace_id = $1 group by product_id order by 2",
      [workspaceId],
    );
    return {
      hasAnyData: Boolean(flags[0]?.o) || Boolean(flags[0]?.i),
      orders: orders.map(rowToOrder),
      insights: insights.map(rowToInsight),
      costs: rowToCosts(costs[0]),
      campaigns: campaigns.map((c) => ({ platform: c.platform as AdPlatform, id: String(c.id), name: String(c.name ?? c.id) })),
      products: products.map((p) => ({ id: String(p.id), name: String(p.name) })),
    };
  });
}

export async function getCostsForUser(db: Db, userId: string, workspaceId: string): Promise<CostSettings> {
  const rows = await asUser(db, userId, (tx) => tx.query<Row>("select * from rastro.cost_settings where workspace_id = $1", [workspaceId]));
  return rowToCosts(rows[0]);
}

/** Atualiza custos. RLS só deixa owner/admin; devolve false se nada foi alterado. */
export async function updateCosts(db: Db, userId: string, workspaceId: string, c: CostSettings): Promise<boolean> {
  const rows = await asUser(db, userId, (tx) =>
    tx.query(
      `update rastro.cost_settings set tax_rate_bps = $2, gateway_fee_bps = $3, cost_per_sale_cents = $4,
         fixed_monthly_cents = $5, updated_at = now()
       where workspace_id = $1 returning workspace_id`,
      [workspaceId, c.taxRateBps, c.gatewayFeeBps, c.costPerSaleCents, c.fixedMonthlyCents],
    ),
  );
  return rows.length === 1;
}

export interface SiteView {
  id: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
  status: "active" | "disabled";
}

export async function listSites(db: Db, userId: string, workspaceId: string): Promise<SiteView[]> {
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Row>("select id, name, public_key, allowed_origins, status from rastro.sites where workspace_id = $1 order by created_at", [workspaceId]),
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    publicKey: String(r.public_key),
    allowedOrigins: (r.allowed_origins as string[]) ?? [],
    status: (r.status as SiteView["status"]) ?? "active",
  }));
}

/** Chave pública nova: pk_ + 32 hex aleatórios (exclusiva pelo UNIQUE do banco). */
export function newSiteKey(): string {
  return `pk_${randomBytes(16).toString("hex")}`;
}

/** RLS: só owner/admin do workspace conseguem criar. Devolve null se o banco recusar. */
export async function createSite(db: Db, userId: string, workspaceId: string, name: string, origins: string[]): Promise<SiteView | null> {
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Row>(
      "insert into rastro.sites (workspace_id, name, public_key, allowed_origins) values ($1, $2, $3, $4::text[]) returning id, name, public_key, allowed_origins, status",
      [workspaceId, name.slice(0, 120), newSiteKey(), origins],
    ),
  );
  const r = rows[0];
  return r ? { id: String(r.id), name: String(r.name), publicKey: String(r.public_key), allowedOrigins: r.allowed_origins as string[], status: "active" } : null;
}

export async function updateSite(db: Db, userId: string, workspaceId: string, siteId: string, patch: { name?: string; origins?: string[]; status?: "active" | "disabled" }): Promise<boolean> {
  const rows = await asUser(db, userId, (tx) =>
    tx.query(
      `update rastro.sites set
         name = coalesce($3, name),
         allowed_origins = coalesce($4::text[], allowed_origins),
         status = coalesce($5, status),
         updated_at = now()
       where workspace_id = $1 and id = $2 returning id`,
      [workspaceId, siteId, patch.name?.slice(0, 120) ?? null, patch.origins ?? null, patch.status ?? null],
    ),
  );
  return rows.length === 1;
}

export interface IntegrationView {
  id: string;
  provider: string;
  status: string;
  label: string | null;
  hasSigningSecret: boolean;
  signingSecretRotatedAt: string | null;
  lastEventAt: string | null;
  lastSyncAt: string | null;
  syncStartedAt: string | null;
  lastError: string | null;
  adAccountId: string | null;
  /** só a integração do banco local de desenvolvimento */
  allowUnsigned: boolean;
  createdAt: string;
}

export async function listIntegrations(db: Db, userId: string, workspaceId: string): Promise<IntegrationView[]> {
  // só colunas sem segredo: rastro_user nem tem grant de SELECT nas colunas cifradas
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Row>(
      `select id, provider, status, label, has_signing_secret, signing_secret_rotated_at, last_event_at, last_sync_at,
              sync_started_at, last_error, config ->> 'ad_account_id' as ad_account_id,
              coalesce((config ->> 'allow_unsigned')::boolean, false) as allow_unsigned, created_at
       from rastro.integrations where workspace_id = $1 order by created_at`,
      [workspaceId],
    ),
  );
  return rows.map((r) => ({
    id: String(r.id),
    provider: String(r.provider),
    status: String(r.status),
    label: (r.label as string) ?? null,
    hasSigningSecret: r.has_signing_secret === true,
    signingSecretRotatedAt: iso(r.signing_secret_rotated_at),
    lastEventAt: iso(r.last_event_at),
    lastSyncAt: iso(r.last_sync_at),
    syncStartedAt: iso(r.sync_started_at),
    lastError: (r.last_error as string) ?? null,
    adAccountId: (r.ad_account_id as string) ?? null,
    allowUnsigned: r.allow_unsigned === true,
    createdAt: iso(r.created_at)!,
  }));
}

/**
 * Grava o token de assinatura da Kiwify CIFRADO. Se já havia um, ele vira o "anterior" e continua
 * aceito por 48 h (a Kiwify reenvia falhas antigas com o token antigo). O texto puro nunca é lido de volta.
 */
export async function setKiwifySigningSecret(db: Db, userId: string, integrationId: string, encrypted: string): Promise<boolean> {
  // a função do banco checa admin e faz a rotação; o usuário nunca lê segredos
  const rows = await asUser(db, userId, (tx) =>
    tx.query<{ ok: boolean }>("select rastro.set_signing_secret($1, $2) as ok", [integrationId, encrypted]),
  );
  return rows[0]?.ok === true;
}

export async function setIntegrationStatus(db: Db, userId: string, workspaceId: string, integrationId: string, status: "active" | "paused"): Promise<boolean> {
  const rows = await asUser(db, userId, (tx) =>
    tx.query("update rastro.integrations set status = $3 where workspace_id = $1 and id = $2 returning id", [workspaceId, integrationId, status]),
  );
  return rows.length === 1;
}

/** Meta Ads: conta de anúncios + token cifrado (liberado só com RASTRO_ENABLE_META=1). */
export async function saveMetaIntegration(db: Db, userId: string, workspaceId: string, adAccountId: string, encryptedToken: string): Promise<string | null> {
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Row>(
      `insert into rastro.integrations (workspace_id, provider, label, credentials_encrypted, config)
       values ($1, 'meta', 'Meta Ads', $2, jsonb_build_object('ad_account_id', $3::text)) returning id`,
      [workspaceId, encryptedToken, adAccountId],
    ),
  );
  return rows[0] ? String(rows[0].id) : null;
}

/**
 * Cria uma integração Kiwify com token de URL novo. O token só existe na resposta
 * (para o usuário copiar); no banco fica apenas o SHA-256.
 */
export async function createKiwifyIntegration(db: Db, userId: string, workspaceId: string, label: string): Promise<{ id: string; token: string }> {
  const token = randomToken(24);
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Row>(
      "insert into rastro.integrations (workspace_id, provider, label, webhook_token_hash) values ($1, 'kiwify', $2, $3) returning id",
      [workspaceId, label.slice(0, 120), sha256Hex(token)],
    ),
  );
  return { id: String(rows[0].id), token };
}

export async function recentEventsForUser(db: Db, userId: string, workspaceId: string, limit = 15) {
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Row>(
      "select event_id, type, name, path, visitor_id, occurred_at from rastro.events where workspace_id = $1 order by occurred_at desc limit $2",
      [workspaceId, limit],
    ),
  );
  return rows.map((r) => ({
    eventId: String(r.event_id),
    type: String(r.type),
    name: (r.name as string) ?? null,
    path: String(r.path),
    visitorId: String(r.visitor_id),
    occurredAt: iso(r.occurred_at)!,
  }));
}
