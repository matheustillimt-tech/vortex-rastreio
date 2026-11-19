// Verificador SCRAM-SHA-256 no formato do Postgres (RFC 5802 / 7677).
// ALTER ROLE ... PASSWORD '<verificador>' é aceito pelo Postgres sem re-hash:
// a senha em texto puro nunca chega ao servidor nem aos logs/histórico.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const hmac = (key, msg) => createHmac("sha256", key).update(msg).digest();
const sha256 = (buf) => createHash("sha256").update(buf).digest();

export function scramVerifier(password, { iterations = 4096, salt = randomBytes(16) } = {}) {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const storedKey = sha256(hmac(salted, "Client Key"));
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export function scramMatches(password, verifier) {
  const m = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
  if (!m) return false;
  return scramVerifier(password, { iterations: Number(m[1]), salt: Buffer.from(m[2], "base64") }) === verifier;
}

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
