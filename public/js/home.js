(function () {
  "use strict";
  const T = window.TimosAI, $ = (s) => document.querySelector(s);
  $("#cta-mentor").innerHTML = T.icon("mic") + " Mentor ile görüş";
  $("#cta-panel").innerHTML = T.icon("chart") + " Kullanıcı paneline geç";
  $("#l-k").innerHTML = T.icon("compass") + " Keşfet";
  $("#l-h").innerHTML = T.icon("grid") + " Isı haritası";
  $("#l-t").innerHTML = T.icon("plane") + " Telegram";
  $("#l-a").innerHTML = T.icon("user") + " Hakkımızda";
  const MOTTOS = [
    "Önce stop, sonra hedef. Sıra hiç değişmez.",
    "Küçük boyut, net plan, sakin zihin.",
    "Piyasa yarın da açık; acele etmek zorunda değilsin.",
    "Kaçan fırsat, kaybedilen sermayeden ucuzdur.",
    "Planın yoksa, piyasanın planına uyarsın.",
    "Bugünün işi kurala uymak; kâr bunun yan ürünü.",
    "Bir işlem, bir gerekçe. Gerekçe yoksa işlem de yok.",
    "Ne kadar riske ettiğini önceden bil; gerisi gürültü.",
    "Sabır da bir pozisyondur.",
    "Kazanınca da kaybedince de aynı sakinlik.",
  ];
  let i = Math.floor(Date.now() / 86400000) % MOTTOS.length;
  const m = $("#motto");
  m.textContent = MOTTOS[i];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setInterval(() => {
    i = (i + 1) % MOTTOS.length;
    if (reduce) { m.textContent = MOTTOS[i]; return; }
    m.classList.add("fade");
    setTimeout(() => { m.textContent = MOTTOS[i]; m.classList.remove("fade"); }, 600);
  }, 7000);

  // Hafif canlı fiyat dokusu: arka planda soluk kıvılcım çizgileri
  async function texture() {
    try {
      const list = (await T.api("/api/candidates")).slice(0, 8);
      const w = 1200, h = 600;
      const paths = list.map((c, k) => `<path d="${T.sparkPath(c.spark, w, 120)}" transform="translate(0 ${30 + k * 70})" fill="none" stroke="${k % 2 ? "var(--coral)" : "var(--amber)"}" stroke-width="2"/>`).join("");
      $("#hero-bg").innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${paths}</svg>`;
    } catch {}
  }
  function strip(s) {
    $("#live-strip").innerHTML = `<span>Ajan: ${T.esc(s.agent.state)}</span><span>${s.agent.scanCount} tarama</span><span>${s.liveData ? "Canlı OKX verisi" : "Örnek veri"}</span><span>${s.tradingMode === "KURU" ? "Kuru çalışma" : "Gerçek işlem"}</span>`;
  }
  T.on("status", strip);
  texture();
  T.on("scan", texture);
})();
