/* Planım kartı: Basic sade (coin, yön, vade, risk, tutarlar, pozisyon), Pro tüm alanlar.
   Kaydedilen plan sunucuda limit kapısına uygulanır; canlıda tutarlar bakiyeyi aşamaz (tek sabit kural). */
(function () {
  "use strict";
  const T = window.TimosAI;
  const form = document.getElementById("plan-form");
  if (!form) return;
  const $ = (s) => document.querySelector(s);
  let data = null, selected = new Set();

  function renderCoins() {
    const q = $("#plan-coin-q").value.trim().toUpperCase();
    const list = data.coinsAvailable.filter((c) => !q || c.startsWith(q) || c.split("-")[0].includes(q));
    $("#plan-coin-list").innerHTML = list.map((c) => `<label class="chip plan-coin"><input type="checkbox" value="${c}" ${selected.has(c) ? "checked" : ""}> ${c.split("-")[0]}</label>`).join("") || `<span class="faint">Eşleşen coin yok.</span>`;
    $("#plan-coin-sum").textContent = `${selected.size} / ${data.coinsAvailable.length} coin seçili`;
  }

  function fill(d) {
    data = d;
    const p = d.plan;
    selected = new Set(p.coins);
    for (const el of form.elements) {
      if (!el.name || !(el.name in p)) continue;
      if (el.type === "checkbox") el.checked = Boolean(p[el.name]);
      else el.value = p[el.name];
    }
    $("#plan-mode").textContent = d.live ? `CANLI · bakiye ${d.balance} USDT` : "PAPER";
    $("#plan-mode").className = `badge ${d.live ? "badge-bad" : "badge-muted"}`;
    $("#plan-ref").textContent = `Plan: risk %${p.riskPct} · R:R ≥ ${p.minRR}${p.followLine ? " · trend çizgisi uyumlu" : ""}`;
    $("#plan-fixed").innerHTML = d.fixedRules.map((r) => `<li>${T.esc(r)}</li>`).join("");
    renderCoins();
    (d.notes || []).forEach((n) => T.toast(n, 5000));
  }

  $("#plan-coin-q").addEventListener("input", renderCoins);
  $("#plan-coin-list").addEventListener("change", (e) => {
    if (e.target.type !== "checkbox") return;
    if (e.target.checked) selected.add(e.target.value); else selected.delete(e.target.value);
    $("#plan-coin-sum").textContent = `${selected.size} / ${data.coinsAvailable.length} coin seçili`;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!selected.size) return T.toast("En az bir coin seç.");
    const body = { coins: [...selected] };
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      body[el.name] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
    }
    try {
      const d = await T.api("/api/trading-plan", { body });
      fill(d);
      T.toast(`Plan kaydedildi: tek işlem ≤ ${d.plan.maxOrderUsdt} USDT · toplam ≤ ${d.plan.maxTotalUsdt} USDT · ${d.plan.maxPositions} pozisyon.`);
    } catch (err) { T.toast(err.message); }
  });

  async function loadStats() {
    try { const st = await T.api("/api/setups/stats"); $("#setup-stats").textContent = `${st.text} (Mentor işlemi kurulumları)`; } catch { $("#setup-stats").textContent = "Kurulum istatistiği alınamadı."; }
  }
  T.renderBacktest = function (r) {
    const sgn = (v) => `${v >= 0 ? "+" : ""}${v}R`;
    return `<div class="kpi-row bt-kpis"><div class="stat"><span class="kpi-small">İşlem</span><b class="num">${r.trades}</b></div><div class="stat"><span class="kpi-small">Hedefe ulaşan</span><b class="num">%${r.hitPct}</b></div><div class="stat"><span class="kpi-small">Ort. R</span><b class="num ${T.cls(r.avgR)}">${sgn(r.avgR)}</b></div><div class="stat"><span class="kpi-small">Maks düşüş</span><b class="num">${r.maxDrawdownR}R</b></div><div class="stat"><span class="kpi-small">Long / short</span><b class="num">${r.long.trades} (${sgn(r.long.avgR)}) / ${r.short.trades} (${sgn(r.short.avgR)})</b></div></div>
      <p class="faint bt-meta">${T.esc(r.plan)} · vade ${T.esc(r.horizon)} · 4s kapanışları, ileriye bakış yok · ${r.coins.map((c) => c.split("-")[0]).join(", ")}${r.coinsNote ? ` · ${T.esc(r.coinsNote)}` : ""}</p>
      ${r.trades ? "" : `<p class="faint">Bu dönemde plan koşullarını sağlayan kurulum çıkmadı.</p>`}
      <p class="bt-note"><b>${T.esc(r.note)}</b></p>`;
  };
  $("#bt-run").addEventListener("click", async () => {
    const b = $("#bt-run");
    b.disabled = true;
    $("#bt-out").innerHTML = `<p class="faint">Son 30 günün 4s mumları test ediliyor…</p>`;
    try { $("#bt-out").innerHTML = T.renderBacktest(await T.api("/api/backtest", { method: "POST", body: {} })); }
    catch (e) { $("#bt-out").innerHTML = `<p class="faint">Backtest çalışmadı: ${T.esc(e.message)}</p>`; }
    finally { b.disabled = false; }
  });
  loadStats();
  setInterval(loadStats, 60_000);

  T.api("/api/trading-plan").then(fill).catch(() => { $("#plan-coin-sum").textContent = "Plan yüklenemedi."; });
  T.on("plan", () => T.api("/api/trading-plan").then(fill).catch(() => undefined));
})();
