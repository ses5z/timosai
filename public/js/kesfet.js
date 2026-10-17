(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s), F = T.fmt;
  $("#detail-toggle").innerHTML = T.detailToggle();
  $("#btn-pass").innerHTML = T.icon("x");
  $("#btn-like").innerHTML = T.icon("heart");
  $("#btn-undo").innerHTML = T.icon("undo");
  const deck = $("#deck");
  let queue = [], follows = [], canUndo = false, busy = false, dragging = false, lastLoad = 0;

  const DEC = { aç: "ajan: aç", izle: "ajan: izle", ele: "ajan: ele" };
  function cardHtml(c, behind) {
    const why = (c.whyBullets || []).map((b) => `<li>${T.esc(b)}</li>`).join("");
    const s = c.security || {};
    return `<article class="swipe-card${behind ? " behind" : ""}" data-inst="${T.esc(c.instId)}" ${behind ? 'aria-hidden="true"' : `tabindex="0" aria-roledescription="kaydırılabilir kart" aria-label="${T.esc(c.base)}: ${T.esc(c.reason)}"`}>
      <div class="stamp stamp-like" aria-hidden="true">LİSTEME</div><div class="stamp stamp-pass" aria-hidden="true">GEÇ</div>
      <header><div><h2>${T.esc(c.base)}</h2><span class="cat">${T.esc(c.category)} · ${T.esc(c.instId)}</span></div><div style="display:grid;gap:6px;justify-items:end"><span class="pill pill-${T.esc(c.decision)}">${DEC[c.decision]}</span>${T.derivBadge(c.derivatives)}</div></header>
      <div class="price-row"><span class="kpi" data-price>${F.price(c.price)}</span><span data-chg class="${T.cls(c.change24hPct)}">${F.pct(c.change24hPct)} <span class="faint">24 sa</span></span></div>
      <div class="mini-chart">${T.spark(c.spark, 400, 78)}</div>
      <div class="scores">
        <div class="score-box"><span class="kpi-small">${T.term("opportunity", "Fırsat")}</span><br><b>${c.opportunity}</b><div class="bar"><span style="width:${c.opportunity}%"></span></div></div>
        <div class="score-box"><span class="kpi-small">${T.term("risk", "Risk")}</span><br><b>${c.risk}</b><div class="bar ${c.risk >= 55 ? "bad" : c.risk >= 35 ? "warn" : ""}"><span style="width:${c.risk}%"></span></div></div>
      </div>
      <p class="kpi-small" style="margin:0">Yön: <b style="color:var(--text)">${T.esc(c.direction)}</b><span class="detail-only"> · ${T.term("rr", "R:R")} ${c.rr} · ${T.term("atr", "ATR")} %${c.atrPct}</span></p>
      <p class="reason">${T.esc(c.reason)}</p>
      <details><summary>Neden önerildi?</summary><ul>${why}</ul>
        <p class="kpi-small" style="margin:8px 0 0"><b>Güvenlik özeti</b> <span class="badge badge-warn">${T.esc(s.label || "ÖRNEK VERİ")}</span><br>Denetim: ${T.esc(s.contractAudit)} · Arz açılışı: ${T.esc(s.unlockNext30d)} · Yoğunlaşma: ${T.esc(s.concentration)}<br>Makas (gerçek): ${s.spreadPct == null ? "ölçülmedi" : "%" + s.spreadPct} · Derinlik: ${s.depthUsdt == null ? "-" : F.vol(s.depthUsdt) + " USDT"}</p>
      </details>
    </article>`;
  }

  function render() {
    $("#follow-count").textContent = `(${follows.length})`;
    $("#btn-undo").disabled = !canUndo;
    $("#queue-info").textContent = queue.length ? `Kuyrukta ${queue.length} aday · takip listende ${follows.length} coin` : "Kuyruk boş";
    if (!queue.length) {
      deck.innerHTML = `<div class="deck-empty"><div><p>Şimdilik bütün adaylara baktın.</p><button class="btn btn-sm" id="btn-reset" type="button">Geçtiklerimi yeniden göster</button></div></div>`;
      $("#btn-reset").addEventListener("click", async () => { await T.api("/api/queue/reset", { body: {} }); load(true); });
      $("#btn-pass").disabled = $("#btn-like").disabled = true;
      return;
    }
    $("#btn-pass").disabled = $("#btn-like").disabled = false;
    deck.innerHTML = (queue[1] ? cardHtml(queue[1], true) : "") + cardHtml(queue[0], false);
    bindDrag(deck.querySelector(".swipe-card:not(.behind)"));
  }

  async function load(force) {
    if (dragging || busy) return;
    if (!force && Date.now() - lastLoad < 5000) return;
    lastLoad = Date.now();
    try {
      const d = await T.api("/api/queue");
      const top = queue[0]?.instId;
      queue = d.queue;
      // görünen kart yeni kuyrukta da varsa en üstte kalsın (canlı yenileme akışı bozmasın)
      const i = queue.findIndex((q) => q.instId === top);
      if (i > 0) queue.unshift(queue.splice(i, 1)[0]);
      follows = d.follows;
      canUndo = d.canUndo;
      if (!force && top && queue[0]?.instId === top && deck.querySelector(".swipe-card")) { updateInfoOnly(); return; }
      render();
    } catch (e) {
      $("#queue-info").textContent = "Kuyruk alınamadı: " + e.message;
    }
  }
  function updateInfoOnly() {
    $("#follow-count").textContent = `(${follows.length})`;
    $("#btn-undo").disabled = !canUndo;
    $("#queue-info").textContent = `Kuyrukta ${queue.length} aday · takip listende ${follows.length} coin`;
  }

  async function decide(action) {
    if (busy || !queue.length) return;
    busy = true;
    const c = queue[0];
    const el = deck.querySelector(".swipe-card:not(.behind)");
    if (el) {
      el.classList.add("fly");
      el.style.transform = `translateX(${action === "like" ? 140 : -140}%) rotate(${action === "like" ? 18 : -18}deg)`;
      el.style.opacity = "0";
    }
    try {
      const r = await T.api("/api/swipe", { body: { instId: c.instId, action } });
      follows = r.follows;
      canUndo = true;
      if (action === "like") { renderAnalysis(r.analysis, c); T.toast(`${c.base} takip listende.`); }
    } catch (e) { T.toast(e.message); }
    setTimeout(() => { queue.shift(); busy = false; render(); deck.querySelector(".swipe-card:not(.behind)")?.focus({ preventScroll: true }); if (queue.length < 3) load(true); }, 260);
  }

  async function undo() {
    if (busy) return;
    const r = await T.api("/api/swipe/undo", { body: {} });
    if (r.ok) T.toast(`${r.last.instId.replace("-USDT", "")} geri alındı.`);
    queue = [];
    load(true);
  }

  function bindDrag(el) {
    if (!el) return;
    let x0 = 0, y0 = 0, dx = 0, id = null;
    const like = el.querySelector(".stamp-like"), pass = el.querySelector(".stamp-pass");
    el.addEventListener("pointerdown", (e) => {
      if (e.target.closest("summary, details, button")) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; dragging = true;
      el.setPointerCapture(id); el.classList.remove("settle");
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== id) return;
      dx = e.clientX - x0;
      const dy = e.clientY - y0;
      el.style.transform = `translate(${dx}px, ${dy * 0.15}px) rotate(${dx / 18}deg)`;
      like.style.opacity = String(Math.max(0, Math.min(1, dx / 110)));
      pass.style.opacity = String(Math.max(0, Math.min(1, -dx / 110)));
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; dragging = false;
      if (Math.abs(dx) > 110) return decide(dx > 0 ? "like" : "pass");
      el.classList.add("settle"); el.style.transform = ""; like.style.opacity = pass.style.opacity = "0";
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function renderAnalysis(a, c) {
    const box = $("#analysis");
    if (!a) { box.innerHTML = `<h2 id="an-h">Mentor analizi</h2><p class="muted">${T.esc(c.base)} için analiz hazırlanamadı.</p>`; return; }
    const L = a.levels, S = a.size;
    box.innerHTML = `<div class="card-head"><h2 id="an-h">${T.esc(a.base)} · mentor analizi</h2><span class="pill pill-${T.esc(a.decision)}">${DEC[a.decision]}</span></div>
      <p>${T.esc(a.headline)} <span class="muted">${T.esc(a.direction)}.</span></p>
      <div class="levels">
        <div class="level"><span>Giriş</span><b>${F.price(L.entry)}</b></div>
        <div class="level stop"><span>${T.term("stop", "Stop")}</span><b>${F.price(L.stop)}</b> <small class="faint">-%${L.stopPct}</small></div>
        <div class="level target"><span>Hedef</span><b>${F.price(L.target)}</b> <small class="faint">+%${L.targetPct}</small></div>
        <div class="level"><span>${T.term("rr", "R:R")}</span><b>${L.rr}</b></div>
      </div>
      <h3>Risk bütçene göre örnek boyut</h3>
      <p><b class="num">${S.notionalUsdt > 0 ? F.usd(S.notionalUsdt) : "Boyut yok"}</b> ${S.notionalUsdt > 0 ? `· stop olursa ≈ <b class="num">${F.num(S.riskUsdt, 3)} USDT</b>` : ""}</p>
      <p class="kpi-small">${T.esc(S.explain)}</p>
      <h3>Teknik tablo</h3>
      <div class="table-wrap" style="max-height:none"><table><tbody>${a.table.map((r) => `<tr><td>${T.esc(r.label)}</td><td class="num">${T.esc(r.value)}</td><td class="faint detail-only">${T.esc(r.note)}</td></tr>`).join("")}</tbody></table></div>
      <h3>Senaryolar</h3>
      <p class="kpi-small"><span class="up">Lehte:</span> ${T.esc(a.scenarios.lehte)}<br><span class="down">Aleyhte:</span> ${T.esc(a.scenarios.aleyhte)}</p>
      <h3>Dikkat edilecekler</h3>
      <ul class="cautions">${a.cautions.map((x) => `<li>${T.esc(x)}</li>`).join("")}</ul>
      <p style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn btn-sm" href="/mentor?q=${encodeURIComponent(a.base + " analizi")}">Mentora sor</a><a class="btn btn-sm btn-ghost" href="/isi-haritasi?s=${encodeURIComponent(a.instId)}">Ayrıntı çekmecesi</a></p>
      <p class="faint" style="font-size:.8rem">Yatırım tavsiyesi değildir. Emri ajan kendi kuralları ve sert limitler içinde verir.</p>`;
  }

  // ---- Liste görünümü ----
  async function loadFollows() {
    const d = await T.api("/api/follows");
    follows = d.follows.map((f) => f.instId);
    $("#follow-count").textContent = `(${follows.length})`;
    $("#follow-list").innerHTML = d.follows.length ? d.follows.map((f) => `<div class="follow-row"><div><b>${T.esc(f.base)}</b> ${f.decision ? `<span class="pill pill-${T.esc(f.decision)}">${DEC[f.decision]}</span>` : ""}<div class="meta"><span class="num">${F.price(f.price)}</span><span class="${T.cls(f.change24hPct)} num">${F.pct(f.change24hPct)}</span><span>Fırsat ${f.opportunity ?? "-"}</span><span>Risk ${f.risk ?? "-"}</span></div></div><button class="btn btn-sm btn-ghost" data-unfollow="${T.esc(f.instId)}" aria-label="${T.esc(f.base)} takibini bırak">Bırak</button></div>`).join("") : `<div class="empty">Takip listen boş. Kartları sağa kaydırarak ekleyebilirsin.</div>`;
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-unfollow]");
    if (!b) return;
    await T.api("/api/follows/" + encodeURIComponent(b.dataset.unfollow), { method: "DELETE" });
    loadFollows();
  });
  $("#btn-plan").addEventListener("click", async () => {
    const box = $("#plan-box");
    box.innerHTML = `<p class="muted">Hesaplanıyor…</p>`;
    try {
      const { plan, explanation } = await T.api("/api/plan", { body: {} });
      const rows = plan.rows.map((r) => `<tr><td>${T.esc(r.instId.replace("-USDT", ""))}</td><td class="num">${F.price(r.entry)}</td><td class="num">${F.price(r.stop)}</td><td class="num">${r.rr}</td><td class="num">${r.included ? F.num(r.notionalUsdt, 2) : "-"}</td><td class="num">${r.included ? F.num(r.riskUsdt, 3) : "-"}</td><td class="faint">${T.esc(r.note)}</td></tr>`).join("");
      box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Coin</th><th class="num">Giriş</th><th class="num">Stop</th><th class="num">R:R</th><th class="num">USDT</th><th class="num">Risk</th><th>Not</th></tr></thead><tbody>${rows || `<tr><td colspan="7">Takip listen boş.</td></tr>`}</tbody></table></div>
        <p style="margin-top:12px">${T.esc(explanation || "")}</p>
        <button class="btn btn-primary" id="btn-apply" type="button" ${plan.rows.some((r) => r.included) ? "" : "disabled"}>Ajana tercih olarak ilet</button>`;
      $("#btn-apply")?.addEventListener("click", async () => {
        await T.api("/api/plan/apply", { body: { symbols: plan.rows.filter((r) => r.included).map((r) => r.instId) } });
        T.toast("Plan ajana tercih olarak iletildi. Emri ajan verir.");
      });
    } catch (e) { box.innerHTML = `<p class="down">${T.esc(e.message)}</p>`; }
  });

  // ---- Sekmeler ----
  function tab(which) {
    const cards = which === "cards";
    $("#tab-cards").setAttribute("aria-selected", String(cards));
    $("#tab-list").setAttribute("aria-selected", String(!cards));
    $("#view-cards").hidden = !cards;
    $("#view-list").hidden = cards;
    if (!cards) loadFollows();
  }
  $("#tab-cards").addEventListener("click", () => tab("cards"));
  $("#tab-list").addEventListener("click", () => tab("list"));

  // ---- Klavye ----
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select") || $("#view-cards").hidden || document.querySelector(".modal-backdrop")) return;
    if (e.key === "ArrowRight") { e.preventDefault(); decide("like"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); decide("pass"); }
    else if (e.key === "Backspace") { e.preventDefault(); undo(); }
  });
  $("#btn-like").addEventListener("click", () => decide("like"));
  $("#btn-pass").addEventListener("click", () => decide("pass"));
  $("#btn-undo").addEventListener("click", undo);

  // ---- Canlı ----
  T.on("prices", (p) => {
    const el = deck.querySelector(".swipe-card:not(.behind)");
    if (!el || dragging) return;
    const v = p[el.dataset.inst];
    if (!v) return;
    el.querySelector("[data-price]").textContent = F.price(v.p);
    const chg = el.querySelector("[data-chg]");
    chg.className = T.cls(v.c);
    chg.innerHTML = `${F.pct(v.c)} <span class="faint">24 sa</span>`;
  });
  T.on("candidates", () => { if (!queue.length) load(true); });
  T.on("follows", (f) => { follows = f; updateInfoOnly(); });
  T.on("status", (s) => { $("#notices").innerHTML = s.liveData ? "" : `<div class="notice notice-warn">${T.icon("warn")}<span>Canlı veri yok: örnek veri gösteriliyor.</span></div>`; });
  load(true);
  setInterval(() => load(false), 60000);
})();
