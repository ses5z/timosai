/* TimosAI grafik modülü: TradingView Lightweight Charts (Apache 2.0, public/vendor). Veri bizim (ATK mumları).
   Üstte iki düğme: "Trend çizgisi" (TimosAI ATR trend: mavi yükseliş / kırmızı düşüş + yön dönüş işaretleri) ve
   "Seviyeler" (giriş/stop/hedef; varsayılan KAPALI). Fiyat biçimi coinin tickSz'ine göre. */
(function () {
  "use strict";
  const T = window.TimosAI;
  const LC = window.LightweightCharts;
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim() || "#999";
  const decimals = (tick) => (tick > 0 ? Math.max(0, Math.min(12, Math.round(-Math.log10(tick)))) : null);

  T.tvChart = function (el, instId, opts = {}) {
    if (!LC) { el.innerHTML = `<div class="empty">Grafik kütüphanesi yüklenemedi.</div>`; return { destroy() {} }; }
    let chart = null, bar = opts.bar || "15m", destroyed = false;
    let showTrend = opts.showTrend ?? (document.body.dataset.mode === "pro");
    let showLevels = opts.showLevels ?? false;
    const frames = opts.frames || ["15m", "1H", "4H"];
    const wrap = document.createElement("div");
    wrap.className = "tv-wrap";
    wrap.innerHTML = `<div class="chart-tools">
        <div class="tf ${opts.timeframes ? "" : "pro-only"}" role="group" aria-label="Zaman aralığı">${frames.map((b) => `<button type="button" class="chip" data-bar="${b}" aria-pressed="${b === bar}">${{ "15m": "15 dk", "1H": "1 sa", "4H": "4 sa", "1D": "1 g" }[b]}</button>`).join("")}</div>
        <div class="tf" role="group" aria-label="Grafik katmanları">
          <button type="button" class="chip" data-layer="trend" aria-pressed="${showTrend}">Trend çizgisi</button>
          <button type="button" class="chip" data-layer="levels" aria-pressed="${showLevels}">Seviyeler</button>
        </div></div>
      <p class="chart-legend" ${showTrend ? "" : "hidden"}><span class="lg-dot" style="background:#4f8cff"></span><span class="lg-dot" style="background:#f06a66"></span><b>Trend çizgisi · TimosAI ATR</b>: fiyat çizginin üstündeyse mavi (yükseliş), altındaysa kırmızı (düşüş); oklar yön dönüşleri. Bu projede yazılmış ATR tabanlı iz süren çizgi.</p>
      <div class="tv-box" style="height:${opts.height || 260}px"></div><p class="faint chart-note"></p>`;
    el.innerHTML = "";
    el.append(wrap);
    const box = wrap.querySelector(".tv-box");
    wrap.querySelectorAll("[data-bar]").forEach((b) => b.addEventListener("click", () => { bar = b.dataset.bar; wrap.querySelectorAll("[data-bar]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); load(); }));
    wrap.querySelectorAll("[data-layer]").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.layer === "trend") showTrend = !showTrend; else showLevels = !showLevels;
      b.setAttribute("aria-pressed", String(b.dataset.layer === "trend" ? showTrend : showLevels));
      wrap.querySelector(".chart-legend").hidden = !showTrend;
      draw();
    }));

    let data = null;
    async function load() {
      try { data = await T.api(`/api/candles/${encodeURIComponent(instId)}?bar=${bar}`); } catch (e) { box.innerHTML = `<div class="empty">Mum verisi yok.</div>`; return; }
      if (!destroyed) draw();
    }
    function draw() {
      const d = data;
      if (!d) return;
      if (chart) { chart.remove(); chart = null; }
      const pro = document.body.dataset.mode === "pro";
      const prec = decimals(d.tickSz);
      const priceFormat = prec === null ? undefined : { type: "price", precision: prec, minMove: d.tickSz };
      chart = LC.createChart(box, {
        autoSize: true,
        layout: { background: { type: "solid", color: "transparent" }, textColor: css("--muted"), fontFamily: "system-ui, sans-serif" },
        grid: { vertLines: { color: "rgba(120,130,160,.18)" }, horzLines: { color: "rgba(120,130,160,.18)" } },
        rightPriceScale: { borderColor: "rgba(120,130,160,.4)" },
        timeScale: { borderColor: "rgba(120,130,160,.4)", timeVisible: true, secondsVisible: false },
        crosshair: { mode: 0 },
      });
      let main;
      if (pro || opts.candles) {
        main = chart.addSeries(LC.CandlestickSeries, { upColor: "#2fbf71", downColor: "#f06a66", borderVisible: false, wickUpColor: "#2fbf71", wickDownColor: "#f06a66", priceFormat });
        main.setData(d.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        const vol = chart.addSeries(LC.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" } });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        vol.setData(d.candles.map((c) => ({ time: c.time, value: c.vol, color: c.close >= c.open ? "rgba(47,191,113,.35)" : "rgba(240,106,102,.35)" })));
      } else {
        const acc = css("--amber");
        main = chart.addSeries(LC.AreaSeries, { lineColor: acc, topColor: acc + "47", bottomColor: acc + "00", lineWidth: 2, priceFormat });
        main.setData(d.candles.map((c) => ({ time: c.time, value: c.close })));
      }
      let markers = pro ? d.markers.slice() : [];
      if (showTrend) {
        const at = chart.addSeries(LC.LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat });
        at.setData(d.atrTrend.map((p) => ({ time: p.time, value: p.value, color: p.dir === 1 ? "#4f8cff" : "#f06a66" })));
        markers = markers.concat(d.trendFlips || []);
      }
      if (markers.length && LC.createSeriesMarkers) LC.createSeriesMarkers(main, markers.sort((a, b) => a.time - b.time));
      const L = opts.levels || d.levels;
      if (showLevels && L) {
        main.createPriceLine({ price: L.entry, color: "#d3c9b8", lineWidth: 1, lineStyle: 2, title: "giriş" });
        main.createPriceLine({ price: L.stop, color: "#f06a66", lineWidth: 1, lineStyle: 2, title: "stop" });
        main.createPriceLine({ price: L.target, color: "#2fbf71", lineWidth: 1, lineStyle: 2, title: "hedef" });
      }
      if (showLevels && d.position) main.createPriceLine({ price: d.position.entryPx, color: "#f2a93b", lineWidth: 2, lineStyle: 0, title: "pozisyon" });
      chart.timeScale().fitContent();
      wrap.querySelector(".chart-note").textContent = `${d.live ? "OKX ATK mumları" : "Örnek veri"}${d.tickSz ? ` · fiyat adımı ${d.tickSz}` : ""} · Grafik: TradingView Lightweight Charts`;
    }
    load();
    T.on("mode", () => draw());
    T.on("theme", () => draw());
    return { destroy() { destroyed = true; if (chart) chart.remove(); }, reload: load };
  };
})();
