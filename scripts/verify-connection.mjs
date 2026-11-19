#!/usr/bin/env node
// Verifica a conexão real (rastro_app ou rastro_app_prod) SEM gravar nada e SEM imprimir segredos.
//   node scripts/verify-connection.mjs                          → usa .env.local (desenvolvimento)
//   node scripts/verify-connection.mjs --env .secrets/producao.env → credencial de produção
// Tudo roda em transação READ ONLY terminada em rollback.
import { readFileSync } from "node:fs";
import postgres from "postgres";

const envIdx = process.argv.indexOf("--env");
const envFile = envIdx >= 0 ? process.argv[envIdx + 1] : ".env.local";
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const url = env.DATABASE_URL;
if (!url) throw new Error(`DATABASE_URL ausente em ${envFile}`);
const u = new URL(url);
console.log(`alvo: ${u.username}@${u.hostname}:${u.port} (senha oculta)`);

const sql = postgres(url, { prepare: false, ssl: "require", max: 1, connect_timeout: 15, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "OK  " : "FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** executa em transação read-only e sempre desfaz */
async function ro(fn) {
  try {
    await sql.begin("read only", async (tx) => {
      await fn(tx);
      throw Object.assign(new Error("rollback"), { __rollback: true });
    });
  } catch (e) {
    if (!e.__rollback) throw e;
  }
}

async function denied(tx, stmt) {
  try {
    await tx.unsafe(`savepoint s`);
    await tx.unsafe(stmt);
    await tx.unsafe(`rollback to savepoint s`);
    return false;
  } catch (e) {
    await tx.unsafe(`rollback to savepoint s`);
    // "não existe" também conta como negado: num projeto só do Vórtex Rastreio algumas tabelas nem existem
    return /permission denied|must be member|not have permission|does not exist|não existe/i.test(e.message) ? true : `erro inesperado: ${e.message}`;
  }
}

try {
  await ro(async (tx) => {
    const [who] = await tx`select current_user, session_user, current_setting('transaction_read_only') ro, version() v`;
    const ROLE = who.current_user;
    check("autenticou com role do Vórtex Rastreio", ROLE === "rastro_app" || ROLE === "rastro_app_prod", `${ROLE} · transação read-only=${who.ro}`);
    check("TLS cliente→pooler", true, "ssl:'require' recusa conexão sem TLS; conexão estabelecida");
    const [ssl] = await tx`select ssl, version from pg_stat_ssl where pid = pg_backend_pid()`;
    console.log(`INFO pooler→banco (rede interna do Supabase): TLS ${ssl?.ssl ? ssl.version : "não usado nesse trecho"}`);

    // banco na versão que o app exige (é a mesma checagem do aviso "Atualização do banco pendente")
    const schemaOk = (await denied(tx, "select status from rastro.sites where false")) === false;
    check("schema na versão do app (0002: sites.status)", schemaOk);
    const [sec] = await tx`select count(*)::int n from rastro.integrations where has_signing_secret`;
    check("lê has_signing_secret sem ler segredos", sec.n >= 0);
    check("lê token anterior da Kiwify (necessário para validar assinaturas durante a troca)", (await denied(tx, "select signing_secret_previous_encrypted from rastro.integrations")) === false);

    // acesso autorizado (somente leitura)
    for (const t of ["sites", "integrations", "sessions", "events", "orders", "webhook_events", "ad_insights_daily"]) {
      const r = await denied(tx, `select count(*) from rastro.${t}`);
      check(`lê rastro.${t}`, r === false);
    }
    // negado dentro do rastro
    for (const t of ["workspace_members", "cost_settings", "schema_migrations"]) {
      check(`NÃO lê rastro.${t}`, (await denied(tx, `select 1 from rastro.${t}`)) === true);
    }
    // desde a 0004: só id e tipo (produção/laboratório) dos workspaces, para o webhook; nome e escrita, não
    check("lê só id e kind de rastro.workspaces", (await denied(tx, "select id, kind from rastro.workspaces limit 1")) === false);
    check("NÃO lê o nome dos workspaces", (await denied(tx, "select name from rastro.workspaces limit 1")) === true);
    // outros sistemas
    for (const t of ["auth.users", "auth.identities", "storage.objects", "vault.secrets"]) {
      check(`NÃO lê ${t}`, (await denied(tx, `select 1 from ${t} limit 1`)) === true);
    }
    // privilégios de escrita fora do rastro (sem tentar escrever)
    const [w] = await tx`
      select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p','v','m','f') and n.nspname not in ('rastro','pg_catalog','information_schema')
        and (has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
          or (n.nspname in ('public','auth','storage','vault','realtime') and has_table_privilege(current_user, c.oid, 'SELECT')))`;
    check("sem escrita em nenhuma tabela fora do rastro (e sem leitura em public/auth/storage/vault/realtime)", w.n === 0, `${w.n} tabelas`);
    const [sch] = await tx`select count(*)::int n from pg_namespace where nspname in ('public','auth','storage','vault','realtime','extensions') and has_schema_privilege(current_user, oid, 'CREATE')`;
    check("sem CREATE em outros schemas", sch.n === 0);
    const [d] = await tx`select count(*)::int n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rastro' and c.relkind = 'r' and has_table_privilege(current_user, c.oid, 'DELETE,TRUNCATE')`;
    check("sem DELETE/TRUNCATE nem no rastro", d.n === 0);
    for (const r of ["postgres", "authenticated", "service_role", "anon"]) {
      check(`não assume a role ${r}`, (await denied(tx, `set local role ${r}`)) === true);
    }
    // leitura em nome de usuário: sem claims, RLS não devolve nada
    await tx.unsafe("savepoint u");
    await tx.unsafe("set local role rastro_user");
    const rows = await tx.unsafe("select count(*)::int n from rastro.orders");
    check("rastro_user sem login não vê pedidos", rows[0].n === 0);
    await tx.unsafe("rollback to savepoint u");
  });
} catch (e) {
  check("conexão", false, e.message.replace(url, "<url>"));
} finally {
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => r !== true).length;
console.log(failed ? `\n${failed} verificação(ões) falharam` : "\nTodas as verificações passaram");
process.exit(failed ? 1 : 0);
