-- Desfaz a 0004. Aborta se já existirem integrações de plataformas novas ou workspaces de laboratório
-- (para não apagar dados sem decisão explícita).
begin;
do $$
begin
  if exists (select 1 from rastro.integrations where provider not in ('kiwify', 'hotmart', 'mercadopago', 'meta', 'google', 'tiktok', 'whatsapp')) then
    raise exception 'há integrações de plataformas novas: remova-as antes do rollback';
  end if;
  if exists (select 1 from rastro.workspaces where kind <> 'production') then
    raise exception 'há workspaces de laboratório: remova-os antes do rollback';
  end if;
end $$;
drop table if exists rastro.integration_daily_stats;
alter table rastro.orders drop column if exists integration_id;
alter table rastro.integrations drop column if exists last_received_at;
alter table rastro.integrations drop constraint integrations_provider_check;
alter table rastro.integrations add constraint integrations_provider_check
  check (provider in ('kiwify', 'hotmart', 'mercadopago', 'meta', 'google', 'tiktok', 'whatsapp'));
revoke select (id, kind) on rastro.workspaces from rastro_app;
drop policy if exists a_ws_kind on rastro.workspaces;
drop trigger if exists workspaces_kind_immutable on rastro.workspaces;
drop function if exists rastro.workspaces_kind_immutable();
alter table rastro.workspaces drop column if exists kind;
delete from rastro.schema_migrations where version = '0004_multiplataforma';
commit;
