#!/usr/bin/env node
// Gera as credenciais de DESENVOLVIMENTO do Vórtex Rastreio SEM exibir segredos (opcional:
// só serve se você quiser rodar o painel no seu computador ligado ao Supabase de verdade).
//
//   node scripts/setup-credentials.mjs --ref <id-do-projeto> --pooler-host <host-do-pooler> [--force]
//
// O que faz (só localmente):
//  1. gera senha forte para rastro_app, ENCRYPTION_KEY e CRON_SECRET;
//  2. grava DATABASE_URL, ENCRYPTION_KEY, CRON_SECRET e NEXT_PUBLIC_SUPABASE_URL no .env.local
//     (não sobrescreve chaves existentes sem --force);
//  3. grava em .secrets/rastro_app_password.sql o comando ALTER ROLE com o VERIFICADOR SCRAM
//     (hash), para ser aplicado no Supabase. A senha em texto puro só existe no .env.local.
//
// Não conecta em nada e não altera o Supabase.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomSecret, scramMatches, scramVerifier } from "./lib/scram.mjs";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const ref = arg("--ref") ?? "";
const host = arg("--pooler-host");
const force = args.includes("--force");

if (!host || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host)) {
  console.error("Informe --pooler-host (Supabase › Connect › Transaction pooler), ex.: aws-0-<regiao>.pooler.supabase.com");
  process.exit(1);
}
if (!/^[a-z]{20}$/.test(ref)) {
  console.error("Informe --ref com o id do seu projeto Supabase (20 letras, aparece em https://<id>.supabase.co)");
  process.exit(1);
}

const root = process.cwd();
const envPath = join(root, ".env.local");
const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const has = (k) => new RegExp(`^${k}=.+`, "m").test(current);

const password = randomSecret(32);
const verifier = scramVerifier(password);
if (!scramMatches(password, verifier)) throw new Error("falha ao gerar verificador SCRAM");

const values = {
  DATABASE_URL: `postgresql://rastro_app.${ref}:${password}@${host}:6543/postgres`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
  // base64 padrão de 32 bytes (formato exigido por src/lib/security/crypto.ts)
  ENCRYPTION_KEY: Buffer.from(randomSecret(32), "base64url").toString("base64"),
  CRON_SECRET: randomSecret(32),
};

const skipped = [];
let next = current;
for (const [k, v] of Object.entries(values)) {
  if (has(k) && !force) {
    skipped.push(k);
    continue;
  }
  const line = `${k}=${v}`;
  next = has(k) ? next.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${next.trimEnd()}\n${line}\n`.replace(/^\n/, "");
}
if (skipped.includes("DATABASE_URL")) {
  console.error("DATABASE_URL já existe no .env.local: nada foi gerado. Use --force para substituir (a senha antiga deixa de valer após o ALTER ROLE).");
  process.exit(1);
}
writeFileSync(envPath, next.endsWith("\n") ? next : `${next}\n`, { mode: 0o600 });

mkdirSync(join(root, ".secrets"), { recursive: true });
const sqlPath = join(root, ".secrets", "rastro_app_password.sql");
writeFileSync(
  sqlPath,
  `-- Aplicar no SQL Editor do projeto ${ref} (como postgres). Contém só o hash SCRAM (não a senha).\nalter role rastro_app with password '${verifier}';\n`,
  { mode: 0o600 },
);

console.log("Gerado sem exibir segredos:");
console.log(`  .env.local            → ${Object.keys(values).filter((k) => !skipped.includes(k)).join(", ")}`);
if (skipped.length) console.log(`  (mantidos: ${skipped.join(", ")})`);
console.log(`  .secrets/rastro_app_password.sql → ALTER ROLE com verificador SCRAM`);
console.log("Falta no .env.local: NEXT_PUBLIC_SUPABASE_ANON_KEY (Supabase › Settings › API › anon/publishable).");
