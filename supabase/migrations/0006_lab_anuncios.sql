-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — 0006 · gasto de anúncios simulado no laboratório.
--
-- O laboratório passa a gravar gasto de anúncios fictício (ad_insights_daily) no workspace sandbox,
-- para testar campanhas, conjuntos e anúncios sem conta real. Esta migration só REESCREVE as duas
-- funções de limpeza da 0005 para que também apaguem esse gasto simulado. Nenhuma tabela nova,
-- nenhuma coluna alterada, nenhum grant novo. Todo DELETE continua exigindo workspace kind = 'sandbox'.
-- Aplicar com `supabase db push` (ou como postgres pelo SQL Editor), sempre depois da anterior.
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
  if not exists (select 1 from rastro.schema_migrations where version = '0005_laboratorio') then
    raise exception 'migration 0005 ausente';
  end if;
  if exists (select 1 from rastro.schema_migrations where version = '0006_lab_anuncios') then
    raise exception '0006 já aplicada';
  end if;
end $$;

-- ───────────── zerar o laboratório (botão) ─────────────
-- Igual à 0005, mais o gasto de anúncios simulado.
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
  delete from rastro.ad_insights_daily a using rastro.workspaces w where a.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  get diagnostics c = row_count; n := n + c;
  update rastro.integrations i set last_event_at = null, last_received_at = null, last_error = null
  from rastro.workspaces w where i.workspace_id = w.id and w.id = p_ws and w.kind = 'sandbox';
  return n;
end $$;

-- ───────────── limpeza automática (cron) ─────────────
-- Igual à 0005, mais o gasto de anúncios simulado gravado há mais de p_days dias.
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
  delete from rastro.ad_insights_daily a using rastro.workspaces w
  where a.workspace_id = w.id and w.kind = 'sandbox' and a.synced_at < v_cut;
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;

-- "create or replace" mantém os grants da 0005; reafirmados aqui por segurança.
revoke execute on function rastro.lab_reset(uuid), rastro.lab_purge_expired(integer) from public;
grant execute on function rastro.lab_reset(uuid) to rastro_user;
grant execute on function rastro.lab_purge_expired(integer) to rastro_app;

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all functions in schema rastro from %I', r);
    end if;
  end loop;
end $$;

insert into rastro.schema_migrations (version) values ('0006_lab_anuncios');

commit;
