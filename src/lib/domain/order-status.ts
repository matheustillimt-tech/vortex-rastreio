import type { OrderStatus } from "./types";

/**
 * Webhooks chegam fora de ordem e repetidos. O status só avança:
 * um "approved" atrasado nunca desfaz um "refunded" já gravado.
 * cancelled e approved têm o mesmo nível: são desfechos alternativos do pagamento
 * (ex.: boleto expirado → cancelled; pago depois → approved é aceito).
 */
const RANK: Record<OrderStatus, number> = {
  pending: 0,
  cancelled: 1,
  approved: 1,
  refunded: 2,
  chargeback: 3,
};

export function statusRank(status: OrderStatus): number {
  return RANK[status];
}

export function shouldApplyStatus(current: OrderStatus | null, incoming: OrderStatus): boolean {
  if (current == null) return true;
  return RANK[incoming] >= RANK[current];
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pendente",
  approved: "Aprovada",
  cancelled: "Cancelada",
  refunded: "Reembolsada",
  chargeback: "Chargeback",
};
