-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — 0001 · schema próprio `rastro` (nome técnico do Vórtex Rastreio)
--
-- REGRAS DESTE ARQUIVO (não quebrar):
--  • Só cria objetos dentro do schema `rastro` + 2 roles próprias (rastro_app, rastro_user).
--  • Não altera public, auth, storage nem nenhum objeto existente. Não cria trigger em auth.users.
--  • Não concede nada a anon/authenticated/service_role: o schema fica FORA da Data API.
--  • Aplicar com `supabase db push` (ou pelo SQL Editor / psql como `postgres`), numa transação.
--    Além do controle da CLI, a versão fica registrada em rastro.schema_migrations.
--  • Funciona num projeto Supabase só seu ou num projeto que já tenha outras tabelas: nada fora do
--    schema rastro é tocado.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- O dono de tudo precisa ser postgres. Se a CLI do Supabase conectar com outra role de login
-- (membro de postgres), esta linha assume postgres só dentro desta transação.
set local role postgres;

-- ───────────────────────── roles próprias ─────────────────────────
-- rastro_app : login do servidor do Vórtex Rastreio (ingestão). Senha definida à parte, fora do git:
--              alter role rastro_app with password '<gerada>';
-- rastro_user: sem login; o servidor assume (SET LOCAL ROLE) para ler/configurar em nome de
--              um usuário, com RLS por workspace. Herda nada de authenticated.
-- Se já existir role com esses nomes, ABORTA: nunca reaproveitar role de outro sistema.
do $$
begin
  -- dono de tudo deve ser postgres (gerenciável pelo SQL Editor e pelo rollback)
  if current_user <> 'postgres' then
    raise exception 'execute como postgres (atual: %)', current_user;
  end if;
  if exists (select 1 from pg_roles where rolname in ('rastro_app', 'rastro_user')) then
    raise exception 'role rastro_app/rastro_user já existe neste projeto: abortando para não reaproveitar permissões alheias';
  end if;
  if exists (select 1 from pg_namespace where nspname = 'rastro') then
    raise exception 'schema rastro já existe neste projeto: abortando';
  end if;
end $$;

create role rastro_app login noinherit nocreatedb nocreaterole connection limit 10;
create role rastro_user nologin noinherit;

-- rastro_app pode virar rastro_user (para leituras com RLS), sem herdar os privilégios dele
grant rastro_user to rastro_app with inherit false, set true;

-- ───────────────────────── schema ─────────────────────────
create schema rastro;
revoke all on schema rastro from public;
grant usage on schema rastro to rastro_app, rastro_user;

create table rastro.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- quem é o usuário da requisição (mesmo GUC que o Supabase usa: request.jwt.claims)
create function rastro.current_user_id() returns uuid
language sql stable set search_path = '' as $$
  -- GUC vazio ('') acontece em conexão reaproveitada do pooler: tratar como "sem usuário"
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
$$;

-- ───────────────────────── workspaces e membros ─────────────────────────
create table rastro.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  timezone text not null default 'America/Sao_Paulo',
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now()
);

create table rastro.workspace_members (
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  -- só leitura de auth.users (FK); nada é escrito no schema auth
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on rastro.workspace_members (user_id);

create function rastro.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from rastro.workspace_members m
    where m.workspace_id = ws and m.user_id = rastro.current_user_id()
  );
$$;

create function rastro.is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from rastro.workspace_members m
    where m.workspace_id = ws and m.user_id = rastro.current_user_id() and m.role in ('owner', 'admin')
  );
$$;

-- ───────────────────────── sites e integrações ─────────────────────────
create table rastro.sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  public_key text not null unique check (public_key ~ '^pk_[A-Za-z0-9]{16,48}$'),
  allowed_origins text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index on rastro.sites (workspace_id);

create table rastro.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  provider text not null check (provider in ('kiwify', 'hotmart', 'mercadopago', 'meta', 'google', 'tiktok', 'whatsapp')),
  status text not null default 'active' check (status in ('active', 'paused', 'error', 'revoked')),
  label text check (label is null or char_length(label) <= 120),
  webhook_token_hash text unique check (webhook_token_hash is null or webhook_token_hash ~ '^[a-f0-9]{64}$'),
  -- cifrados pela aplicação (AES-256-GCM, chave fora do banco)
  signing_secret_encrypted text,
  credentials_encrypted text,
  config jsonb not null default '{}',
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index on rastro.integrations (workspace_id);

-- ───────────────────────── rastreamento ─────────────────────────
create table rastro.sessions (
  id text primary key,
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  site_id uuid not null references rastro.sites(id) on delete cascade,
  visitor_id text not null,
  started_at timestamptz not null,
  landing_path text not null,
  referrer_host text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  fbclid text, gclid text, ttclid text,
  campaign_id text, adset_id text, ad_id text,
  created_at timestamptz not null default now()
);
create index on rastro.sessions (workspace_id, visitor_id, started_at desc);

