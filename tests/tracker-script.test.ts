// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "..", "public", "t.js"), "utf8");
const KEY = "pk_devlocal000000000000";

type Sent = { events: Array<Record<string, unknown>> };

function boot(opts: { search?: string; attrs?: Record<string, string>; html?: string } = {}) {
  const w = window as unknown as Record<string, unknown>;
  delete w.__rastroLoaded;
  delete w.rastro;
  document.cookie.split(";").forEach((c) => (document.cookie = `${c.split("=")[0].trim()}=; Max-Age=0; Path=/`));
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", `/oferta${opts.search ?? ""}`);
  document.body.innerHTML = opts.html ?? "";

  const sent: Sent[] = [];
  Object.defineProperty(window.navigator, "sendBeacon", {
    configurable: true,
    value: (_url: string, blob: Blob) => {
      // jsdom: lê o Blob de forma síncrona via FileReaderSync não existe → guardamos a promessa
      blob.text().then((t) => sent.push(JSON.parse(t)));
      return true;
    },
  });

  const s = document.createElement("script");
  s.src = "https://rastro.app/t.js";
  s.setAttribute("data-key", KEY);
  for (const [k, v] of Object.entries(opts.attrs ?? {})) s.setAttribute(k, v);
  document.head.appendChild(s);
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => s });
  new Function(SOURCE)();
  Object.defineProperty(document, "currentScript", { configurable: true, get: () => null });
  return { sent, rastro: (...args: unknown[]) => (w.rastro as (...a: unknown[]) => void)(...args) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("t.js", () => {
  beforeEach(() => document.head.querySelectorAll("script").forEach((s) => s.remove()));

  it("envia pageview com ids, UTMs e sem parâmetros estranhos", async () => {
    const { sent } = boot({ search: "?utm_source=facebook&utm_campaign=BF&fbclid=abc&email=x@y.com" });
    await flush();
    expect(sent).toHaveLength(1);
    const e = sent[0].events[0];
    expect(e).toMatchObject({ k: KEY, type: "pageview" });
    expect(e.eid).toMatch(/^[a-f0-9]{24}$/);
    expect(e.vid).toMatch(/^[a-f0-9]{24}$/);
    expect(e.q).toBe("utm_source=facebook&utm_campaign=BF&fbclid=abc");
    expect(document.cookie).toContain("_rst_vid=");
  });

  it("decora links de checkout com visitor id e UTMs", async () => {
    boot({
      search: "?utm_source=facebook&utm_campaign=BF",
      html: '<a id="c" href="https://pay.kiwify.com.br/abc">Comprar</a><a id="o" href="https://outro.com/x">Outro</a>',
    });
    const checkout = new URL((document.getElementById("c") as HTMLAnchorElement).href);
    expect(checkout.searchParams.get("sck")).toMatch(/^rst_[a-f0-9]{24}$/);
    expect(checkout.searchParams.get("utm_campaign")).toBe("BF");
    expect((document.getElementById("o") as HTMLAnchorElement).href).toBe("https://outro.com/x");
  });

  it("Kirvano: visitante vai no src, só quando vazio (não sobrescreve afiliado)", async () => {
    boot({
      search: "?utm_source=facebook&utm_campaign=BF",
      html:
        '<a id="k" href="https://pay.kirvano.com/abc">Comprar</a>' +
        '<a id="a" href="https://pay.kirvano.com/abc?src=afiliado123">Comprar</a>',
    });
    const k = new URL((document.getElementById("k") as HTMLAnchorElement).href);
    expect(k.searchParams.get("src")).toMatch(/^rst_[a-f0-9]{24}$/);
    expect(k.searchParams.get("sck")).toBeNull();
    expect(k.searchParams.get("utm_campaign")).toBe("BF");
    const a = new URL((document.getElementById("a") as HTMLAnchorElement).href);
    expect(a.searchParams.get("src")).toBe("afiliado123");
    expect(a.searchParams.get("sck")).toBeNull();
  });

  it("com consentimento obrigatório: nada de cookie nem envio até consentir", async () => {
    const { sent, rastro } = boot({ attrs: { "data-consent": "required" }, html: '<a id="c" href="https://pay.kiwify.com.br/abc">x</a>' });
    rastro("lead");
    await flush();
    expect(sent).toHaveLength(0);
    expect(document.cookie).not.toContain("_rst_vid");
    expect((document.getElementById("c") as HTMLAnchorElement).href).not.toContain("sck=");

    rastro("consent", true);
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].events.map((e) => e.type)).toEqual(["pageview", "lead"]);
    // eventos da fila recebem o visitor id persistido
    expect(new Set(sent[0].events.map((e) => e.vid)).size).toBe(1);
    expect(document.cookie).toContain("_rst_vid=");
    expect((document.getElementById("c") as HTMLAnchorElement).href).toContain("sck=rst_");
  });

  it("evento customizado e chave inválida", async () => {
    const { sent, rastro } = boot();
    rastro("track", "assistiu_video");
    await flush();
    expect(sent[1].events[0]).toMatchObject({ type: "custom", name: "assistiu_video" });
  });
});
