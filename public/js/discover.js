/* Keşfet CEX / DEX sekmeleri. CEX: OKX spot parite araması (ATK), parite sekmeleri, büyük grafik + AI analizi + vadeli + arz.
   DEX: zincir + kontrat adresi; güvenlik taraması tablosu. URL: ?tab=cex&s=AVAX-USDC · ?tab=dex&chain=43114&ca=0x... */
(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s), F = T.fmt;
  const params = new URLSearchParams(location.search);
  const setUrl = (obj) => { const u = new URLSearchParams(obj); const tf = new URLSearchParams(location.search).get("tf"); if (tf) u.set("tf", tf); history.replaceState(null, "", `${location.pathname}?${u}`); };

  // ---- Sekmeler ----
  function tab(which) {
    const cex = which === "cex";
    $("#mt-cex").setAttribute("aria-selected", String(cex));
    $("#mt-dex").setAttribute("aria-selected", String(!cex));
    $("#panel-cex").hidden = !cex;
    $("#panel-dex").hidden = cex;
  }
  $("#mt-cex").addEventListener("click", () => { tab("cex"); setUrl({ tab: "cex" }); });
  $("#mt-dex").addEventListener("click", () => { tab("dex"); setUrl({ tab: "dex" }); });

  // ---- CEX arama (combobox) ----
  const input = $("#cex-q"), list = $("#cex-list");
  let results = [], active = -1, timer = 0;
  function renderList() {
    list.hidden = !results.length;
    input.setAttribute("aria-expanded", String(results.length > 0));
    list.innerHTML = results.map((r, i) => `<li role="option" id="opt-${i}" aria-selected="${i === active}" data-i="${i}"><b>${T.esc(r.base)}</b> <span class="muted">${T.esc(r.name || "")}</span> <span class="faint">${r.pairs.map((p) => T.esc(p.split("-")[1])).join(" · ")}</span></li>`).join("");
    if (active >= 0) input.setAttribute("aria-activedescendant", `opt-${active}`); else input.removeAttribute("aria-activedescendant");
  }
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results = []; renderList(); return; }
    timer = setTimeout(async () => { try { results = (await T.api(`/api/cex/search?q=${encodeURIComponent(q)}`)).results; active = results.length ? 0 : -1; renderList(); } catch {} }, 150);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (results.length) { active = (active + 1) % results.length; renderList(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (results.length) { active = (active - 1 + results.length) % results.length; renderList(); } }
    else if (e.key === "Enter") { e.preventDefault(); if (results[active]) choose(results[active].base); }
    else if (e.key === "Escape") { results = []; renderList(); }
  });
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("[data-i]"); if (li) { e.preventDefault(); choose(results[Number(li.dataset.i)].base); } });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !e.target.closest("input, textarea, select") && !$("#panel-cex").hidden) { e.preventDefault(); input.focus(); }
  });

  async function choose(base, preferId) {
    results = []; renderList();
    input.value = base;
    const d = await T.api(`/api/cex/pairs/${encodeURIComponent(base)}`);
    if (!d.pairs.length) { $("#cex-view").innerHTML = `<p class="muted">${T.esc(base)} için USDT, USDC, BTC, ETH, SOL ya da TRY paritesi yok.</p>`; return; }
    const pick = d.pairs.find((p) => p.instId === preferId) || d.pairs.find((p) => p.quote === "USDT") || d.pairs[0];
    openPair(pick.instId);
  }

  let chartRef = null;
  async function openPair(instId) {
    setUrl({ tab: "cex", s: instId });
    const box = $("#cex-view");
    box.innerHTML = `<p class="muted">Yükleniyor…</p>`;
    let v;
    try { v = await T.api(`/api/cex/view/${encodeURIComponent(instId)}`); } catch (e) { box.innerHTML = `<p class="down">${T.esc(e.message)}</p>`; return; }
    const p = v.pair, c = v.candidate;
    const tabs = v.pairs.map((x) => `<button type="button" role="tab" class="chip" aria-selected="${x.instId === instId}" data-pair="${T.esc(x.instId)}">${T.esc(x.instId)}</button>`).join("");
    const rows = v.pairs.map((x) => `<tr${x.instId === instId ? ' class="sel"' : ""}><td><b>${T.esc(x.base)}</b></td><td>${T.esc(x.quote)}</td><td class="num">${x.last == null ? "-" : F.price(x.last)}</td><td class="num ${T.cls(x.change24hPct)}">${x.change24hPct == null ? "-" : F.pct(x.change24hPct)}</td><td class="num">${x.volQuote == null ? "-" : F.vol(x.volQuote) + " " + T.esc(x.quote)}</td><td class="num">${x.volUsdt == null ? "-" : "≈ " + F.vol(x.volUsdt) + " USDT"}</td></tr>`).join("");
    box.innerHTML = `
      <div class="pair-tabs" role="tablist" aria-label="Pariteler">${tabs}</div>
      <div class="table-wrap" style="max-height:none;margin:10px 0"><table><thead><tr><th>Sembol</th><th>Parite</th><th class="num">Son fiyat</th><th class="num">24 sa</th><th class="num">24 sa hacim</th><th class="num">USDT karşılığı</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${p.lowLiquidity ? `<div class="notice notice-warn">${T.icon("warn")}<span>Likidite düşük: 24 saatlik hacim ≈ ${F.vol(p.volUsdt)} USDT.</span></div>` : ""}
      <p class="kpi-small">${T.esc(v.tradeNote)}</p>
      <div class="cex-grid">
        <div id="cex-chart"></div>
        <aside class="ai-card" aria-labelledby="cai-h">
          <h3 id="cai-h">AI analizi</h3>
          ${c ? `<p style="margin:0 0 6px"><span class="pill pill-${T.esc(c.decision)}">ajan: ${T.esc(c.decision)}</span> <b>${T.esc(c.direction)}</b></p><p style="margin:0 0 8px">${T.esc(v.analysis ? v.analysis.short : c.reason)}</p>` : `<p class="muted">Analiz için yeterli mum verisi yok.</p>`}
          ${v.derivatives ? `<h3>Vadeli durum</h3>${T.derivCard(v.derivatives)}` : `<p class="kpi-small">Vadeli durum: bu coinin SWAP verisi yok.</p>`}
          <h3>Hold</h3><div>${v.hold ? `<span class="badge ${v.hold.verdict === "hold profiline uygun" ? "badge-ok" : v.hold.verdict === "kısa vade trade edilebilir" ? "badge-warn" : "badge-bad"}">${T.esc(v.hold.verdict)}</span> <span class="kpi-small">${T.esc(v.hold.reasons[0] || "")}</span>` : "veri yok"}</div>
          <h3>Arz dedektörü</h3><div id="cex-supply"></div>
          <div class="cex-actions">
            <button class="btn btn-sm heart-btn" type="button" id="cex-follow" ${v.watchlisted ? "" : "disabled"} aria-pressed="${v.followed}">${T.icon("heart")} ${v.followed ? "Takipte" : "Takibe al"}</button>
            <button class="btn btn-sm" type="button" id="cex-prio" ${v.watchlisted ? "" : "disabled"}>${T.icon("arrowUp")} Ajana öncelik ver</button>
            <a class="btn btn-sm btn-ghost" href="/mentor?q=${encodeURIComponent(p.base + " analizi")}">Mentora sor</a>
          </div>
          ${v.watchlisted ? "" : `<p class="faint" style="font-size:.78rem">Takip ve öncelik yalnızca ajanın izleme listesindeki coinler için.</p>`}
        </aside>
      </div>`;
    box.querySelectorAll("[data-pair]").forEach((b) => b.addEventListener("click", () => openPair(b.dataset.pair)));
    if (T.supplyCard) T.supplyCard(box.querySelector("#cex-supply"), p.base);
    if (chartRef) chartRef.destroy();
    chartRef = T.tvChart(box.querySelector("#cex-chart"), instId, { height: 340, frames: ["15m", "1H", "4H", "1D"], timeframes: true, candles: true, levels: v.analysis ? v.analysis.levels : null, showLevels: false });
    const usdt = `${p.base}-USDT`;
    box.querySelector("#cex-follow")?.addEventListener("click", async (e) => {
      const on = e.currentTarget.getAttribute("aria-pressed") === "true";
      if (on) await T.api("/api/follows/" + encodeURIComponent(usdt), { method: "DELETE" }); else await T.api("/api/follows", { body: { instId: usdt } });
      e.currentTarget.setAttribute("aria-pressed", String(!on));
      e.currentTarget.innerHTML = `${T.icon("heart")} ${on ? "Takibe al" : "Takipte"}`;
    });
    box.querySelector("#cex-prio")?.addEventListener("click", async (e) => { await T.api("/api/priority", { body: { instId: usdt } }); e.currentTarget.disabled = true; T.toast(`${p.base} ajanın tarama sırasında öne alındı.`); });
  }

  // ---- DEX ----
  T.api("/api/dex/chains").then((d) => {
    $("#scan-chain").innerHTML = d.chains.map((c) => `<option value="${T.esc(c.id)}">${T.esc(c.name)}</option>`).join("");
    if (params.get("tab") === "dex" && params.get("chain")) $("#scan-chain").value = params.get("chain");
    if (params.get("tab") === "dex" && params.get("ca")) { $("#scan-addr").value = params.get("ca"); runScan(); }
  });
  async function runScan() {
    const chain = $("#scan-chain").value, ca = $("#scan-addr").value.trim();
    const box = $("#scan-result");
    const v = await T.api(`/api/dex/validate?chain=${encodeURIComponent(chain)}&ca=${encodeURIComponent(ca)}`).catch((e) => ({ ok: false, error: e.message }));
    if (!v.ok) { box.innerHTML = `<p class="down">${T.esc(v.error)}</p>`; return; }
    setUrl({ tab: "dex", chain, ca });
    box.innerHTML = `<p class="muted">Taranıyor…</p>`;
    if (T.renderSecurity) return T.renderSecurity(box, chain, ca);
    try {
      const r = await T.api("/api/scan", { body: { chain, address: ca } });
      box.innerHTML = `<p><span class="badge">${T.esc(r.verdict)}</span> ${T.esc(r.reasons.join(" · "))}</p>`;
    } catch (e) { box.innerHTML = `<p class="down">${T.esc(e.message)}</p>`; }
  }
  $("#scan-form").addEventListener("submit", (e) => { e.preventDefault(); runScan(); });
  $("#dex-name-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = await T.api(`/api/dex/search?q=${encodeURIComponent($("#dex-name").value.trim())}`);
    $("#dex-name-result").innerHTML = `<div class="notice notice-warn">${T.icon("warn")}<span>${T.esc(d.warning)}</span></div>${d.results.length ? "" : `<p class="kpi-small">${T.esc(d.onchainos.note)} Kontrat adresiyle arayabilirsin.</p>`}`;
  });
  T.api("/api/demo-tokens").then((d) => {
    const items = d.tokens.concat(d.honeypot ? [{ label: "Honeypot örneği", ...d.honeypot }] : []);
    $("#scan-demo").innerHTML = items.length ? "Demo: " + items.map((t, i) => `<button type="button" class="chip" data-demo="${i}">${T.esc(t.label)}</button>`).join(" ") : "";
    $("#scan-demo").addEventListener("click", (e) => { const b = e.target.closest("[data-demo]"); if (!b) return; const t = items[Number(b.dataset.demo)]; $("#scan-chain").value = t.chainId || t.chain; $("#scan-addr").value = t.address; runScan(); });
  }).catch(() => {});

  // ---- URL'den aç ----
  if (params.get("tab") === "dex") tab("dex");
  else if (params.get("s") && /^[A-Z0-9]{1,15}-(USDT|USDC|BTC|ETH|SOL|TRY)$/.test(params.get("s"))) { tab("cex"); const s = params.get("s"); choose(s.split("-")[0], s); }
})();
