import { NextResponse, type NextRequest } from "next/server";
import { ingestEvents, isOriginAllowed } from "@/lib/ingest/collect";
import { logger } from "@/lib/security/logger";
import { createRateLimiter } from "@/lib/security/rate-limit";
import { createTtlCache } from "@/lib/security/ttl-cache";
import type { Site } from "@/lib/store/types";
import { getStore } from "@/lib/store";
import { collectBatchSchema } from "@/lib/tracking/event-schema";


// teto de execução: limita o custo de qualquer travamento
export const maxDuration = 10;
const MAX_BODY_BYTES = 32 * 1024;
// por site + IP: 60 lotes de rajada, 2/s sustentado (uso normal de uma página)
const allow = createRateLimiter({ capacity: 60, refillPerSecond: 2 });
// por IP, independente da chave: impede driblar o limite trocando de chave a cada envio
const allowIp = createRateLimiter({ capacity: 120, refillPerSecond: 4 });
// sites (inclusive "não existe") ficam 60 s em memória: chave inválida repetida não chega ao banco.
// Efeito colateral aceito: desativar um site leva até 60 s para valer em todas as instâncias.
const siteCache = createTtlCache<Site | null>({ ttlMs: 60_000, maxEntries: 2_000 });

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  // recusa corpo grande antes de lê-lo
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowIp(ip)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = collectBatchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const publicKey = parsed.data.events[0].k;
  // IP só para os baldes de rate limit, em memória; nunca é gravado
  if (!allow(`${publicKey}:${ip}`)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  try {
    const store = await getStore();
    const cached = siteCache.get(publicKey);
    const site = cached.hit ? cached.value : await store.findSiteByPublicKey(publicKey);
    if (!cached.hit) siteCache.set(publicKey, site);
    if (!site) return NextResponse.json({ error: "unknown_site" }, { status: 404 });
    if (!isOriginAllowed(site, origin)) return NextResponse.json({ error: "origin_not_allowed" }, { status: 403 });

    const result = await ingestEvents(store, site, parsed.data.events);
    return NextResponse.json({ ok: true, ...result }, { status: 202, headers: cors(origin) });
  } catch (err) {
    logger.error("collect_failed", { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "internal" }, { status: 500, headers: cors(origin) });
  }
}
