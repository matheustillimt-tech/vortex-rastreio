-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — 0003 · role de login exclusiva para PRODUÇÃO
--
-- rastro_app continua sendo usada pelo desenvolvimento (.env.local) e passa a ser também o
-- "grupo de permissões". rastro_app_prod é só um login que HERDA rastro_app:
--   • não recebe nenhum grant próprio → nunca terá mais acesso que rastro_app;
--   • senha e limite de conexões próprios → trocar/revogar a de produção não afeta o desenvolvimento;
--   • as políticas RLS "to rastro_app" valem para ela (membro com herança).
-- Só cria 1 role e 1 membership; não toca em tabelas, funções ou outros schemas.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- O dono de tudo precisa ser postgres. Se a CLI do Supabase conectar com outra role de login
-- (membro de postgres), esta linha assume postgres só dentro desta transação.
set local role postgres;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'execute como postgres (atual: %)', current_user;
  end if;
  if not exists (select 1 from rastro.schema_migrations where version = '0002_sites_integracoes') then
    raise exception 'migration 0002 ausente';
  end if;
  if exists (select 1 from pg_roles where rolname = 'rastro_app_prod') then
    raise exception 'role rastro_app_prod já existe: abortando para não reaproveitar permissões alheias';
  end if;
end $$;

-- login sem senha (definida à parte, por verificador SCRAM); sem criar banco/role; limite próprio
create role rastro_app_prod login inherit nocreatedb nocreaterole connection limit 10;

-- herda as permissões mínimas da rastro_app; SET permite o SET LOCAL ROLE rastro_user das leituras com RLS
grant rastro_app to rastro_app_prod with inherit true, set true;

insert into rastro.schema_migrations (version) values ('0003_role_producao');

commit;
