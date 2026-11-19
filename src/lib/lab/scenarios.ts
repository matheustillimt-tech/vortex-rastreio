import { randomBytes } from "node:crypto";
import { adPerformance } from "@/lib/domain/metrics";
import type { AdInsightDaily } from "@/lib/domain/types";
import { brl } from "@/lib/format";
import { ingestEvents } from "@/lib/ingest/collect";
import { handleWebhook, simulateSandboxDelivery, type WebhookResult } from "@/lib/ingest/webhook";
import { hmacHex, sha256Hex } from "@/lib/security/crypto";
import type { CollectEvent } from "@/lib/tracking/event-schema";
import type { Site, Store } from "@/lib/store/types";
import type { Lab } from "./setup";

/**
 * Cenários do laboratório. Cada um usa o MESMO código de produção (coleta, adaptadores, autenticação,
 * deduplicação, atribuição) dentro do workspace sandbox, e compara o esperado com o encontrado.
 * Ids levam um prefixo por execução: rodar de novo não colide com rodadas anteriores.
 * Nenhuma chamada sai para plataformas externas.
 */

export interface Step {
  label: string;
  expected: string;
  found: string;
  pass: boolean;
}

export interface ScenarioResult {
  id: string;
  title: string;
  pass: boolean;
  steps: Step[];
  error?: string;
}

interface Ctx {
  store: Store;
  lab: Lab;
  site: Site;
  run: string;
  now: Date;
  /** visita com parâmetros de URL; devolve o id do visitante */
  visit(q: string, opts?: { types?: CollectEvent["type"][]; repeat?: boolean }): Promise<{ vid: string; inserted: number; duplicates: number }>;
  /** entrega Kiwify ASSINADA (HMAC oficial) pelo handler da rota pública, em processo */
  kiwify(body: object, opts?: { badSignature?: boolean }): Promise<WebhookResult>;
  /** entrega Kirvano por simulação interna autenticada (a rota pública continua recusando) */
  kirvano(body: object): Promise<WebhookResult>;
  /** entrega Kirvano pela rota pública (para provar que é recusada) */
  kirvanoPublic(body: object): Promise<WebhookResult>;
  order(provider: string, externalId: string): ReturnType<Store["getOrder"]>;
  /** o banco tem a 0006 (zerar/limpeza também apagam gasto simulado)? Sem ela, nenhum gasto é gravado */
  adsReady: boolean;
}

const step = (label: string, expected: unknown, found: unknown): Step => ({
  label,
  expected: String(expected),
  found: String(found),
  pass: String(expected) === String(found),
});

/** Data "YYYY-MM-DD HH:mm(:ss)" no horário de Brasília, como as plataformas enviam. */
function brasilia(d: Date, seconds = false): string {
  const s = new Date(d.getTime() - 3 * 3600_000).toISOString().replace("T", " ");
  return seconds ? s.slice(0, 19) : s.slice(0, 16);
}

function kiwifyBody(c: Ctx, over: Record<string, unknown> & { order_id: string }) {
  const at = brasilia(new Date(c.now.getTime() - 60_000));
  return {
    order_status: "paid",
    webhook_event_type: "order_approved",
    payment_method: "pix",
    created_at: at,
    approved_date: at,
    Product: { product_id: "lab-produto", product_name: "Produto simulado" },
    Commissions: { charge_amount: 19700, kiwify_fee: 1970, my_commission: 17730, currency: "BRL" },
    TrackingParameters: {},
    ...over,
  };
}

function kirvanoBody(c: Ctx, over: Record<string, unknown> & { sale_id: string }) {
  const at = brasilia(new Date(c.now.getTime() - 60_000), true);
  return {
    event: "SALE_APPROVED",
    checkout_id: `chk-${c.run}`,
    payment_method: "PIX",
    total_price: "R$ 1.169,80",
    type: "ONE_TIME",
    created_at: at,
    payment: { method: "PIX", finished_at: at },
    products: [
      { id: "lab-bump", name: "Bônus simulado", price: "R$ 97,00", is_order_bump: true },
      { id: "lab-kv", name: "Produto simulado Kirvano", price: "R$ 1.072,80", is_order_bump: false },
    ],
    utm: {},
    ...over,
  };
}

const kwEvent = (status: string, event: string) => ({ order_status: status, webhook_event_type: event });

