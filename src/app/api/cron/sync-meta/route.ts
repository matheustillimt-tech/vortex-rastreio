import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { syncAllMeta } from "@/lib/integrations/meta-sync";
import { safeEqual } from "@/lib/security/crypto";

/**
 * Sincroniza gastos da Meta Ads. Protegido por CRON_SECRET e DESLIGADO até RASTRO_ENABLE_META=1
 * (nenhuma chamada real à Meta enquanto a conexão estiver desligada).
 */

// a sincronização Meta pode paginar; o teto evita execução longa
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!env.metaEnabled) return NextResponse.json({ error: "meta_desativada" }, { status: 403 });
  const results = await syncAllMeta(await getDb());
  return NextResponse.json({ results });
}
