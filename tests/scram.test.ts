import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { scramMatches, scramVerifier } from "../scripts/lib/scram.mjs";

describe("verificador SCRAM da senha da rastro_app", () => {
  it("gera o formato do Postgres e confere senha certa/errada", () => {
    const v = scramVerifier("pencil", { iterations: 4096, salt: Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64") });
    expect(v).toMatch(/^SCRAM-SHA-256\$4096:W22ZaJ0SNY7soEsUEjb6gQ==\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
    expect(scramMatches("pencil", v)).toBe(true);
    expect(scramMatches("pencil2", v)).toBe(false);
  });

  it("o Postgres guarda o verificador como está (não re-hasheia a string)", async () => {
    const pg = new PGlite();
    const v = scramVerifier("senha-de-teste-local");
    await pg.exec("create role r_test login");
    await pg.query(`alter role r_test with password '${v}'`);
    const r = await pg.query<{ ok: boolean }>("select rolpassword = $1 ok from pg_authid where rolname = 'r_test'", [v]);
    expect(r.rows[0].ok).toBe(true);
    await pg.close();
  }, 30_000);
});
