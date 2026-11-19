/** Payload sintético no formato público do webhook de vendas da Kiwify (dados fictícios). */
export function kiwifyPayload(over: Record<string, unknown> = {}) {
  return {
    order_id: "kw-0001",
    order_ref: "ABC123",
    order_status: "paid",
    webhook_event_type: "order_approved",
    payment_method: "credit_card",
    created_at: "2026-11-01 10:00",
    approved_date: "2026-11-01 10:01",
    updated_at: "2026-11-01 10:01",
    card_last4digits: "4242",
    Product: { product_id: "prod-1", product_name: "Curso Exemplo" },
    Customer: { full_name: "Pessoa Teste", email: "Pessoa@Exemplo.com ", mobile: "+5511999999999", CPF: "00000000000" },
    Commissions: { charge_amount: 19700, product_base_price: 19700, kiwify_fee: 1970, my_commission: 17730, currency: "BRL" },
    TrackingParameters: { src: null, sck: "rst_visitor000001", utm_source: "facebook", utm_medium: "paid", utm_campaign: "Black Friday", utm_content: null, utm_term: null },
    ...over,
  };
}
