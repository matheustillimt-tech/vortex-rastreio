import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { asApp, type Db } from "@/lib/db/client";
import { getMembership, loadWorkspaceData, type Membership } from "@/lib/workspace/repo";
import { dateRange, type Filters } from "./filters";
import { buildDashboard, getDemoDashboard, type DashboardData } from "./query";

/**
 * live  → dados reais do workspace (pode estar vazio: zeros e "—", nunca números inventados)
 * demo  → conjunto fictício, só quando o usuário pede (?demo=1); nunca misturado com o real
 */
export type DashboardResult =
  | { kind: "ok"; data: DashboardData; membership: Membership; empty: boolean }
  | { kind: "no-workspace" }
  | { kind: "schema-pending" };

const g = globalThis as unknown as { __rastroSchemaOk?: boolean };

/** O código atual exige a migration 0004 (workspaces.kind etc.). Banco sem ela → aviso, não erro 500. */
export async function schemaReady(db: Db): Promise<boolean> {
  if (g.__rastroSchemaOk) return true;
  try {
    await asApp(db, (tx) => tx.query("select kind from rastro.workspaces where false"));
    g.__rastroSchemaOk = true;
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "42703") return false;
    throw e;
  }
}

export type WorkspaceContext =
  | { kind: "ok"; userId: string; membership: Membership }
  | { kind: "no-workspace" }
  | { kind: "schema-pending" };

/** Usuário logado + workspace dele. Sem login → /login. */
export async function requireWorkspace(): Promise<WorkspaceContext> {
  const userId = await getCurrentUserId();
  if (!userId) redirect("/login");
  const db = await getDb();
  if (!(await schemaReady(db))) return { kind: "schema-pending" };
  const membership = await getMembership(db, userId);
  return membership ? { kind: "ok", userId, membership } : { kind: "no-workspace" };
}

/** Compatibilidade com ações já existentes. */
export async function requireMembership(): Promise<{ userId: string; membership: Membership | null }> {
  const ctx = await requireWorkspace();
  if (ctx.kind === "ok") return { userId: ctx.userId, membership: ctx.membership };
  const userId = (await getCurrentUserId())!;
  return { userId, membership: null };
}

export async function loadDashboard(filters: Filters, opts: { demo?: boolean } = {}): Promise<DashboardResult> {
  const ctx = await requireWorkspace();
  if (ctx.kind !== "ok") return ctx;
  const { from, to } = dateRange(filters.days);
  const live = await loadWorkspaceData(await getDb(), ctx.userId, ctx.membership.workspaceId, from, to);

  if (opts.demo) return { kind: "ok", membership: ctx.membership, empty: false, data: getDemoDashboard(filters, live.costs) };

  return {
    kind: "ok",
    membership: ctx.membership,
    empty: !live.hasAnyData,
    data: buildDashboard({
      source: "live",
      orders: live.orders,
      insights: live.insights,
      options: { campaigns: live.campaigns, products: live.products },
      costs: live.costs,
      filters,
    }),
  };
}
