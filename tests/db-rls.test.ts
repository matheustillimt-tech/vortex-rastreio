import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asUser } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrations";
import { DEFAULT_COSTS } from "@/lib/domain/types";
import { createKiwifyIntegration, getMembership, listIntegrations, loadWorkspaceData, updateCosts } from "@/lib/workspace/repo";
import { hostDb } from "./db-helpers";
describe("isolamento entre workspaces (RLS)", () => {
  let host: Awaited<ReturnType<typeof hostDb>>;
  const A = "00000000-0000-4000-8000-00000000000a";
  const B = "00000000-0000-4000-8000-00000000000b";
  const C = "00000000-0000-4000-8000-00000000000c"; // viewer do workspace A
  const STRANGER = "00000000-0000-4000-8000-0000000000ff"; // usuário de outro sistema do mesmo Supabase
  let wsA = "";
  let wsB = "";

  beforeAll(async () => {
    host = await hostDb();
    await migrate(host.sql);
    await host.sql.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}'), ('${STRANGER}')`);
    wsA = (await host.sql.query<{ id: string }>("select rastro.create_workspace($1, 'A') id", [A]))[0].id;
    wsB = (await host.sql.query<{ id: string }>("select rastro.create_workspace($1, 'B') id", [B]))[0].id;
    await host.sql.query("insert into rastro.workspace_members (workspace_id, user_id, role) values ($1, $2, 'viewer')", [wsA, C]);
    for (const [ws, ext] of [[wsA, "a1"], [wsB, "b1"], [wsB, "b2"]]) {
      await host.sql.query(
        `insert into rastro.orders (workspace_id, provider, external_id, status, status_rank, product_id, product_name, gross_cents,
          attribution_method, order_created_at, approved_at) values ($1, 'kiwify', $2, 'approved', 1, 'p', 'Produto', 1000, 'utm', now(), now())`,
        [ws, ext],
      );
    }
    await host.sql.query(
      "insert into rastro.integrations (workspace_id, provider, signing_secret_encrypted, credentials_encrypted) values ($1, 'kiwify', 'v1.segredo', 'v1.token')",
      [wsA],
    );
  });
  afterAll(() => host.pg.close());

  const ordersAs = (user: string, ws?: string) =>
    asUser(host.db, user, (tx) =>
      ws ? tx.query<{ external_id: string }>("select external_id from rastro.orders where workspace_id = $1", [ws]) : tx.query<{ external_id: string }>("select external_id from rastro.orders order by 1"),
    );

  it("cada usuário só vê os pedidos do próprio workspace", async () => {
    expect((await ordersAs(A)).map((r) => r.external_id)).toEqual(["a1"]);
    expect((await ordersAs(B)).map((r) => r.external_id)).toEqual(["b1", "b2"]);
    expect((await ordersAs(C)).map((r) => r.external_id)).toEqual(["a1"]);
  });

  it("pedir explicitamente outro workspace não devolve nada", async () => {
    expect(await ordersAs(A, wsB)).toEqual([]);
  });

  it("usuário de outro sistema (sem membership) não vê nada", async () => {
    expect(await ordersAs(STRANGER)).toEqual([]);
    expect(await getMembership(host.db, STRANGER)).toBeNull();
  });

  it("sem claims (role pura) não vê nada", async () => {
    const rows = await host.sql.transaction(async (tx) => {
      await tx.exec("set local role rastro_user");
      return tx.query("select * from rastro.orders");
    });
    expect(rows).toEqual([]);
  });

  it("dashboard carrega só dados do próprio workspace", async () => {
    const data = await loadWorkspaceData(host.db, A, wsA, "2000-01-01", "2100-01-01");
    expect(data.orders.map((o) => o.externalId)).toEqual(["a1"]);
    const leak = await loadWorkspaceData(host.db, A, wsB, "2000-01-01", "2100-01-01");
    expect(leak.orders).toEqual([]);
    expect(leak.hasAnyData).toBe(false);
  });

  it("custos: viewer não altera; owner altera só o próprio workspace", async () => {
    const c = { ...DEFAULT_COSTS, taxRateBps: 1234 };
    expect(await updateCosts(host.db, C, wsA, c)).toBe(false);
    expect(await updateCosts(host.db, A, wsB, c)).toBe(false);
    expect(await updateCosts(host.db, A, wsA, c)).toBe(true);
    const b = await host.sql.query<{ tax_rate_bps: number }>("select tax_rate_bps from rastro.cost_settings where workspace_id = $1", [wsB]);
    expect(b[0].tax_rate_bps).toBe(600);
  });

  it("segredos de integração nunca são legíveis pelo usuário", async () => {
    await expect(asUser(host.db, A, (tx) => tx.query("select signing_secret_encrypted from rastro.integrations"))).rejects.toThrow(/permission denied/);
    await expect(asUser(host.db, A, (tx) => tx.query("select * from rastro.integrations"))).rejects.toThrow(/permission denied/);
    expect(await listIntegrations(host.db, A, wsA)).toHaveLength(1);
    expect(await listIntegrations(host.db, B, wsA)).toHaveLength(0);
  });

  it("criar integração: owner sim (só hash no banco), viewer e outro workspace não", async () => {
    const { token } = await createKiwifyIntegration(host.db, A, wsA, "Teste");
    const stored = await host.sql.query<{ webhook_token_hash: string }>("select webhook_token_hash from rastro.integrations where label = 'Teste'");
    expect(stored[0].webhook_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored[0].webhook_token_hash).not.toContain(token);
    await expect(createKiwifyIntegration(host.db, C, wsA, "x")).rejects.toThrow(/row-level security/);
    await expect(createKiwifyIntegration(host.db, A, wsB, "x")).rejects.toThrow(/row-level security/);
  });

  it("usuário não grava pedidos nem eventos (só o servidor de ingestão)", async () => {
    await expect(
      asUser(host.db, A, (tx) =>
        tx.query(
          `insert into rastro.orders (workspace_id, provider, external_id, status, status_rank, product_id, product_name, gross_cents, attribution_method, order_created_at)
           values ($1, 'kiwify', 'forjado', 'approved', 1, 'p', 'p', 1, 'utm', now())`,
          [wsA],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(host.db, A, (tx) => tx.query("delete from rastro.orders"))).rejects.toThrow(/permission denied/);
  });

  it("rastro_app não lê membros nem apaga dados", async () => {
    await expect(asApp(host.db, (tx) => tx.query("select * from rastro.workspace_members"))).rejects.toThrow(/permission denied/);
    await expect(asApp(host.db, (tx) => tx.query("delete from rastro.orders"))).rejects.toThrow(/permission denied/);
  });

  it("trigger impede regressão de status mesmo com escrita direta", async () => {
    await asApp(host.db, (tx) => tx.query("update rastro.orders set status = 'refunded', status_rank = 2 where external_id = 'a1'"));
    await asApp(host.db, (tx) => tx.query("update rastro.orders set status = 'approved', status_rank = 1 where external_id = 'a1'"));
    const r = await host.sql.query<{ status: string }>("select status from rastro.orders where external_id = 'a1'");
    expect(r[0].status).toBe("refunded");
  });
});

