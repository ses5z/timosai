(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s);
  const STATES = { ready: "HAZIR", listening: "DİNLİYOR", thinking: "DÜŞÜNÜYOR", speaking: "KONUŞUYOR" };
  $("#mic").innerHTML = T.icon("mic");
  $("#send-btn").innerHTML = T.icon("send");
  $("#btn-mute").innerHTML = T.icon("volumeOff") + " Sustur";
  const CHIPS = ["Durum", "Adaylar", "SOL analizi", "Portföyüm", "Takip listem", "Plan oluştur", "Ajan ne yapıyor?", "Risk bütçesini %1 yap"];
  $("#chips").innerHTML = CHIPS.map((c) => `<button class="chip" type="button">${T.esc(c)}</button>`).join("");

  let state = "ready";
  function setState(s) {
    state = s;
    $("#state-badge").textContent = STATES[s];
    $("#state-badge").dataset.state = s;
    $("#pulse").dataset.state = s;
    $("#mic").setAttribute("aria-pressed", String(s === "listening"));
    $("#mic").setAttribute("aria-label", s === "listening" ? "Dinlemeyi durdur" : "Konuşmaya başla");
  }

  // ---- Konuşma sentezi: cümle cümle ----
  const synth = window.speechSynthesis;
  let trVoice = null;
  const pickVoice = () => { trVoice = (synth?.getVoices() || []).find((v) => /^tr/i.test(v.lang)) || null; };
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!synth || !$("#speak-out").checked) return Promise.resolve();
    synth.cancel();
    const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+(?=[A-ZÇĞİÖŞÜ0-9])/u).filter(Boolean);
    setState("speaking");
    return new Promise((resolve) => {
      let i = 0;
      const next = () => {
        if (i >= sentences.length || state !== "speaking") { if (state === "speaking") setState("ready"); return resolve(); }
        const u = new SpeechSynthesisUtterance(sentences[i++].trim());
        u.lang = "tr-TR";
        if (trVoice) u.voice = trVoice;
        u.rate = 1.02;
        u.onend = next;
        u.onerror = next;
        synth.speak(u);
      };
      next();
    });
  }
  $("#btn-mute").addEventListener("click", () => { synth?.cancel(); if (state === "speaking") setState("ready"); });

  // ---- Konuşma tanıma ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (!SR) {
    $("#mic").disabled = true;
    $("#speech-note").hidden = false;
    $("#speech-note").textContent = "Bu tarayıcı sesli girişi desteklemiyor; yazı kutusunu kullanabilirsin.";
    $("#voice-chat").disabled = true;
  }
  function listen() {
    if (!SR) return;
    synth?.cancel();
    rec = new SR();
    rec.lang = "tr-TR";
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      $("#msg").value = finalText || interim;
    };
    rec.onerror = (e) => { setState("ready"); if (e.error !== "no-speech" && e.error !== "aborted") T.toast("Ses alınamadı: " + e.error); };
    rec.onend = () => { if (state === "listening") setState("ready"); if (finalText.trim()) send(finalText.trim(), "ses"); };
    setState("listening");
    try { rec.start(); } catch { setState("ready"); }
  }
  $("#mic").addEventListener("click", () => { if (state === "listening") { rec?.stop(); } else listen(); });

  // ---- Gönderim ----
  async function send(text, via = "web", detail = false) {
    if (!text) return;
    $("#msg").value = "";
    renderLast(text, null);
    setState("thinking");
    try {
      const r = await T.api("/api/mentor/chat", { body: { text, via, detail, mode: document.body.dataset.mode } });
      renderLast(text, r);
      $("#provider-badge").textContent = `Mentor: ${r.ai ? "yapay zeka" : "kural tabanlı"}`;
      setState("ready");
      await speak(r.text);
      if ($("#voice-chat").checked && SR) setTimeout(listen, 350);
    } catch (e) {
      setState("ready");
      renderLast(text, { text: "Şu an cevap veremiyorum: " + e.message, provider: "-" });
    }
  }
  function renderLast(userText, r) {
    $("#last-convo").innerHTML = `<div class="bubble user"><small>Sen</small>${T.esc(userText)}</div>` + (r ? `<div class="bubble mentor"><small>Mentor · ${T.esc(r.provider)}${r.detail ? " · ayrıntılı" : ""}</small><span class="pre">${T.esc(r.text)}</span>${r.canDetail ? `<div><button type="button" class="detail-btn" data-detail-q="${T.esc(r.question || userText)}">Ayrıntı</button></div>` : ""}</div>` : `<div class="bubble mentor"><small>Mentor</small><span class="muted">Düşünüyor…</span></div>`);
    renderConfirm(r && r.pending);
  }
  function renderConfirm(p) {
    const area = $("#confirm-area");
    if (!p) { area.innerHTML = ""; return; }
    area.innerHTML = `<div class="confirm-box" role="group" aria-label="Onay"><span>${T.icon("info")} ${T.esc(p.summary)}</span><button class="btn btn-sm btn-primary" type="button" data-yes>Onayla</button><button class="btn btn-sm" type="button" data-no>Vazgeç</button><span class="faint" style="font-size:.8rem">Sesle "evet" ya da "hayır" da diyebilirsin.</span></div>`;
    const done = async (yes) => {
      const r = await T.api("/api/mentor/confirm", { body: { id: p.id, yes } });
      area.innerHTML = "";
      $("#last-convo").insertAdjacentHTML("beforeend", `<div class="bubble mentor"><small>Mentor</small>${T.esc(r.text)}</div>`);
      speak(r.text);
    };
    area.querySelector("[data-yes]").addEventListener("click", () => done(true));
    area.querySelector("[data-no]").addEventListener("click", () => done(false));
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-detail-q]");
    if (b) send(b.dataset.detailQ, "web", true);
  });
  $("#composer").addEventListener("submit", (e) => { e.preventDefault(); send($("#msg").value.trim()); });
  $("#chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) send(b.textContent); });

  // ---- Geçmiş (Telegram ile ortak) ----
  const hist = $("#history");
  const bubble = (m) => `<div class="bubble ${m.role}"><small>${m.role === "user" ? "Sen" : "Mentor"} · ${m.via === "telegram" ? "Telegram" : m.via === "ses" ? "ses" : "web"} · ${T.fmt.time(m.ts)}</small><span class="pre">${T.esc(m.text)}</span></div>`;
  async function loadHistory() {
    const d = await T.api("/api/mentor/history");
    hist.innerHTML = d.history.map(bubble).join("") || `<p class="muted">Henüz sohbet yok.</p>`;
    hist.scrollTop = hist.scrollHeight;
    $("#provider-badge").textContent = `Mentor: ${d.status.ai ? "yapay zeka (" + d.status.provider + ")" : "kural tabanlı"}`;
  }
  T.on("chat", (m) => {
    const atBottom = hist.scrollHeight - hist.scrollTop - hist.clientHeight < 40;
    if (hist.querySelector("p.muted")) hist.innerHTML = "";
    hist.insertAdjacentHTML("beforeend", bubble(m));
    if (atBottom) hist.scrollTop = hist.scrollHeight;
  });
  loadHistory();
  const q = new URLSearchParams(location.search).get("q");
  if (q) send(q.slice(0, 200));
})();
