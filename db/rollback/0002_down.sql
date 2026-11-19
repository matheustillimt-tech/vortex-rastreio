-- Desfaz a 0002 (remove só as colunas novas; dados de sites/integrações permanecem).
begin;
drop function if exists rastro.set_signing_secret(uuid, text);
alter table rastro.integrations
  drop column if exists sync_started_at,
  drop column if exists last_event_at,
  drop column if exists has_signing_secret,
  drop column if exists signing_secret_rotated_at,
  drop column if exists signing_secret_previous_encrypted;
alter table rastro.sites
  drop column if exists updated_at,
  drop column if exists status;
delete from rastro.schema_migrations where version = '0002_sites_integracoes';
commit;