interface Scenario {
  id: string;
  title: string;
  description: string;
  run(c: Ctx): Promise<Step[]>;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "visita-utm",
    title: "Visita com UTMs (Meta)",
    description: "Página vista com UTMs e click id da Meta; o mesmo evento chega duas vezes.",
    async run(c) {
      const v = await c.visit("utm_source=facebook&utm_medium=paid&utm_campaign=Lab%20Meta&fbclid=lab123&campaign_id=900001", { repeat: true });
      const s = (await c.store.sessionsForVisitor(c.lab.workspaceId, v.vid))[0];
      return [
        step("Sessão registrada", "1", (await c.store.sessionsForVisitor(c.lab.workspaceId, v.vid)).length),
        step("UTM de campanha guardada", "Lab Meta", s?.params.utm_campaign ?? "—"),
        step("Click id guardado", "lab123", s?.params.fbclid ?? "—"),
        step("Evento repetido descartado", "1 inserido, 1 duplicado", `${v.inserted} inserido, ${v.duplicates} duplicado`),
      ];
    },
  },
  {
    id: "lead-checkout",
    title: "Lead e início de checkout",
    description: "Visita seguida de cadastro (lead) e clique para o checkout.",
    async run(c) {
      const v = await c.visit("utm_source=google&utm_campaign=Lab%20Google&gclid=labg1", { types: ["pageview", "lead", "initiate_checkout"] });
      return [step("Eventos registrados (página, lead, checkout)", "3", v.inserted)];
    },
  },
  {
    id: "venda-aprovada",
    title: "Venda aprovada atribuída (Kiwify)",
    description: "Visita da Meta e venda aprovada com o visitante no sck.",
    async run(c) {
      const v = await c.visit("utm_source=facebook&utm_campaign=Lab%20Venda&fbclid=labv1&campaign_id=900002&ad_id=900009");
      const id = `lab-${c.run}-aprovada`;
      const r = await c.kiwify(kiwifyBody(c, { order_id: id, TrackingParameters: { sck: `rst_${v.vid}` } }));
      const o = await c.order("kiwify", id);
      return [
        step("Resposta do webhook", 200, r.status),
        step("Status do pedido", "approved", o?.status ?? "—"),
        step("Atribuição", "click_id · meta", `${o?.attributionMethod ?? "—"} · ${o?.platform ?? "—"}`),
        step("Campanha", "900002", o?.campaignId ?? "—"),
        step("Valor bruto", brl(19700), o ? brl(o.grossCents) : "—"),
      ];
    },
  },
  {
    id: "pix",
    title: "PIX gerado e depois pago",
    description: "Pedido nasce pendente (PIX gerado) e vira aprovado quando pago.",
    async run(c) {
      const id = `lab-${c.run}-pix`;
      await c.kiwify(kiwifyBody(c, { order_id: id, ...kwEvent("waiting_payment", "pix_created") }));
      const pending = await c.order("kiwify", id);
      await c.kiwify(kiwifyBody(c, { order_id: id }));
      const paid = await c.order("kiwify", id);
      return [step("Depois do PIX gerado", "pending", pending?.status ?? "—"), step("Depois do pagamento", "approved", paid?.status ?? "—")];
    },
  },
  {
    id: "recusada",
    title: "Compra recusada",
    description: "Cartão recusado: o pedido fica cancelado e não conta como venda.",
    async run(c) {
      const id = `lab-${c.run}-recusada`;
      await c.kiwify(kiwifyBody(c, { order_id: id, ...kwEvent("refused", "order_rejected") }));
      return [step("Status do pedido", "cancelled", (await c.order("kiwify", id))?.status ?? "—")];
    },
  },
  {
    id: "reembolso",
    title: "Reembolso",
    description: "Venda aprovada e depois reembolsada.",
    async run(c) {
      const id = `lab-${c.run}-reembolso`;
      await c.kiwify(kiwifyBody(c, { order_id: id }));
      await c.kiwify(kiwifyBody(c, { order_id: id, ...kwEvent("refunded", "order_refunded") }));
      const o = await c.order("kiwify", id);
      return [step("Status final", "refunded", o?.status ?? "—"), step("Data do reembolso registrada", "sim", o?.refundedAt ? "sim" : "não")];
    },
  },
  {
    id: "chargeback",
    title: "Chargeback",
    description: "Venda aprovada e depois contestada no cartão.",
    async run(c) {
      const id = `lab-${c.run}-chargeback`;
      await c.kiwify(kiwifyBody(c, { order_id: id }));
      await c.kiwify(kiwifyBody(c, { order_id: id, ...kwEvent("chargedback", "chargeback") }));
      return [step("Status final", "chargeback", (await c.order("kiwify", id))?.status ?? "—")];
    },
  },
  {
    id: "duplicado",
    title: "Webhook duplicado (3×)",
    description: "A plataforma reenvia a mesma entrega três vezes.",
    async run(c) {
      const id = `lab-${c.run}-duplicado`;
      const body = kiwifyBody(c, { order_id: id });
      const rs = [await c.kiwify(body), await c.kiwify(body), await c.kiwify(body)];
      const dup = rs.filter((r) => r.body.duplicate === true).length;
      return [
        step("Respostas", "200, 200, 200", rs.map((r) => r.status).join(", ")),
        step("Reconhecidas como duplicadas", "2", dup),
        step("Pedidos criados", "1", (await c.order("kiwify", id)) ? 1 : 0),
      ];
    },
  },
  {
    id: "fora-de-ordem",
    title: "Eventos fora de ordem",
    description: "O reembolso chega antes da aprovação; a aprovação atrasada não desfaz o reembolso.",
    async run(c) {
      const id = `lab-${c.run}-fora-de-ordem`;
      await c.kiwify(kiwifyBody(c, { order_id: id, ...kwEvent("refunded", "order_refunded") }));
      await c.kiwify(kiwifyBody(c, { order_id: id }));
      const o = await c.order("kiwify", id);
      return [step("Status final", "refunded", o?.status ?? "—"), step("Data de aprovação preservada", "sim", o?.approvedAt ? "sim" : "não")];
    },
  },
  {
    id: "assinatura-invalida",
    title: "Assinatura inválida",
    description: "Entrega com assinatura errada: recusada antes de gravar qualquer coisa.",
    async run(c) {
      const id = `lab-${c.run}-assinatura`;
      const r = await c.kiwify(kiwifyBody(c, { order_id: id }), { badSignature: true });
      return [step("Resposta", 401, r.status), step("Pedido criado", "não", (await c.order("kiwify", id)) ? "sim" : "não")];
    },
  },
  {
    id: "sem-origem",
    title: "Venda sem origem",
    description: "Venda sem visitante nem UTMs: fica como não atribuída (nada inventado).",
    async run(c) {
      const id = `lab-${c.run}-sem-origem`;
      await c.kiwify(kiwifyBody(c, { order_id: id }));
      return [step("Atribuição", "unattributed", (await c.order("kiwify", id))?.attributionMethod ?? "—")];
    },
  },
  {
    id: "utm-tiktok",
    title: "Venda só com UTMs (TikTok)",
    description: "Sem visitante identificado, mas com UTMs do TikTok no próprio pedido.",
    async run(c) {
      const id = `lab-${c.run}-tiktok`;
      await c.kiwify(kiwifyBody(c, { order_id: id, TrackingParameters: { utm_source: "tiktok", utm_campaign: "Lab TikTok" } }));
      const o = await c.order("kiwify", id);
      return [step("Atribuição", "utm · tiktok", `${o?.attributionMethod ?? "—"} · ${o?.platform ?? "—"}`)];
    },
  },
  {
    id: "kirvano-aprovada",
    title: "Kirvano: venda aprovada (simulação interna)",
    description: "Visita do Google e venda Kirvano com o visitante no src. A rota pública continua recusando a Kirvano.",
    async run(c) {
      const v = await c.visit("utm_source=google&utm_campaign=Lab%20Kirvano&gclid=labk1");
      const id = `lab-${c.run}-kv`;
      const body = kirvanoBody(c, { sale_id: id, utm: { src: `rst_${v.vid}`, utm_source: "google" } });
      const pub = await c.kirvanoPublic(body);
      const r = await c.kirvano(body);
      const o = await c.order("kirvano", id);
      return [
        step("Rota pública (sem autenticação oficial)", 401, pub.status),
        step("Simulação interna", 200, r.status),
        step("Status", "approved", o?.status ?? "—"),
        step("Valor (texto “R$ 1.169,80”)", brl(116980), o ? brl(o.grossCents) : "—"),
        step("Produto principal (não o order bump)", "Produto simulado Kirvano", o?.productName ?? "—"),
        step("Atribuição", "click_id · google", `${o?.attributionMethod ?? "—"} · ${o?.platform ?? "—"}`),
      ];
    },
  },
  {
    id: "kirvano-ciclo",
    title: "Kirvano: PIX, reembolso e aprovação atrasada",
    description: "PIX gerado, reembolso e uma aprovação que chega por último.",
    async run(c) {
      const id = `lab-${c.run}-kv-ciclo`;
      await c.kirvano(kirvanoBody(c, { sale_id: id, event: "PIX_GENERATED" }));
      const pending = await c.order("kirvano", id);
      await c.kirvano(kirvanoBody(c, { sale_id: id, event: "SALE_REFUNDED" }));
      await c.kirvano(kirvanoBody(c, { sale_id: id, event: "SALE_APPROVED" }));
      const dup = await c.kirvano(kirvanoBody(c, { sale_id: id, event: "SALE_APPROVED" }));
      return [
        step("Depois do PIX gerado", "pending", pending?.status ?? "—"),
        step("Status final", "refunded", (await c.order("kirvano", id))?.status ?? "—"),
        step("Reenvio reconhecido como duplicado", "sim", dup.body.duplicate === true ? "sim" : "não"),
      ];
    },
  },
  {
    id: "mesma-id",
    title: "Mesma id em duas plataformas",
    description: "Kiwify e Kirvano mandam o mesmo número de pedido: são dois pedidos separados.",
    async run(c) {
      const id = `lab-${c.run}-mesma-id`;
      await c.kiwify(kiwifyBody(c, { order_id: id }));
      await c.kirvano(kirvanoBody(c, { sale_id: id }));
      const kw = await c.order("kiwify", id);
      const kv = await c.order("kirvano", id);
      return [
        step("Pedido Kiwify", brl(19700), kw ? brl(kw.grossCents) : "—"),
        step("Pedido Kirvano", brl(116980), kv ? brl(kv.grossCents) : "—"),
        step("Integrações diferentes", "sim", kw?.integrationId && kv?.integrationId && kw.integrationId !== kv.integrationId ? "sim" : "não"),
      ];
    },
  },
];

