/* Pro Terminal (G3 madde 9): sol ~%22 izleme listesi (arama, sıralama, sabit yükseklik, iç kaydırma);
   orta ~%53 grafik + sekmeli panel (Pozisyonlar · Emir defteri · Paper istatistik · Backtest · Güvenlik taraması · ATK günlüğü);
   sağ ~%25 sekmeli kart (Order book · Vadeli · L/S · Arz) + Mentor işlemi özeti. <1280 px'te sağ sütun ortanın altına iner. */
(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s), F = T.fmt;
  if (document.body.dataset.mode !== "pro") document.body.dataset.mode = "pro";
  let cands = [], ls = null, sel = new URLSearchParams(location.search).get("s") || null, chart = null, tab = "pos", rtab = "ob";

  const longOf = (id) => { const r = ls && ls.rows.find((x) => x.instId === id); return r ? (r.okxTopAccount ?? r.bnTopAccount) : null; };
  function renderWatch() {
    const q = $("#tc-search").value.trim().toUpperCase(), sort = $("#tw-sort").value;
    const list = cands.filter((c) => !q || c.base.includes(q)).sort((a, b) => sort === "chg" ? b.change24hPct - a.change24hPct : sort === "vol" ? b.volUsdt24h - a.volUsdt24h : sort === "az" ? a.base.localeCompare(b.base) : 0);
    $("#tw-info").textContent = `${list.length}/${cands.length} coin`;
    $("#tw-body").innerHTML = list.map((c) => {
      const l = longOf(c.instId);
      return `<tr data-id="${T.esc(c.instId)}" tabindex="0" aria-selected="${c.instId === sel}" class="${c.instId === sel ? "sel" : ""}"><th scope="row">${T.esc(c.base)}</th><td class="num" data-p>${F.price(c.price)}</td><td class="num ${T.cls(c.change24hPct)}" data-c>${F.pct(c.change24hPct)}</td><td class="num">${l == null ? "–" : F.num(l, 0) + "%"}</td></tr>`;
    }).join("") || `<tr><td colspan="4" class="faint">Eşleşen coin yok.</td></tr>`;
  }
  function select(id) {
    sel = id;
    T.setParam("s", id);
    renderWatch();
    const c = cands.find((x) => x.instId === id);
    $("#tc-sym").textContent = id;
    $("#tc-px").textContent = c ? `${F.price(c.price)} · ${F.pct(c.change24hPct)}` : "";
    $("#tc-dec").textContent = c ? `ajan: ${c.decision}` : "";
    $("#tc-dec").className = c ? `pill pill-${c.decision}` : "pill";
    if (chart) chart.destroy();
    chart = T.tvChart($("#tc-chart"), id, { height: 360, candles: true, showTrend: true });
    loadSetup();
    loadBook();
    T.api(`/api/derivatives/${encodeURIComponent(id)}`).then((d) => ($("#dv-box").innerHTML = T.derivCard(d))).catch(() => ($("#dv-box").innerHTML = `<p class="kpi-small">Vadeli veri yok.</p>`));
    renderLs();
    if (T.supplyCard) T.supplyCard($("#sp-box"), id.split("-")[0], { height: 110 });
  }
  async function loadBook() {
    if (!sel) return;
    try {
      const b = await T.api(`/api/orderbook/${encodeURIComponent(sel)}`);
      const max = Math.max(1, ...b.bids.map((x) => x[1]), ...b.asks.map((x) => x[1]));
      const dec = b.tickSz > 0 ? Math.max(0, Math.round(-Math.log10(b.tickSz))) : null;
      const px = (p) => (dec === null ? F.price(p) : Number(p).toFixed(dec));
      const row = (r, side) => `<div class="ob-row ${side}"><span class="ob-bar" style="width:${((r[1] / max) * 100).toFixed(1)}%"></span><span class="num">${px(r[0])}</span><span class="num">${F.num(r[1], 3)}</span></div>`;
      const spread = b.asks[0] && b.bids[0] ? ((b.asks[0][0] - b.bids[0][0]) / ((b.asks[0][0] + b.bids[0][0]) / 2)) * 100 : null;
      $("#ob-spread").textContent = spread == null ? "" : `makas %${spread.toFixed(3)}`;
      $("#ob-box").innerHTML = `<div class="ob-head"><span>Fiyat</span><span>Miktar</span></div>${b.asks.slice(0, 10).reverse().map((r) => row(r, "ask")).join("")}<div class="ob-mid num">${b.bids[0] ? px(b.bids[0][0]) : "–"}</div>${b.bids.slice(0, 10).map((r) => row(r, "bid")).join("")}<p class="faint" style="font-size:.72rem;margin:6px 0 0">${b.live ? "ATK market_get_orderbook" : "Örnek veri"}</p>`;
    } catch { $("#ob-box").innerHTML = `<p class="kpi-small">Order book verisi yok.</p>`; }
  }
  async function loadSetup() {
    const box = $("#ts-box"), id = sel;
    box.innerHTML = `<p class="kpi-small">Mentor işlemi hesaplanıyor (15dk · 1s · 4s · 1g)…</p>`;
    try {
      const s = await T.api(`/api/setup/${encodeURIComponent(id)}`);
      if (id !== sel) return;
      box.innerHTML = T.setupCardHtml(s, true);
      T.bindSetupCard(box, s);
    } catch { box.innerHTML = `<p class="kpi-small">Mentor işlemi hesaplanamadı.</p>`; }
  }
  function renderRt() {
    document.querySelectorAll("[data-rt]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.rt === rtab)));
    document.querySelectorAll("[data-rp]").forEach((p) => (p.hidden = p.dataset.rp !== rtab));
  }
  document.querySelectorAll("[data-rt]").forEach((b) => b.addEventListener("click", () => { rtab = b.dataset.rt; renderRt(); }));
  function renderLs() {
    if (!ls || !sel) { $("#ls2-box").innerHTML = `<p class="kpi-small">L/S verisi yükleniyor…</p>`; return; }
    const r = ls.rows.find((x) => x.instId === sel), all = ls.summary.find((x) => x.label === "All");
    const f = (v) => (v == null ? "–" : F.num(v, 0) + "%");
    $("#ls2-box").innerHTML = `<table class="dense"><thead><tr><th></th><th class="num">OKX hesap</th><th class="num">OKX poz.</th><th class="num">BN hesap</th><th class="num">BN poz.</th></tr></thead><tbody>
      <tr><th scope="row">${T.esc(sel.split("-")[0])}</th><td class="num">${f(r && r.okxTopAccount)}</td><td class="num">${f(r && r.okxTopPosition)}</td><td class="num">${f(r && r.bnTopAccount)}</td><td class="num">${f(r && r.bnTopPosition)}</td></tr>
      <tr><th scope="row">All</th><td class="num">${f(all && all.okxTopAccount)}</td><td class="num">${f(all && all.okxTopPosition)}</td><td class="num">${f(all && all.bnTopAccount)}</td><td class="num">${f(all && all.bnTopPosition)}</td></tr></tbody></table>
      <p class="faint" style="font-size:.72rem;margin:6px 0 0">Üst trader long %. OKX ve Binance tanımları farklıdır.</p>`;
  }

  // ---- Alt sekmeler ----
  async function renderTab() {
    const box = $("#tb-box");
    document.querySelectorAll("[data-tb]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tb === tab)));
    if (tab === "bt") {
      box.innerHTML = `<p class="kpi-small">Planındaki coinlerde son 30 günün 4s kapanışlarıyla test (ileriye bakış yok).</p><button type="button" class="btn" id="t-bt">Bu planı son 30 günde test et</button><div id="t-bt-out"></div>`;
      $("#t-bt").addEventListener("click", async () => {
        $("#t-bt-out").innerHTML = `<p class="faint">Test ediliyor…</p>`;
        try { $("#t-bt-out").innerHTML = T.renderBacktest(await T.api("/api/backtest", { method: "POST", body: {} })); } catch (e) { $("#t-bt-out").innerHTML = `<p class="faint">${T.esc(e.message)}</p>`; }
      });
      return;
    }
    if (tab === "pos" || tab === "hist") {
      const p = await T.api("/api/portfolio");
      if (tab === "pos") box.innerHTML = p.positions.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Coin</th><th>Mod</th><th class="num">Giriş</th><th class="num">Son</th><th class="num">Stop</th><th class="num">Hedef</th><th class="num">USDT</th><th class="num">PnL</th></tr></thead><tbody>${p.positions.map((x) => `<tr><th scope="row">${T.esc(x.instId)}</th><td>${T.esc(x.mode)}</td><td class="num">${F.price(x.entryPx)}</td><td class="num">${F.price(x.lastPx)}</td><td class="num">${F.price(x.stopPx)}</td><td class="num">${F.price(x.targetPx)}</td><td class="num">${F.num(x.costUsdt, 2)}</td><td class="num ${T.cls(x.pnlUsdt)}">${F.signed(x.pnlUsdt, 3)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="kpi-small">Açık pozisyon yok.</p>`;
      else {
        const rows = await T.api("/api/order-log");
        box.innerHTML = rows.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Saat</th><th>Coin</th><th>Yön</th><th class="num">Fiyat</th><th class="num">Tutar</th><th>Durum</th><th class="num">PnL</th><th>Mod</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${F.time(r.ts)}</td><th scope="row">${T.esc(r.coin)}</th><td>${r.side}</td><td class="num">${F.price(r.px)}</td><td class="num">${F.num(r.usdt, 2)}</td><td>${T.esc(r.status)}</td><td class="num ${T.cls(r.pnl)}">${r.pnl == null ? "–" : F.signed(r.pnl, 3)}</td><td>${T.esc(r.mode)}${r.ordId ? ` · OKX #${T.esc(r.ordId)}` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="kpi-small">Henüz emir yok.</p>`;
      }
    } else if (tab === "stats") {
      const d = await T.api("/api/paper"), s = d.stats;
      box.innerHTML = `<div class="kpi-row">${[["İşlem", s.trades], ["Kazanma oranı", s.trades ? F.num(s.winRate * 100, 1) + "%" : "–"], ["Ortalama R", s.trades ? F.signed(s.avgR, 2) + "R" : "–"], ["Maks drawdown", F.num(s.maxDrawdownPct, 2) + "%"], ["Toplam PnL", F.signed(s.totalPnl, 3) + " USDT"], ["Futures (SİM) gerçekleşen", F.signed(d.futuresStats.realized, 3) + " USDT"]].map(([k, v]) => `<div class="stat"><span class="kpi-small">${k}</span><b class="num">${v}</b></div>`).join("")}</div>`;
    } else if (tab === "sec") {
      box.innerHTML = `<form class="scan-form" id="t-scan" autocomplete="off"><label class="visually-hidden" for="t-chain">Zincir</label><select id="t-chain"><option value="56">BNB Chain</option><option value="1">Ethereum</option><option value="8453">Base</option><option value="43114">Avalanche C-Chain</option><option value="42161">Arbitrum</option><option value="137">Polygon</option><option value="10">Optimism</option><option value="solana">Solana</option></select><label class="visually-hidden" for="t-ca">Kontrat adresi</label><input id="t-ca" placeholder="Kontrat adresi (CA)" spellcheck="false"><button class="btn btn-primary" type="submit">Tara</button></form><div id="t-sec"></div>`;
      $("#t-scan").addEventListener("submit", (e) => { e.preventDefault(); T.renderSecurity($("#t-sec"), $("#t-chain").value, $("#t-ca").value.trim()); });
    } else if (tab === "atk") {
      const a = await T.api("/api/atk");
      box.innerHTML = `<p class="kpi-small">${a.total} ATK çağrısı · ${a.errors} hata</p><ul class="log" style="max-height:260px">${a.recent.map((r) => `<li class="${r.ok ? "lvl-bilgi" : "lvl-hata"}"><time>${F.time(r.ts)}</time><span><b class="mono">${T.esc(r.tool)}</b> <span class="faint">${T.esc(r.params)}</span> → ${T.esc(r.result)} <span class="faint">${r.ms} ms</span></span></li>`).join("")}</ul>`;
    }
  }
  document.querySelectorAll("[data-tb]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tb; renderTab(); }));

  $("#tw-body").addEventListener("click", (e) => { const tr = e.target.closest("[data-id]"); if (tr) select(tr.dataset.id); });
  $("#tw-body").addEventListener("keydown", (e) => { const tr = e.target.closest("[data-id]"); if (tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(tr.dataset.id); } });

  async function load() {
    cands = await T.api("/api/candidates").catch(() => []);
    if (!sel || !cands.some((c) => c.instId === sel)) sel = cands[0] ? cands[0].instId : null;
    renderWatch();
    if (sel && !chart) select(sel);
    T.api("/api/longshort").then((d) => { ls = d; renderWatch(); renderLs(); }).catch(() => {});
  }
  $("#tc-search").addEventListener("input", renderWatch);
  $("#tw-sort").addEventListener("change", renderWatch);
  load();
  renderTab();
  renderRt();
  T.on("prices", (p) => {
    document.querySelectorAll("#tw-body tr").forEach((tr) => { const v = p[tr.dataset.id]; if (!v) return; tr.querySelector("[data-p]").textContent = F.price(v.p); const c = tr.querySelector("[data-c]"); c.textContent = F.pct(v.c); c.className = "num " + T.cls(v.c); });
  });
  T.on("scan", () => load());
  setInterval(loadBook, 10000);
  setInterval(() => { if (tab === "pos" || tab === "atk") renderTab(); }, 10000);
})();
