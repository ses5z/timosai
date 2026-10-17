(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s);
  const box = $("#pv-msgs");
  const SAMPLE = [
    { dir: "in", text: "/kesfet", ts: Date.now() - 60000, sent: true, sample: true },
    { dir: "out", text: "SOL · Katman 1\n105,08 (+1,2% 24 sa)\n▃▄▄▅▄▆▆▇▆▇██▇██▇\nFırsat 68 · Risk 31 · ajan: aç", buttons: ["💔 Geç", "❤️ Takibe al"], ts: Date.now() - 58000, sent: false, sample: true },
  ];
  const msg = (m) => `<div class="tg-msg ${m.dir}">${m.photo ? `<img src="${T.esc(m.photo)}" alt="Grafik" class="tg-photo" loading="lazy">` : ""}${T.esc(m.text)}${m.buttons && m.buttons.length ? `<div class="tg-btns">${m.buttons.map((b) => `<span>${T.esc(b)}</span>`).join("")}</div>` : ""}<small>${T.fmt.time(m.ts)}${m.sample ? " · örnek" : m.dir === "out" && !m.sent ? " · gönderilmedi" : ""}</small></div>`;
  let items = [];
  function render() {
    const list = items.length ? items : SAMPLE;
    box.innerHTML = list.map(msg).join("");
    box.scrollTop = box.scrollHeight;
  }
  async function load() {
    const d = await T.api("/api/telegram");
    const s = d.status;
    $("#tg-status").textContent = s.connected ? "Bağlı" : s.enabled ? "Bağlanamadı" : "Kapalı";
    $("#tg-status").className = "badge " + (s.connected ? "badge-ok" : s.enabled ? "badge-warn" : "badge-muted");
    $("#tg-info").innerHTML = `
      <p>Durum: <b>${s.connected ? "bağlı" : s.enabled ? "jeton var, bağlantı kurulamadı" : "kapalı (.env'de TELEGRAM_BOT_TOKEN boş)"}</b></p>
      <p>Bot: <b>${T.esc(s.username || "-")}</b> · İzinli kullanıcı: <b>${s.allowedUserSet ? "ayarlı" : "ayarlı değil (TELEGRAM_ALLOWED_USER_ID)"}</b></p>
      <p>Gönderilen mesaj: <b class="num">${s.sent}</b>${s.lastError ? ` · <span class="down">Son hata: ${T.esc(s.lastError)}</span>` : ""}</p>
      <p class="faint" style="margin:0">Jeton bu sayfada ve günlüklerde asla gösterilmez.</p>`;
    if (s.username) $("#pv-name").textContent = s.username;
    $("#pv-sub").textContent = s.connected ? "çevrimiçi" : "önizleme";
    items = d.preview;
    render();
    renderSettings(d.settings);
  }
  function renderSettings(n) {
    $("#n-dev").checked = n.developments;
    $("#n-crit").checked = n.critical;
    $("#n-sum").checked = n.opportunitySummary;
    $("#quiet-info").textContent = n.quietUntil > Date.now() ? `${new Date(n.quietUntil).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}'e kadar sessiz` : "Kapalı";
  }
  const save = async (body) => renderSettings(await T.api("/api/settings/notifications", { body }));
  $("#n-dev").addEventListener("change", (e) => save({ developments: e.target.checked }));
  $("#n-crit").addEventListener("change", (e) => save({ critical: e.target.checked }));
  $("#n-sum").addEventListener("change", (e) => save({ opportunitySummary: e.target.checked }));
  document.querySelectorAll("[data-quiet]").forEach((b) => b.addEventListener("click", () => save({ quietMinutes: Number(b.dataset.quiet) })));
  T.on("telegram", (m) => { items.push(m); if (items.length > 40) items.shift(); render(); });
  load();
  setInterval(load, 30000);
})();
