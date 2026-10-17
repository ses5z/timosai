/* Arz dedektörü bileşeni: arz yapısı, 1G/1A/1Y değişim (tahmini, MC/fiyat), deflasyon, sıçramalar, kilit açılımı,
   arz baskısı ve 1 yıllık dolaşım eğrisi (açılım tarihleri işaretli). Keşfet CEX, ısı haritası çekmecesi, Pro Terminal. */
(function () {
  "use strict";
  const T = window.TimosAI, F = T.fmt;
  const pc = (v) => (v == null ? "-" : `<span class="${T.cls(v)}">${F.pct(v, 2)}</span>`);
  const PCLS = { "düşük": "badge-ok", orta: "badge-warn", "yüksek": "badge-bad" };
  T.supplyCard = async function (el, base, opts = {}) {
    el.innerHTML = `<p class="kpi-small">Arz verisi yükleniyor…</p>`;
    let r;
    try { r = await T.api(`/api/supply/${encodeURIComponent(base)}`); } catch { el.innerHTML = `<p class="kpi-small">Arz: veri yok.</p>`; return; }
    if (!r.available) { el.innerHTML = `<p class="kpi-small">Arz: ${T.esc(r.note || "veri yok")}</p>`; return; }
    const s = r.structure, c = r.change, u = r.unlocks;
    el.innerHTML = `<div class="supply">
      <p style="margin:0 0 6px"><span class="badge ${PCLS[r.pressure.level]}">Arz baskısı: ${T.esc(r.pressure.level)}</span> ${s ? `<span class="badge badge-muted">${s.capped ? "Sınırlı arz" : "Sınırsız arz"}</span>` : ""} ${c && c.deflationary ? `<span class="badge badge-ok">deflasyonist (yakım)</span>` : ""}</p>
      <ul class="cautions">${r.pressure.reasons.map((x) => `<li>${T.esc(x)}</li>`).join("")}</ul>
      <div class="kpi-small supply-grid">
        <span>Dolaşımdaki</span><b class="num">${s && s.circulating != null ? F.vol(s.circulating) : "-"}${s && s.circulatingPct != null ? ` (%${F.num(s.circulatingPct, 1)})` : ""}</b>
        <span>Toplam / maks</span><b class="num">${s && s.total != null ? F.vol(s.total) : "-"} / ${s && s.max != null ? F.vol(s.max) : "sınırsız"}</b>
        <span>${T.term("fdv", "FDV/MC")}</span><b class="num">${s && s.fdvToMc != null ? F.num(s.fdvToMc, 2) : "-"}</b>
        <span>Arz değişimi 1G / 1A / 1Y</span><b class="num">${c ? `${pc(c.d1)} / ${pc(c.m1)} / ${pc(c.y1)}` : "veri yok"}</b>
        <span>Yıllık enflasyon</span><b class="num">${c && c.annualInflationPct != null ? F.pct(c.annualInflationPct, 2) : "-"} <span class="faint">tahmini (MC/fiyat)</span></b>
        <span>Sonraki açılım</span><b>${u.next ? `${T.esc(u.next.date)} · %${u.next.pctOfCirculating}${u.next.amountTokens ? ` (≈ ${F.vol(u.next.amountTokens)})` : ""}` : "kayıt yok"} <span class="badge badge-warn">ÖRNEK VERİ</span></b>
        <span>30 / 90 gün açılım</span><b class="num">%${F.num(u.total30dPct, 1)} / %${F.num(u.total90dPct, 1)}</b>
        <span>Günlük > %1 sıçrama</span><b class="num">${r.jumps.length}</b>
      </div>
      <div class="supply-chart" style="height:${opts.height || 160}px"></div>
      <p class="faint" style="font-size:.75rem;margin:6px 0 0">Kaynak: ${T.esc(r.source)} · dolaşım ≈ piyasa değeri / fiyat (tahmini). ${T.esc(r.jumpNote)} Açılımlar: ${T.esc(u.source)}.</p></div>`;
    const LC = window.LightweightCharts;
    const box = el.querySelector(".supply-chart");
    if (!LC || !r.series.length) { box.innerHTML = `<div class="empty">Arz eğrisi için veri yok.</div>`; return; }
    const chart = LC.createChart(box, { autoSize: true, layout: { background: { type: "solid", color: "transparent" }, textColor: getComputedStyle(document.body).getPropertyValue("--muted").trim() }, grid: { vertLines: { visible: false }, horzLines: { color: "rgba(120,130,160,.15)" } }, timeScale: { borderVisible: false }, rightPriceScale: { borderVisible: false } });
    const line = chart.addSeries(LC.LineSeries, { color: "#f2a93b", lineWidth: 2, priceFormat: { type: "volume" } });
    line.setData(r.series);
    const marks = u.items.map((x) => ({ time: Math.floor(Date.parse(x.date) / 1000), position: "aboveBar", color: "#ef7d5e", shape: "arrowDown", text: `açılım %${x.pctOfCirculating}` }))
      .concat(r.jumps.slice(-5).map((j) => ({ time: Math.floor(j.t / 1000), position: "belowBar", color: "#4f8cff", shape: "circle", text: `${j.pct > 0 ? "+" : ""}${j.pct.toFixed(1)}%` })))
      .filter((m) => m.time <= r.series[r.series.length - 1].time).sort((a, b) => a.time - b.time);
    if (marks.length && LC.createSeriesMarkers) LC.createSeriesMarkers(line, marks);
    chart.timeScale().fitContent();
  };
})();
