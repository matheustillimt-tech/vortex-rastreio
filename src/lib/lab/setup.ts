import { asApp, asUser, DEV_USER_ID, type Db } from "@/lib/db/client";
import { env } from "@/lib/env";
import { encryptSecret, hmacHex, sha256Hex } from "@/lib/security/crypto";

/**
 * Laboratório de simulação: um workspace `sandbox` separado, do qual só o dono participa.
 *
 * Acesso (negado por padrão): o id do usuário precisa estar em RASTRO_LAB_ADMIN_IDS. Em produção, sem
 * essa variável, ninguém acessa. No banco local de desenvolvimento (PGlite, sem DATABASE_URL), o usuário
 * de dev pode usar. Além disso, o banco só abre laboratório para quem é DONO de um workspace de produção.
 */
function labAdminIds(): string[] {
  return (process.env.RASTRO_LAB_ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Há alguém que possa usar o laboratório neste ambiente? (evita consultar a sessão à toa em cada página) */
export function labEnabled(): boolean {
  return labAdminIds().length > 0 || (!env.isProduction && !env.databaseUrl);
}

export function labAllowed(userId: string | null): boolean {
  if (!userId) return false;
  const ids = labAdminIds();
  if (ids.includes(userId)) return true;
  return !env.isProduction && !env.databaseUrl && userId === DEV_USER_ID;
}

export interface LabKeys {
  siteKey: string;
  kiwifyToken: string;
  kiwifySecret: string;
  kirvanoToken: string;
}

/**
 * Chaves do laboratório derivadas da ENCRYPTION_KEY + usuário: o servidor recalcula quando precisa,
 * e o banco só recebe hash (tokens) e texto cifrado (segredo). Nada fica em texto puro.
 */
export function labKeys(userId: string): LabKeys {
  const master = process.env.ENCRYPTION_KEY;
  if (!master) throw new Error("ENCRYPTION_KEY ausente");
  const d = (purpose: string) => hmacHex("sha256", master, `rastro-lab:${purpose}:${userId}`);
  return {
    siteKey: `pk_lab${d("site").slice(0, 32)}`,
    kiwifyToken: `lab_kw_${d("kiwify-token").slice(0, 40)}`,
    kiwifySecret: d("kiwify-secret").slice(0, 40),
    kirvanoToken: `lab_kv_${d("kirvano-token").slice(0, 40)}`,
  };
}

export interface Lab extends LabKeys {
  workspaceId: string;
  siteId: string;
}

/** Abre (ou reaproveita) o laboratório do usuário. Idempotente. */
export async function ensureLab(db: Db, userId: string): Promise<Lab> {
  const k = labKeys(userId);
  const rows = await asUser(db, userId, (tx) =>
    tx.query<{ workspace_id: string; site_id: string }>("select workspace_id, site_id from rastro.lab_ensure($1, $2, $3, $4)", [
      k.siteKey,
      sha256Hex(k.kiwifyToken),
      encryptSecret(k.kiwifySecret),
      sha256Hex(k.kirvanoToken),
    ]),
  );
  return { ...k, workspaceId: String(rows[0].workspace_id), siteId: String(rows[0].site_id) };
}

/** Zera os dados do laboratório (o banco recusa se o workspace não for sandbox do próprio usuário). */
export async function resetLab(db: Db, userId: string, workspaceId: string): Promise<number> {
  const rows = await asUser(db, userId, (tx) => tx.query<{ n: number }>("select rastro.lab_reset($1) as n", [workspaceId]));
  return Number(rows[0]?.n ?? 0);
}

/** A 0005 foi aplicada neste banco? Sem ela, a tela mostra o aviso em vez de erro. */
export async function labSchemaReady(db: Db): Promise<boolean> {
  const rows = await db.sql.query<{ ok: boolean }>(
    "select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'rastro' and p.proname = 'lab_ensure') as ok",
  );
  return rows[0]?.ok === true;
}

/** A 0006 foi aplicada? (zerar e limpeza também apagam o gasto de anúncios simulado) */
export async function labAdsReady(db: Db): Promise<boolean> {
  const rows = await db.sql.query<{ ok: boolean }>(
    `select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'rastro' and p.proname = 'lab_reset' and p.prosrc like '%ad_insights_daily%') as ok`,
  );
  return rows[0]?.ok === true;
}

/** Números atuais do laboratório (lidos como o usuário, via RLS). */
export async function labCounts(db: Db, userId: string, workspaceId: string) {
  const rows = await asUser(db, userId, (tx) =>
    tx.query<Record<string, number>>(
      `select (select count(*)::int from rastro.sessions where workspace_id = $1) as sessions,
              (select count(*)::int from rastro.events where workspace_id = $1) as events,
              (select count(*)::int from rastro.orders where workspace_id = $1) as orders,
              (select count(*)::int from rastro.webhook_events where workspace_id = $1) as webhooks,
              (select count(*)::int from rastro.ad_insights_daily where workspace_id = $1) as insights`,
      [workspaceId],
    ),
  );
  return rows[0];
}

/**
 * Limpeza automática: apaga dados de laboratório com mais de 7 dias. Roda junto do cron de
 * reprocessamento (sem cron novo). A função do banco só toca workspaces sandbox.
 * Banco sem a 0005 → não faz nada.
 */
export async function purgeExpiredLabs(db: Db): Promise<number | null> {
  try {
    const rows = await asApp(db, (tx) => tx.query<{ n: number }>("select rastro.lab_purge_expired(7) as n"));
    return Number(rows[0]?.n ?? 0);
  } catch (e) {
    if ((e as { code?: string }).code === "42883") return null; // função inexistente: 0005 não aplicada
    throw e;
  }
}
