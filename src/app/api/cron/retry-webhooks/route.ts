import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { retryFailedWebhooks } from "@/lib/ingest/process-order";
import { purgeExpiredLabs } from "@/lib/lab/setup";
import { safeEqual } from "@/lib/security/crypto";
import { logger } from "@/lib/security/logger";
import { getStore } from "@/lib/store";

/**
 * Reprocessa webhooks que falharam e limpa dados de laboratório com mais de 7 dias.
 * Protegido por CRON_SECRET (Authorization: Bearer …).
 */

// reprocessamento em lote
export const maxDuration = 60;
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await retryFailedWebhooks(await getStore());
  let labPurged: number | null = null;
  try {
    labPurged = await purgeExpiredLabs(await getDb());
  } catch (err) {
    // a limpeza do laboratório nunca derruba o reprocessamento de vendas reais
    logger.error("lab_purge_failed", { err: err instanceof Error ? err.message : String(err) });
  }
  return NextResponse.json({ ...result, labPurged });
}
