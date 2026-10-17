/* TimosAI grafik modülü: TradingView Lightweight Charts (Apache 2.0, public/vendor). Veri bizim (ATK mumları).
   Basic: fiyat çizgisi + giriş/stop/hedef. Pro: mumlar, hacim, ATR trend çizgisi, ajanın al/sat işaretleri, zaman aralığı. */
(function () {
  "use strict";
  const T = window.TimosAI;
  const LC = window.LightweightCharts;
  const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim() || "#999";

  T.tvChart = function (el, instId, opts = {}) {
    if (!LC) { el.innerHTML = `<div class="empty">Grafik kütüphanesi yüklenemedi.</div>`; return { destroy() {} }; }
    let chart = null, bar = opts.bar || "15m", destroyed = false;
    const wrap = document.createElement("div");
    wrap.innerHTML = `<div class="tf pro-only" role="group" aria-label="Zaman aralığı">${["15m", "1H", "4H"].map((b) => `<button type="button" class="chip" data-bar="${b}" aria-pressed="${b === bar}">${b === "15m" ? "15 dk" : b === "1H" ? "1 sa" : "4 sa"}</button>`).join("")}</div><div class="tv-box" style="height:${opts.height || 260}px"></div><p class="faint chart-note"></p>`;
    el.innerHTML = "";
    el.append(wrap);
    const box = wrap.querySelector(".tv-box");
    wrap.querySelectorAll("[data-bar]").forEach((b) => b.addEventListener("click", () => { bar = b.dataset.bar; wrap.querySelectorAll("[data-bar]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); load(); }));

    async function load() {
      let d;
      try { d = await T.api(`/api/candles/${encodeURIComponent(instId)}?bar=${bar}`); } catch (e) { box.innerHTML = `<div class="empty">Mum verisi yok.</div>`; return; }
      if (destroyed) return;
      if (chart) { chart.remove(); chart = null; }
      const pro = document.body.dataset.mode === "pro";
      chart = LC.createChart(box, {
        autoSize: true,
        layout: { background: { type: "solid", color: "transparent" }, textColor: css("--cream-300"), fontFamily: "system-ui, sans-serif" },
        grid: { vertLines: { color: "rgba(58,72,102,.25)" }, horzLines: { color: "rgba(58,72,102,.25)" } },
        rightPriceScale: { borderColor: "rgba(58,72,102,.6)" },
        timeScale: { borderColor: "rgba(58,72,102,.6)", timeVisible: true, secondsVisible: false },
        crosshair: { mode: 0 },
      });
      let main;
      if (pro) {
        main = chart.addSeries(LC.CandlestickSeries, { upColor: "#62c98f", downColor: "#f06a66", borderVisible: false, wickUpColor: "#62c98f", wickDownColor: "#f06a66" });
        main.setData(d.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
        const vol = chart.addSeries(LC.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, color: "rgba(242,169,59,.35)" });
        chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
        vol.setData(d.candles.map((c) => ({ time: c.time, value: c.vol, color: c.close >= c.open ? "rgba(98,201,143,.35)" : "rgba(240,106,102,.35)" })));
        const at = chart.addSeries(LC.LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        at.setData(d.atrTrend.map((p) => ({ time: p.time, value: p.value, color: p.dir === 1 ? "#62c98f" : "#ef7d5e" })));
        if (d.markers.length && LC.createSeriesMarkers) LC.createSeriesMarkers(main, d.markers);
      } else {
        main = chart.addSeries(LC.AreaSeries, { lineColor: "#f2a93b", topColor: "rgba(242,169,59,.28)", bottomColor: "rgba(242,169,59,0)", lineWidth: 2 });
        main.setData(d.candles.map((c) => ({ time: c.time, value: c.close })));
      }
      const L = opts.levels || d.levels;
      if (L) {
        main.createPriceLine({ price: L.entry, color: "#d3c9b8", lineWidth: 1, lineStyle: 2, title: "giriş" });
        main.createPriceLine({ price: L.stop, color: "#f06a66", lineWidth: 1, lineStyle: 2, title: "stop" });
        main.createPriceLine({ price: L.target, color: "#62c98f", lineWidth: 1, lineStyle: 2, title: "hedef" });
      }
      if (d.position) main.createPriceLine({ price: d.position.entryPx, color: "#f2a93b", lineWidth: 2, lineStyle: 0, title: "pozisyon" });
      chart.timeScale().fitContent();
      wrap.querySelector(".chart-note").textContent = `${d.live ? "OKX ATK mumları" : "Örnek veri"} · ${pro ? "mumlar, hacim, ATR trend çizgisi ve ajanın al/sat işaretleri" : "fiyat ve giriş/stop/hedef"} · Grafik: TradingView Lightweight Charts`;
    }
    load();
    const onMode = () => load();
    T.on("mode", onMode);
    return { destroy() { destroyed = true; if (chart) chart.remove(); }, reload: load };
  };
})();
