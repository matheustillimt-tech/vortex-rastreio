/* eslint-disable @typescript-eslint/no-unused-vars -- catch(e) mantido por compatibilidade com navegadores antigos */
/*!
 * Vórtex Rastreio — script de rastreamento (sem dependências, ~4 KB). A função global se chama `rastro`.
 *
 * Instalação:
 *   <script async src="https://SEU-DOMINIO/t.js" data-key="pk_..."></script>
 *
 * Opções (atributos data-*):
 *   data-key               chave pública do site (obrigatória)
 *   data-endpoint          URL da coleta (padrão: mesma origem do script + /api/collect)
 *   data-consent="required" só grava cookie e envia eventos após rastro('consent', true)
 *   data-checkout-domains  domínios de checkout cujos links recebem o visitor id (separados por vírgula)
 *   data-auto-lead="true"  envia "lead" ao enviar formulário com campo de e-mail (o e-mail NÃO é enviado)
 *
 * API:
 *   rastro('lead') · rastro('initiate_checkout') · rastro('track', 'nome') · rastro('consent', true|false)
 */
(function (w, d) {
  "use strict";
  if (w.__rastroLoaded) return;
  w.__rastroLoaded = true;

  var script = d.currentScript || d.querySelector("script[data-key][src*='t.js']");
  if (!script) return;
  var KEY = script.getAttribute("data-key") || "";
  if (!/^pk_[A-Za-z0-9]{16,48}$/.test(KEY)) return;

  var ENDPOINT = script.getAttribute("data-endpoint") || new URL(script.src, w.location.href).origin + "/api/collect";
  var CONSENT_REQUIRED = script.getAttribute("data-consent") === "required";
  var AUTO_LEAD = script.getAttribute("data-auto-lead") === "true";
  var CHECKOUT_DOMAINS = (script.getAttribute("data-checkout-domains") ||
    "pay.kiwify.com.br,kiwify.app,pay.kirvano.com,pay.hotmart.com,go.hotmart.com,mercadopago.com.br")
    .split(",").map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  // checkouts que devolvem o visitante no `src` (a Kirvano não tem `sck`); os demais usam `sck`
  var SRC_DOMAINS = ["pay.kirvano.com"];

  var TRACKED = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "fbclid", "gclid", "ttclid", "campaign_id", "adset_id", "ad_id", "utm_id"];
  var PASS_TO_CHECKOUT = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var VID_COOKIE = "_rst_vid";
  var SESSION_KEY = "_rst_s";
  var ATTR_KEY = "_rst_attr";
  var SESSION_TIMEOUT = 30 * 60 * 1000;

  var consent = !CONSENT_REQUIRED || readStorage(w.localStorage, "_rst_consent") === "1";
  var queue = [];

  function rid() {
    var a = new Uint8Array(12);
    (w.crypto || w.msCrypto).getRandomValues(a);
    var s = "";
    for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
    return s;
  }
  function readStorage(store, k) { try { return store.getItem(k); } catch (e) { return null; } }
  function writeStorage(store, k, v) { try { store.setItem(k, v); } catch (e) { /* modo privado */ } }
  function readCookie(name) {
    var m = d.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(name, value, days) {
    var secure = w.location.protocol === "https:" ? "; Secure" : "";
    d.cookie = name + "=" + encodeURIComponent(value) + "; Max-Age=" + days * 86400 + "; Path=/; SameSite=Lax" + secure;
  }

  function trackedQuery(search) {
    var sp = new URLSearchParams(search);
    var out = new URLSearchParams();
    TRACKED.forEach(function (k) { var v = sp.get(k); if (v) out.set(k, v.slice(0, 300)); });
    return out.toString();
  }

  // visitor id: só persiste depois do consentimento (quando exigido)
  var memoryVid = null;
  function visitorId() {
    if (!consent) return memoryVid || (memoryVid = rid());
    var v = readCookie(VID_COOKIE) || readStorage(w.localStorage, VID_COOKIE) || memoryVid || rid();
    writeCookie(VID_COOKIE, v, 365);
    writeStorage(w.localStorage, VID_COOKIE, v);
    return v;
  }

  // sessão: expira após 30 min parada ou quando chegam novos parâmetros de campanha
  function session() {
    var now = Date.now();
    var q = trackedQuery(w.location.search);
    var raw = readStorage(w.sessionStorage, SESSION_KEY);
    var s = null;
    try { s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    if (!s || now - s.t > SESSION_TIMEOUT || (q && q !== s.q)) {
      s = { id: rid(), q: q, ref: d.referrer || null };
    }
    s.t = now;
    writeStorage(w.sessionStorage, SESSION_KEY, JSON.stringify(s));
    if (q) writeStorage(w.localStorage, ATTR_KEY, q);
    return s;
  }

  function send(events) {
    var body = JSON.stringify({ events: events });
    // text/plain = requisição simples (sem preflight CORS); o servidor faz o parse do JSON
    var blob = new Blob([body], { type: "text/plain" });
    if (w.navigator.sendBeacon && w.navigator.sendBeacon(ENDPOINT, blob)) return;
    if (w.fetch) w.fetch(ENDPOINT, { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "text/plain" } })["catch"](function () {});
  }

  function emit(type, name) {
    var s = session();
    var ev = {
      k: KEY, eid: rid(), vid: visitorId(), sid: s.id, type: type,
      url: w.location.href.split("#")[0], ref: s.ref, q: s.q || undefined, ts: Date.now()
    };
    if (name) ev.name = String(name).slice(0, 64);
    if (!consent) { if (queue.length < 20) queue.push(ev); return; }
    send([ev]);
  }

  function matches(host, list) {
    return list.some(function (dmn) { return host === dmn || host.slice(-dmn.length - 1) === "." + dmn; });
  }
  function isCheckout(href) {
    try {
      return matches(new URL(href, w.location.href).hostname.toLowerCase(), CHECKOUT_DOMAINS);
    } catch (e) { return false; }
  }

  // leva o visitor id (sck) e as UTMs até o checkout → o webhook devolve e ligamos a venda à sessão
  function decorate(a) {
    if (!consent || !a.href || !isCheckout(a.href)) return;
    try {
      var u = new URL(a.href, w.location.href);
      if (matches(u.hostname.toLowerCase(), SRC_DOMAINS)) {
        // `src` também é usado por afiliados e campanhas: só preenche se estiver vazio
        if (!u.searchParams.get("src")) u.searchParams.set("src", "rst_" + visitorId());
      } else {
        u.searchParams.set("sck", "rst_" + visitorId());
      }
      var stored = new URLSearchParams(readStorage(w.localStorage, ATTR_KEY) || "");
      PASS_TO_CHECKOUT.forEach(function (k) {
        var v = stored.get(k);
        if (v && !u.searchParams.get(k)) u.searchParams.set(k, v);
      });
      a.href = u.toString();
    } catch (e) { /* href inválido */ }
  }
  function decorateAll() {
    var links = d.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) decorate(links[i]);
  }

  function api(cmd, arg) {
    if (cmd === "consent") {
      consent = arg === true;
      writeStorage(w.localStorage, "_rst_consent", consent ? "1" : "0");
      if (consent) {
        var pending = queue.splice(0);
        if (pending.length) {
          var vid = visitorId();
          pending.forEach(function (e) { e.vid = vid; });
          send(pending);
        }
        decorateAll();
      } else {
        queue = [];
        writeCookie(VID_COOKIE, "", 0);
        try { w.localStorage.removeItem(VID_COOKIE); w.localStorage.removeItem(ATTR_KEY); } catch (e) {}
      }
    } else if (cmd === "lead" || cmd === "initiate_checkout" || cmd === "pageview") {
      emit(cmd);
    } else if (cmd === "track") {
      emit("custom", arg);
    }
  }

  // processa chamadas feitas antes do script carregar
  var preQueue = (w.rastro && w.rastro.q) || [];
  w.rastro = function () { api.apply(null, arguments); };
  for (var i = 0; i < preQueue.length; i++) api.apply(null, preQueue[i]);

  emit("pageview");
  decorateAll();

  d.addEventListener("click", function (e) {
    var el = e.target;
    while (el && el.tagName !== "A") el = el.parentElement;
    if (el) {
      decorate(el);
      if (isCheckout(el.href)) emit("initiate_checkout");
    }
  }, true);

  if (AUTO_LEAD) {
    d.addEventListener("submit", function (e) {
      var form = e.target;
      if (form && form.querySelector && form.querySelector("input[type=email], input[name*=mail]")) emit("lead");
    }, true);
  }
})(window, document);
