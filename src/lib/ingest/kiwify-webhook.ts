import type { Store } from "@/lib/store/types";
import { handleWebhook, type WebhookResult } from "./webhook";

export type { WebhookResult } from "./webhook";

/** Atalho do fluxo genérico para a Kiwify (assinatura em `?signature=`). Mantido por compatibilidade. */
export async function handleKiwifyWebhook(input: {
  store: Store;
  urlToken: string;
  rawBody: string;
  signature: string | null;
  now?: Date;
}): Promise<WebhookResult> {
  const query = new URLSearchParams();
  if (input.signature !== null) query.set("signature", input.signature);
  return handleWebhook({ store: input.store, provider: "kiwify", urlToken: input.urlToken, rawBody: input.rawBody, query, now: input.now });
}
