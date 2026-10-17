/* Long/Short tablosu bileşeni (ısı haritası sayfası + Pro Terminal). Long % = oran / (1 + oran). */
(function () {
  "use strict";
  const T = window.TimosAI, F = T.fmt;
  T.TERMS["ls-okx"] = "OKX üst trader: OKX'in en büyük pozisyonlu hesapları. 'Hesap' long hesap sayısı oranı, 'Pozisyon' long pozisyon büyüklüğü oranıdır. Kaynak: OKX vadeli verisi (ATK dışı).";
  T.TERMS["ls-bn"] = "Binance top trader: marjin bakiyesine göre en üst %20 hesap; tanım OKX'ten farklıdır. Genel: tüm hesaplar. Kaynak: Binance Futures public, 5 dk.";
  const COLS = [
    ["okxTopAccount", "OKX üst · hesap", "ls-okx"],
    ["okxTopPosition", "OKX üst · pozisyon", "ls-okx"],
    ["okxAccount", "OKX genel", "ls-okx"],
    ["bnTopAccount", "Binance üst · hesap", "ls-bn"],
    ["bnTopPosition", "Binance üst · pozisyon", "ls-bn"],
    ["bnGlobal", "Binance genel", "ls-bn"],
  ];
  const cell = (v) => {
    if (v == null) return `<td class="num faint">–</td>`;
    const cls = v >= 75 ? "down" : v <= 25 ? "up" : "";
    return `<td class="num ${cls}"><span class="lsbar" style="--p:${v.toFixed(0)}%"></span>${F.num(v, 0)}%</td>`;
  };
  T.lsTable = async function (el, opts = {}) {
    let view = opts.view || "summary", data = null;
    async function load() {
      try { data = await T.api("/api/longshort"); } catch { el.innerHTML = `<p class="kpi-small">L/S verisi yok.</p>`; return; }
      draw();
    }
    function draw() {
      const rows = view === "summary" ? data.summary : view === "category" ? data.categories : data.rows.map((r) => ({ ...r, label: r.base }));
      el.innerHTML = `<div class="ls-tools"><div class="tabs" role="tablist" aria-label="L/S görünümü">${[["summary", "Özet"], ["category", "Kategori"], ["coin", "Coin"]].map(([k, l]) => `<button role="tab" aria-selected="${view === k}" data-v="${k}">${l}</button>`).join("")}</div>
        <span class="kpi-small">Güncelleme: OKX ${data.updatedAt.okx ? F.time(data.updatedAt.okx) : "–"} · Binance ${data.updatedAt.binance ? F.time(data.updatedAt.binance) : "–"}</span></div>
        <div class="table-wrap ls-table" style="max-height:${opts.maxHeight || 420}px"><table><thead><tr><th>${view === "coin" ? "Coin" : view === "category" ? "Kategori" : "Grup"}</th>${COLS.map(([, l, t]) => `<th class="num">${T.term(t, l)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr><th scope="row">${T.esc(r.label)}${r.count != null && view !== "coin" ? ` <span class="faint">(${r.count})</span>` : ""}</th>${COLS.map(([k]) => cell(r[k])).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="faint" style="font-size:.75rem;margin:6px 0 0">Long % = oran / (1 + oran). Özet ve kategori satırları 24 sa USDT hacmine göre ağırlıklı. %75 üstü kırmızı, %25 altı yeşil (kalabalık taraf). OKX ve Binance "üst trader" tanımları farklıdır.</p>`;
      el.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => { view = b.dataset.v; draw(); }));
    }
    load();
    return { reload: load };
  };
})();
