-- Desfaz a 0006: devolve lab_reset e lab_purge_expired exatamente à versão da 0005.
-- Aborta se ainda houver gasto de anúncios simulado em algum laboratório (a versão antiga não saberia apagá-lo):
-- zere os laboratórios pelo botão antes de desfazer.
begin;
do $$
begin
  if exists (select 1 from rastro.ad_insights_daily a join rastro.workspaces w on w.id = a.workspace_id where w.kind = 'sandbox') then
    raise exception 'há gasto de anúncios simulado em laboratório: zere os laboratórios antes de desfazer a 0006';
  end if;
end $$;

create or replace function rastro.lab_reset(p_ws uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; c integer;
begin
  if not exists (
    select 1 from rastro.workspaces w join rastro.workspace_members m on m.workspace_id = w.id
    where w.id = p_ws and w.kind = 'sandbox' and m.user_id = rastro.current_user_id() and m.role = 'owner'
  ) then
    raise exception 'só é possível zerar um laboratório próprio';
  end if;
  delete from rastro.events e using rastro.workspaces w where e.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  get diagnostics c = row_count; n := n + c;
  delete from rastro.sessions s using rastro.workspaces w where s.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  get diagnostics c = row_count; n := n + c;
  delete from rastro.webhook_events x using rastro.workspaces w where x.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  get diagnostics c = row_count; n := n + c;
  delete from rastro.orders o using rastro.workspaces w where o.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  get diagnostics c = row_count; n := n + c;
  delete from rastro.integration_daily_stats d using rastro.workspaces w where d.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  get diagnostics c = row_count; n := n + c;
  update rastro.integrations i set last_event_at = null, last_received_at = null, last_error = null
  from rastro.workspaces w where i.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  return n;
end $$;

create or replace function rastro.lab_purge_expired(p_days integer default 7) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_cut timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 7), 7), 3650));
  n integer := 0; c integer;
begin
  delete from rastro.events e using rastro.workspaces w
  where e.workspace_id = w.id and w.kind = 'sandbox' and e.received_at < v_cut;
  get diagnostics c = row_count; n := n + c;
  delete from rastro.sessions s using rastro.workspaces w
  where s.workspace_id = w.id and w.kind = 'sandbox' and s.created_at < v_cut;
  get diagnostics c = row_count; n := n + c;
  delete from rastro.webhook_events x using rastro.workspaces w
  where x.workspace_id = w.id and w.kind = 'sandbox' and x.received_at < v_cut;
  get diagnostics c = row_count; n := n + c;
  delete from rastro.orders o using rastro.workspaces w
  where o.workspace_id = w.id and w.kind = 'sandbox' and o.updated_at < v_cut;
  get diagnostics c = row_count; n := n + c;
  delete from rastro.integration_daily_stats d using rastro.workspaces w
  where d.workspace_id = w.id and w.kind = 'sandbox' and d.updated_at < v_cut;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

revoke execute on function rastro.lab_reset(uuid), rastro.lab_purge_expired(integer) from public;
grant execute on function rastro.lab_reset(uuid) to rastro_user;
grant execute on function rastro.lab_purge_expired(integer) to rastro_app;
delete from rastro.schema_migrations where version = '0006_lab_anuncios';
commit;