/**
 * Gasto fictício de uma conta Meta: 1 campanha, 2 conjuntos, 3 anúncios, 7 dias até hoje.
 * Valores redondos para conferir de cabeça: por dia 30,00 · 15,00 · 10,00.
 */
export function labAdInsights(run: string, now: Date): AdInsightDaily[] {
  const c = { campaignId: `lab-${run}-c1`, campaignName: "Lab · Vendas Meta" };
  const ads = [
    { adsetId: `lab-${run}-s1`, adsetName: "Público frio", adId: `lab-${run}-a1`, adName: "Vídeo depoimento", spendCents: 3_000, impressions: 4_000, clicks: 80 },
    { adsetId: `lab-${run}-s1`, adsetName: "Público frio", adId: `lab-${run}-a2`, adName: "Imagem oferta", spendCents: 1_500, impressions: 3_000, clicks: 30 },
    { adsetId: `lab-${run}-s2`, adsetName: "Remarketing", adId: `lab-${run}-a3`, adName: "Carrossel", spendCents: 1_000, impressions: 1_000, clicks: 25 },
  ];
  const rows: AdInsightDaily[] = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(now.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    for (const a of ads) rows.push({ platform: "meta", accountId: "act_lab", date, ...c, ...a, platformPurchases: null });
  }
  return rows;
}

