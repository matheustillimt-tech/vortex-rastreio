import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** Payload enviado pelo public/t.js para POST /api/collect. */
export const collectEventSchema = z.object({
  /** chave pública do site (não é segredo; só identifica o site) */
  k: z.string().regex(/^pk_[A-Za-z0-9]{16,48}$/),
  /** id único do evento gerado no navegador → deduplicação */
  eid: id,
  vid: id,
  sid: id,
  type: z.enum(["pageview", "lead", "initiate_checkout", "custom"]),
  name: z.string().max(64).optional(),
  url: z.string().url().max(2000),
  ref: z.string().max(2000).optional().nullable(),
  /** query string da landing da sessão (o servidor só aproveita as chaves rastreadas) */
  q: z.string().max(2000).optional(),
  ts: z.number().int().positive(),
});

export const collectBatchSchema = z.object({
  events: z.array(collectEventSchema).min(1).max(20),
});

export type CollectEvent = z.infer<typeof collectEventSchema>;
