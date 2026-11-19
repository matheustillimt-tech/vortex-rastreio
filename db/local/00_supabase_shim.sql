-- ═══════════════════════════════════════════════════════════════════════════
-- SÓ PARA BANCO LOCAL (PGlite) E TESTES. Nunca aplicar no Supabase.
-- Reproduz o mínimo do ambiente Supabase de que a migration depende, mais um
-- "outro sistema" no mesmo banco para provar que o Vórtex Rastreio não enxerga nem altera nada fora dele.
-- ═══════════════════════════════════════════════════════════════════════════

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- pior caso: privilégios padrão GLOBAIS concedendo tudo a anon/authenticated/service_role
alter default privileges grant all on tables to anon, authenticated, service_role;
alter default privileges grant all on functions to anon, authenticated, service_role;

-- outro sistema no mesmo banco (tabelas fictícias em public)
create table public.leads (id serial primary key, email text, created_at timestamptz default now());
alter table public.leads enable row level security;
create policy leads_auth on public.leads for select to authenticated using (true);
insert into public.leads (email) values ('outro-sistema@exemplo.com');
create table public.webhooks (id serial primary key, url text);
create function public.handle_new_user() returns trigger language plpgsql as $$ begin return new; end $$;