SCENARIOS.push({
  id: "anuncios-meta",
  title: "Gasto de anúncios × vendas (Meta)",
  description: "Grava 7 dias de gasto fictício (1 campanha, 2 conjuntos, 3 anúncios) e duas vendas vindas de anúncios diferentes.",
  async run(c) {
    if (!c.adsReady) return [step("Migration 0006 aplicada (necessária para gasto simulado)", "sim", "não")];
    const rows = labAdInsights(c.run, c.now);
    const saved = await c.store.saveSandboxAdInsights(c.lab.workspaceId, rows);
    const [a1, , a3] = [rows[0], rows[1], rows[2]];
    const q = (r: AdInsightDaily) => `utm_source=facebook&utm_medium=paid&utm_campaign=Lab%20Vendas%20Meta&fbclid=lab${c.run}&campaign_id=${r.campaignId}&adset_id=${r.adsetId}&ad_id=${r.adId}`;
    const v1 = await c.visit(q(a1));
    const v3 = await c.visit(q(a3));
    await c.kiwify(kiwifyBody(c, { order_id: `lab-${c.run}-ad1`, TrackingParameters: { sck: `rst_${v1.vid}` } }));
    await c.kiwify(kiwifyBody(c, { order_id: `lab-${c.run}-ad3`, TrackingParameters: { sck: `rst_${v3.vid}` } }));
    const o1 = await c.order("kiwify", `lab-${c.run}-ad1`);
    const o3 = await c.order("kiwify", `lab-${c.run}-ad3`);
    const orders = [o1, o3].filter((o) => o != null);
    const noCosts = { taxRateBps: 0, gatewayFeeBps: 0, costPerSaleCents: 0, fixedMonthlyCents: 0 };
    const ad = adPerformance(orders, rows, noCosts, "ad").find((r) => r.id === a1.adId);
    const adset = adPerformance(orders, rows, noCosts, "adset").find((r) => r.id === a1.adsetId);
    const camp = adPerformance(orders, rows, noCosts, "campaign")[0];
    return [
      step("Linhas de gasto gravadas no laboratório", rows.length, saved),
      step("Venda 1 atribuída ao anúncio", "Vídeo depoimento", o1?.adId === a1.adId ? "Vídeo depoimento" : (o1?.adId ?? "—")),
      step("Venda 2 atribuída ao anúncio", "Carrossel", o3?.adId === a3.adId ? "Carrossel" : (o3?.adId ?? "—")),
      step("Investimento do anúncio Vídeo depoimento (7 dias)", brl(21_000), ad ? brl(ad.spendCents) : "—"),
      step("ROAS do anúncio Vídeo depoimento", (19_700 / 21_000).toFixed(2), ad?.roas?.toFixed(2) ?? "—"),
      step("Conjunto Público frio: investimento e vendas", `${brl(31_500)} · 1`, adset ? `${brl(adset.spendCents)} · ${adset.approved}` : "—"),
      step("Campanha: investimento, vendas e CPA", `${brl(38_500)} · 2 · ${brl(19_250)}`, camp ? `${brl(camp.spendCents)} · ${camp.approved} · ${brl(camp.cpaCents == null ? null : Math.round(camp.cpaCents))}` : "—"),
    ];
  },
});

