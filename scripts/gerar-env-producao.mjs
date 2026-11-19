#!/usr/bin/env node
// Gera as variáveis de PRODUÇÃO do Vórtex Rastreio sem exibir segredos.
//   node scripts/gerar-env-producao.mjs --ref <id-do-projeto> --pooler-host aws-0-<regiao>.pooler.supabase.com [--force]
//
// Saídas (pasta .secrets/, fora do git):
//   producao.env                         → valores para colar em Vercel › Project › Settings › Environment Variables (Production)
//   rastro_app_prod_password.sql         → ALTER ROLE rastro_app_prod com o VERIFICADOR SCRAM (hash)
// A anon/publishable key é pública e é lida do .env.local (NEXT_PUBLIC_SUPABASE_ANON_KEY) ou da variável de
// ambiente de mesmo nome (não é segredo).
// Usa a role rastro_app_prod (migration 0003): herda as permissões mínimas da rastro_app, com senha própria.
// O desenvolvimento (opcional) usa a rastro_app, com outra senha (scripts/setup-credentials.mjs).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomSecret, scramMatches, scramVerifier } from "./lib/scram.mjs";

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const ref = arg("--ref") ?? "";
const host = arg("--pooler-host");
if (!/^[a-z]{20}$/.test(ref)) {
  console.error("Informe --ref com o id do seu projeto Supabase (20 letras, aparece em https://<id>.supabase.co)");
  process.exit(1);
}
if (!host || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host)) {
  console.error("Informe --pooler-host (Supabase › Connect › Transaction pooler), ex.: aws-0-<regiao>.pooler.supabase.com");
  process.exit(1);
}

const local = existsSync(".env.local") ? readFileSync(".env.local", "utf8") : "";
const anon = (local.match(/^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$/m)?.[1] ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
if (!anon || !/^(sb_publishable_|eyJ)/.test(anon)) {
  console.error("NEXT_PUBLIC_SUPABASE_ANON_KEY (anon/publishable) não encontrada no .env.local. Cole a chave pública lá (Supabase › Project Settings › API Keys).");
  process.exit(1);
}
if (/^sb_secret_/.test(anon)) throw new Error("chave secreta no lugar da pública: abortado");

const password = randomSecret(32);
const verifier = scramVerifier(password);
if (!scramMatches(password, verifier)) throw new Error("falha no verificador SCRAM");

const envFile = [
  "# PRODUÇÃO — colar no painel da Vercel (ambiente Production). Não versionar. Não reutilizar no desenvolvimento.",
  `DATABASE_URL=postgresql://rastro_app_prod.${ref}:${password}@${host}:6543/postgres`,
  `NEXT_PUBLIC_SUPABASE_URL=https://${ref}.supabase.co`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`,
  `ENCRYPTION_KEY=${Buffer.from(randomSecret(32), "base64url").toString("base64")}`,
  `CRON_SECRET=${randomSecret(32)}`,
  "# RASTRO_ENABLE_META=1   ← ligue quando for conectar a Meta Ads",
  "",
].join("\n");

mkdirSync(".secrets", { recursive: true });
const envPath = join(".secrets", "producao.env");
if (existsSync(envPath) && !args.includes("--force")) {
  console.error(".secrets/producao.env já existe. Use --force para gerar outro (invalida o anterior quando o SQL novo for aplicado).");
  process.exit(1);
}
writeFileSync(envPath, envFile, { mode: 0o600 });
writeFileSync(
  join(".secrets", "rastro_app_prod_password.sql"),
  `-- Aplicar no SQL Editor do projeto ${ref} (como postgres). Contém só o hash SCRAM da senha de PRODUÇÃO.\nalter role rastro_app_prod with password '${verifier}';\n`,
  { mode: 0o600 },
);
console.log("Gerado sem exibir segredos:");
console.log("  .secrets/producao.env → DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ENCRYPTION_KEY, CRON_SECRET");
console.log("  .secrets/rastro_app_prod_password.sql → ALTER ROLE rastro_app_prod com verificador SCRAM");
