const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompactFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("pt-BR");
const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" });

export const DASH = "—";

export function brl(cents: number | null | undefined): string {
  return cents == null ? DASH : brlFmt.format(cents / 100);
}
export function brlCompact(cents: number): string {
  return brlCompactFmt.format(cents / 100);
}
export function int(n: number | null | undefined): string {
  return n == null ? DASH : intFmt.format(n);
}
export function pct(fraction: number | null | undefined, digits = 2): string {
  return fraction == null ? DASH : `${(fraction * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
export function multiple(x: number | null | undefined): string {
  return x == null ? DASH : `${x.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`;
}
export function dateTime(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : DASH;
}
export function shortDay(ymd: string): string {
  return dayFmt.format(new Date(`${ymd}T00:00:00Z`)).replace(".", "");
}
