/* Pro Long/Short: tüm OKX USDT perpetual coinleri. Sütunlar: Coin · Account % · Position % · Genel % · Funding · 24 sa hacim. */
(function () {
  "use strict";
  const T = window.TimosAI, F = T.fmt;
  const $ = (s) => document.querySelector(s);
  let src = "okx", data = null, extra = new Map();
  const pct = (v) => (v == null ? `<td class="num faint">–</td>` : `<td class="num ${v >= 70 ? "down" : v <= 35 ? "up" : ""}"><span class="lsbar" style="--p:${v.toFixed(0)}%"></span>${F.num(v, 0)}%</td>`);
  const vol = (v) => (v >= 1e9 ? `${F.num(v / 1e9, 2)} Mr` : v >= 1e6 ? `${F.num(v / 1e6, 1)} M` : `${F.num(v / 1e3, 0)} B`);
  const fund = (f) => (f == null ? `<td class="num faint">–</td>` : `<td class="num ${f > 0 ? "" : "up"}">${(f * 100).toFixed(4)}%</td>`);

  async function load() {
    try { data = await T.api(`/api/ls-all?source=${src}`); } catch (e) { $("#lsa-wrap").innerHTML = `<p class="kpi-small">L/S verisi alınamadı: ${T.esc(e.message)}</p>`; return; }
    const cats = [...new Set(data.rows.map((r) => r.category))].sort();
    const sel = $("#lsa-cat"), cur = sel.value;
    sel.innerHTML = `<option value="">Tüm kategoriler</option>` + cats.map((c) => `<option ${c === cur ? "selected" : ""}>${T.esc(c)}</option>`).join("");
    draw();
  }

  function filtered() {
    const q = $("#lsa-q").value.trim().toUpperCase(), cat = $("#lsa-cat").value, minVol = Number($("#lsa-vol").value || 0) * 1e6;
    return data.rows.map((r) => (extra.has(r.base) ? { ...r, ...extra.get(r.base) } : r)).filter((r) =>
      (!q || r.base.includes(q)) && (!cat || r.category === cat) && r.volUsdt24h >= minVol &&
      (!$("#lsa-long").checked || (r.account ?? -1) > 70) && (!$("#lsa-short").checked || (r.account ?? 101) < 35) &&
      (!$("#lsa-div").checked || (r.account != null && r.position != null && Math.abs(r.account - r.position) >= 15)));
  }

  function draw() {
    if (!data) return;
    const rows = filtered();
    const srcName = src === "okx" ? "OKX" : "Binance";
    $("#lsa-meta").textContent = `${data.filled}/${data.total} coin verili · arka planda hacim sırasıyla yenileniyor (5 dk önbellek)`;
    const sumRow = (r) => `<tr class="lsa-agg"><th scope="row">${T.esc(r.label)} <span class="faint">(${r.count})</span></th>${pct(r.account)}${pct(r.position)}${pct(r.general)}<td></td><td></td></tr>`;
    $("#lsa-sum").innerHTML = `<details><summary>Özet ve kategori satırları (24 sa hacim ağırlıklı)</summary><div class="table-wrap"><table class="dense"><thead><tr><th>Grup</th><th class="num">Account %</th><th class="num">Position %</th><th class="num">Genel %</th><th></th><th></th></tr></thead><tbody>${data.summary.map(sumRow).join("")}${data.categories.map(sumRow).join("")}</tbody></table></div></details>`;
    $("#lsa-wrap").innerHTML = `<table class="dense"><thead><tr><th>Coin</th><th class="num" title="Üst trader hesap long %">Account %</th><th class="num" title="Üst trader pozisyon long %">Position %</th><th class="num" title="Tüm hesaplar long %">Genel %</th><th class="num">Funding</th><th class="num">24 sa hacim</th></tr></thead>
      <tbody>${rows.slice(0, 300).map((r) => `<tr data-base="${T.esc(r.base)}"><th scope="row">${T.esc(r.base)} <span class="faint">${T.esc(r.category)}</span></th>${pct(r.account)}${pct(r.position)}${pct(r.general)}${fund(r.funding)}<td class="num">${vol(r.volUsdt24h)}</td></tr>`).join("") || `<tr><td colspan="6" class="faint">Filtreye uyan coin yok.</td></tr>`}</tbody></table>`;
    $("#lsa-note").textContent = `Kaynak: ${srcName} (${src === "okx" ? "rubik/stat: üst trader hesap + pozisyon, tüm hesaplar" : "futures/data: top trader hesap + pozisyon, global hesap"}, 5 dk). Hacim birimi: ${data.units.volume}. Funding: ${data.units.funding} (OKX). %70 üstü kırmızı, %35 altı yeşil. OKX ve Binance "üst trader" tanımları farklıdır.`;
  }

  document.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => {
    src = b.dataset.src;
    document.querySelectorAll("[data-src]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    extra.clear();
    load();
  }));
  ["#lsa-cat", "#lsa-vol", "#lsa-long", "#lsa-short", "#lsa-div"].forEach((id) => $(id).addEventListener("input", draw));
  $("#lsa-q").addEventListener("input", draw);
  $("#lsa-q").addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const base = $("#lsa-q").value.trim().toUpperCase();
    if (!base) return;
    T.toast(`${base} L/S verisi çekiliyor…`, 2000);
    try {
      const r = await T.api(`/api/ls-all/coin/${encodeURIComponent(base)}`);
      const s = src === "okx" ? r.okx : r.bn;
      extra.set(base, { account: s?.account ?? null, position: s?.position ?? null, general: s?.general ?? null });
      draw();
    } catch (err) { T.toast(err.message); }
  });
  if (document.body.dataset.mode === "pro") load();
  T.on("mode", (m) => { if (m === "pro" && !data) load(); });
  setInterval(() => { if (document.body.dataset.mode === "pro" && !document.hidden) load(); }, 60_000);
})();
