-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — checagem prévia SOMENTE LEITURA (opcional).
-- Útil se você for instalar num projeto Supabase que já tem outras coisas. Rodar no SQL Editor
-- antes de aplicar as migrações. Não grava nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Conflitos de nome (todos devem vir false)
select
  exists (select 1 from pg_namespace where nspname = 'rastro')                         as schema_rastro_existe,
  exists (select 1 from pg_roles where rolname in ('rastro_app', 'rastro_user'))       as roles_rastro_existem;

-- 2. Versão do Postgres (precisa ser 16+ por causa de GRANT ... WITH INHERIT FALSE)
select current_setting('server_version') as postgres;

-- 3. Tamanho do banco e das maiores tabelas (para estimar folga do plano)
select pg_size_pretty(pg_database_size(current_database())) as tamanho_banco;
select n.nspname || '.' || c.relname as tabela, pg_size_pretty(pg_total_relation_size(c.oid)) as tamanho
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema')
order by pg_total_relation_size(c.oid) desc limit 10;

-- 4. Conexões em uso × limite (o Vórtex Rastreio reserva no máximo 10 via connection limit)
select count(*) as conexoes_abertas, current_setting('max_connections') as max_connections from pg_stat_activity;

-- 5. Usuários no Auth (quem já existe no login do projeto)
select count(*) as usuarios_auth from auth.users;

-- 6. Privilégios padrão globais que poderiam vazar para o schema novo (a migration já revoga)
select defaclrole::regrole as dono, defaclnamespace::regnamespace as schema, defaclobjtype as tipo, defaclacl
from pg_default_acl;

-- 7. Triggers existentes em auth.users (só para conhecimento; o Vórtex Rastreio não cria nenhum)
select tgname from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- 8. Event triggers (verificar se algum age em CREATE SCHEMA/TABLE/ROLE)
select evtname, evtevent, evttags, evtfoid::regproc as funcao from pg_event_trigger;

-- 9. Atividade das outras tabelas do projeto (escritas acumuladas desde o último reset de estatísticas)
select relname, n_tup_ins, n_tup_upd, n_live_tup from pg_stat_user_tables where schemaname = 'public' order by n_tup_ins desc;

-- 10. Privilégios necessários para a migration
select has_table_privilege('postgres', 'auth.users', 'REFERENCES') as pode_fk_auth_users,
       has_database_privilege('postgres', current_database(), 'CREATE') as pode_criar_schema,
       (select rolcreaterole from pg_roles where rolname = 'postgres') as pode_criar_role;
