/**
 * Payload sintético no formato do exemplo OFICIAL do webhook da Kirvano (help.kirvano.com › Webhooks).
 * Dados fictícios. Valores em texto "R$ 0,00" e datas sem fuso, como na documentação.
 */
export function kirvanoPayload(over: Record<string, unknown> = {}) {
  return {
    event: "SALE_APPROVED",
    event_description: "Venda aprovada",
    checkout_id: "chk-0001",
    sale_id: "kv-0001",
    payment_method: "PIX",
    total_price: "R$ 1.169,80",
    type: "ONE_TIME",
    status: "APPROVED",
    created_at: "2026-11-01 10:00:00",
    customer: { name: "Pessoa Teste", document: "00000000000", email: "Pessoa@Exemplo.com", phone_number: "5511999999999" },
    payment: { method: "PIX", qrcode: "000201010212...", finished_at: "2026-11-01 10:02:00" },
    products: [
      { id: "bump-1", name: "Bônus", offer_id: "of-2", offer_name: "Bump", price: "R$ 97,00", is_order_bump: true },
      { id: "prod-kv", name: "Curso Kirvano", offer_id: "of-1", offer_name: "Oferta", price: "R$ 1.072,80", is_order_bump: false },
    ],
    utm: { src: "rst_visitor000001", utm_source: "facebook", utm_medium: "paid", utm_campaign: "Black Friday", utm_term: null, utm_content: null },
    ...over,
  };
}
