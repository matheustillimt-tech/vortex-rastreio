-- Desfaz a 0005 (só funções). Workspaces de laboratório já criados continuam existindo;
-- para removê-los também, rode o rollback da 0004 depois de apagá-los conscientemente.
begin;
drop function if exists rastro.lab_purge_expired(integer);
drop function if exists rastro.lab_reset(uuid);
drop function if exists rastro.lab_ensure(text, text, text, text);
delete from rastro.schema_migrations where version = '0005_laboratorio';
commit;
