"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireMembership } from "@/lib/dashboard/load";
import { costSettingsSchema, moneyToCents, percentToBps } from "@/lib/settings/costs";
import { updateCosts } from "@/lib/workspace/repo";

export interface SaveCostsState {
  ok: boolean;
  message: string;
}

export async function saveCosts(_prev: SaveCostsState, form: FormData): Promise<SaveCostsState> {
  const { userId, membership } = await requireMembership();
  if (!membership) return { ok: false, message: "Sem acesso a um workspace." };

  const parsed = costSettingsSchema.safeParse({
    taxRateBps: percentToBps(String(form.get("tax") ?? "")),
    gatewayFeeBps: percentToBps(String(form.get("gateway") ?? "")),
    costPerSaleCents: moneyToCents(String(form.get("perSale") ?? "")),
    fixedMonthlyCents: moneyToCents(String(form.get("fixed") ?? "")),
  });
  if (!parsed.success) return { ok: false, message: "Confira os valores: percentuais entre 0 e 100 e valores em reais não negativos." };

  // RLS decide: só owner/admin conseguem alterar
  const saved = await updateCosts(await getDb(), userId, membership.workspaceId, parsed.data);
  if (!saved) return { ok: false, message: "Só administradores do workspace podem alterar custos." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Custos salvos. O lucro estimado já usa os novos valores." };
}
