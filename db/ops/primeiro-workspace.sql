-- ═══════════════════════════════════════════════════════════════════════════
-- Vórtex Rastreio — cria o primeiro workspace + um site de teste. Rodar como postgres.
-- Gerado por: node scripts/primeiro-workspace.mjs --email <email> [--nome "Minha Empresa"]
-- (o script substitui __ADMIN_EMAIL__ e __WORKSPACE_NOME__ e valida os valores)
--
-- Garantias:
--  • só grava no schema rastro (workspace, 1 membro owner, custos padrão, 1 site);
--  • aborta se o e-mail não existir, não estiver confirmado ou já tiver workspace;
--  • o único membro é o administrador indicado;
--  • a chave pública do site é aleatória (122 bits) e UNIQUE no banco.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

create temp table _rastro_out (workspace_id uuid, site_id uuid, public_key text) on commit drop;

do $$
declare
  v_email text := lower('__ADMIN_EMAIL__');
  v_user uuid;
  v_confirmed timestamptz;
  v_ws uuid;
  v_site uuid;
  v_pk text := 'pk_' || replace(gen_random_uuid()::text, '-', '');
begin
  if (select count(*) from auth.users where lower(email) = v_email) <> 1 then
    raise exception 'usuário % não encontrado (ou duplicado) no Auth', v_email;
  end if;
  select id, email_confirmed_at into v_user, v_confirmed from auth.users where lower(email) = v_email;
  if v_confirmed is null then
    raise exception 'e-mail % ainda não confirmado', v_email;
  end if;
  if exists (select 1 from rastro.workspace_members where user_id = v_user) then
    raise exception 'usuário % já pertence a um workspace do Vórtex Rastreio', v_email;
  end if;

  v_ws := rastro.create_workspace(v_user, '__WORKSPACE_NOME__');
  insert into rastro.sites (workspace_id, name, public_key)
    values (v_ws, 'Site de teste', v_pk) returning id into v_site;

  if (select count(*) from rastro.workspace_members where workspace_id = v_ws) <> 1 then
    raise exception 'esperado exatamente 1 membro';
  end if;
  insert into _rastro_out values (v_ws, v_site, v_pk);
end $$;

select * from _rastro_out;
commit;
