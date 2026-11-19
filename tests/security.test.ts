import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, hashEmail, safeEqual } from "@/lib/security/crypto";
import { logger, redact } from "@/lib/security/logger";
import { createRateLimiter } from "@/lib/security/rate-limit";

const key = randomBytes(32).toString("base64");

describe("criptografia de credenciais", () => {
  it("cifra e decifra; IV muda a cada vez", () => {
    const a = encryptSecret("EAAB-token-secreto", key);
    const b = encryptSecret("EAAB-token-secreto", key);
    expect(a).not.toBe(b);
    expect(a).not.toContain("EAAB");
    expect(decryptSecret(a, key)).toBe("EAAB-token-secreto");
  });

  it("detecta adulteração e chave errada", () => {
    const enc = encryptSecret("x", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("y").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(enc, randomBytes(32).toString("base64"))).toThrow();
  });

  it("recusa chave de tamanho errado", () => {
    expect(() => encryptSecret("x", Buffer.from("curta").toString("base64"))).toThrow(/32 bytes/);
  });

  it("safeEqual e hashEmail", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(hashEmail("  A@B.com ")).toBe(hashEmail("a@b.com"));
    expect(hashEmail("sem-arroba")).toBeNull();
  });
});

describe("logger", () => {
  it("redige segredos e PII em qualquer nível", () => {
    const out = redact({ access_token: "t", nested: { Customer: { email: "a@b.com", CPF: "1" } }, note: "fale com a@b.com", count: 3 }) as Record<string, unknown>;
    expect(out.access_token).toBe("[redigido]");
    expect(JSON.stringify(out)).not.toContain("a@b.com");
    expect(out.count).toBe(3);
  });

  it("não vaza no console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error("falhou", { authorization: "Bearer xyz", phone: "11999" });
    const printed = spy.mock.calls[0][0] as string;
    expect(printed).not.toContain("xyz");
    expect(printed).not.toContain("11999");
    spy.mockRestore();
  });
});

describe("rate limit", () => {
  it("bloqueia rajada e reabastece com o tempo", () => {
    const allow = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
    expect(allow("k", 0)).toBe(true);
    expect(allow("k", 0)).toBe(true);
    expect(allow("k", 0)).toBe(false);
    expect(allow("outra", 0)).toBe(true);
    expect(allow("k", 1000)).toBe(true);
  });
});

describe("cache com validade (proteção contra varredura de chaves/tokens)", () => {
  it("guarda inclusive resultados negativos e expira", async () => {
    const { createTtlCache } = await import("@/lib/security/ttl-cache");
    const c = createTtlCache<string | null>({ ttlMs: 1000, maxEntries: 2 });
    c.set("inexistente", null, 0);
    expect(c.get("inexistente", 500)).toEqual({ hit: true, value: null });
    expect(c.get("inexistente", 1500)).toEqual({ hit: false });
    expect(c.get("nunca-visto", 0)).toEqual({ hit: false });
  });
  it("respeita o tamanho máximo (descarta o mais antigo)", async () => {
    const { createTtlCache } = await import("@/lib/security/ttl-cache");
    const c = createTtlCache<number>({ ttlMs: 10_000, maxEntries: 2 });
    c.set("a", 1, 0);
    c.set("b", 2, 0);
    c.set("c", 3, 0);
    expect(c.get("a", 1).hit).toBe(false);
    expect(c.get("c", 1)).toEqual({ hit: true, value: 3 });
  });
  it("limite por IP barra quem troca de chave a cada envio", () => {
    const allowIp = createRateLimiter({ capacity: 3, refillPerSecond: 0 });
    const allowKey = createRateLimiter({ capacity: 60, refillPerSecond: 0 });
    let aceitos = 0;
    for (let i = 0; i < 10; i++) if (allowIp("1.2.3.4", 0) && allowKey(`pk_${i}:1.2.3.4`, 0)) aceitos++;
    expect(aceitos).toBe(3);
  });
});
