-- SÓ PARA BANCO LOCAL. Usuário, workspace, site e integração Kiwify de desenvolvimento.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000aa', 'dev@local.test')
  on conflict do nothing;

insert into rastro.workspaces (id, name) values ('00000000-0000-4000-8000-000000000001', 'Workspace local')
  on conflict do nothing;
insert into rastro.workspace_members (workspace_id, user_id, role)
  values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', 'owner')
  on conflict do nothing;
insert into rastro.cost_settings (workspace_id) values ('00000000-0000-4000-8000-000000000001')
  on conflict do nothing;

insert into rastro.sites (id, workspace_id, name, public_key)
  values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', 'Site local', 'pk_devlocal000000000000')
  on conflict do nothing;

insert into rastro.integrations (id, workspace_id, provider, label, webhook_token_hash, config)
  values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'kiwify', 'Kiwify (local)',
          encode(sha256('dev-kiwify-token-local'::bytea), 'hex'), '{"allow_unsigned": true}')
  on conflict do nothing;
