import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Credenciais de integração (tokens de API) são cifradas com AES-256-GCM antes de ir ao banco.
 * Formato: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>
 * ENCRYPTION_KEY = 32 bytes em base64 (gerar com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
 */
function loadKey(raw = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("ENCRYPTION_KEY ausente");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY deve ter 32 bytes em base64");
  return key;
}

export function encryptSecret(plain: string, rawKey?: string): string {
  const key = loadKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, rawKey?: string): string {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("formato de segredo inválido");
  const decipher = createDecipheriv("aes-256-gcm", loadKey(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Comparação em tempo constante de duas strings (hex/base64). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function hmacHex(algorithm: "sha1" | "sha256", secret: string, body: string): string {
  return createHmac(algorithm, secret).update(body, "utf8").digest("hex");
}

/** Token aleatório para URLs de webhook e chaves públicas de site. */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/** E-mail normalizado + SHA-256 (mesmo formato que Meta/Google/TikTok aceitam para correspondência). */
export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  return sha256Hex(normalized);
}
