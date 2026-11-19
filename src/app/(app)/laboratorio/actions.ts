"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { ensureLab, labAdsReady, labAllowed, labSchemaReady, resetLab } from "@/lib/lab/setup";
import { runScenarios, SCENARIOS, type ScenarioResult } from "@/lib/lab/scenarios";
import { logger } from "@/lib/security/logger";
import { getStore } from "@/lib/store";

export interface RunState {
  ok: boolean;
  message: string;
  results?: ScenarioResult[];
}

/** Toda ação confere de novo: usuário logado, liberado para o laboratório e banco com a 0005. */
async function guard(): Promise<{ error: string } | { error?: undefined; userId: string; db: Awaited<ReturnType<typeof getDb>> }> {
  const userId = await getCurrentUserId();
  if (!userId || !labAllowed(userId)) return { error: "Acesso negado ao laboratório." };
  const db = await getDb();
  if (!(await labSchemaReady(db))) return { error: "O laboratório precisa da migration 0005, ainda não aplicada neste banco." };
  return { userId, db };
}

export async function runLabAction(_prev: RunState, form: FormData): Promise<RunState> {
  const g = await guard();
  if (g.error !== undefined) return { ok: false, message: g.error };
  const which = String(form.get("scenario") ?? "all");
  const ids = which === "all" ? "all" : SCENARIOS.some((s) => s.id === which) ? [which] : null;
  if (!ids) return { ok: false, message: "Cenário desconhecido." };
  try {
    const lab = await ensureLab(g.db, g.userId);
    const results = await runScenarios(await getStore(), lab, ids, new Date(), { adsReady: await labAdsReady(g.db) });
    const passed = results.filter((r) => r.pass).length;
    revalidatePath("/laboratorio");
    return { ok: passed === results.length, message: `${passed} de ${results.length} cenário(s) aprovados.`, results };
  } catch (err) {
    logger.error("lab_run_failed", { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Falha ao rodar o laboratório." };
  }
}

export async function resetLabAction(_prev: RunState, form: FormData): Promise<RunState> {
  const g = await guard();
  if (g.error !== undefined) return { ok: false, message: g.error };
  if (form.get("confirm") !== "on") return { ok: false, message: "Marque a confirmação para zerar." };
  try {
    const lab = await ensureLab(g.db, g.userId);
    const n = await resetLab(g.db, g.userId, lab.workspaceId);
    revalidatePath("/laboratorio");
    return { ok: true, message: `Laboratório zerado: ${n} registro(s) de simulação apagados. Nenhum dado real foi tocado.` };
  } catch (err) {
    logger.error("lab_reset_failed", { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Falha ao zerar o laboratório." };
  }
}
