-- Desfaz a 0003: bloqueia o login, encerra sessões e remove só a role de produção.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'rastro_app_prod') then
    alter role rastro_app_prod nologin;
  end if;
end $$;
begin;
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'rastro_app_prod';
drop role if exists rastro_app_prod;
delete from rastro.schema_migrations where version = '0003_role_producao';
commit;
