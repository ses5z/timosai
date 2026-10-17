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

  T.api("/api/trading-plan").then(fill).catch(() => { $("#plan-coin-sum").textContent = "Plan yüklenemedi."; });
  T.on("plan", () => T.api("/api/trading-plan").then(fill).catch(() => undefined));
})();
