import { z } from "zod";

export const costSettingsSchema = z.object({
  taxRateBps: z.number().int().min(0).max(10_000),
  gatewayFeeBps: z.number().int().min(0).max(10_000),
  costPerSaleCents: z.number().int().min(0).max(100_000_000),
  fixedMonthlyCents: z.number().int().min(0).max(10_000_000_000),
});

/** "6,5" → 650 bps */
export function percentToBps(input: string): number | null {
  const n = Number(input.replace(/[%\s]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null;
}

/** "R$ 1.234,56" → 123456 centavos */
export function moneyToCents(input: string): number | null {
  const cleaned = input.replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
