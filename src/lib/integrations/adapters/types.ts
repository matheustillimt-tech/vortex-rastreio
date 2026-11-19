import type { CheckoutProvider, NormalizedOrder } from "@/lib/domain/types";
import type { Integration } from "@/lib/store/types";

/**
 * Contrato de um adaptador de checkout. Um arquivo por plataforma, sem lógica escondida em comum:
 * cada um decide sozinho autenticação, leitura do payload, status, valores, rastreio e duplicidade.
 *
 * Regra de segurança: o token secreto na URL só localiza a integração. Ele NÃO substitui a
 * autenticação oficial da plataforma. Plataforma sem mecanismo documentado e confirmado recusa
 * eventos reais até o mecanismo ser confirmado.
 */

export interface WebhookRequest {
  rawBody: string;
  /** parâmetros da URL (ex.: `?signature=` da Kiwify) */
  query: URLSearchParams;
  headers: Headers;
}

export type AuthResult = { ok: true } | { ok: false; error: string };

export type ParseResult =
  /** pedido com status que o Rastro entende */
  | { kind: "order"; order: NormalizedOrder; eventType: string | null; isTest: boolean }
  /** evento autêntico que não muda venda (carrinho abandonado, assinatura…) → 200 sem gravar pedido */
  | { kind: "ignored"; eventType: string | null }
  /** formato inesperado → 400 */
  | { kind: "invalid"; detail?: string };

export interface AuthInfo {
  /** como a plataforma autentica a entrega */
  method: string;
  /** o mecanismo está na documentação OFICIAL e foi conferido? */
  documented: boolean;
  /** de onde veio a informação */
  source: string;
}

export interface CheckoutAdapter {
  provider: CheckoutProvider;
  label: string;
  auth: AuthInfo;
  /** parâmetro do link de checkout que devolve o visitante (rst_<id>) no webhook */
  trackingParam: "sck" | "src";
  /** domínios do checkout, usados pelo script de rastreamento */
  checkoutHosts: string[];
  authenticate(req: WebhookRequest, integration: Integration): AuthResult;
  parse(body: unknown, now?: Date): ParseResult;
  /** chave de idempotência (única no banco inteiro): mesma entrega repetida → mesma chave */
  dedupeKey(workspaceId: string, order: Pick<NormalizedOrder, "externalId" | "status">, eventType: string | null): string;
  /** cópia do payload SEM dados pessoais, para auditoria e reprocessamento */
  stripPii(body: unknown): unknown;
}

/** Plataforma prevista, ainda sem adaptador: aparece na tela, mas a rota recusa entregas. */
export interface PlannedProvider {
  provider: CheckoutProvider;
  label: string;
  auth: AuthInfo;
}
