/**
 * Domínios autorizados de um site (CORS do /api/collect).
 * Aceita: "loja.com.br" → https://loja.com.br · "https://lp.loja.com" · "*.loja.com" (subdomínios)
 * e http://localhost:porta (testes). Recusa caminhos, credenciais, IPs públicos sem https e curingas amplos.
 */
export type OriginError = { ok: false; input: string; reason: string };
export type OriginResult = { ok: true; value: string } | OriginError;

const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeOrigin(raw: string): OriginResult {
  const input = raw.trim().toLowerCase().replace(/\/+$/, "");
  if (!input) return { ok: false, input: raw, reason: "vazio" };

  if (input.startsWith("*.")) {
    const host = input.slice(2);
    if (!HOST.test(host) || host.split(".").length < 2) return { ok: false, input: raw, reason: "curinga inválido" };
    return { ok: true, value: `*.${host}` };
  }

  const withScheme = /^[a-z]+:\/\//.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, input: raw, reason: "endereço inválido" };
  }
  if (url.username || url.password) return { ok: false, input: raw, reason: "não use usuário/senha no endereço" };
  if (url.pathname !== "/" || url.search || url.hash) return { ok: false, input: raw, reason: "informe só o domínio, sem caminho" };
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "http:" && !isLocal) return { ok: false, input: raw, reason: "use https" };
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, input: raw, reason: "protocolo inválido" };
  if (!isLocal && !HOST.test(url.hostname)) return { ok: false, input: raw, reason: "domínio inválido" };
  return { ok: true, value: url.origin };
}

/** Lista separada por vírgula ou linha → origens únicas, até 20. */
export function parseOrigins(text: string): { origins: string[]; errors: OriginError[] } {
  const parts = text.split(/[\n,]/).map((p) => p.trim()).filter(Boolean);
  const origins = new Set<string>();
  const errors: OriginError[] = [];
  for (const p of parts) {
    const r = normalizeOrigin(p);
    if (r.ok) origins.add(r.value);
    else errors.push(r);
  }
  if (origins.size > 20) errors.push({ ok: false, input: "", reason: "no máximo 20 domínios por site" });
  return { origins: [...origins].slice(0, 20), errors };
}