export function scenarioList() {
  return SCENARIOS.map(({ id, title, description }) => ({ id, title, description }));
}

/** Monta o contexto de execução. Exige que a integração Kirvano encontrada seja de workspace sandbox. */
async function context(store: Store, lab: Lab, now: Date, adsReady: boolean): Promise<Ctx> {
  const site: Site = { id: lab.siteId, workspaceId: lab.workspaceId, publicKey: lab.siteKey, allowedOrigins: [], status: "disabled" };
  const kirvanoIntegration = await store.findIntegrationByWebhookToken("kirvano", sha256Hex(lab.kirvanoToken));
  if (!kirvanoIntegration || kirvanoIntegration.workspaceId !== lab.workspaceId || kirvanoIntegration.workspaceKind !== "sandbox") {
    throw new Error("integração Kirvano do laboratório não encontrada no workspace sandbox");
  }
  const run = randomBytes(4).toString("hex");
  const id = () => randomBytes(12).toString("hex");
  return {
    store,
    lab,
    site,
    run,
    now,
    async visit(q, opts = {}) {
      const vid = id();
      const sid = id();
      const events: CollectEvent[] = (opts.types ?? ["pageview"]).map((type, i) => ({
        k: lab.siteKey,
        eid: id(),
        vid,
        sid,
        type,
        url: `https://simulacao.rastro.local/oferta?${q}`,
        ref: null,
        q,
        ts: now.getTime() - 3600_000 + i * 1000,
      }));
      if (opts.repeat) events.push({ ...events[0] });
      const r = await ingestEvents(store, site, events, now.getTime());
      return { vid, ...r };
    },
    kiwify(body, opts = {}) {
      const raw = JSON.stringify(body);
      const signature = hmacHex("sha1", opts.badSignature ? "assinatura-errada" : lab.kiwifySecret, raw);
      return handleWebhook({ store, provider: "kiwify", urlToken: lab.kiwifyToken, rawBody: raw, query: new URLSearchParams({ signature }), now });
    },
    kirvano(body) {
      return simulateSandboxDelivery({ store, provider: "kirvano", integration: kirvanoIntegration, rawBody: JSON.stringify(body), now });
    },
    kirvanoPublic(body) {
      return handleWebhook({ store, provider: "kirvano", urlToken: lab.kirvanoToken, rawBody: JSON.stringify(body), now });
    },
    order: (provider, externalId) => store.getOrder(lab.workspaceId, provider, externalId),
    adsReady,
  };
}

/** Roda um cenário (ou todos). Uma falha inesperada vira resultado "falhou", nunca exceção solta. */
export async function runScenarios(
  store: Store,
  lab: Lab,
  ids: string[] | "all",
  now = new Date(),
  opts: { adsReady?: boolean } = {},
): Promise<ScenarioResult[]> {
  const chosen = ids === "all" ? SCENARIOS : SCENARIOS.filter((s) => ids.includes(s.id));
  const c = await context(store, lab, now, opts.adsReady === true);
  const out: ScenarioResult[] = [];
  for (const s of chosen) {
    try {
      const steps = await s.run(c);
      out.push({ id: s.id, title: s.title, steps, pass: steps.length > 0 && steps.every((x) => x.pass) });
    } catch (err) {
      out.push({ id: s.id, title: s.title, steps: [], pass: false, error: err instanceof Error ? err.message : "erro desconhecido" });
    }
  }
  return out;
}
