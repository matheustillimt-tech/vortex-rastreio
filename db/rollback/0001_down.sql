-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — desfaz a 0001 por completo. APAGA todos os dados do Rastro.
-- Não toca em nenhum outro schema. Rodar como postgres, só com decisão explícita.
-- ═══════════════════════════════════════════════════════════════════════════
-- Passo 0 (fora da transação, efeito imediato): ninguém mais entra como rastro_app
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'rastro_app') then
    alter role rastro_app nologin;
  end if;
end $$;

begin;
-- encerra sessões abertas da role antes de removê-la
select pg_terminate_backend(pid) from pg_stat_activity where usename = 'rastro_app';
drop schema if exists rastro cascade;
drop role if exists rastro_app;
drop role if exists rastro_user;
commit;
