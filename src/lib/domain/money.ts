import type { Cents } from "./types";

/**
 * Conversões de valor monetário para centavos (inteiro), sem ponto flutuante.
 * Cada plataforma manda num formato; o adaptador escolhe a função certa — nunca adivinhar o formato.
 */

/** Já vem em centavos (ex.: Kiwify `charge_amount: 19700`). Aceita número ou texto só com dígitos. */
export function centsFromInteger(v: unknown): Cents | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === "string" && /^\d{1,15}$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** Decimal com ponto (ex.: `"197.00"`, `197.5`). */
export function centsFromDecimal(v: unknown): Cents | null {
  const s = typeof v === "number" ? (Number.isFinite(v) ? v.toFixed(2) : "") : typeof v === "string" ? v.trim() : "";
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/**
 * Texto em reais no padrão brasileiro (ex.: Kirvano `"R$ 1.169,80"`, `"R$ 169,80"`, `"169,8"`, `"R$ 97"`).
 * Ponto é sempre separador de milhar; vírgula é sempre decimal. Formato fora disso → null (não inventa valor).
 */
export function centsFromBrl(v: unknown): Cents | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/R\$/i, "").replace(/[\s ]/g, "");
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1].replace(/\./g, "")) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

/**
 * Data/hora local de Brasília sem fuso (`"YYYY-MM-DD HH:mm"` ou `"YYYY-MM-DD HH:mm:ss"`) → ISO UTC.
 * O Brasil não tem horário de verão desde 2019, então -03:00 vale o ano todo.
 * Texto que já traz fuso (ISO completo) é respeitado. Inválido → null.
 */
export function brasiliaToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(v);
  const normalized = local ? `${local[1]}T${local[2]}-03:00` : v;
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
