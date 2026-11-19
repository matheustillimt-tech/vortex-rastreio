import type { CollectEvent } from "@/lib/tracking/event-schema";
import { parseAttributionParams, referrerHost, sanitizePath } from "@/lib/tracking/params";
import type { EventRecord, Site, Store } from "@/lib/store/types";

const MAX_CLOCK_SKEW_MS = 24 * 3600_000;

/** Grava sessão (primeiro toque) + eventos deduplicados. Separado da rota para ser testável. */
export async function ingestEvents(store: Store, site: Site, events: CollectEvent[], now = Date.now()) {
  const records: EventRecord[] = [];
  const seenSessions = new Set<string>();

  for (const e of events) {
    if (e.k !== site.publicKey) continue; // lote não pode misturar sites
    // relógio do navegador não é confiável: fora de ±24h usamos o horário do servidor
    const occurredAt = new Date(Math.abs(e.ts - now) > MAX_CLOCK_SKEW_MS ? now : e.ts).toISOString();

    if (!seenSessions.has(e.sid)) {
      seenSessions.add(e.sid);
      await store.ensureSession({
        id: `${site.id}:${e.sid}`,
        workspaceId: site.workspaceId,
        siteId: site.id,
        visitorId: e.vid,
        startedAt: occurredAt,
        landingPath: sanitizePath(e.url),
        referrerHost: referrerHost(e.ref),
        params: parseAttributionParams(e.q ?? ""),
      });
    }

    records.push({
      workspaceId: site.workspaceId,
      siteId: site.id,
      eventId: e.eid,
      visitorId: e.vid,
      sessionId: `${site.id}:${e.sid}`,
      type: e.type,
      name: e.type === "custom" ? e.name ?? null : null,
      path: sanitizePath(e.url),
      occurredAt,
    });
  }

  return store.insertEvents(records);
}

/** CORS: só ecoa a origem se ela estiver liberada para o site. */
export function isOriginAllowed(site: Site, origin: string | null): boolean {
  if (site.allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return site.allowedOrigins.some((allowed) => {
    if (allowed.startsWith("*.")) {
      try {
        const host = new URL(origin).hostname;
        return host === allowed.slice(2) || host.endsWith(allowed.slice(1));
      } catch {
        return false;
      }
    }
    return allowed === origin;
  });
}