create table rastro.events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  site_id uuid not null references rastro.sites(id) on delete cascade,
  event_id text not null,
  visitor_id text not null,
  session_id text not null,
  type text not null check (type in ('pageview', 'lead', 'initiate_checkout', 'custom')),
  name text,
  path text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique (site_id, event_id)
);
create index on rastro.events (workspace_id, occurred_at desc);

-- ───────────────────────── pedidos ─────────────────────────
create table rastro.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  provider text not null,
  external_id text not null,
  status text not null check (status in ('pending', 'approved', 'cancelled', 'refunded', 'chargeback')),
  status_rank smallint not null,
  product_id text not null,
  product_name text not null,
  gross_cents bigint not null check (gross_cents >= 0),
  net_cents bigint,
  fee_cents bigint,
  currency char(3) not null default 'BRL',
  payment_method text,
  customer_email_hash text check (customer_email_hash is null or customer_email_hash ~ '^[a-f0-9]{64}$'),
  tracking jsonb not null default '{}',
  attribution_method text not null check (attribution_method in ('click_id', 'utm', 'estimated', 'unattributed')),
  platform text check (platform in ('meta', 'google', 'tiktok')),
  campaign_id text,
  campaign_name text,
  ad_id text,
  order_created_at timestamptz not null,
  approved_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);
create index on rastro.orders (workspace_id, order_created_at desc);

-- segunda trava (além da aplicação): status nunca regride, mesmo com escrita concorrente
create function rastro.orders_status_monotonic() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status_rank < old.status_rank then
    new.status := old.status;
    new.status_rank := old.status_rank;
    new.refunded_at := old.refunded_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger orders_status_monotonic before update on rastro.orders
  for each row execute function rastro.orders_status_monotonic();

-- ───────────────────────── webhooks (log + fila de reprocessamento) ─────────────────────────
create table rastro.webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  integration_id uuid not null references rastro.integrations(id) on delete cascade,
  provider text not null,
  dedupe_key text not null unique,
  payload jsonb not null,          -- já sem PII
  normalized jsonb,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  attempts int not null default 0,
  last_error text,
  next_retry_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on rastro.webhook_events (next_retry_at) where status = 'failed';

-- ───────────────────────── anúncios e custos ─────────────────────────
create table rastro.ad_insights_daily (
  workspace_id uuid not null references rastro.workspaces(id) on delete cascade,
  platform text not null check (platform in ('meta', 'google', 'tiktok')),
  account_id text not null,
  date date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  adset_id text,
  adset_name text,
  ad_id text not null default '',
  ad_name text,
  spend_cents bigint not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  platform_purchases numeric,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, platform, account_id, date, campaign_id, ad_id)
);

