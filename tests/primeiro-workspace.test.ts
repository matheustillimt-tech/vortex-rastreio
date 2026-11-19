import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asUser, type Db, type SqlClient } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrations";
import { getMembership } from "@/lib/workspace/repo";

const TEMPLATE = readFileSync(join(process.cwd(), "db", "ops", "primeiro-workspace.sql"), "utf8");
const render = (email: string, nome = "Grupo Teste") => TEMPLATE.replaceAll("__ADMIN_EMAIL__", email).replaceAll("__WORKSPACE_NOME__", nome);

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const PENDENTE = "00000000-0000-4000-8000-0000000000a2";
const OUTRO = "00000000-0000-4000-8000-0000000000a3";

describe("SQL do primeiro workspace", () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    pg = new PGlite();
    const sql: SqlClient = {
      query: async (t, p) => (await pg.query(t, p as unknown[])).rows as never,
      exec: async (t) => void (await pg.exec(t)),
      transaction: (fn) =>
        pg.transaction((tx) =>
          fn({
            query: async (t, p) => (await tx.query(t, p as unknown[])).rows as never,
            exec: async (t) => void (await tx.exec(t)),
            transaction: (inner) => inner(sql),
          }),
        ),
    };
    await pg.exec(readFileSync(join(process.cwd(), "db", "local", "00_supabase_shim.sql"), "utf8"));
    await migrate(sql);
    await pg.exec(`insert into auth.users (id, email, email_confirmed_at) values
      ('${ADMIN}', 'Admin@Rastro.test', now()), ('${PENDENTE}', 'pendente@rastro.test', null), ('${OUTRO}', 'outro@rastro.test', now())`);
    db = { sql, kind: "pglite", assumeAppRole: true };
  });
  afterAll(() => pg.close());

  it("recusa e-mail inexistente e e-mail não confirmado, sem gravar nada", async () => {
    await expect(pg.exec(render("ninguem@rastro.test"))).rejects.toThrow(/não encontrado/);
    await pg.exec("rollback").catch(() => {});
    await expect(pg.exec(render("pendente@rastro.test"))).rejects.toThrow(/não confirmado/);
    await pg.exec("rollback").catch(() => {});
    expect((await pg.query("select count(*)::int n from rastro.workspaces")).rows[0]).toEqual({ n: 0 });
  });

  it("cria workspace com um único membro (owner) e site com chave exclusiva", async () => {
    const res = await pg.exec(render("admin@rastro.test")); // e-mail em caixa diferente do cadastro
    const out = res.find((r) => r.fields.some((f) => f.name === "public_key"))!.rows[0] as { workspace_id: string; public_key: string };
    expect(out.public_key).toMatch(/^pk_[a-f0-9]{32}$/);
    const members = await pg.query("select user_id, role from rastro.workspace_members where workspace_id = $1", [out.workspace_id]);
    expect(members.rows).toEqual([{ user_id: ADMIN, role: "owner" }]);
    expect((await pg.query("select count(*)::int n from rastro.cost_settings where workspace_id = $1", [out.workspace_id])).rows[0]).toEqual({ n: 1 });

    expect(await getMembership(db, ADMIN)).toMatchObject({ workspaceId: out.workspace_id, role: "owner", workspaceName: "Grupo Teste" });
    // outro usuário do mesmo Auth não vê nada
    expect(await getMembership(db, OUTRO)).toBeNull();
    const sites = await asUser(db, OUTRO, (tx) => tx.query("select * from rastro.sites"));
    expect(sites).toEqual([]);
  });

  it("não roda duas vezes para o mesmo administrador", async () => {
    await expect(pg.exec(render("admin@rastro.test"))).rejects.toThrow(/já pertence/);
    await pg.exec("rollback").catch(() => {});
    expect((await pg.query("select count(*)::int n from rastro.workspaces")).rows[0]).toEqual({ n: 1 });
  });

  it("chave pública é UNIQUE no banco", async () => {
    const pk = (await pg.query<{ public_key: string }>("select public_key from rastro.sites")).rows[0].public_key;
    const ws = (await pg.query<{ id: string }>("select id from rastro.workspaces")).rows[0].id;
    await expect(pg.query("insert into rastro.sites (workspace_id, name, public_key) values ($1, 'x', $2)", [ws, pk])).rejects.toThrow(/duplicate key/);
  });

  it("não toca no sistema vizinho", async () => {
    expect((await pg.query("select count(*)::int n from public.leads")).rows[0]).toEqual({ n: 1 });
  });
});
