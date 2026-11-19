-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — 0004 · workspaces de laboratório, integração de origem nos pedidos,
-- novas plataformas e contadores diários de saúde das integrações.
--
-- Tudo ADITIVO e só no schema rastro: o código já publicado continua funcionando
-- (colunas novas são opcionais; nenhuma coluna/constraint usada por ele muda de forma).
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
  if not exists (select 1 from rastro.schema_migrations where version = '0003_role_producao') then
    raise exception 'migration 0003 ausente';
  end if;
  if exists (select 1 from rastro.schema_migrations where version = '0004_multiplataforma') then
    raise exception '0004 já aplicada';
  end if;
end $$;

-- ───────────── tipo do workspace (produção x laboratório) ─────────────
alter table rastro.workspaces
  add column kind text not null default 'production' check (kind in ('production', 'sandbox'));

-- o tipo é definido na criação e nunca muda: dado de laboratório não vira dado de produção
create function rastro.workspaces_kind_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'o tipo do workspace (produção/laboratório) não pode ser alterado';
  end if;
  return new;
end $$;
create trigger workspaces_kind_immutable before update on rastro.workspaces
  for each row execute function rastro.workspaces_kind_immutable();
revoke execute on function rastro.workspaces_kind_immutable() from public;

grant select (kind) on rastro.workspaces to rastro_user;
-- o webhook precisa saber se a integração é de laboratório (evento de teste nunca vira venda em produção):
-- rastro_app lê só id e tipo dos workspaces, nada mais
create policy a_ws_kind on rastro.workspaces for select to rastro_app using (true);
grant select (id, kind) on rastro.workspaces to rastro_app;

-- ───────────── plataformas aceitas ─────────────
alter table rastro.integrations drop constraint integrations_provider_check;
alter table rastro.integrations add constraint integrations_provider_check check (provider in (
  'kiwify', 'kirvano', 'hotmart', 'perfectpay', 'payt', 'pagtrust', 'mercadopago',
  'meta', 'google', 'tiktok', 'whatsapp'
));

-- última requisição que chegou a uma integração conhecida (mesmo recusada); last_event_at = último VÁLIDO
alter table rastro.integrations add column last_received_at timestamptz;
grant select (last_received_at) on rastro.integrations to rastro_user;
grant update (last_received_at) on rastro.integrations to rastro_app;

-- ───────────── integração de origem de cada pedido ─────────────
-- (a unicidade continua (workspace, provider, external_id): ids de plataformas diferentes nunca colidem)
alter table rastro.orders add column integration_id uuid references rastro.integrations(id) on delete set null;
create index on rastro.orders (integration_id);

-- ───────────── contadores diários de saúde ─────────────
-- uma linha por integração e dia; atualizada por upsert no próprio webhook (1 escrita por evento)
create table rastro.integration_daily_stats (
  integration_id uuid not null references rastro.integrations(id) on delete cascade,
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  day date not null,
  received int not null default 0,
  processed int not null default 0,
  duplicates int not null default 0,
  ignored int not null default 0,
  failed int not null default 0,
  auth_failed int not null default 0,
  invalid int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (integration_id, day)
);
create index on rastro.integration_daily_stats (workspace_id, day desc);
alter table rastro.integration_daily_stats enable row level security;

create policy u_stats on rastro.integration_daily_stats for select to rastro_user using (rastro.is_member(workspace_id));
create policy a_stats on rastro.integration_daily_stats for all to rastro_app using (true) with check (true);

grant select on rastro.integration_daily_stats to rastro_user;
grant select, insert, update on rastro.integration_daily_stats to rastro_app;

-- blindagem: nada novo acessível às roles padrão do Supabase
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema rastro from %I', r);
      execute format('revoke all on all functions in schema rastro from %I', r);
    end if;
  end loop;
end $$;

insert into rastro.schema_migrations (version) values ('0004_multiplataforma');

commit;
