-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — 0005 · laboratório de simulação.
--
-- Só funções no schema rastro (nenhuma tabela nova, nenhuma coluna alterada).
-- Tudo que apaga dados exige workspace kind = 'sandbox' (imutável desde a 0004):
-- nenhuma função daqui consegue tocar dado de workspace de produção.
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
  if not exists (select 1 from rastro.schema_migrations where version = '0004_multiplataforma') then
    raise exception 'migration 0004 ausente';
  end if;
  if exists (select 1 from rastro.schema_migrations where version = '0005_laboratorio') then
    raise exception '0005 já aplicada';
  end if;
end $$;

-- ───────────── abre (ou reaproveita) o laboratório do usuário ─────────────
-- Só quem já é DONO de um workspace de produção pode ter laboratório. O laboratório é um workspace
-- 'sandbox' separado, com o usuário como único dono, um site DESATIVADO (a coleta pública o recusa)
-- e integrações próprias. Chaves e tokens vêm prontos da aplicação (só hash/cifrado chegam aqui).
create function rastro.lab_ensure(
  p_site_key text, p_kiwify_token_hash text, p_kiwify_secret_encrypted text, p_kirvano_token_hash text
) returns table (workspace_id uuid, site_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := rastro.current_user_id();
  v_ws uuid;
  v_site uuid;
begin
  if v_user is null then raise exception 'sem usuário'; end if;
  if not exists (
    select 1 from rastro.workspace_members m join rastro.workspaces w on w.id = m.workspace_id
    where m.user_id = v_user and m.role = 'owner' and w.kind = 'production'
  ) then
    raise exception 'laboratório só para dono de workspace de produção';
  end if;
  if p_site_key !~ '^pk_lab[A-Za-z0-9]{16,40}$' or p_kiwify_token_hash !~ '^[a-f0-9]{64}$'
     or p_kirvano_token_hash !~ '^[a-f0-9]{64}$' or p_kiwify_secret_encrypted !~ '^v1\.' then
    raise exception 'parâmetros do laboratório inválidos';
  end if;

  select w.id into v_ws from rastro.workspaces w join rastro.workspace_members m on m.workspace_id = w.id
  where w.kind = 'sandbox' and m.user_id = v_user and m.role = 'owner' order by w.created_at limit 1;
  if v_ws is null then
    insert into rastro.workspaces (name, kind) values ('Laboratório — simulação', 'sandbox') returning id into v_ws;
    insert into rastro.workspace_members (workspace_id, user_id, role) values (v_ws, v_user, 'owner');
    insert into rastro.cost_settings (workspace_id) values (v_ws);
  end if;

  select s.id into v_site from rastro.sites s where s.workspace_id = v_ws and s.public_key = p_site_key;
  if v_site is null then
    insert into rastro.sites (workspace_id, name, public_key, allowed_origins, status)
    values (v_ws, 'Site simulado', p_site_key, '{}', 'disabled') returning id into v_site;
  end if;

  if not exists (select 1 from rastro.integrations i where i.workspace_id = v_ws and i.webhook_token_hash = p_kiwify_token_hash) then
    insert into rastro.integrations (workspace_id, provider, label, webhook_token_hash, signing_secret_encrypted)
    values (v_ws, 'kiwify', 'Kiwify simulada', p_kiwify_token_hash, p_kiwify_secret_encrypted);
  end if;
  if not exists (select 1 from rastro.integrations i where i.workspace_id = v_ws and i.webhook_token_hash = p_kirvano_token_hash) then
    insert into rastro.integrations (workspace_id, provider, label, webhook_token_hash)
    values (v_ws, 'kirvano', 'Kirvano simulada', p_kirvano_token_hash);
  end if;

  return query select v_ws, v_site;
end $$;

-- ───────────── zerar o laboratório (botão) ─────────────
-- Apaga só os DADOS (visitas, eventos, webhooks, pedidos, contadores) de um workspace sandbox do qual
-- o usuário é dono. Configuração (site, integrações) fica. Workspace de produção → erro.
create function rastro.lab_reset(p_ws uuid) returns integer
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

-- ───────────── limpeza automática (cron) ─────────────
-- Dados de QUALQUER laboratório com mais de p_days dias. Nunca toca workspace de produção.
-- Parâmetro inválido (nulo, zero, negativo, menor que 7) vira 7: nunca apaga simulação mais recente que isso.
-- Valores enormes são limitados a 10 anos (evita estouro de data).
create function rastro.lab_purge_expired(p_days integer default 7) returns integer
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

revoke execute on function rastro.lab_ensure(text, text, text, text), rastro.lab_reset(uuid), rastro.lab_purge_expired(integer) from public;
grant execute on function rastro.lab_ensure(text, text, text, text), rastro.lab_reset(uuid) to rastro_user;
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

insert into rastro.schema_migrations (version) values ('0005_laboratorio');

commit;