create table rastro.cost_settings (
  workspace_id uuid primary key references rastro.workspaces(id) on delete cascade,
  tax_rate_bps int not null default 600 check (tax_rate_bps between 0 and 10000),
  gateway_fee_bps int not null default 0 check (gateway_fee_bps between 0 and 10000),
  cost_per_sale_cents bigint not null default 0 check (cost_per_sale_cents >= 0),
  fixed_monthly_cents bigint not null default 0 check (fixed_monthly_cents >= 0),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── RLS ─────────────────────────
alter table rastro.schema_migrations enable row level security;
alter table rastro.workspaces enable row level security;
alter table rastro.workspace_members enable row level security;
alter table rastro.sites enable row level security;
alter table rastro.integrations enable row level security;
alter table rastro.sessions enable row level security;
alter table rastro.events enable row level security;
alter table rastro.orders enable row level security;
alter table rastro.webhook_events enable row level security;
alter table rastro.ad_insights_daily enable row level security;
alter table rastro.cost_settings enable row level security;

-- rastro_user: leitura do próprio workspace; configuração só para owner/admin
create policy u_ws on rastro.workspaces for select to rastro_user using (rastro.is_member(id));
create policy u_members on rastro.workspace_members for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_sites_r on rastro.sites for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_sites_w on rastro.sites for insert to rastro_user with check (rastro.is_admin(workspace_id));
create policy u_sites_u on rastro.sites for update to rastro_user using (rastro.is_admin(workspace_id)) with check (rastro.is_admin(workspace_id));
create policy u_int_r on rastro.integrations for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_int_w on rastro.integrations for insert to rastro_user with check (rastro.is_admin(workspace_id));
create policy u_int_u on rastro.integrations for update to rastro_user using (rastro.is_admin(workspace_id)) with check (rastro.is_admin(workspace_id));
create policy u_sessions on rastro.sessions for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_events on rastro.events for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_orders on rastro.orders for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_webhooks on rastro.webhook_events for select to rastro_user using (rastro.is_admin(workspace_id));
create policy u_insights on rastro.ad_insights_daily for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_costs_r on rastro.cost_settings for select to rastro_user using (rastro.is_member(workspace_id));
create policy u_costs_w on rastro.cost_settings for update to rastro_user using (rastro.is_admin(workspace_id)) with check (rastro.is_admin(workspace_id));

-- rastro_app: ingestão (script, webhooks, sync de anúncios). Escopo = só as tabelas abaixo.
create policy a_sites on rastro.sites for select to rastro_app using (true);
create policy a_int on rastro.integrations for select to rastro_app using (true);
create policy a_int_sync on rastro.integrations for update to rastro_app using (true) with check (true);
create policy a_sessions on rastro.sessions for all to rastro_app using (true) with check (true);
create policy a_events on rastro.events for all to rastro_app using (true) with check (true);
create policy a_orders on rastro.orders for all to rastro_app using (true) with check (true);
create policy a_webhooks on rastro.webhook_events for all to rastro_app using (true) with check (true);
create policy a_insights on rastro.ad_insights_daily for all to rastro_app using (true) with check (true);

-- ───────────────────────── grants (mínimos) ─────────────────────────
grant select on rastro.workspaces, rastro.workspace_members, rastro.sites, rastro.sessions, rastro.events,
  rastro.orders, rastro.webhook_events, rastro.ad_insights_daily, rastro.cost_settings to rastro_user;
grant insert (workspace_id, name, public_key, allowed_origins), update (name, allowed_origins) on rastro.sites to rastro_user;
-- integrações: rastro_user nunca LÊ as colunas de segredo; pode gravá-las (já cifradas pelo servidor)
grant select (id, workspace_id, provider, status, label, config, last_sync_at, last_error, created_at) on rastro.integrations to rastro_user;
grant insert (workspace_id, provider, label, webhook_token_hash, signing_secret_encrypted, credentials_encrypted, config),
  update (status, label, signing_secret_encrypted, credentials_encrypted, config) on rastro.integrations to rastro_user;
grant update (tax_rate_bps, gateway_fee_bps, cost_per_sale_cents, fixed_monthly_cents, updated_at) on rastro.cost_settings to rastro_user;

grant select on rastro.sites to rastro_app;
grant select, update (last_sync_at, last_error, status) on rastro.integrations to rastro_app;
grant select, insert, update on rastro.sessions, rastro.orders, rastro.webhook_events, rastro.ad_insights_daily to rastro_app;
grant select, insert on rastro.events to rastro_app;

grant execute on function rastro.current_user_id(), rastro.is_member(uuid), rastro.is_admin(uuid) to rastro_user, rastro_app;
revoke execute on function rastro.orders_status_monotonic() from public;

-- ───────────────────────── funções administrativas (só postgres) ─────────────────────────
-- onboarding explícito: sem trigger em auth.users, usuários de outros sistemas não ganham nada
create function rastro.create_workspace(p_owner uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  insert into rastro.workspaces (name) values (p_name) returning id into ws;
  insert into rastro.workspace_members (workspace_id, user_id, role) values (ws, p_owner, 'owner');
  insert into rastro.cost_settings (workspace_id) values (ws);
  return ws;
end $$;

-- LGPD: navegação expira em 13 meses; payload bruto de webhook esvaziado após 90 dias
create function rastro.purge_old_tracking_data() returns void
language sql security definer set search_path = '' as $$
  delete from rastro.events where occurred_at < now() - interval '13 months';
  delete from rastro.sessions where started_at < now() - interval '13 months';
  update rastro.webhook_events set payload = '{}'::jsonb
    where received_at < now() - interval '90 days' and payload <> '{}'::jsonb;
$$;

revoke execute on all functions in schema rastro from public;
grant execute on function rastro.current_user_id(), rastro.is_member(uuid), rastro.is_admin(uuid) to rastro_user, rastro_app;

-- ───────────────────────── blindagem contra privilégios padrão do projeto ─────────────────────────────
-- Se o projeto tiver ALTER DEFAULT PRIVILEGES globais para anon/authenticated/service_role,
-- os objetos acima teriam herdado grants. Removemos explicitamente.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema rastro from %I', r);
      execute format('revoke all on all sequences in schema rastro from %I', r);
      execute format('revoke all on all functions in schema rastro from %I', r);
      execute format('revoke all on schema rastro from %I', r);
    end if;
  end loop;
end $$;

insert into rastro.schema_migrations (version) values ('0001_rastro_init');

commit;
