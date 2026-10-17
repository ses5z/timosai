(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s), F = T.fmt;
  const map = $("#treemap"), tip = $("#tm-tip");
  let data = [], colorMode = T.store.get("tms-hm-color") || "change", openId = null, lastFocus = null;

  // ---- Squarified treemap ----
  function squarify(items, x, y, w, h) {
    const out = [];
    const total = items.reduce((s, i) => s + i.value, 0);
    if (!total || w <= 0 || h <= 0) return out;
    const scale = (w * h) / total;
    let rest = items.map((i) => ({ ...i, area: i.value * scale }));
    while (rest.length) {
      const short = Math.min(w, h);
      let row = [rest[0]], best = worst(row, short), i = 1;
      while (i < rest.length) {
        const cand = row.concat(rest[i]);
        const wc = worst(cand, short);
        if (wc > best) break;
        row = cand; best = wc; i++;
      }
      const sum = row.reduce((s, r) => s + r.area, 0);
      const thick = sum / short;
      let off = 0;
      for (const r of row) {
        const len = r.area / thick;
        if (w >= h) out.push({ ...r, x, y: y + off, w: thick, h: len });
        else out.push({ ...r, x: x + off, y, w: len, h: thick });
        off += len;
      }
      if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
      rest = rest.slice(row.length);
    }
    return out;
  }
  function worst(row, short) {
    const s = row.reduce((a, r) => a + r.area, 0);
    const mx = Math.max(...row.map((r) => r.area)), mn = Math.min(...row.map((r) => r.area));
    return Math.max((short * short * mx) / (s * s), (s * s) / (short * short * mn));
  }

  // ---- Renk ölçekleri (AA kontrast için koyu tonlar) ----
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  const NEU = [44, 54, 76], GRN = [30, 120, 78], RED = [150, 44, 48], AMB = [150, 104, 28];
  function color(c) {
    if (colorMode === "change") {
      const t = Math.max(-1, Math.min(1, c.change24hPct / 6));
      return t >= 0 ? mix(NEU, GRN, t) : mix(NEU, RED, -t);
    }
    const s = (c.opportunity - c.risk) / 60; // -1..1
    if (s >= 0.25) return mix(AMB, GRN, Math.min(1, (s - 0.25) / 0.5));
    if (s >= -0.1) return mix(NEU, AMB, (s + 0.1) / 0.35);
    return mix(NEU, RED, Math.min(1, (-s - 0.1) / 0.5));
  }
  function legend() {
    $("#legend").innerHTML = colorMode === "change"
      ? `<span>-6%</span><span class="grad" style="background:linear-gradient(90deg,${mix(NEU, RED, 1)},rgb(${NEU}),${mix(NEU, GRN, 1)})"></span><span>+6%</span>`
      : `<span>riskli</span><span class="grad" style="background:linear-gradient(90deg,${mix(NEU, RED, 1)},rgb(${NEU}),rgb(${AMB}),${mix(AMB, GRN, 1)})"></span><span>fırsat</span>`;
    document.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === colorMode)));
  }

  function render() {
    const W = map.clientWidth, H = map.clientHeight;
    const groups = {};
    for (const c of data) (groups[c.category] = groups[c.category] || []).push(c);
    const gItems = Object.entries(groups).map(([name, list]) => ({ name, list, value: list.reduce((s, c) => s + Math.sqrt(Math.max(1, c.volUsdt24h)), 0) })).sort((a, b) => b.value - a.value);
    const gRects = squarify(gItems, 0, 0, W, H);
    let html = "";
    for (const g of gRects) {
      html += `<div class="tm-group" style="left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px" role="group" aria-label="${T.esc(g.name)}"><span class="tm-group-label">${T.esc(g.name)}</span></div>`;
      const items = g.list.map((c) => ({ c, value: Math.sqrt(Math.max(1, c.volUsdt24h)) })).sort((a, b) => b.value - a.value);
      const pad = 18;
      for (const r of squarify(items, g.x + 2, g.y + pad, g.w - 4, g.h - pad - 2)) {
        const c = r.c, small = r.w < 70 || r.h < 46, tiny = r.w < 44 || r.h < 30;
        const label = colorMode === "change" ? F.pct(c.change24hPct) : `F${c.opportunity} · R${c.risk}`;
        html += `<button type="button" class="tile${small ? " small" : ""}${tiny ? " tiny" : ""}" data-id="${T.esc(c.instId)}" aria-pressed="${c.instId === openId}" style="left:${r.x + 1}px;top:${r.y + 1}px;width:${Math.max(0, r.w - 2)}px;height:${Math.max(0, r.h - 2)}px;background:${color(c)}" aria-label="${T.esc(c.base)}, ${F.pct(c.change24hPct)}, fırsat ${c.opportunity}, risk ${c.risk}, ajan: ${T.esc(c.decision)}"><b>${T.esc(c.base)}</b><span>${T.esc(label)}</span></button>`;
      }
    }
    map.innerHTML = html;
    legend();
    $("#hm-info").textContent = `${data.length} coin · ${data[0] && data[0].live === false ? "örnek veri" : "canlı veri"}`;
  }

  async function load() {
    try {
      data = await T.api("/api/candidates");
      render();
      if (openId) refreshDrawer();
    } catch (e) { map.innerHTML = `<div class="empty">Veri alınamadı: ${T.esc(e.message)}</div>`; }
  }

  // ---- İpucu ----
  map.addEventListener("pointermove", (e) => {
    const t = e.target.closest(".tile");
    if (!t) { tip.hidden = true; return; }
    const c = data.find((x) => x.instId === t.dataset.id);
    if (!c) return;
    tip.hidden = false;
    tip.innerHTML = `<b>${T.esc(c.base)}</b> · ${T.esc(c.category)}<br>${F.price(c.price)} · <span class="${c.change24hPct >= 0 ? "" : ""}">${F.pct(c.change24hPct)}</span><br>Hacim ${F.vol(c.volUsdt24h)} USDT<br>Fırsat ${c.opportunity} · Risk ${c.risk} · ajan: ${T.esc(c.decision)}`;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + 250 > window.innerWidth) x = e.clientX - 254;
    if (y + 120 > window.innerHeight) y = e.clientY - 120;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  });
  map.addEventListener("pointerleave", () => (tip.hidden = true));
  map.addEventListener("click", (e) => { const t = e.target.closest(".tile"); if (t) { lastFocus = t; openDrawer(t.dataset.id, true); } });
  document.querySelectorAll("[data-color]").forEach((b) => b.addEventListener("click", () => { colorMode = b.dataset.color; T.store.set("tms-hm-color", colorMode); render(); }));

  // ---- Çekmece (salt okunur: Al/Sat yok) ----
  const PART = {
    momentum: ["İvme", "Son 4 saat ve 24 saatlik fiyat değişimi."],
    trend: ["Trend", "Fiyatın kısa (EMA20) ve orta (EMA50) ortalamalara göre konumu ve eğimi."],
    volume: ["Hacim", "Son saatteki işlem hacminin normale oranı."],
    rsi: ["RSI dengesi", "RSI 50-66 arası en yüksek puanı alır; aşırı alım/satım puanı düşürür."],
    volatility: ["Oynaklık dengesi", "ATR ılımlıysa yüksek puan; aşırı oynaklık düşürür."],
    funding: ["Funding", "Sıfıra yakın funding nötr; aşırı pozitif kalabalık long işareti."],
    sentiment: ["Haber duygusu", "OKX haber duygusu (ATK news). Erişilemezse \"veri yok\" gösterilir ve skora katılmaz."],
  };
  async function openDrawer(id, push) {
    openId = id;
    if (push) history.replaceState(null, "", `?s=${encodeURIComponent(id)}`);
    document.querySelectorAll(".tile").forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.id === id)));
    const root = $("#drawer-root");
    root.innerHTML = `<div class="drawer-backdrop" data-close></div><aside class="drawer drawer-wide" role="dialog" aria-modal="true" aria-labelledby="dr-h" id="drawer"><div class="grabber"></div><div id="dr-body"><p class="muted">Yükleniyor…</p></div></aside>`;
    root.querySelector("[data-close]").addEventListener("click", closeDrawer);
    await refreshDrawer(true);
  }
  async function refreshDrawer(first) {
    const body = $("#dr-body");
    if (!body || !openId) return;
    let d;
    try { d = await T.api("/api/coin/" + encodeURIComponent(openId)); } catch (e) { body.innerHTML = `<p class="down">${T.esc(e.message)}</p><button class="btn" data-x type="button">Kapat</button>`; body.querySelector("[data-x]").onclick = closeDrawer; return; }
    const c = d.candidate, p = d.position, s = d.size;
    if (!first && body.dataset.inst === c.instId) {
      // canlı güncelleme: yalnızca sayılar değişir, odak/kaydırma bozulmaz
      body.querySelector("[data-price]").textContent = F.price(c.price);
      const chg = body.querySelector("[data-chg]"); chg.textContent = F.pct(c.change24hPct); chg.className = T.cls(c.change24hPct);
      const pv = body.querySelector("[data-pos]"); if (pv) pv.innerHTML = posHtml(p);
      return;
    }
    body.dataset.inst = c.instId;
    const parts = Object.entries(c.parts).map(([k, v]) => `<div class="part-row"><span>${PART[k][0]} <button type="button" class="term-btn" data-term="part-${k}" aria-label="${PART[k][0]} nedir?" aria-expanded="false">?</button></span>${v == null ? `<span class="faint">veri yok</span><b></b>` : `<div class="bar ${v < 35 ? "bad" : v < 55 ? "warn" : ""}"><span style="width:${v}%"></span></div><b class="num">${v}</b>`}</div>`).join("");
    Object.entries(PART).forEach(([k, [, txt]]) => (T.TERMS["part-" + k] = txt));
    body.innerHTML = `
      <div class="card-head" style="margin-bottom:4px"><h2 id="dr-h">${T.esc(c.base)} <span class="cat">${T.esc(c.category)}</span></h2><button class="btn btn-sm btn-ghost" type="button" data-x aria-label="Çekmeceyi kapat">${T.icon("x")}</button></div>
      <div class="price-row"><span class="kpi" data-price>${F.price(c.price)}</span><span data-chg class="${T.cls(c.change24hPct)}">${F.pct(c.change24hPct)}</span><span class="faint kpi-small">24 sa · hacim ${F.vol(c.volUsdt24h)} USDT</span></div>
      <div class="dr-top">
        <div id="dr-chart"></div>
        <aside class="ai-card" aria-labelledby="ai-h">
          <h3 id="ai-h">AI analizi</h3>
          <p style="margin:0 0 6px"><span class="pill pill-${T.esc(c.decision)}">ajan: ${T.esc(c.decision)}</span> <b>${T.esc(c.direction)}</b></p>
          <p style="margin:0 0 8px">${T.esc(c.reason)}</p>
          <p class="kpi-small" style="margin:0 0 6px"><b>Vadeli:</b> <span id="ai-deriv">${c.derivatives && c.derivatives.available ? `${T.derivBadge(c.derivatives)} ${T.esc(c.derivatives.reasons[0])}` : "veri yok"}</span></p>
          <p class="kpi-small" style="margin:0"><b>Hold / arz:</b> <span id="ai-hold">yükleniyor…</span></p>
        </aside>
      </div>
      <section><h3>Giriş, stop, hedef</h3><div class="levels"><div class="level"><span>Giriş</span><b>${F.price(c.entry)}</b></div><div class="level stop"><span>${T.term("stop", "Stop")}</span><b>${F.price(c.stop)}</b></div><div class="level target"><span>Hedef</span><b>${F.price(c.target)}</b></div><div class="level"><span>${T.term("rr", "R:R")}</span><b>${c.rr}</b></div></div>
        <p class="kpi-small" style="margin-top:8px">Risk bütçene göre örnek boyut: <b>${s.notionalUsdt > 0 ? F.usd(s.notionalUsdt) : "yok"}</b>${s.notionalUsdt > 0 ? ` · stop olursa ≈ ${F.num(s.riskUsdt, 3)} USDT` : ""}. <span class="pro-only">${T.esc(s.explain)}</span></p></section>
      <section data-pos>${posHtml(p)}</section>
      <section><h3>Vadeli durum</h3><div id="dr-deriv">${T.derivCard(c.derivatives)}</div></section>
      <section><h3>Hold raporu</h3><div id="dr-hold"><p class="kpi-small">Yükleniyor…</p></div></section>
      <section><h3>Skor bileşenleri</h3><p class="kpi-small">${T.term("opportunity", "Fırsat")} ${c.opportunity} · ${T.term("risk", "Risk")} ${c.risk}<span class="pro-only"> · ${T.term("rsi", "RSI")} ${c.rsi ?? "-"} · ${T.term("atr", "ATR")} %${c.atrPct} · ${T.term("funding", "Funding")} ${c.funding == null ? "-" : (c.funding * 100).toFixed(4) + "%"}</span></p>${parts}</section>
      <section class="pro-only"><h3>Neden?</h3><ul class="cautions">${c.whyBullets.map((b) => `<li>${T.esc(b)}</li>`).join("")}</ul><p class="kpi-small">Güvenlik özeti <span class="badge badge-warn">${T.esc(c.security.label)}</span>: ${T.esc(c.security.level)} · makas (gerçek) ${c.security.spreadPct == null ? "ölçülmedi" : "%" + c.security.spreadPct}</p></section>
      <section style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn heart-btn" type="button" data-follow aria-pressed="${d.followed}">${T.icon("heart")} <span>${d.followed ? "Takipte" : "Takibe al"}</span></button>
        <button class="btn" type="button" data-priority ${d.prioritized ? "disabled" : ""}>${T.icon("arrowUp")} ${d.prioritized ? "Öncelikli" : "Ajana öncelik ver"}</button>
        <a class="btn btn-ghost" href="/mentor?q=${encodeURIComponent(c.base + " analizi")}">Mentora sor</a>
      </section>
      <p class="faint" style="font-size:.8rem">Öncelik ajanın tarama sırasını yükseltir; emir değildir. Emirleri yalnızca ajan, sözleşme ve sert limitler içinde verir.</p>`;
    if (window.__drChart) window.__drChart.destroy();
    window.__drChart = T.tvChart(body.querySelector("#dr-chart"), c.instId, { height: 280, levels: { entry: c.entry, stop: c.stop, target: c.target }, showLevels: false });
    body.querySelector("[data-x]").addEventListener("click", closeDrawer);
    body.querySelector("[data-follow]").addEventListener("click", async (e) => {
      const b = e.currentTarget, on = b.getAttribute("aria-pressed") === "true";
      if (on) await T.api("/api/follows/" + encodeURIComponent(c.instId), { method: "DELETE" });
      else await T.api("/api/follows", { body: { instId: c.instId } });
      b.setAttribute("aria-pressed", String(!on));
      b.querySelector("span").textContent = on ? "Takibe al" : "Takipte";
      T.toast(on ? `${c.base} takipten çıktı.` : `${c.base} takipte.`);
    });
    body.querySelector("[data-priority]").addEventListener("click", async (e) => {
      await T.api("/api/priority", { body: { instId: c.instId } });
      e.currentTarget.disabled = true;
      e.currentTarget.innerHTML = `${T.icon("arrowUp")} Öncelikli`;
      T.toast(`${c.base} ajanın tarama sırasında öne alındı.`);
    });
    if (first) body.querySelector("[data-x]").focus();
    T.api("/api/hold/" + encodeURIComponent(c.instId)).then((h) => {
      const el = body.querySelector("#dr-hold"); if (!el) return;
      const m = h.metrics, n = (v, d = 2) => (v == null ? "-" : Number(v).toFixed(d));
      const cls = h.verdict === "hold profiline uygun" ? "badge-ok" : h.verdict === "kısa vade trade edilebilir" ? "badge-warn" : "badge-bad";
      const aiH = body.querySelector("#ai-hold");
      if (aiH) aiH.innerHTML = `<span class="badge ${cls}">${T.esc(h.verdict)}</span> ${T.esc(h.reasons[0] || "")}`;
      el.innerHTML = `<div class="view-box"><p style="margin:0 0 6px"><span class="badge ${cls}">${T.esc(h.verdict)}</span></p><ul class="cautions">${h.reasons.map((r) => `<li>${T.esc(r)}</li>`).join("")}</ul>
        <div class="pro-only kpi-small" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:8px">
          <span>Dolaşım oranı</span><b class="num">${m.circulatingRatio == null ? "-" : "%" + (m.circulatingRatio * 100).toFixed(0)}</b>
          <span>${T.term("fdv", "FDV/piyasa değeri")}</span><b class="num">${n(m.fdvToMc)}</b>
          <span>Piyasa değeri / FDV</span><b class="num">${m.marketCap == null ? "-" : T.fmt.vol(m.marketCap)} / ${m.fdv == null ? "-" : T.fmt.vol(m.fdv)}</b>
          <span>Dolaşım dışı arz</span><b class="num">${m.outsideSupplyPct == null ? "-" : n(m.outsideSupplyPct, 1) + "%"}</b>
          <span>90 gün kilit açılımı</span><b class="num">%${n(m.unlock90dPct, 1)} <span class="badge badge-warn">ÖRNEK VERİ</span></b>
          <span>Cüzdan dağılımı</span><b>${T.esc(h.distribution.status)}</b>
        </div><p class="faint" style="font-size:.78rem;margin:8px 0 0">Arz: ${T.esc(h.supply ? h.supply.source : "veri yok")}. ${T.esc(h.distribution.note)}</p></div>`;
    }).catch(() => {});
    T.api("/api/derivatives/" + encodeURIComponent(c.instId)).then((dv) => {
      const el = body.querySelector("#dr-deriv"); if (el) el.innerHTML = T.derivCard(dv);
      const ai = body.querySelector("#ai-deriv"); if (ai) ai.innerHTML = dv.available ? `${T.derivBadge(dv)} ${T.esc(dv.reasons[0])}` : "veri yok";
    }).catch(() => {});
  }
  function posHtml(p) {
    if (!p) return `<h3>Pozisyon</h3><p class="kpi-small">Bu coinde açık pozisyon yok.</p>`;
    return `<h3>Pozisyon <span class="badge ${p.mode === "PAPER" ? "badge-dry" : "badge-live"}">${p.mode}</span></h3><div class="view-box"><b class="num ${T.cls(p.pnlUsdt)}">${F.signed(p.pnlUsdt, 3)} USDT (${F.pct(p.pnlPct)})</b><p class="kpi-small" style="margin:6px 0 0">Giriş ${F.price(p.entryPx)} · stop ${F.price(p.stopPx)} · hedef ${F.price(p.targetPx)} · ${F.num(p.costUsdt, 2)} USDT${p.trailing ? " · iz süren stop" : ""}</p></div>`;
  }
  function closeDrawer() {
    $("#drawer-root").innerHTML = "";
    openId = null;
    history.replaceState(null, "", location.pathname);
    document.querySelectorAll(".tile").forEach((t) => t.setAttribute("aria-pressed", "false"));
    const back = lastFocus && document.querySelector(`.tile[data-id="${lastFocus.dataset.id}"]`);
    back && back.focus();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openId && !document.querySelector(".modal-backdrop") && !document.querySelector(".term-tip")) closeDrawer();
    if (e.key === "Tab" && openId) {
      const dr = $("#drawer"); if (!dr) return;
      const f = [...dr.querySelectorAll("button:not([disabled]), a[href]")];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // ---- Canlı ----
  let rt = 0;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 200); });
  T.on("candidates", () => load());
  T.on("prices", (pr) => {
    let changed = false;
    for (const c of data) { const v = pr[c.instId]; if (v) { c.price = v.p; c.change24hPct = v.c; changed = true; } }
    if (!changed) return;
    // renkleri yerinde güncelle (DOM'u yeniden kurmadan)
    document.querySelectorAll(".tile").forEach((t) => {
      const c = data.find((x) => x.instId === t.dataset.id);
      if (!c) return;
      t.style.background = color(c);
      if (colorMode === "change") { const sp = t.querySelector("span"); if (sp) sp.textContent = F.pct(c.change24hPct); }
    });
    if (openId) refreshDrawer(false);
  });
  T.on("status", (s) => { $("#notices").innerHTML = s.liveData ? "" : `<div class="notice notice-warn">${T.icon("warn")}<span>Canlı veri yok: örnek veri gösteriliyor.</span></div>`; });

  load().then(() => {
    const s = new URLSearchParams(location.search).get("s");
    if (s && /^[A-Z0-9]{2,12}-USDT$/.test(s)) openDrawer(s, false);
  });
})();
