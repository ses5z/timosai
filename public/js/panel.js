(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s), F = T.fmt;
  $("#detail-toggle").innerHTML = T.detailToggle();

  async function loadPortfolio() {
    const p = await T.api("/api/portfolio");
    $("#eq-val").textContent = F.usd(p.equity, 2);
    $("#eq-day").innerHTML = `<span class="${T.cls(p.dailyPnl)}">${F.signed(p.dailyPnl, 3)} USDT</span>`;
    $("#eq-cash").textContent = F.usd(p.cash);
    $("#eq-open").textContent = `${p.positions.length} · ${F.usd(p.openNotional)}`;
    $("#eq-mode").textContent = p.mode;
    $("#eq-mode").className = "badge " + (p.mode === "KURU" ? "badge-dry" : "badge-live");
    T.lineChart($("#eq-chart"), p.equityHistory.map((x) => ({ v: x.equity, t: x.ts })), { label: "Değer çizgisi", fmt: (v) => F.num(v, 2), levels: [{ v: p.startEquity, label: "başlangıç", color: "var(--faint)" }], empty: "Değer çizgisi ilk taramalardan sonra oluşur." });
    renderPositions(p.positions);
    $("#risk-range").value = p.riskPct;
    $("#risk-val").textContent = "%" + p.riskPct;
    $("#risk-usdt").textContent = `Bu, işlem başına en fazla ≈ ${F.usd(p.riskBudgetUsdt, 3)} kayıp demek.`;
    const TAG = { ajan: "OTONOM", senaryo: "SENARYO", "hızlı": "HIZLI" };
    const rows = p.trades.map((t) => `<tr><td>${F.time(t.ts)}</td><td>${T.esc(t.instId.replace("-USDT", ""))}</td><td>${t.side === "buy" ? "AL" : "SAT"}</td><td class="num">${F.price(t.px)}</td><td class="num">${F.num(t.notionalUsdt, 2)}</td><td class="num ${T.cls(t.pnl)}">${t.pnl == null ? "-" : F.signed(t.pnl, 3)}</td><td><span class="badge ${t.mode === "KURU" ? "badge-dry" : "badge-live"}">${t.mode}</span> <span class="badge badge-muted">${TAG[t.origin] || T.esc(t.origin)}</span></td><td class="detail-only">${T.esc(t.reason)}</td></tr>`).join("");
    T.renderKeep($("#tr-wrap"), rows ? `<table><thead><tr><th>Saat</th><th>Coin</th><th>Yön</th><th class="num">Fiyat</th><th class="num">USDT</th><th class="num">K/Z</th><th>Mod</th><th class="detail-only">Gerekçe</th></tr></thead><tbody>${rows}</tbody></table>` : `<div class="empty">Henüz işlem yok. Ajan uygun sinyal görünce küçük bir emir açar.</div>`);
  }

  function renderPositions(list) {
    $("#pos-sum").textContent = list.length ? `${list.length} pozisyon` : "";
    if (!list.length) { $("#pos-list").innerHTML = `<div class="empty">Açık pozisyon yok.</div>`; return; }
    $("#pos-list").innerHTML = list.map((p) => {
      const range = p.targetPx - p.stopPx, prog = range > 0 ? Math.max(0, Math.min(100, ((p.lastPx - p.stopPx) / range) * 100)) : 50;
      return `<article class="card" style="padding:14px;margin-bottom:10px;box-shadow:none">
        <div class="card-head" style="margin-bottom:6px"><h3>${T.esc(p.instId.replace("-USDT", ""))} <span class="badge ${p.mode === "KURU" ? "badge-dry" : "badge-live"}">${p.mode}</span>${p.trailing ? ' <span class="badge badge-ok">iz süren stop</span>' : ""}${p.partialDone ? ' <span class="badge badge-muted">kısmi kâr alındı</span>' : ""}</h3>
        <b class="num ${T.cls(p.pnlUsdt)}">${F.signed(p.pnlUsdt, 3)} USDT (${F.pct(p.pnlPct)})</b></div>
        <div class="kpi-row kpi-small"><span>Giriş <b class="num">${F.price(p.entryPx)}</b></span><span>Son <b class="num">${F.price(p.lastPx)}</b></span><span>${T.term("stop", "Stop")} <b class="num">${F.price(p.stopPx)}</b></span><span>Hedef <b class="num">${F.price(p.targetPx)}</b></span><span>Büyüklük <b class="num">${F.num(p.costUsdt, 2)} USDT</b></span></div>
        <div class="bar ${prog < 25 ? "bad" : prog < 50 ? "warn" : ""}" style="margin-top:10px" role="img" aria-label="Stop ile hedef arasında konum yüzde ${Math.round(prog)}"><span style="width:${prog}%"></span></div>
        <p class="faint detail-only" style="font-size:.82rem;margin:8px 0 0">${T.esc(p.reason)}</p></article>`;
    }).join("");
  }

  async function loadContract() {
    const c = await T.api("/api/contract");
    $("#ct-gauge").innerHTML = T.gauge(c.riskScore.score) + `<div><b>${T.term("risk", "Risk skoru")}</b><p class="kpi-small" style="margin:4px 0 0">Durum: <b class="${c.riskScore.level === "güvenli" ? "up" : c.riskScore.level === "riskli" ? "down" : ""}">${c.riskScore.level}</b></p></div>`;
    $("#ct-warn").textContent = c.warningsTotal;
    $("#ct-mult").textContent = c.sizeMultiplier === 1 ? "1×" : `${c.sizeMultiplier}× (${c.lossStreak} zarar)`;
    $("#halve").checked = c.halveAfterLosses;
    $("#ct-blocked").textContent = c.blockedByAgent;
    T.renderKeep($("#ct-list"), c.warnings.slice(0, 8).map((w) => `<li class="lvl-uyarı"><time>${F.time(w.ts)}</time><span><b>${T.esc(w.title)}</b><br><span class="faint">${T.esc(w.text)}</span></span></li>`).join("") || `<li><span></span><span class="muted">Uyarı yok.</span></li>`);
    $("#ct-bars").innerHTML = c.bars.map((b) => {
      const pct = Math.min(100, (b.value / b.max) * 100);
      return `<div class="bar-row"><header><span>${T.esc(b.label)}${b.warnOnly ? ' <span class="faint">(yalnızca uyarı)</span>' : ""}</span><b class="num">${F.num(b.value, b.unit ? 2 : 0)} / ${b.max} ${b.unit}</b></header><div class="bar ${pct >= 100 ? "bad" : pct >= 80 ? "warn" : ""}"><span style="width:${pct}%"></span></div></div>`;
    }).join("");
  }

  async function loadEvents() {
    const ev = await T.api("/api/events");
    T.renderKeep($("#ev-list"), ev.map(evRow).join("") || `<li><span></span><span class="muted">Henüz olay yok.</span></li>`);
  }
  const evRow = (e) => `<li class="lvl-${T.esc(e.level)}"><time datetime="${new Date(e.ts).toISOString()}">${F.time(e.ts)}</time><span>${T.esc(e.text)}</span></li>`;

  async function loadAtk() {
    const a = await T.api("/api/atk");
    $("#atk-total").textContent = `${a.total} çağrı`;
    const tools = Object.entries(a.byTool);
    $("#atk-tools").innerHTML = tools.length ? `<ul class="log" style="max-height:220px">${tools.map(([n, c]) => `<li><b class="num">${c}</b><span class="mono">${T.esc(n)}</span></li>`).join("")}</ul>` : `<div class="empty">${a.connected ? "Çağrı bekleniyor." : "ATK bağlı değil (örnek veri)."}</div>`;
    T.renderKeep($("#atk-recent"), a.recent.map((r) => `<li class="${r.ok ? "lvl-bilgi" : "lvl-hata"}"><time>${F.time(r.ts)}</time><span><b class="mono">${T.esc(r.tool)}</b> <span class="faint">${T.esc(r.params)}</span><br>${T.esc(r.result)} <span class="faint">${r.ms} ms</span></span></li>`).join(""));
  }

  async function loadLedger() {
    const l = await T.api("/api/ledger");
    $("#lg-head").textContent = `Son özet: ${l.head} · ${l.count} kayıt · ${l.anchor.note}`;
    const a = l.anchor;
    $("#av-state").textContent = a.enabled ? (a.network === "mainnet" ? "C-Chain" : "Fuji") : "kapalı";
    $("#av-state").className = "badge " + (a.enabled ? "badge-ok" : "badge-muted");
    $("#av-body").innerHTML = a.enabled
      ? `<p>DecisionLog sözleşmesi: <a href="${T.esc(a.contractUrl)}" target="_blank" rel="noopener" class="mono">${T.esc(a.contract.slice(0, 10))}…${T.esc(a.contract.slice(-6))}</a></p>
         <p>${a.last ? `Son ${a.last.kind === "anchor" ? "özet" : "sonuç"} işlemi: <a href="${T.esc(a.last.url)}" target="_blank" rel="noopener" class="mono">${T.esc(a.last.txHash.slice(0, 12))}…</a> · ${F.time(a.last.at)}` : T.esc(a.note)}</p>
         <p>Toplam zincir kaydı: <b class="num">${a.total}</b>${a.lastError ? ` · <span class="down">${T.esc(a.lastError)}</span>` : ""}</p>
         <p class="faint">Karar/emir izinin sha256 özeti periyodik olarak, kapanan işlemlerin sonucu her kapanışta değiştirilemez şekilde zincire yazılır.</p>`
      : `<p>${T.esc(a.note)}</p><p class="faint">Kurulum: .env'de AVAX_DEPLOYER_PRIVATE_KEY (yeni cüzdan), faucet.avax.network'ten test AVAX, sonra npm run deploy:fuji.</p>`;
    $("#lg-valid").textContent = l.valid ? "zincir geçerli" : "zincir bozuk";
    $("#lg-valid").className = "badge " + (l.valid ? "badge-ok" : "badge-bad");
    T.renderKeep($("#lg-list"), l.entries.map((e) => `<li class="lvl-${e.kind === "order" ? "emir" : e.kind === "warning" ? "uyarı" : "karar"}"><time>#${e.seq}</time><span><b>${T.esc(e.kind)}</b> <span class="mono faint">${e.hash.slice(0, 12)}</span><br>${T.esc(JSON.stringify(e.data).slice(0, 220))}</span></li>`).join(""));
  }

  function renderStatus(s) {
    const a = s.agent;
    const st = $("#ag-state");
    st.innerHTML = `<span class="dot"></span> ${T.esc(a.state)}`;
    st.className = "badge " + (a.paused ? "badge-warn" : "badge-ok");
    $("#ag-auto").checked = a.autonomous;
    if (a.breaker && a.breaker.active) st.className = "badge badge-bad";
    $("#breaker-box").innerHTML = a.breaker && a.breaker.active ? `<div class="notice notice-warn" role="alert">${T.icon("warn")}<span><b>Devre kesici açık:</b> ${T.esc(a.breaker.reason)}. Ajan yeni emir vermiyor; açık pozisyonlar yönetiliyor.</span><button class="btn btn-sm btn-primary" type="button" id="resume-btn" style="margin-left:auto">Devam ettir</button></div>` : "";
    const rb = document.getElementById("resume-btn");
    if (rb) rb.addEventListener("click", async () => { await T.api("/api/agent/resume", { body: {} }); T.refreshStatus(); T.toast("Ajan devam ediyor."); });
    $("#ag-pause").checked = a.paused;
    $("#ag-info").innerHTML = `${a.scanCount} tarama · son ${a.lastScanAt ? F.ago(a.lastScanAt) : "-"} · her ${a.scanIntervalSec} sn · ${s.liveData ? '<span class="up">canlı veri</span>' : '<span class="down">canlı veri yok</span>'} · ${T.term("kuru", s.tradingMode)}`;
    $("#ag-mentor").textContent = `Mentor: ${s.mentor.ai ? "yapay zeka (" + s.mentor.active + ")" : "kural tabanlı"}`;
    const n = [];
    if (!s.liveData) n.push(`<div class="notice notice-warn">${T.icon("warn")}<span>${s.atkMode === "mock" ? "Örnek veri modu (ATK_MODE=mock): canlı veri kapalı." : "Canlı veri yok: ATK'ya ulaşılamadı, örnek veri gösteriliyor."}</span></div>`);
    if (s.missingEnv.length) n.push(`<div class="notice notice-info">${T.icon("info")}<span>.env içinde boş: ${s.missingEnv.map(T.esc).join(", ")}. İlgili özellikler kapalı görünür.</span></div>`);
    $("#notices").innerHTML = n.join("");
  }

  $("#ag-auto").addEventListener("change", (e) => T.api("/api/agent", { body: { autonomous: e.target.checked } }).then(() => T.refreshStatus()));
  $("#ag-pause").addEventListener("change", (e) => T.api("/api/agent", { body: { paused: e.target.checked } }).then(() => T.refreshStatus()));
  $("#ag-scan").addEventListener("click", async (e) => { e.target.disabled = true; try { await T.api("/api/agent/scan", { body: {} }); T.toast("Tarama tamamlandı."); } finally { e.target.disabled = false; refreshAll(); } });
  $("#halve").addEventListener("change", (e) => T.api("/api/settings/halve", { body: { on: e.target.checked } }).then(loadContract));
  $("#risk-range").addEventListener("change", async (e) => { try { await T.api("/api/settings/risk", { body: { riskPct: Number(e.target.value) } }); loadPortfolio(); } catch (err) { T.toast(err.message); } });
  $("#scenario-btn").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await T.api("/api/scenario/start", { body: {} }); T.toast("Senaryo başladı: adımları olay günlüğünden izle."); } catch (err) { T.toast(err.message); } finally { setTimeout(() => (e.target.disabled = false), 4000); }
  });

  function renderScenario(steps) {
    if (!steps.length) return;
    $("#scenario-card").hidden = false;
    const last = steps[steps.length - 1];
    $("#sc-step").textContent = last.done ? "tamamlandı" : `${last.step}/${last.total}`;
    $("#sc-list").innerHTML = steps.map((s) => `<li><b>${T.esc(s.title)}</b><br><span class="muted">${T.esc(s.text)}</span></li>`).join("");
  }
  let scSteps = [];
  T.on("scenario", (s) => { if (s.step === 1) scSteps = []; scSteps.push(s); renderScenario(scSteps); if (s.done) refreshAll(); });
  T.api("/api/scenario").then((d) => { scSteps = d.steps; renderScenario(scSteps); }).catch(() => {});

  async function loadQuick() {
    const q = await T.api("/api/quick/sims");
    $("#qk-state").textContent = q.enabled ? "açık" : "kapalı";
    $("#qk-state").className = "badge " + (q.enabled ? "badge-warn" : "badge-muted");
    if (!q.enabled) { $("#qk-body").innerHTML = `<p>Hızlı komutlar kapalı (QUICK_COMMANDS=false). Kullanıcı emir yolu yoktur; emirleri yalnızca ajan verir.</p>`; return; }
    const s = q.settings;
    const sims = q.sims.map((x) => `<li class="lvl-karar"><time>${F.time(x.openedAt)}</time><span><span class="badge badge-muted">SİMÜLASYON</span> ${T.esc(x.instId.replace("-USDT", ""))} ${x.side} ${x.leverage}x · teminat ${x.marginUsdt} · giriş ${F.price(x.entryPx)} · likidasyon ${F.price(x.liqPx)} · <b class="${T.cls(x.pnlUsdt)}">${F.signed(x.pnlUsdt, 3)} USDT</b>${x.liquidated ? " · likide oldu" : ""}</span></li>`).join("");
    $("#qk-body").innerHTML = `<p>Telegram ve mentorda <span class="mono">/al SOL 5</span>, <span class="mono">/sat SOL</span>, <span class="mono">/kapat SOL</span>: komutun kendisi onaydır; sert limitler ve zorunlu stop geçerli. Kaldıraçlı <span class="mono">/l</span>, <span class="mono">/s</span> yalnızca SİMÜLASYON.</p>
      <form id="qk-form" style="display:grid;gap:8px;grid-template-columns:1fr 1fr 1fr;align-items:end">
        <label>Varsayılan tutar (USDT)<input id="qk-amt" type="number" min="1" max="5" step="0.5" value="${s.amountUsdt}" style="width:100%"></label>
        <label>Stop türü<select id="qk-mode" style="width:100%"><option value="atr" ${s.stopMode === "atr" ? "selected" : ""}>ATR × k</option><option value="pct" ${s.stopMode === "pct" ? "selected" : ""}>%</option></select></label>
        <label>Değer<input id="qk-val" type="number" min="0.3" max="10" step="0.1" value="${s.stopValue}" style="width:100%"></label>
      </form>${sims ? `<h3 style="margin-top:10px">Simülasyon pozisyonları</h3><ul class="log">${sims}</ul>` : ""}`;
    const save = () => T.api("/api/settings/quick", { body: { amountUsdt: Number($("#qk-amt").value), stopMode: $("#qk-mode").value, stopValue: Number($("#qk-val").value) } }).then(() => T.toast("Hızlı mod ayarları kaydedildi."));
    ["#qk-amt", "#qk-mode", "#qk-val"].forEach((id) => $(id).addEventListener("change", save));
  }

  const refreshAll = () => Promise.allSettled([loadPortfolio(), loadContract(), loadEvents(), loadAtk(), loadLedger(), loadQuick()]);
  refreshAll();
  T.on("status", renderStatus);
  if (T.status) renderStatus(T.status);
  T.on("event", (e) => { const ul = $("#ev-list"); const st = ul.scrollTop; ul.insertAdjacentHTML("afterbegin", evRow(e)); if (st > 0) ul.scrollTop = st + ul.firstElementChild.offsetHeight; while (ul.children.length > 150) ul.lastElementChild.remove(); });
  let t1 = 0;
  const soon = () => { clearTimeout(t1); t1 = setTimeout(refreshAll, 400); };
  T.on("positions", (p) => renderPositions(p));
  T.on("scan", () => { soon(); T.refreshStatus(); });
  T.on("warning", () => loadContract());
  T.on("agent", () => T.refreshStatus());
  setInterval(() => { loadAtk(); loadPortfolio(); }, 10000);
  window.addEventListener("resize", () => { clearTimeout(t1); t1 = setTimeout(loadPortfolio, 300); });
})();
