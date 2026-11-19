/**
 * Logger estruturado que nunca imprime dado sensível.
 * Qualquer chave que pareça segredo ou PII vira "[redigido]", em qualquer profundidade.
 */
const SENSITIVE = /(token|secret|password|senha|authorization|cookie|api[_-]?key|email|e-mail|cpf|cnpj|phone|mobile|telefone|celular|document|address|endereco|card|signature|full_?name|first_?name|last_?name|^name$|^ip$)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[profundo]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE.test(k) ? "[redigido]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)) return "[redigido]";
  return value;
}

type Level = "info" | "warn" | "error";

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const line = JSON.stringify({ level, msg, ...(ctx ? (redact(ctx) as object) : {}), at: new Date().toISOString() });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};
