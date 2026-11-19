import { NextResponse, type NextRequest } from "next/server";
import { handleWebhook } from "@/lib/ingest/webhook";
import { getAdapter } from "@/lib/integrations/adapters";
import { sha256Hex } from "@/lib/security/crypto";
import { logger } from "@/lib/security/logger";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createTtlCache } from "@/lib/security/ttl-cache";
import { getStore } from "@/lib/store";

/**
 * /api/webhooks/{provider}/{token} — uma rota para todas as plataformas com adaptador
 * (a URL da Kiwify, /api/webhooks/kiwify/{token}, continua a mesma).
 */

// as plataformas esperam dezenas de segundos; 15 s é folga suficiente e limita custo
export const maxDuration = 15;
const MAX_BODY_BYTES = 256 * 1024;
// as plataformas reenviam em rajadas curtas; o limite é folgado para elas e barra varreduras de tokens
const allowIp = createRateLimiter({ capacity: 300, refillPerSecond: 10 });
// tokens que não existem ficam 60 s em memória (só o hash): varredura não chega ao banco
const unknownTokens = createTtlCache<true>({ ttlMs: 60_000, maxEntries: 5_000 });
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{16,64}$/;

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string; token: string }> }) {
  const { provider, token } = await ctx.params;
  // plataforma sem adaptador: recusa sem tocar no banco
  if (!getAdapter(provider)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowIp(ip)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  // token fora do formato ou sabidamente inexistente: recusa sem tocar no banco
  const tokenKey = sha256Hex(`${provider}:${token}`);
  if (!TOKEN_FORMAT.test(token) || unknownTokens.get(tokenKey).hit) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  try {
    const result = await handleWebhook({
      store: await getStore(),
      provider,
      urlToken: token,
      rawBody,
      query: req.nextUrl.searchParams,
      headers: req.headers,
    });
    if (result.status === 401 && result.body.reason === "unknown_token") unknownTokens.set(tokenKey, true);
    return NextResponse.json({ ...result.body, reason: undefined }, { status: result.status });
  } catch (err) {
    logger.error("webhook_crash", { provider, err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
