/* TimosAI ortak istemci: gezinme, SSE, uyarı penceresi, açıklama balonları, grafik yardımcıları. */
(function () {
  "use strict";
  const T = (window.TimosAI = window.TimosAI || {});
  const listeners = {};
  T.on = (type, fn) => (listeners[type] = listeners[type] || []).push(fn);
  const fire = (type, data) => (listeners[type] || []).forEach((fn) => { try { fn(data); } catch (e) { console.warn(e); } });

  // ---------- Yardımcılar ----------
  T.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  T.api = async (path, opts = {}) => {
    const r = await fetch(path, { method: opts.method || (opts.body ? "POST" : "GET"), headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || r.statusText);
    return data;
  };
  const nf = (d) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: d, maximumFractionDigits: d });
  T.fmt = {
    usd: (v, d = 2) => (v == null || isNaN(v) ? "-" : nf(d).format(v) + " USDT"),
    num: (v, d = 2) => (v == null || isNaN(v) ? "-" : nf(d).format(v)),
    signed: (v, d = 2) => (v == null || isNaN(v) ? "-" : (v > 0 ? "+" : "") + nf(d).format(v)),
    pct: (v, d = 2) => (v == null || isNaN(v) ? "-" : (v > 0 ? "+" : "") + nf(d).format(v) + "%"),
    price: (p) => {
      if (p == null || isNaN(p)) return "-";
      const d = p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : 8;
      return nf(d).format(p);
    },
    time: (ts) => new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    ago: (ts) => {
      const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      return s < 60 ? `${s} sn önce` : s < 3600 ? `${Math.round(s / 60)} dk önce` : `${Math.round(s / 3600)} sa önce`;
    },
    vol: (v) => (v >= 1e9 ? nf(1).format(v / 1e9) + " Mr" : v >= 1e6 ? nf(1).format(v / 1e6) + " Mn" : v >= 1e3 ? nf(0).format(v / 1e3) + " B" : nf(0).format(v)),
  };
  T.cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  /** Vadeli durum rozeti: renk yanında her zaman metin. */
  T.derivBadge = (d) => {
    if (!d || !d.available) return `<span class="badge badge-muted">vadeli veri yok</span>`;
    const cls = d.manipulation === "yüksek" ? "badge-bad" : d.manipulation === "orta" || d.crowded !== "dengeli" ? "badge-warn" : "badge-ok";
    return `<span class="badge ${cls}" title="Manipülasyon şüphesi: ${T.esc(d.manipulation)}">${T.esc(d.badge)}</span>`;
  };
  /** Vadeli durum kartı (Basit: tek rozet + ilk gerekçe; Ayrıntı: tüm sayılar). */
  T.derivCard = (d) => {
    if (!d || !d.available) return `<p class="kpi-small">Vadeli veri yok.</p>`;
    const s = d.snapshot, n = (v, k = 2) => (v == null ? "-" : Number(v).toFixed(k));
    return `<div class="view-box"><p style="margin:0 0 6px">${T.derivBadge(d)} <span class="kpi-small">Kalabalık taraf: <b>${T.esc(d.crowded)}</b> · Manipülasyon şüphesi: <b>${T.esc(d.manipulation)}</b></span></p>
      <ul class="cautions">${d.reasons.map((r) => `<li>${T.esc(r)}</li>`).join("")}</ul>
      <div class="detail-only kpi-small" style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">
        <span>${T.term("funding", "Funding")}</span><b class="num">${s.funding == null ? "-" : (s.funding * 100).toFixed(4) + "%"}</b>
        <span>${T.term("oi", "OI")}</span><b class="num">${s.oiUsd == null ? "-" : T.fmt.vol(s.oiUsd) + " USD"}</b>
        <span>OI değişimi 1 sa / 4 sa</span><b class="num">${n(s.oiDeltaPct1h)}% / ${n(s.oiDeltaPct4h)}%</b>
        <span>${T.term("ls", "Genel hesap oranı")}</span><b class="num">${n(s.lsAccount)}</b>
        <span>Üst trader oranı (hesap)</span><b class="num">${n(s.lsTopAccount)}</b>
        <span>Üst trader oranı (pozisyon)</span><b class="num">${n(s.lsTopPosition)}</b>
        <span>Taker alış / satış</span><b class="num">${s.takerBuy == null ? "-" : T.fmt.vol(s.takerBuy)} / ${s.takerSell == null ? "-" : T.fmt.vol(s.takerSell)}</b>
      </div>
      <p class="faint" style="font-size:.78rem;margin:8px 0 0">Funding ve OI: ATK. L/S ve taker hacmi: ${s.publicSource ? T.esc(s.publicSource) + " vadeli verisi (ATK dışı)" : "veri yok"}. Vadeli veri yalnızca analiz girdisidir; işlem spot.</p></div>`;
  };

  // ---------- İkonlar (sade SVG) ----------
  const P = {
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    send: '<path d="M4 12l16-8-6 16-2-7-8-1z"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    warn: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18v.5"/>',
    chart: '<path d="M4 19h16"/><path d="M6 15l4-5 3 3 5-7"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="4" rx="1.5"/><rect x="13" y="10" width="7" height="10" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/>',
    plane: '<path d="M21 4L3 11l6 2 2 6 3-4 4 3z"/><path d="M9 13l12-9"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
    volumeOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    star: '<path d="M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2 8 13.7 4 9.8l5.5-.8z"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  };
  T.icon = (name, cls = "icon") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;

  // ---------- Terim sözlüğü ----------
  T.TERMS = {
    rr: "R:R (ödül/risk): hedefe kadar olası kazancın, stopa kadar olası kayba oranı. 2 demek, 1 birim riske karşı 2 birim hedef demek.",
    atr: "ATR: ortalama gerçek aralık. Bir mumun tipik oynaklığı. Stop mesafesi buna göre ayarlanır.",
    funding: "Funding: vadeli piyasada long ve short taraflar arasındaki periyodik ödeme. Çok pozitifse kalabalık long işaretidir.",
    risk: "Risk skoru (0-100): günlük zarar, açık pozisyon büyüklüğü, emir temposu ve art arda kayıplardan hesaplanır. Yükselince ajan daha seçici olur; kimse kilitlenmez.",
    stop: "Stop: işlem aleyhe giderse zararı sınırlamak için önceden belirlenen çıkış fiyatı. Her girişte zorunludur.",
    opportunity: "Fırsat skoru (0-100): ivme, trend, hacim, RSI, oynaklık, funding ve haber duygusunun ağırlıklı ortalaması.",
    rsi: "RSI: 0-100 arası güç göstergesi. 70 üstü aşırı alım, 30 altı aşırı satım bölgesi sayılır.",
    breakeven: "Başa baş: stopu giriş fiyatına çekmek. Böylece işlem en kötü ihtimalle zararsız kapanır.",
    trailing: "İz süren stop: fiyat lehe ilerledikçe stopu da yukarı taşımak.",
    notional: "Büyüklük (notional): işlemin USDT cinsinden toplam değeri.",
    oi: "Open interest (OI): vadeli piyasada açık duran toplam pozisyon büyüklüğü. Fiyatla birlikte sert artışı kaldıraçlı hareket işaretidir.",
    ls: "Long/short (L/S) oranı: long pozisyondaki hesapların short olanlara oranı. 1'in çok üstü long kalabalığı demektir. Üst trader oranı en büyük hesapların oranıdır.",
    fdv: "FDV: tüm arz dolaşımda olsaydı piyasa değeri. FDV/piyasa değeri oranı yüksekse ileride arz açılımı baskısı olabilir.",
    kuru: "KURU ÇALIŞMA: emirler borsaya gitmez; canlı fiyatla kâğıt üzerinde simüle edilir.",
  };
  T.term = (key, label) => `<span class="term">${T.esc(label)}<button type="button" class="term-btn" data-term="${key}" aria-label="${T.esc(label)} nedir?" aria-expanded="false">?</button></span>`;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".term-btn");
    document.querySelectorAll(".term-tip").forEach((t) => { if (!btn || t.previousElementSibling !== btn) { t.previousElementSibling?.setAttribute("aria-expanded", "false"); t.remove(); } });
    if (!btn) return;
    if (btn.getAttribute("aria-expanded") === "true") { btn.setAttribute("aria-expanded", "false"); btn.nextElementSibling?.remove(); return; }
    const tip = document.createElement("span");
    tip.className = "term-tip";
    tip.setAttribute("role", "tooltip");
    tip.id = "tip-" + Math.random().toString(36).slice(2, 8);
    tip.textContent = T.TERMS[btn.dataset.term] || "";
    btn.after(tip);
    btn.setAttribute("aria-expanded", "true");
    btn.setAttribute("aria-describedby", tip.id);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".term-tip").forEach((t) => { t.previousElementSibling?.setAttribute("aria-expanded", "false"); t.remove(); }); });

  // ---------- Basit / Ayrıntı ----------
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  T.store = store;
  document.body.dataset.detail = store.get("tms-detail") || "simple";
  T.detailToggle = () => `<div class="segment" role="group" aria-label="Görünüm"><button type="button" data-detail="simple" aria-pressed="${document.body.dataset.detail === "simple"}">Basit</button><button type="button" data-detail="detail" aria-pressed="${document.body.dataset.detail === "detail"}">Ayrıntı</button></div>`;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-detail]");
    if (!b || b.tagName !== "BUTTON") return;
    document.body.dataset.detail = b.dataset.detail;
    store.set("tms-detail", b.dataset.detail);
    document.querySelectorAll("[data-detail]").forEach((x) => x.tagName === "BUTTON" && x.setAttribute("aria-pressed", String(x.dataset.detail === b.dataset.detail)));
    fire("detail", b.dataset.detail);
  });

  // ---------- Gezinme + alt bilgi ----------
  const LINKS = [
    ["/", "Karşılama"],
    ["/kesfet", "Keşfet"],
    ["/mentor", "Mentor"],
    ["/panel", "Panel"],
    ["/isi-haritasi", "Isı haritası"],
    ["/telegram", "Telegram"],
    ["/hakkimizda", "Hakkımızda"],
  ];
  const here = location.pathname.replace(/\/$/, "") || "/";
  const links = LINKS.map(([h, t]) => `<li><a href="${h}"${h === here ? ' aria-current="page"' : ""}>${t}</a></li>`).join("");
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <a class="skip-link" href="#main">İçeriğe geç</a>
    <nav class="nav" aria-label="Ana gezinme">
      <a class="brand" href="/"><img src="/img/logo.svg" alt="" width="34" height="34"><span>TimosAI</span></a>
      <ul class="nav-links">${links}</ul>
      <div class="nav-right">
        <span id="mode-badge" class="badge badge-dry" title="Emirler borsaya gitmez">KURU ÇALIŞMA</span>
        <button class="menu-btn" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Menüyü aç">${T.icon("menu")}</button>
      </div>
    </nav>
    <div class="mobile-menu" id="mobile-menu"><ul>${links}</ul></div>
    <div class="ticker-strip" aria-hidden="true"><div class="ticker-track" id="ticker-track"></div></div>`;
  document.body.prepend(header);
  const menuBtn = header.querySelector(".menu-btn");
  menuBtn.addEventListener("click", () => {
    const m = header.querySelector("#mobile-menu");
    const open = !m.classList.contains("open");
    m.classList.toggle("open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
    menuBtn.setAttribute("aria-label", open ? "Menüyü kapat" : "Menüyü aç");
  });
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `<div class="row"><span id="footer-dry" class="badge badge-dry">KURU ÇALIŞMA</span><span>Gerçek piyasa verisi, sınırlı bakiye, yatırım tavsiyesi değildir.</span></div><div class="row" style="margin-top:6px"><span id="footer-data" class="faint"></span></div>`;
  document.body.append(footer);
  const toastWrap = document.createElement("div");
  toastWrap.className = "toast-wrap";
  toastWrap.setAttribute("role", "status");
  toastWrap.setAttribute("aria-live", "polite");
  document.body.append(toastWrap);
  T.toast = (msg, ms = 3200) => {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    toastWrap.append(t);
    setTimeout(() => t.remove(), ms);
  };

  // ---------- Fiyat dokusu ----------
  const tickerPrices = {};
  function renderTicker() {
    const items = Object.entries(tickerPrices).slice(0, 18).map(([id, v]) => `<span>${id.replace("-USDT", "")}<b>${T.fmt.price(v.p)}</b><em class="${T.cls(v.c)}">${T.fmt.pct(v.c)}</em></span>`).join("");
    const el = document.getElementById("ticker-track");
    if (el && items) el.innerHTML = items + items;
  }

  // ---------- Durum ----------
  T.status = null;
  async function refreshStatus() {
    try {
      const s = await T.api("/api/status");
      T.status = s;
      const dry = s.tradingMode === "KURU";
      const b = document.getElementById("mode-badge");
      b.textContent = dry ? "KURU ÇALIŞMA" : "GERÇEK İŞLEM";
      b.className = "badge " + (dry ? "badge-dry" : "badge-live");
      const fb = document.getElementById("footer-dry");
      fb.hidden = !dry;
      document.getElementById("footer-data").textContent = `${s.liveData ? "Canlı veri: OKX Agent Trade Kit" : "Canlı veri yok: örnek veri gösteriliyor"} · Mentor: ${s.mentor.ai ? "yapay zeka" : "kural tabanlı"}`;
      fire("status", s);
    } catch {}
  }
  refreshStatus();
  setInterval(refreshStatus, 15000);
  // fiyat şeridini ilk açılışta doldur (SSE fiyat akışını beklemeden)
  fetch("/api/candidates").then((r) => r.json()).then((list) => {
    if (!Array.isArray(list)) return;
    for (const c of list) if (!tickerPrices[c.instId]) tickerPrices[c.instId] = { p: c.price, c: c.change24hPct };
    renderTicker();
  }).catch(() => {});
  T.refreshStatus = refreshStatus;

  // ---------- Uyarı penceresi (tek düğme: Tamam) ----------
  const queue = [];
  let open = false;
  T.showWarning = (w) => { queue.push(w); if (!open) next(); };
  function next() {
    const w = queue.shift();
    if (!w) { open = false; return; }
    open = true;
    const prevFocus = document.activeElement;
    const bd = document.createElement("div");
    bd.className = "modal-backdrop";
    const items = (w.items || []).map((i) => `<li><span>${T.esc(i.label)}</span><b class="num">${T.esc(i.value)}</b>${i.limit && i.limit !== "-" ? `<small>Sınır: ${T.esc(i.limit)}</small>` : ""}</li>`).join("");
    bd.innerHTML = `<div class="modal modal-enter" role="alertdialog" aria-modal="true" aria-labelledby="mw-title" aria-describedby="mw-text">
      <h2 id="mw-title">${T.icon("warn")} ${T.esc(w.title)}</h2>
      <p id="mw-text">${T.esc(w.text)}</p>
      ${items ? `<ul>${items}</ul>` : ""}
      <p class="muted">Risk skoru: <b class="num">${T.esc(w.riskScore)}</b> / 100 ${T.term("risk", "")}</p>
      <div class="actions"><button type="button" class="btn btn-primary" data-ok>Tamam</button></div></div>`;
    document.body.append(bd);
    const ok = bd.querySelector("[data-ok]");
    ok.focus();
    const close = () => { bd.remove(); document.removeEventListener("keydown", onKey, true); prevFocus && prevFocus.focus && prevFocus.focus(); setTimeout(next, 150); };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") { e.preventDefault(); ok.focus(); } // odak pencerede kalır
    };
    document.addEventListener("keydown", onKey, true);
    ok.addEventListener("click", close);
  }

  // ---------- SSE ----------
  let es;
  function connect() {
    es = new EventSource("/api/stream");
    ["hello", "prices", "scan", "candidates", "positions", "event", "warning", "follows", "chat", "agent", "priority", "scenario", "pending", "telegram"].forEach((type) =>
      es.addEventListener(type, (ev) => {
        let data;
        try { data = JSON.parse(ev.data); } catch { return; }
        if (type === "prices") { Object.assign(tickerPrices, data); renderTicker(); }
        if (type === "warning") T.showWarning(data);
        fire(type, data);
      }),
    );
    es.onerror = () => { es.close(); if (!leaving) setTimeout(connect, 4000); };
  }
  let leaving = false;
  window.addEventListener("pagehide", () => { leaving = true; es && es.close(); });
  connect();

  // ---------- Grafik yardımcıları ----------
  T.sparkPath = (values, w, h, pad = 2) => {
    if (!values || values.length < 2) return "";
    const lo = Math.min(...values), hi = Math.max(...values), r = hi - lo || 1;
    return values.map((v, i) => `${i ? "L" : "M"}${(pad + (i / (values.length - 1)) * (w - pad * 2)).toFixed(1)},${(pad + (1 - (v - lo) / r) * (h - pad * 2)).toFixed(1)}`).join("");
  };
  T.spark = (values, w = 120, h = 36, color) => {
    const up = values && values.length > 1 && values[values.length - 1] >= values[0];
    const c = color || (up ? "var(--safe)" : "var(--risky)");
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" preserveAspectRatio="none"><path d="${T.sparkPath(values, w, h)}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  };
  /** Etkileşimli çizgi grafik. levels: [{v, label, color}] yatay çizgiler. */
  T.lineChart = (box, points, opts = {}) => {
    const w = box.clientWidth || 600, h = opts.height || 180, pad = { l: 8, r: 56, t: 10, b: 18 };
    if (!points || points.length < 2) { box.innerHTML = `<div class="empty">${opts.empty || "Grafik için henüz yeterli veri yok."}</div>`; return; }
    const vals = points.map((p) => p.v).concat((opts.levels || []).map((l) => l.v));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
    const x = (i) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
    const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const area = d + `L${x(points.length - 1).toFixed(1)},${h - pad.b}L${x(0)},${h - pad.b}Z`;
    const color = opts.color || "var(--amber)";
    const levels = (opts.levels || []).map((l) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(l.v)}" y2="${y(l.v)}" stroke="${l.color}" stroke-dasharray="5 4" stroke-width="1.4"/><text x="${w - pad.r + 4}" y="${y(l.v) + 4}" fill="${l.color}" font-size="11">${T.esc(l.label)}</text>`).join("");
    const gid = "g" + Math.random().toString(36).slice(2, 7);
    box.classList.add("chart-box");
    box.innerHTML = `<svg class="chart" viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img" aria-label="${T.esc(opts.label || "grafik")}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${gid})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>${levels}
      <text x="${w - pad.r + 4}" y="${pad.t + 8}" fill="var(--faint)" font-size="11">${T.esc((opts.fmt || T.fmt.price)(hi))}</text>
      <text x="${w - pad.r + 4}" y="${h - pad.b}" fill="var(--faint)" font-size="11">${T.esc((opts.fmt || T.fmt.price)(lo))}</text>
      <line class="cursor" x1="0" x2="0" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--cream-300)" stroke-width="1" opacity="0"/><circle class="cdot" r="4" fill="${color}" opacity="0"/></svg><div class="chart-tip" hidden></div>`;
    const svg = box.querySelector("svg"), tip = box.querySelector(".chart-tip"), cur = svg.querySelector(".cursor"), dot = svg.querySelector(".cdot");
    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const rel = ((clientX - r.left) / r.width) * w;
      const i = Math.max(0, Math.min(points.length - 1, Math.round(((rel - pad.l) / (w - pad.l - pad.r)) * (points.length - 1))));
      const p = points[i];
      cur.setAttribute("x1", x(i)); cur.setAttribute("x2", x(i)); cur.setAttribute("opacity", ".5");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(p.v)); dot.setAttribute("opacity", "1");
      tip.hidden = false;
      tip.style.left = (x(i) / w) * r.width + "px";
      tip.style.top = (y(p.v) / h) * r.height + "px";
      tip.textContent = `${(opts.fmt || T.fmt.price)(p.v)}${p.t ? " · " + new Date(p.t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : ""}`;
    };
    svg.addEventListener("pointermove", (e) => move(e.clientX));
    svg.addEventListener("pointerleave", () => { tip.hidden = true; cur.setAttribute("opacity", "0"); dot.setAttribute("opacity", "0"); });
  };

  /** Liste kaydırma konumunu koruyarak içerik yeniler. */
  T.renderKeep = (el, html) => {
    if (!el) return;
    const st = el.scrollTop;
    el.innerHTML = html;
    el.scrollTop = st;
  };

  T.gauge = (score) => {
    const s = Math.max(0, Math.min(100, score || 0));
    const c = s >= 70 ? "var(--risky)" : s >= 40 ? "var(--caution)" : "var(--safe)";
    const len = 2 * Math.PI * 40, off = len * (1 - s / 100);
    return `<svg viewBox="0 0 100 100" role="img" aria-label="Risk skoru ${s}"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--ink-600)" stroke-width="10"/><circle cx="50" cy="50" r="40" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${off}" transform="rotate(-90 50 50)" style="transition:stroke-dashoffset .6s ease"/><text x="50" y="57" text-anchor="middle" fill="var(--cream-100)" font-size="24" font-family="var(--font-display)">${Math.round(s)}</text></svg>`;
  };
})();
