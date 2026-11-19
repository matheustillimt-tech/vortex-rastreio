#!/usr/bin/env node
// Gera o SQL do primeiro workspace a partir do template, validando as entradas.
//   node scripts/primeiro-workspace.mjs --email voce@exemplo.com [--nome "Minha Empresa"]
// Saída: .secrets/primeiro-workspace.sql (não versionado). Não conecta em nada.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = (arg("--email") ?? "").trim().toLowerCase();
const nome = (arg("--nome") ?? "Minha Empresa").trim();

if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error("--email inválido");
  process.exit(1);
}
if (!/^[\p{L}\p{N} ._-]{1,120}$/u.test(nome)) {
  console.error("--nome inválido (letras, números, espaço, . _ -)");
  process.exit(1);
}

const sql = readFileSync(join("db", "ops", "primeiro-workspace.sql"), "utf8")
  .replaceAll("__ADMIN_EMAIL__", email)
  .replaceAll("__WORKSPACE_NOME__", nome);
mkdirSync(".secrets", { recursive: true });
writeFileSync(join(".secrets", "primeiro-workspace.sql"), sql);
console.log(`SQL gerado em .secrets/primeiro-workspace.sql para ${email} / "${nome}"`);
