-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — 0002 · gestão de sites, token Kiwify com rotação, trava de sincronização Meta
-- Só altera tabelas do schema rastro (colunas novas + grants nas roles do Vórtex Rastreio).
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
  if not exists (select 1 from rastro.schema_migrations where version = '0001_rastro_init') then
    raise exception 'migration 0001 ausente';
  end if;
  if exists (select 1 from rastro.schema_migrations where version = '0002_sites_integracoes') then
    raise exception '0002 já aplicada';
  end if;
end $$;

-- ───────────── sites: ativar/desativar ─────────────
alter table rastro.sites
  add column status text not null default 'active' check (status in ('active', 'disabled')),
  add column updated_at timestamptz not null default now();

grant update (status, updated_at) on rastro.sites to rastro_user;

-- ───────────── integrações ─────────────
alter table rastro.integrations
  -- troca de token sem janela de falha: o anterior vale por 48 h (reenvios antigos da Kiwify)
  add column signing_secret_previous_encrypted text,
  add column signing_secret_rotated_at timestamptz,
  -- visível ao usuário sem expor o segredo
  add column has_signing_secret boolean generated always as (signing_secret_encrypted is not null) stored,
  -- último evento com assinatura válida (prova de que a autenticação funciona)
  add column last_event_at timestamptz,
  -- trava contra sincronização simultânea (Meta Ads)
  add column sync_started_at timestamptz;

grant select (has_signing_secret, signing_secret_rotated_at, last_event_at, sync_started_at) on rastro.integrations to rastro_user;
grant update (last_event_at, sync_started_at) on rastro.integrations to rastro_app;

-- Troca do token de assinatura: o atual vira "anterior" sem que o usuário precise (ou possa) LER segredos.
-- security definer + checagem explícita de admin do workspace; não devolve nenhum segredo.
create function rastro.set_signing_secret(p_integration uuid, p_encrypted text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  if p_encrypted is null or p_encrypted !~ '^v1\.' then
    raise exception 'segredo deve vir cifrado pela aplicação';
  end if;
  select workspace_id into v_ws from rastro.integrations where id = p_integration;
  if v_ws is null or not rastro.is_admin(v_ws) then
    return false;
  end if;
  update rastro.integrations set
    signing_secret_previous_encrypted = signing_secret_encrypted,
    signing_secret_rotated_at = case when signing_secret_encrypted is not null then now() end,
    signing_secret_encrypted = p_encrypted
  where id = p_integration;
  return true;
end $$;
revoke execute on function rastro.set_signing_secret(uuid, text) from public;
grant execute on function rastro.set_signing_secret(uuid, text) to rastro_user;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function rastro.set_signing_secret(uuid, text) from %I', r);
    end if;
  end loop;
end $$;

-- rastro_app grava insights por upsert; precisa de UPDATE nas colunas de métricas (já tinha via grant de tabela)

insert into rastro.schema_migrations (version) values ('0002_sites_integracoes');

commit;
