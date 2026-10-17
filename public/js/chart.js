/* TimosAI grafik modülü: TradingView Lightweight Charts (Apache 2.0, public/vendor). Veri bizim (ATK mumları).
   Zaman aralığı: OKX'in 14 mum aralığı; favori satırı görünür, kalanlar "Diğer ▾" menüsünde (yıldızla favori).
   Seçim ?tf=4H ile URL'de ve sayfalar arası kalıcı. Sola kaydırınca eski mumlar yüklenir (önbellekli).
   Zaman ekseni Europe/Istanbul. Trend çizgisi (TimosAI ATR) seçili aralıkta, yüklenen tüm mumlarla yeniden hesaplanır.
   "Mentor işlemi": çok zaman dilimli kurulum kartı + grafikte seviyeler (grafik aralığından bağımsız). */
(function () {
  "use strict";
  const T = window.TimosAI;
  const LC = window.LightweightCharts;
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim() || "#999";
  const decimals = (tick) => (tick > 0 ? Math.max(0, Math.min(12, Math.round(-Math.log10(tick)))) : null);

  const BARS = ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "3D", "1W", "1M"];
  const LABEL = { "1m": "1dk", "3m": "3dk", "5m": "5dk", "15m": "15dk", "30m": "30dk", "1H": "1s", "2H": "2s", "4H": "4s", "6H": "6s", "12H": "12s", "1D": "1g", "3D": "3g", "1W": "1h", "1M": "1a" };
  const LONG = { "1m": "1 dakika", "3m": "3 dakika", "5m": "5 dakika", "15m": "15 dakika", "30m": "30 dakika", "1H": "1 saat", "2H": "2 saat", "4H": "4 saat", "6H": "6 saat", "12H": "12 saat", "1D": "1 gün", "3D": "3 gün", "1W": "1 hafta", "1M": "1 ay" };
  const DEF_FAV = { basic: ["15m", "1H", "4H", "1D", "1W"], pro: ["1m", "5m", "15m", "1H", "4H", "1D", "1W"] };
  const SEC = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1H": 3600, "2H": 7200, "4H": 14400, "6H": 21600, "12H": 43200, "1D": 86400, "3D": 259200, "1W": 604800, "1M": 2592000 };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* özel pencere: bellek içi kalır */ } },
  };
  const modeKey = () => (document.body.dataset.mode === "pro" ? "pro" : "basic");
  T.tfFavorites = function () {
    try {
      const v = JSON.parse(store.get(`timosai.tf.fav.${modeKey()}`) || "null");
      if (Array.isArray(v) && v.every((b) => BARS.includes(b))) return BARS.filter((b) => v.includes(b));
    } catch { /* bozuk kayıt: varsayılan */ }
    return DEF_FAV[modeKey()].slice();
  };
  T.setTfFavorites = (list) => store.set(`timosai.tf.fav.${modeKey()}`, JSON.stringify(list));
  /** Seçili aralık: önce URL ?tf=, sonra kayıt (sayfalar arası), sonra varsayılan. */
  T.currentTf = function (fallback = "15m") {
    const u = new URLSearchParams(location.search).get("tf");
    if (u && BARS.includes(u)) { store.set("timosai.tf", u); return u; } // paylaşılan bağlantı seçimi kalıcı yapar
    const s = store.get("timosai.tf");
    return s && BARS.includes(s) ? s : fallback;
  };
  T.setCurrentTf = function (bar) {
    store.set("timosai.tf", bar);
    const url = new URL(location.href);
    url.searchParams.set("tf", bar);
    history.replaceState(history.state, "", url);
  };
  T.BARS = BARS;
  T.activeChart = () => activeChart;
  T.TF_LABEL = LABEL;

  // İstanbul saatiyle eksen ve imleç etiketleri
  const fmt = (o) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", ...o });
  const F = {
    time: fmt({ hour: "2-digit", minute: "2-digit" }),
    day: fmt({ day: "numeric", month: "short" }),
    month: fmt({ month: "short", year: "2-digit" }),
    year: fmt({ year: "numeric" }),
    full: fmt({ day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    date: fmt({ day: "numeric", month: "short", year: "numeric" }),
  };
  T.istanbulTick = function (sec, type, bar) {
    const d = new Date(sec * 1000);
    if (type === 0) return F.year.format(d);
    if (type === 1) return F.month.format(d);
    if (type === 2) return F.day.format(d);
    return SEC[bar] >= 86400 ? F.day.format(d) : F.time.format(d);
  };

  /** TimosAI ATR trend (sunucudaki src/indicators/atrTrend.ts ile aynı formül). */
  T.atrTrend = function (c, period = 14, mult = 2) {
    const out = [];
    let prev = 0, dir = 1, line = 0;
    for (let i = 0; i < c.length; i++) {
      const tr = i === 0 ? c[i].high - c[i].low : Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close));
      prev = i < period ? (prev * i + tr) / (i + 1) : (prev * (period - 1) + tr) / period;
      const close = c[i].close, up = close - mult * prev, dn = close + mult * prev;
      if (i === 0) line = up;
      else if (dir === 1) { if (close < line) { dir = -1; line = dn; } else line = Math.max(line, up); }
      else if (close > line) { dir = 1; line = up; } else line = Math.min(line, dn);
      out.push({ time: c[i].time, value: line, dir });
    }
    return out;
  };

  const oldCache = new Map(); // `${instId}:${bar}` → eski mumlar (sola kaydırma önbelleği)
  let activeChart = null;

  // Pro: 1-7 tuşları favori aralıkları seçer (yazı alanındayken çalışmaz).
  document.addEventListener("keydown", (e) => {
    if (!activeChart || document.body.dataset.mode !== "pro" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 7) { const b = T.tfFavorites()[n - 1]; if (b) { e.preventDefault(); activeChart.setBar(b); } }
  });

  T.tvChart = function (el, instId, opts = {}) {
    if (!LC) { el.innerHTML = `<div class="empty">Grafik kütüphanesi yüklenemedi.</div>`; return { destroy() {} }; }
    let chart = null, main = null, trendSeries = null, volSeries = null, markersApi = null, destroyed = false;
    let bar = opts.fixedBar || T.currentTf(opts.bar || "15m");
    let showTrend = opts.showTrend ?? (document.body.dataset.mode === "pro");
    let setup = null, showSetup = false, setupLines = [];
    let d = null, all = [], loadingOld = false, end = false;
    const wrap = document.createElement("div");
    wrap.className = "tv-wrap";
    el.innerHTML = "";
    el.append(wrap);
    wrap.innerHTML = `<div class="chart-tools">
        <div class="tf tf-bars" role="group" aria-label="Zaman aralığı"></div>
        <div class="tf" role="group" aria-label="Grafik katmanları">
          <button type="button" class="chip" data-layer="trend" aria-pressed="${showTrend}">Trend çizgisi</button>
          ${opts.setup === false ? "" : `<button type="button" class="chip" data-layer="setup" aria-pressed="false">Mentor işlemi</button>`}
        </div></div>
      <p class="chart-legend" ${showTrend ? "" : "hidden"}><span class="lg-dot" style="background:#4f8cff"></span><span class="lg-dot" style="background:#f06a66"></span><span><b>Trend çizgisi · TimosAI ATR</b>: fiyat çizginin üstündeyse mavi (yükseliş), altındaysa kırmızı (düşüş); oklar yön dönüşleri.</span></p>
      <div class="tv-box" style="height:${opts.height || 260}px"></div><p class="faint chart-note"></p>
      <div class="setup-card" hidden></div>`;
    const box = wrap.querySelector(".tv-box");
    const tfEl = wrap.querySelector(".tf-bars");

    function renderBars() {
      const fav = T.tfFavorites();
      const rest = BARS.filter((b) => !fav.includes(b));
      const other = rest.includes(bar);
      tfEl.innerHTML = fav.map((b, i) => `<button type="button" class="chip" data-bar="${b}" aria-pressed="${b === bar}" title="${LONG[b]}${document.body.dataset.mode === "pro" ? ` (tuş ${i + 1})` : ""}">${LABEL[b]}</button>`).join("") +
        `<div class="tf-more"><button type="button" class="chip" data-more aria-haspopup="true" aria-expanded="false" aria-pressed="${other}">${other ? LABEL[bar] + " " : ""}Diğer ▾</button>
          <div class="tf-menu" role="menu" hidden>${BARS.map((b) => `<div class="tf-row" role="none"><button type="button" role="menuitemradio" aria-checked="${b === bar}" data-pick="${b}">${LONG[b]}</button><button type="button" class="tf-star" data-star="${b}" aria-pressed="${fav.includes(b)}" aria-label="${LONG[b]} favori">${fav.includes(b) ? "★" : "☆"}</button></div>`).join("")}</div></div>`;
      tfEl.querySelectorAll("[data-bar]").forEach((b) => b.addEventListener("click", () => setBar(b.dataset.bar)));
      const menu = tfEl.querySelector(".tf-menu"), more = tfEl.querySelector("[data-more]");
      more.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; more.setAttribute("aria-expanded", String(!menu.hidden)); });
      menu.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => setBar(b.dataset.pick)));
      menu.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const f = T.tfFavorites(), k = b.dataset.star;
        const next = f.includes(k) ? f.filter((x) => x !== k) : BARS.filter((x) => f.includes(x) || x === k);
        if (!next.length) return T.toast("En az bir favori aralık kalmalı.");
        T.setTfFavorites(next);
        renderBars();
        tfEl.querySelector(".tf-menu").hidden = false;
      }));
    }
    document.addEventListener("click", (e) => { if (!tfEl.contains(e.target)) { const m = tfEl.querySelector(".tf-menu"); if (m) m.hidden = true; } });

    function setBar(b) {
      if (!BARS.includes(b) || destroyed) return;
      bar = b;
      if (!opts.fixedBar) T.setCurrentTf(b);
      renderBars();
      load();
    }

    wrap.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.layer === "trend") {
        showTrend = !showTrend;
        b.setAttribute("aria-pressed", String(showTrend));
        wrap.querySelector(".chart-legend").hidden = !showTrend;
        applyData(false);
      } else {
        showSetup = !showSetup;
        b.setAttribute("aria-pressed", String(showSetup));
        if (showSetup) await loadSetup(); else { wrap.querySelector(".setup-card").hidden = true; drawSetupLines(); }
      }
    }));

    async function load() {
      activeChart = api;
      end = false;
      try { d = await T.api(`/api/candles/${encodeURIComponent(instId)}?bar=${bar}`); } catch { box.innerHTML = `<div class="empty">Mum verisi yok.</div>`; return; }
      if (destroyed) return;
      const old = oldCache.get(`${instId}:${bar}`) || [];
      const first = d.candles[0]?.time ?? Infinity;
      all = old.filter((c) => c.time < first).concat(d.candles);
      build();
    }

    function build() {
      if (chart) { chart.remove(); chart = null; }
      const pro = document.body.dataset.mode === "pro";
      const prec = decimals(d.tickSz);
      const priceFormat = prec === null ? undefined : { type: "price", precision: prec, minMove: d.tickSz };
      chart = LC.createChart(box, {
        autoSize: true,
        layout: { background: { type: "solid", color: "transparent" }, textColor: css("--muted"), fontFamily: "system-ui, sans-serif" },
        grid: { vertLines: { color: "rgba(120,130,160,.18)" }, horzLines: { color: "rgba(120,130,160,.18)" } },
        rightPriceScale: { borderColor: "rgba(120,130,160,.4)" },
        timeScale: { borderColor: "rgba(120,130,160,.4)", timeVisible: SEC[bar] < 86400, secondsVisible: false, tickMarkFormatter: (t, type) => T.istanbulTick(t, type, bar) },
        localization: { locale: "tr-TR", timeFormatter: (t) => (SEC[bar] >= 86400 ? F.date : F.full).format(new Date(t * 1000)) },
        crosshair: { mode: 0 },
      });
      if (pro || opts.candles) {
        main = chart.addSeries(LC.CandlestickSeries, { upColor: "#2fbf71", downColor: "#f06a66", borderVisible: false, wickUpColor: "#2fbf71", wickDownColor: "#f06a66", priceFormat });
        volSeries = chart.addSeries(LC.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      } else {
        const acc = css("--amber");
        main = chart.addSeries(LC.AreaSeries, { lineColor: acc, topColor: acc + "47", bottomColor: acc + "00", lineWidth: 2, priceFormat });
        volSeries = null;
      }
      trendSeries = chart.addSeries(LC.LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat });
      markersApi = LC.createSeriesMarkers ? LC.createSeriesMarkers(main, []) : null;
      setupLines = [];
      applyData(true);
      if (d.position) main.createPriceLine({ price: d.position.entryPx, color: "#f2a93b", lineWidth: 2, lineStyle: 0, title: "pozisyon" });
      drawSetupLines();
      chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 10) loadOlder(); });
      wrap.querySelector(".chart-note").textContent = `${d.live ? "OKX ATK mumları" : "Örnek veri"} · ${LONG[bar]} (OKX bar ${d.okxBar || bar}) · saatler İstanbul${d.tickSz ? ` · fiyat adımı ${d.tickSz}` : ""} · Grafik: TradingView Lightweight Charts`;
    }

    /** Seri verisini yükler; trend çizgisi seçili aralıkta tüm yüklü mumlarla yeniden hesaplanır. */
    function applyData(fit) {
      if (!chart) return;
      const pro = document.body.dataset.mode === "pro";
      if (volSeries) {
        main.setData(all.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        volSeries.setData(all.map((c) => ({ time: c.time, value: c.vol, color: c.close >= c.open ? "rgba(47,191,113,.35)" : "rgba(240,106,102,.35)" })));
      } else main.setData(all.map((c) => ({ time: c.time, value: c.close })));
      const cfg = d.atrCfg || { period: 14, mult: 2 };
      const at = T.atrTrend(all, cfg.period, cfg.mult);
      trendSeries.setData(showTrend ? at.map((p) => ({ time: p.time, value: p.value, color: p.dir === 1 ? "#4f8cff" : "#f06a66" })) : []);
      let markers = pro ? (d.markers || []).slice() : [];
      if (showTrend) markers = markers.concat(at.filter((p, i) => i > 0 && p.dir !== at[i - 1].dir).map((p) => ({ time: p.time, position: p.dir === 1 ? "belowBar" : "aboveBar", color: p.dir === 1 ? "#4f8cff" : "#f06a66", shape: p.dir === 1 ? "arrowUp" : "arrowDown", text: p.dir === 1 ? "yukarı" : "aşağı" })));
      if (markersApi) markersApi.setMarkers(markers.sort((a, b) => a.time - b.time));
      if (fit) chart.timeScale().fitContent();
    }

    async function loadOlder() {
      if (loadingOld || end || !all.length || destroyed) return;
      loadingOld = true;
      const key = `${instId}:${bar}`, myBar = bar;
      try {
        const r = await T.api(`/api/candles/${encodeURIComponent(instId)}?bar=${bar}&before=${all[0].time * 1000}`);
        if (myBar !== bar || destroyed) return;
        const older = r.candles.filter((c) => c.time < all[0].time);
        if (!older.length || r.end) end = true;
        if (older.length) {
          const range = chart.timeScale().getVisibleLogicalRange();
          all = older.concat(all);
          oldCache.set(key, all.slice(0, all.length - d.candles.length));
          applyData(false);
          if (range) chart.timeScale().setVisibleLogicalRange({ from: range.from + older.length, to: range.to + older.length });
        }
      } catch { end = true; } finally { loadingOld = false; }
    }

    async function loadSetup() {
      const card = wrap.querySelector(".setup-card");
      card.hidden = false;
      card.innerHTML = `<p class="faint">Mentor işlemi hesaplanıyor (15dk · 1s · 4s · 1g)…</p>`;
      try { setup = await T.api(`/api/setup/${encodeURIComponent(instId)}`); } catch (e) { card.innerHTML = `<p class="faint">Kurulum hesaplanamadı: ${T.esc(e.message)}</p>`; return; }
      card.innerHTML = T.setupCardHtml(setup);
      T.bindSetupCard(card, setup);
      drawSetupLines();
    }

    function drawSetupLines() {
      if (!main) return;
      setupLines.forEach((l) => { try { main.removePriceLine(l); } catch { /* grafik yenilendi */ } });
      setupLines = [];
      const s = setup;
      if (!showSetup || !s || !s.showLevels) return;
      const add = (price, color, title, style = 2) => setupLines.push(main.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, title }));
      add(s.entryZone[0], "#d3c9b8", "giriş bölgesi", 1);
      add(s.entryZone[1], "#d3c9b8", "", 1);
      add(s.stop, "#f06a66", `stop · ${s.stopType.startsWith("trend") ? "trend çizgisi" : "ATR"}`);
      add(s.target1, "#2fbf71", "hedef 1");
      add(s.target2, "#2fbf71", "hedef 2");
    }

    const api = { setBar, destroy() { destroyed = true; if (activeChart === api) activeChart = null; if (chart) chart.remove(); }, reload: load, get bar() { return bar; }, get count() { return all.length; } };
    renderBars();
    load();
    T.on("mode", () => { renderBars(); if (d) build(); });
    T.on("theme", () => { if (d) build(); });
    return api;
  };

  const fmtPx = (v) => (v === null || v === undefined ? "—" : Number(v).toLocaleString("tr-TR", { maximumSignificantDigits: 6 }));
  /** Mentor işlemi kartı (grafik ve Terminal sağ sütunu aynı biçimi kullanır). */
  T.setupCardHtml = function (s, compact = false) {
    const badges = `<div class="mtf" aria-label="Zaman dilimi trendleri">${s.frames.map((f) => `<span class="mtf-b ${f.dir}">${f.label} ${f.dir === "up" ? "↑" : f.dir === "down" ? "↓" : "→"}</span>`).join("")}</div>`;
    const head = `<div class="setup-head"><b>Mentor işlemi · ${T.esc(s.instId.split("-")[0])}</b>${s.direction ? `<span class="badge ${s.direction === "LONG" ? "badge-ok" : "badge-bad"}">${s.direction}</span>` : ""}<span class="faint">${T.esc(s.horizon)}</span></div>`;
    if (!s.showLevels) return `${head}${badges}<p class="setup-none">${T.esc(s.noTradeReason || "İşlem yok.")}</p>${s.shortNote ? `<p class="faint">${T.esc(s.shortNote)}</p>` : ""}<p class="setup-disc">${T.esc(s.disclaimer)}</p>`;
    const rows = [
      ["Giriş bölgesi", `${fmtPx(s.entryZone[0])} – ${fmtPx(s.entryZone[1])}`],
      ["Stop", `${fmtPx(s.stop)} <span class="faint">(${T.esc(s.stopType)})</span>`],
      ["Hedef 1", `${fmtPx(s.target1)} <span class="faint">(${s.rr1}R)</span>`],
      ["Hedef 2", `${fmtPx(s.target2)} <span class="faint">(${s.rr2}R)</span>`],
      ["R:R", `1 : ${s.rr2}`],
      ["Güven", T.esc(s.confidence)],
    ];
    return `${head}${badges}<dl class="setup-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${compact ? "" : `<ul class="setup-why">${s.reasons.map((r) => `<li>${T.esc(r)}</li>`).join("")}</ul><p class="faint setup-by">Gerekçe: ${T.esc(s.reasonsBy === "kod" ? "kural tabanlı" : s.reasonsBy)} · seviyeler kodla hesaplandı</p>`}
      <p class="setup-inv">${T.esc(s.invalidation)}</p>${s.shortNote ? `<p class="faint">${T.esc(s.shortNote)}</p>` : ""}
      <div class="setup-actions"><button type="button" class="btn" data-plan-add>Plana ekle</button></div>
      <p class="setup-disc">${T.esc(s.disclaimer)}</p>`;
  };
  T.bindSetupCard = function (card, s) {
    const b = card.querySelector("[data-plan-add]");
    if (!b) return;
    b.addEventListener("click", async () => {
      try {
        await T.api("/api/trading-plan/add", { method: "POST", body: { instId: s.instId } });
        T.toast(`${s.instId.split("-")[0]} plana eklendi. Ajan yalnızca plan koşulları sağlanırsa işlem açar.`);
        b.disabled = true;
        b.textContent = "Planda";
      } catch (e) { T.toast(e.message); }
    });
  };
})();
