"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/dashboard/load";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptSecret } from "@/lib/security/crypto";
import { logger } from "@/lib/security/logger";
import { createKiwifyIntegration, saveMetaIntegration, setIntegrationStatus, setKiwifySigningSecret } from "@/lib/workspace/repo";
import { BRAND_NAME } from "@/lib/brand";

export interface CreateWebhookState {
  ok: boolean;
  message: string;
  /** mostrada uma única vez; no banco fica só o hash do token */
  url?: string;
}

export interface SimpleState {
  ok: boolean;
  message: string;
}


/**
 * Desenvolvimento e produção usam o MESMO banco, mas chaves de cifra (ENCRYPTION_KEY) diferentes.
 * Um token salvo a partir do ambiente local ficaria ilegível em produção → só a produção grava tokens no banco real.
 */
function secretsWriteBlocked(): string | null {
  if (!env.isProduction && env.databaseUrl) {
    return `Tokens de integração no banco real só podem ser salvos pelo ${BRAND_NAME} publicado (produção). Localmente, use RASTRO_LOCAL=1.`;
  }
  return null;
}

async function admin() {
  const ctx = await requireWorkspace();
  if (ctx.kind !== "ok") return null;
  if (ctx.membership.role === "viewer") return null;
  return ctx;
}

export async function createKiwifyWebhook(_prev: CreateWebhookState, form: FormData): Promise<CreateWebhookState> {
  const ctx = await admin();
  if (!ctx) return { ok: false, message: "Só administradores podem criar integrações." };
  const label = String(form.get("label") ?? "").trim().slice(0, 120) || "Kiwify";
  try {
    const { token } = await createKiwifyIntegration(await getDb(), ctx.userId, ctx.membership.workspaceId, label);
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
    revalidatePath("/integracoes");
    return {
      ok: true,
      message: "Copie a URL agora: ela não será mostrada de novo. A integração só recebe eventos depois que o token de assinatura for configurado.",
      url: `${origin}/api/webhooks/kiwify/${token}`,
    };
  } catch (err) {
    logger.error("create_kiwify_integration_failed", { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, message: "Não foi possível criar a integração." };
  }
}

/** Token da Kiwify (Apps › Webhooks › token): cifrado aqui, nunca devolvido à tela. */
export async function saveKiwifySecret(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  const blocked = secretsWriteBlocked();
  if (blocked) return { ok: false, message: blocked };
  const ctx = await admin();
  if (!ctx) return { ok: false, message: "Só administradores podem configurar o token." };
  const id = z.string().uuid().safeParse(form.get("integrationId"));
  const secret = z.string().trim().min(8, "Token muito curto").max(200, "Token muito longo").safeParse(form.get("secret"));
  if (!id.success) return { ok: false, message: "Integração inválida." };
  if (!secret.success) return { ok: false, message: secret.error.issues[0].message };
  if (!process.env.ENCRYPTION_KEY) return { ok: false, message: "ENCRYPTION_KEY ausente no servidor." };
  const ok = await setKiwifySigningSecret(await getDb(), ctx.userId, id.data, encryptSecret(secret.data));
  revalidatePath("/integracoes");
  return ok
    ? { ok: true, message: "Token salvo (cifrado). Se havia um anterior, ele ainda vale por 48 h para reenvios da Kiwify." }
    : { ok: false, message: "Não foi possível salvar o token nesta integração." };
}

export async function setIntegrationStatusAction(form: FormData): Promise<void> {
  const ctx = await admin();
  if (!ctx) return;
  const id = z.string().uuid().safeParse(form.get("integrationId"));
  const status = z.enum(["active", "paused"]).safeParse(form.get("status"));
  if (!id.success || !status.success) return;
  await setIntegrationStatus(await getDb(), ctx.userId, ctx.membership.workspaceId, id.data, status.data);
  revalidatePath("/integracoes");
}

/** Meta Ads: bloqueado até RASTRO_ENABLE_META=1 (liga a conexão com a conta de anúncios). */
export async function saveMetaConfig(_prev: SimpleState, form: FormData): Promise<SimpleState> {
  if (!env.metaEnabled) return { ok: false, message: "Conexão com a Meta Ads desligada. Defina RASTRO_ENABLE_META=1 nas variáveis da Vercel e publique de novo." };
  const blocked = secretsWriteBlocked();
  if (blocked) return { ok: false, message: blocked };
  const ctx = await admin();
  if (!ctx) return { ok: false, message: "Só administradores podem conectar a Meta Ads." };
  const account = z.string().trim().regex(/^(act_)?\d{5,25}$/, "ID da conta de anúncios inválido").safeParse(form.get("adAccountId"));
  const token = z.string().trim().min(20, "Token inválido").max(1000).safeParse(form.get("token"));
  if (!account.success) return { ok: false, message: account.error.issues[0].message };
  if (!token.success) return { ok: false, message: token.error.issues[0].message };
  const id = await saveMetaIntegration(
    await getDb(),
    ctx.userId,
    ctx.membership.workspaceId,
    account.data.startsWith("act_") ? account.data : `act_${account.data}`,
    encryptSecret(token.data),
  );
  revalidatePath("/integracoes");
  return id ? { ok: true, message: "Meta Ads conectada. A primeira sincronização roda no próximo ciclo." } : { ok: false, message: "Não foi possível salvar." };
}
