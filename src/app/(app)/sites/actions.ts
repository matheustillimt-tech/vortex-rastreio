"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/dashboard/load";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/security/logger";
import { parseOrigins } from "@/lib/tracking/origins";
import { createSite, updateSite } from "@/lib/workspace/repo";

export interface SiteActionState {
  ok: boolean;
  message: string;
}

const nameSchema = z.string().trim().min(1, "Informe um nome").max(120, "Nome muito longo");

async function adminContext() {
  const ctx = await requireWorkspace();
  if (ctx.kind !== "ok") return { error: "Sem acesso a um workspace." } as const;
  if (ctx.membership.role === "viewer") return { error: "Só administradores podem alterar sites." } as const;
  return { ctx } as const;
}

function originsFrom(form: FormData) {
  const { origins, errors } = parseOrigins(String(form.get("origins") ?? ""));
  if (errors.length) return { error: `Domínio inválido: ${errors.map((e) => `${e.input || "lista"} (${e.reason})`).join("; ")}` } as const;
  return { origins } as const;
}

export async function createSiteAction(_prev: SiteActionState, form: FormData): Promise<SiteActionState> {
  const a = await adminContext();
  if ("error" in a) return { ok: false, message: a.error! };
  const name = nameSchema.safeParse(form.get("name"));
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  const o = originsFrom(form);
  if ("error" in o) return { ok: false, message: o.error! };
  try {
    const site = await createSite(await getDb(), a.ctx.userId, a.ctx.membership.workspaceId, name.data, o.origins);
    if (!site) return { ok: false, message: "O banco recusou a criação." };
    revalidatePath("/sites");
    return { ok: true, message: `Site "${site.name}" criado.` };
  } catch (err) {
    logger.error("create_site_failed", { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Não foi possível criar o site." };
  }
}

export async function updateSiteAction(_prev: SiteActionState, form: FormData): Promise<SiteActionState> {
  const a = await adminContext();
  if ("error" in a) return { ok: false, message: a.error! };
  const siteId = z.string().uuid().safeParse(form.get("siteId"));
  if (!siteId.success) return { ok: false, message: "Site inválido." };
  const name = nameSchema.safeParse(form.get("name"));
  if (!name.success) return { ok: false, message: name.error.issues[0].message };
  const o = originsFrom(form);
  if ("error" in o) return { ok: false, message: o.error! };
  const ok = await updateSite(await getDb(), a.ctx.userId, a.ctx.membership.workspaceId, siteId.data, { name: name.data, origins: o.origins });
  revalidatePath("/sites");
  return ok ? { ok: true, message: "Alterações salvas." } : { ok: false, message: "Site não encontrado neste workspace." };
}

export async function setSiteStatusAction(form: FormData): Promise<void> {
  const a = await adminContext();
  if ("error" in a) return;
  const siteId = z.string().uuid().safeParse(form.get("siteId"));
  const status = z.enum(["active", "disabled"]).safeParse(form.get("status"));
  if (!siteId.success || !status.success) return;
  await updateSite(await getDb(), a.ctx.userId, a.ctx.membership.workspaceId, siteId.data, { status: status.data });
  revalidatePath("/sites");
  revalidatePath("/rastreamento");
}
