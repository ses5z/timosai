/* Güvenlik taraması tablosu: kaynak sütunları (GoPlus, Honeypot.is, OKX OnchainOS; Timos simülasyonu varsa), satırlar,
   durum noktası + metin (renk tek başına anlam taşımaz), özet filtreleri, çelişki işareti, Timos kararı, ham değerler. */
(function () {
  "use strict";
  const T = window.TimosAI;
  const ST = { safe: "güvenli", warn: "uyarı", danger: "tehlike", unknown: "bilgi yok" };
  const ICON = { goplus: "eye", honeypot: "refresh", onchainos: "grid", timos: "play" };
  const VCLS = { PASS: "badge-ok", WARN: "badge-warn", BLOCK: "badge-bad" };
  const cell = (c) => `<span class="sdot sdot-${c.status}" aria-hidden="true"></span><span>${T.esc(c.value)}</span><span class="visually-hidden"> (${ST[c.status]})</span>`;

  T.renderSecurity = async function (box, chain, ca) {
    let t;
    try { t = await T.api(`/api/dex/scan?chain=${encodeURIComponent(chain)}&ca=${encodeURIComponent(ca)}`); } catch (e) { box.innerHTML = `<p class="down">${T.esc(e.message)}</p>`; return; }
    const pro = document.body.dataset.mode === "pro";
    const tok = t.columns.find((c) => c.token && c.token.symbol)?.token;
    const head = t.columns.map((c) => `<th scope="col"><span class="src-h">${T.icon(ICON[c.id] || "info")} ${T.esc(c.name)}</span><br><span class="faint src-note">${T.esc(c.available ? c.note : c.note || "kapalı")}</span></th>`).join("");
    const rows = t.rows.map((r, i) => `<tr class="sec-row${r.conflict ? " conflict" : ""}" data-status="${r.timos.status}" data-i="${i}" tabindex="0" aria-expanded="${pro}">
        <th scope="row"><span class="term">${T.esc(r.label)}<button type="button" class="term-btn" data-term="sec-${r.key}" aria-label="${T.esc(r.label)} neden önemli?" aria-expanded="false">i</button></span>${r.conflict ? `<br><span class="conflict-note">Kaynaklar çelişiyor</span>` : ""}</th>
        ${t.columns.map((c) => `<td>${cell(c.cells[r.key] || { value: "–", status: "unknown" })}</td>`).join("")}
        <td class="timos-col">${cell(r.timos)}</td></tr>
        <tr class="raw-row" data-raw="${i}" ${pro ? "" : "hidden"}><td colspan="${t.columns.length + 2}" class="mono faint">${t.columns.map((c) => `${T.esc(c.name)}: ${T.esc(JSON.stringify(c.cells[r.key]?.raw ?? c.cells[r.key]?.value ?? "–"))}`).join(" · ")}</td></tr>`).join("");
    t.rows.forEach((r) => (T.TERMS["sec-" + r.key] = r.why));
    box.innerHTML = `<div class="sec-wrap">
      <div class="sec-top">
        <div><b>${T.esc(tok ? `${tok.name} (${tok.symbol})` : "Bilinmeyen token")}</b> <span class="faint">· ${T.esc(t.chainName)} · <span class="mono">${T.esc(ca.slice(0, 8))}…${T.esc(ca.slice(-6))}</span></span>
          <p class="kpi-small" style="margin:4px 0 0">Holder: ${tok && tok.holders != null ? Number(tok.holders).toLocaleString("tr-TR") : "–"} · Likidite: ${t.liquidityUsd ? "≈ " + T.fmt.vol(t.liquidityUsd) + " USD" : "–"} · Fiyat ve piyasa değeri: OnchainOS anahtarı gerekli</p></div>
        <span class="badge ${VCLS[t.verdict]} verdict">${t.verdict}</span>
      </div>
      <div class="sec-pills" role="group" aria-label="Satır filtresi">
        <button type="button" class="chip" data-f="danger" aria-pressed="false"><span class="sdot sdot-danger"></span> Tehlike (${t.summary.danger})</button>
        <button type="button" class="chip" data-f="warn" aria-pressed="false"><span class="sdot sdot-warn"></span> Uyarı (${t.summary.warn})</button>
        <button type="button" class="chip" data-f="neutral" aria-pressed="false"><span class="sdot sdot-safe"></span> Nötr (${t.summary.neutral})</button>
      </div>
      <ul class="cautions">${t.reasons.map((x) => `<li>${T.esc(x)}</li>`).join("")}</ul>
      <div class="table-wrap sec-table" style="max-height:none"><table><thead><tr><th scope="col">Kontrol</th>${head}<th scope="col" class="timos-col">Timos kararı</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="faint" style="font-size:.78rem;margin:8px 0 0">Kaynak alanı vermiyorsa "–". Timos simülasyonu (anvil fork) bu ortamda yok; sütun gizli. Oylama: herhangi bir kaynak honeypot → BLOCK; vergi > %10, mint, sahip bakiye değiştirme, kilitsiz LP → WARN; çelişkide simülasyon kazanır.</p></div>`;
    let filter = null;
    box.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => {
      filter = filter === b.dataset.f ? null : b.dataset.f;
      box.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.f === filter)));
      box.querySelectorAll(".sec-row").forEach((tr) => {
        const s = tr.dataset.status, show = !filter || (filter === "neutral" ? s === "safe" || s === "unknown" : s === filter);
        tr.hidden = !show;
        const raw = box.querySelector(`[data-raw="${tr.dataset.i}"]`);
        if (raw && !show) raw.hidden = true;
      });
    }));
    const toggle = (tr) => { const raw = box.querySelector(`[data-raw="${tr.dataset.i}"]`); raw.hidden = !raw.hidden; tr.setAttribute("aria-expanded", String(!raw.hidden)); };
    box.querySelectorAll(".sec-row").forEach((tr) => {
      tr.addEventListener("click", (e) => { if (!e.target.closest(".term-btn")) toggle(tr); });
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(tr); } });
    });
  };
})();
