// ---------- Helpers ----------
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONATE_KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WOCHENTAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseIso(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function fmtDate(iso) {
  if (!ISO_RE.test(iso || "")) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// Effektives Enddatum eines Termins (mehrtägig: endDatum, sonst datum).
function terminEndIso(t) {
  return t.endDatum && ISO_RE.test(t.endDatum) && t.endDatum >= t.datum ? t.endDatum : t.datum;
}
// Ein Termin ist vergangen, sobald sein letzter Tag vor heute liegt (ISO-Strings
// vergleichen sich lexikografisch korrekt als Datum).
function isPast(t) { return terminEndIso(t) < todayIso(); }
function isUpcoming(t) { return ISO_RE.test(t.datum || "") && !isPast(t); }

function sortKey(t) { return `${t.datum}T${(t.ganztags ? "" : t.startZeit) || "00:00"}`; }
function sortTermine(a, b) { return sortKey(a).localeCompare(sortKey(b)); }

function monthKey(iso) { return iso.slice(0, 7); }
function monthLabel(iso) { const dt = parseIso(iso); return `${MONATE[dt.getMonth()]} ${dt.getFullYear()}`; }

// Datumsspanne kompakt: "17.08.2026" bzw. "17.–20.08.2026" / "28.02.–02.03.2026".
function terminDatumLabel(t) {
  const start = t.datum, end = terminEndIso(t);
  if (end === start) return fmtDate(start);
  const [ys, ms, ds] = start.split("-"), [ye, me, de] = end.split("-");
  if (ys === ye && ms === me) return `${ds}.–${de}.${ms}.${ys}`;
  if (ys === ye) return `${ds}.${ms}.–${de}.${me}.${ys}`;
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}
function terminZeitLabel(t) {
  if (t.ganztags || (!t.startZeit && !t.endZeit)) return "ganztägig";
  if (t.startZeit && t.endZeit) return `${t.startZeit}–${t.endZeit} Uhr`;
  if (t.startZeit) return `ab ${t.startZeit} Uhr`;
  return `bis ${t.endZeit} Uhr`;
}
function wochentagLabel(iso) { return WOCHENTAGE[parseIso(iso).getDay()]; }

// ---------- State ----------
let appData = { meta: {}, kategorien: [], termine: [] };
let currentUser = null;
let editingTerminId = null;
// Anhänge, die im offenen Formular gerade bearbeitet werden. Neue Dateien werden
// erst beim Speichern hochgeladen (kein Waisen-Upload beim Abbrechen).
let pendingAnhaenge = [];   // Elemente: {id,name,mime,size,existing:true} | {file,name,mime,size,neu:true}
let removedExistingIds = []; // Ids bestehender Anhänge, die beim Speichern gelöscht werden
let persistTimer = null;

// Nutzer/Gruppen-Verzeichnis für den "Teilen mit"-Picker (nur für Bearbeiter,
// einmalig beim ersten Öffnen des Formulars geladen).
let directoryUsers = null;   // [{username, displayName}] | null solange nicht geladen
let directoryGroups = null;  // [{id, name}]
let pendingShareUsers = [];  // [{username, displayName}] im gerade offenen Formular
let pendingShareGroupIds = []; // [groupId] im gerade offenen Formular
// Terminvorschläge einer Umfrage im gerade offenen Formular.
let pendingUmfrageTermine = []; // [{id, datum}]

// ---------- Normalisierung & Lookups ----------
function normalizeData(data) {
  const d = data && typeof data === "object" ? data : {};
  return {
    meta: d.meta && typeof d.meta === "object" ? d.meta : {},
    kategorien: Array.isArray(d.kategorien) && d.kategorien.length ? d.kategorien : DEFAULT_KATEGORIEN.slice(),
    termine: Array.isArray(d.termine) ? d.termine : []
  };
}
function kategorieById(id) { return appData.kategorien.find((k) => k.id === id) || null; }
function katFarbe(id) { const k = kategorieById(id); return k ? k.farbe : "#6b7280"; }
function katName(id) { const k = kategorieById(id); return k ? k.name : "—"; }

// ---------- Rechte / Nutzer ----------
// Bearbeiten dürfen Site-Admins sowie Nutzer, deren Gruppe in der Tools-Übersicht
// für diese App Bearbeiten-Rechte hat (server-seitig aufgelöst, siehe fetchMe in
// db.js) — alle anderen eingeloggten Nutzer dürfen die Termine nur ansehen.
function canEdit() {
  if (!currentUser) return false;
  return currentUser.isAdmin || !!currentUser.canEdit;
}

// Sichtbarkeit eines Termins für den aktuell eingeloggten Nutzer: nicht-private
// Termine sind wie bisher für alle eingeloggten Nutzer sichtbar. Private Termine
// sieht nur der Ersteller, explizit geteilte Nutzer/Gruppen sowie Admins (gleiches
// Bypass-Muster wie bei der Tool-Sichtbarkeit in der Tools-Übersicht).
function terminVisibleFor(t) {
  if (!t.privat) return true;
  if (!currentUser) return false;
  if (currentUser.isAdmin) return true;
  if (t.ersteller && t.ersteller === currentUser.username) return true;
  if (Array.isArray(t.geteiltUsers) && t.geteiltUsers.includes(currentUser.username)) return true;
  if (Array.isArray(t.geteiltGruppen) && Array.isArray(currentUser.groupIds) &&
      t.geteiltGruppen.some((g) => currentUser.groupIds.includes(g))) return true;
  return false;
}

function terminIsUmfrage(t) { return !!(t.umfrage && t.umfrage.aktiv && Array.isArray(t.umfrage.termine) && t.umfrage.termine.length); }

function renderHeaderUser() {
  const el = document.getElementById("header-user");
  const el2 = document.getElementById("info-user");
  if (!currentUser) { if (el) el.textContent = ""; if (el2) el2.textContent = ""; return; }
  const name = (currentUser.vorname || currentUser.nachname)
    ? `${currentUser.vorname || ""} ${currentUser.nachname || ""}`.trim()
    : currentUser.username;
  const rolle = currentUser.isAdmin ? " (Admin)" : (canEdit() ? " (Bearbeiter)" : "");
  if (el) el.textContent = "👤 " + name + rolle;
  if (el2) el2.textContent = "Angemeldet als " + name + rolle +
    (canEdit() ? "" : " — Termine eintragen ist der Geschäftsstelle vorbehalten.");
}

function applyAdminVisibility() {
  const editable = canEdit();
  document.body.classList.toggle("can-edit", editable);
  document.querySelectorAll(".editor-only").forEach((el) => el.classList.toggle("hidden", !editable));
}

// ---------- Render: Termine ----------
function anhaengeHtml(t) {
  if (!Array.isArray(t.anhaenge) || t.anhaenge.length === 0) return "";
  return `<div class="tc-anhaenge">` + t.anhaenge.map((a) =>
    `<button type="button" class="anhang" data-file-id="${escapeHtml(a.id)}" data-file-name="${escapeHtml(a.name)}" data-mime="${escapeHtml(a.mime || "")}">📎 ${escapeHtml(a.name)}</button>`
  ).join("") + `</div>`;
}

// Terminvorschläge einer Umfrage als klickbare Haken/Kreuz-Zeilen direkt auf der
// Karte — abstimmen geht ohne das Formular zu öffnen (onCardClick fängt Klicks
// auf .umfrage-vote vor dem Karten-Klick-zum-Bearbeiten ab).
function umfrageHtml(t) {
  const stimmen = (t.umfrage && t.umfrage.stimmen) || {};
  const meinName = currentUser ? currentUser.username : null;
  const rows = t.umfrage.termine.map((c) => {
    let ja = 0, nein = 0, meins = null;
    Object.entries(stimmen).forEach(([user, votes]) => {
      const v = votes ? votes[c.id] : null;
      if (v === "ja") ja++; else if (v === "nein") nein++;
      if (user === meinName) meins = v || null;
    });
    const dt = parseIso(c.datum);
    return `
      <div class="umfrage-row" data-cand-id="${escapeHtml(c.id)}">
        <div class="umfrage-row-main">
          <span class="umfrage-date">${escapeHtml(WOCHENTAGE[dt.getDay()])}, ${escapeHtml(fmtDate(c.datum))}</span>
          <div class="umfrage-buttons">
            <button type="button" class="umfrage-vote ja${meins === "ja" ? " active" : ""}" data-termin-id="${escapeHtml(t.id)}" data-cand-id="${escapeHtml(c.id)}" data-val="ja">✓ ${ja}</button>
            <button type="button" class="umfrage-vote nein${meins === "nein" ? " active" : ""}" data-termin-id="${escapeHtml(t.id)}" data-cand-id="${escapeHtml(c.id)}" data-val="nein">✗ ${nein}</button>
            <button type="button" class="umfrage-details-toggle" data-termin-id="${escapeHtml(t.id)}" data-cand-id="${escapeHtml(c.id)}" aria-label="Zu-/Absagen einsehen" title="Zu-/Absagen einsehen">👥</button>
          </div>
        </div>
        <div class="umfrage-details hidden"></div>
      </div>`;
  }).join("");
  return `<div class="umfrage-block"><div class="umfrage-hint">📊 Umfrage — bitte für passende Termine abstimmen</div>${rows}</div>`;
}

// Löst einen Nutzernamen über das (lazy geladene) Verzeichnis in einen
// Anzeigenamen auf; Fallback auf den rohen Nutzernamen, falls unbekannt.
function displayNameFor(username) {
  const found = (directoryUsers || []).find((u) => u.username === username);
  return found ? found.displayName : username;
}

// Zeigt/versteckt die Liste der Zu-/Absager einer Umfrage-Terminzeile. Lädt das
// Nutzerverzeichnis bei Bedarf nach (auch für Nicht-Bearbeiter, die bislang noch
// keins geladen haben) — Namen werden erst beim ersten Aufklappen aufgelöst.
async function toggleUmfrageDetails(terminId, candId, rowEl) {
  if (!rowEl) return;
  const detailsEl = rowEl.querySelector(".umfrage-details");
  if (!detailsEl.classList.contains("hidden")) { detailsEl.classList.add("hidden"); return; }

  await ensureDirectoryLoaded();
  const t = appData.termine.find((x) => x.id === terminId);
  if (!t || !t.umfrage) return;
  const stimmen = t.umfrage.stimmen || {};
  const ja = [], nein = [];
  Object.entries(stimmen).forEach(([user, votes]) => {
    const v = votes ? votes[candId] : null;
    if (v === "ja") ja.push(displayNameFor(user));
    else if (v === "nein") nein.push(displayNameFor(user));
  });
  detailsEl.innerHTML =
    `<div><strong>✓ Zusagen:</strong> ${ja.length ? ja.map(escapeHtml).join(", ") : "—"}</div>` +
    `<div><strong>✗ Absagen:</strong> ${nein.length ? nein.map(escapeHtml).join(", ") : "—"}</div>`;
  detailsEl.classList.remove("hidden");
}

// "Angelegt von <Name> am <Datum>, <Uhrzeit>" — nur wenn beide Angaben vorhanden
// sind (bei Termine aus der Zeit vor 1.9 fehlt erstelltAm, dann kein Meta-Text).
function erstelltLabel(t) {
  if (!t.erstelltAm) return "";
  const d = new Date(t.erstelltAm);
  if (isNaN(d.getTime())) return "";
  const datum = d.toLocaleDateString("de-DE");
  const zeit = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const wer = t.ersteller ? displayNameFor(t.ersteller) : null;
  return wer ? `Angelegt von ${wer} am ${datum}, ${zeit} Uhr` : `Angelegt am ${datum}, ${zeit} Uhr`;
}

function terminCardHtml(t, isHero) {
  const start = t.datum;
  const end = terminEndIso(t);
  const dt = parseIso(start);
  const dayBadge = `<span class="tc-day">${dt.getDate()}</span><span class="tc-mon">${MONATE_KURZ[dt.getMonth()]}</span>` +
    (end !== start ? `<span class="tc-range">bis ${fmtDate(end)}</span>` : "");
  const farbe = katFarbe(t.kategorie);
  const ort = t.ort ? `<div class="tc-sub">📍 ${escapeHtml(t.ort)}</div>` : "";
  const notiz = t.notiz ? `<div class="tc-notiz">${escapeHtml(t.notiz)}</div>` : "";
  const umfrage = terminIsUmfrage(t);
  const badges = `${umfrage ? `<span class="tc-badge tc-badge-umfrage">📊 Umfrage</span>` : ""}` +
    `${t.privat ? `<span class="tc-badge tc-badge-privat">🔒 Privat</span>` : ""}`;
  const erstellt = erstelltLabel(t);
  const erstelltHtml = erstellt ? `<div class="tc-meta">🕓 ${escapeHtml(erstellt)}</div>` : "";
  return `
    <div class="termin-card${isHero ? " is-hero" : ""}" data-id="${escapeHtml(t.id)}" style="--kat:${escapeHtml(farbe)}">
      ${isHero ? `<div class="hero-label">Nächster Termin</div>` : ""}
      <div class="tc-inner">
        <div class="tc-date">${dayBadge}</div>
        <div class="tc-body">
          <div class="tc-top">
            <span class="kat-chip"><span class="kat-dot" style="background:${escapeHtml(farbe)}"></span>${escapeHtml(katName(t.kategorie))}</span>
            ${umfrage ? "" : `<span class="tc-time">🕘 ${escapeHtml(terminZeitLabel(t))}</span>`}
            ${badges}
          </div>
          <div class="tc-title">${escapeHtml(t.titel)}</div>
          ${umfrage ? "" : `<div class="tc-sub tc-datespan">📅 ${escapeHtml(wochentagLabel(start))}, ${escapeHtml(terminDatumLabel(t))}</div>`}
          ${ort}
          ${notiz}
          ${umfrage ? umfrageHtml(t) : ""}
          ${anhaengeHtml(t)}
          ${erstelltHtml}
        </div>
      </div>
    </div>`;
}

function renderTermine() {
  const upcoming = appData.termine.filter((t) => isUpcoming(t) && terminVisibleFor(t)).sort(sortTermine);
  const heroEl = document.getElementById("hero");
  const listEl = document.getElementById("termin-list");
  const emptyEl = document.getElementById("termine-empty");
  const countEl = document.getElementById("termine-count");
  const weitereEl = document.getElementById("weitere-heading");

  countEl.textContent = upcoming.length
    ? `${upcoming.length} anstehende${upcoming.length === 1 ? "r Termin" : " Termine"}`
    : "";

  if (upcoming.length === 0) {
    heroEl.innerHTML = "";
    listEl.innerHTML = "";
    weitereEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  heroEl.innerHTML = terminCardHtml(upcoming[0], true);

  const rest = upcoming.slice(1);
  weitereEl.classList.toggle("hidden", rest.length === 0);

  let html = "";
  let lastMonth = null;
  rest.forEach((t) => {
    const mk = monthKey(t.datum);
    if (mk !== lastMonth) {
      html += `<div class="month-heading">${escapeHtml(monthLabel(t.datum))}</div>`;
      lastMonth = mk;
    }
    html += terminCardHtml(t, false);
  });
  listEl.innerHTML = html;
}

function renderVersionInfo() {
  document.querySelectorAll("#version-badge, #version-badge-2").forEach((el) => { if (el) el.textContent = "v" + APP_VERSION; });
  const list = document.getElementById("changelog-list");
  if (!list) return;
  list.innerHTML = APP_CHANGELOG.map((entry) => `
    <div class="changelog-entry">
      <div class="cv">Version ${escapeHtml(entry.version)}</div>
      ${entry.groups.map((g) => `
        <div class="changelog-group">
          <div class="cg-title">${escapeHtml(g.title)}</div>
          <ul class="cg-items">${g.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        </div>`).join("")}
    </div>`).join("");
}

function renderAll() {
  renderTermine();
  renderVersionInfo();
  renderKategorien();
}

// ---------- Tabs ----------
function switchTab(tab) {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-section").forEach((s) => s.classList.toggle("active", s.id === "tab-" + tab));
}

// ---------- Datei-Anhänge im Formular ----------
function fillSelect(el, options) {
  if (!el) return;
  el.innerHTML = options.map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("");
}

function renderAnhangEditList() {
  const el = document.getElementById("tf-anhaenge");
  if (pendingAnhaenge.length === 0) { el.innerHTML = `<span class="muted">Keine Datei angehängt.</span>`; return; }
  el.innerHTML = pendingAnhaenge.map((a, i) =>
    `<div class="anhang-edit"><span>📎 ${escapeHtml(a.name)}${a.neu ? ' <span class="muted">(neu)</span>' : ""}</span>` +
    `<button type="button" class="anhang-remove" data-idx="${i}" aria-label="Entfernen">×</button></div>`
  ).join("");
}

// ---------- Teilen mit Nutzern/Gruppen (nur bei privaten Terminen) ----------
async function ensureDirectoryLoaded() {
  if (directoryUsers && directoryGroups) return;
  try {
    const dir = await fetchDirectory();
    directoryUsers = Array.isArray(dir.users) ? dir.users : [];
    directoryGroups = Array.isArray(dir.groups) ? dir.groups : [];
  } catch (e) {
    console.warn("Nutzer-/Gruppenverzeichnis konnte nicht geladen werden", e);
    directoryUsers = directoryUsers || [];
    directoryGroups = directoryGroups || [];
  }
}

function renderShareUserChips() {
  const el = document.getElementById("tf-user-chips");
  if (pendingShareUsers.length === 0) { el.innerHTML = ""; return; }
  el.innerHTML = pendingShareUsers.map((u, i) =>
    `<span class="share-chip">${escapeHtml(u.displayName)}<button type="button" class="share-chip-remove" data-idx="${i}" aria-label="Entfernen">×</button></span>`
  ).join("");
}

function renderShareGroupList() {
  const el = document.getElementById("tf-group-list");
  const groups = directoryGroups || [];
  if (groups.length === 0) { el.innerHTML = `<span class="muted">Keine Gruppen vorhanden.</span>`; return; }
  el.innerHTML = groups.map((g) =>
    `<label class="check-label share-group-item"><input type="checkbox" class="tf-group-checkbox" value="${escapeHtml(g.id)}" ${pendingShareGroupIds.includes(g.id) ? "checked" : ""} /> ${escapeHtml(g.name)}</label>`
  ).join("");
}

function onUserSearchInput(e) {
  const q = e.target.value.trim().toLowerCase();
  const resultsEl = document.getElementById("tf-user-results");
  if (!q) { resultsEl.classList.add("hidden"); resultsEl.innerHTML = ""; return; }
  const chosen = new Set(pendingShareUsers.map((u) => u.username));
  const matches = (directoryUsers || [])
    .filter((u) => !chosen.has(u.username) && (u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)))
    .slice(0, 8);
  if (matches.length === 0) { resultsEl.classList.add("hidden"); resultsEl.innerHTML = ""; return; }
  resultsEl.innerHTML = matches.map((u) =>
    `<div class="share-result" data-username="${escapeHtml(u.username)}" data-name="${escapeHtml(u.displayName)}">${escapeHtml(u.displayName)}</div>`
  ).join("");
  resultsEl.classList.remove("hidden");
}

function onUserResultClick(e) {
  const el = e.target.closest(".share-result");
  if (!el) return;
  pendingShareUsers.push({ username: el.dataset.username, displayName: el.dataset.name });
  document.getElementById("tf-user-search").value = "";
  document.getElementById("tf-user-results").classList.add("hidden");
  document.getElementById("tf-user-results").innerHTML = "";
  renderShareUserChips();
}

function onShareChipsClick(e) {
  const btn = e.target.closest(".share-chip-remove");
  if (!btn) return;
  pendingShareUsers.splice(parseInt(btn.dataset.idx, 10), 1);
  renderShareUserChips();
}

// ---------- Umfrage-Terminvorschläge im Formular ----------
function renderUmfrageEditList() {
  const el = document.getElementById("tf-umfrage-termine");
  if (pendingUmfrageTermine.length === 0) { el.innerHTML = `<span class="muted">Noch keine Terminvorschläge.</span>`; return; }
  el.innerHTML = pendingUmfrageTermine.map((c, i) =>
    `<div class="umfrage-edit-row">` +
    `<input type="date" class="umfrage-cand-datum" data-idx="${i}" value="${escapeHtml(c.datum || "")}" />` +
    `<button type="button" class="anhang-remove umfrage-cand-remove" data-idx="${i}" aria-label="Entfernen">×</button></div>`
  ).join("");
}

function addUmfrageTermin() {
  pendingUmfrageTermine.push({ id: uuid(), datum: "" });
  renderUmfrageEditList();
}

function onUmfrageListInput(e) {
  if (!e.target.classList.contains("umfrage-cand-datum")) return;
  const idx = parseInt(e.target.dataset.idx, 10);
  if (pendingUmfrageTermine[idx]) pendingUmfrageTermine[idx].datum = e.target.value;
}

function onUmfrageListClick(e) {
  const btn = e.target.closest(".umfrage-cand-remove");
  if (!btn) return;
  pendingUmfrageTermine.splice(parseInt(btn.dataset.idx, 10), 1);
  renderUmfrageEditList();
}

// ---------- Termin-Formular ----------
async function openTerminModal(idOrNew) {
  if (!canEdit()) return;
  const t = (typeof idOrNew === "string") ? appData.termine.find((x) => x.id === idOrNew) : null;
  editingTerminId = t ? t.id : null;
  removedExistingIds = [];
  pendingAnhaenge = t && Array.isArray(t.anhaenge)
    ? t.anhaenge.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, existing: true }))
    : [];

  fillSelect(document.getElementById("tf-kategorie"), appData.kategorien.map((k) => ({ value: k.id, label: k.name })));

  document.getElementById("tf-titel").value = t ? (t.titel || "") : "";
  document.getElementById("tf-kategorie").value = t ? t.kategorie : (appData.kategorien[0] ? appData.kategorien[0].id : "sonstiges");
  document.getElementById("tf-ort").value = t ? (t.ort || "") : "";
  document.getElementById("tf-datum").value = t ? (t.datum || "") : todayIso();
  document.getElementById("tf-enddatum").value = (t && t.endDatum) ? t.endDatum : "";
  document.getElementById("tf-ganztags").checked = t ? !!t.ganztags : true;
  document.getElementById("tf-startzeit").value = (t && t.startZeit) ? t.startZeit : "";
  document.getElementById("tf-endzeit").value = (t && t.endZeit) ? t.endZeit : "";
  document.getElementById("tf-notiz").value = t ? (t.notiz || "") : "";
  renderAnhangEditList();

  pendingUmfrageTermine = (t && terminIsUmfrage(t))
    ? t.umfrage.termine.map((c) => ({ id: c.id, datum: c.datum }))
    : [];
  document.getElementById("tf-umfrage").checked = pendingUmfrageTermine.length > 0;
  renderUmfrageEditList();

  document.getElementById("tf-privat").checked = t ? !!t.privat : false;
  pendingShareGroupIds = (t && Array.isArray(t.geteiltGruppen)) ? t.geteiltGruppen.slice() : [];
  pendingShareUsers = [];
  document.getElementById("tf-user-search").value = "";
  document.getElementById("tf-user-results").classList.add("hidden");
  document.getElementById("tf-user-results").innerHTML = "";
  await ensureDirectoryLoaded();
  if (t && Array.isArray(t.geteiltUsers)) {
    pendingShareUsers = t.geteiltUsers.map((u) => {
      const found = (directoryUsers || []).find((d) => d.username === u);
      return { username: u, displayName: found ? found.displayName : u };
    });
  }
  renderShareUserChips();
  renderShareGroupList();

  updateFormModeUi();

  document.getElementById("termin-modal-title").textContent = t ? "Termin bearbeiten" : "Neuer Termin";
  document.getElementById("btn-delete-termin").classList.toggle("hidden", !t);
  document.getElementById("termin-modal").classList.remove("hidden");
  document.getElementById("tf-titel").focus();
}

// Blendet Datum/Enddatum/Ganztägig gegen die Terminvorschlagsliste um, sobald
// "Umfrage aktivieren" angehakt ist, und das Teilen-Feld gegen "Privattermin".
function updateFormModeUi() {
  const umfrage = document.getElementById("tf-umfrage").checked;
  const ganz = document.getElementById("tf-ganztags").checked;
  document.getElementById("tf-datum-field").classList.toggle("hidden", umfrage);
  document.getElementById("tf-enddatum-field").classList.toggle("hidden", umfrage);
  document.getElementById("tf-ganztags-field").classList.toggle("hidden", umfrage);
  document.getElementById("tf-zeit-grid").classList.toggle("hidden", umfrage || ganz);
  document.getElementById("tf-umfrage-wrap").classList.toggle("hidden", !umfrage);

  const privat = document.getElementById("tf-privat").checked;
  document.getElementById("tf-teilen-wrap").classList.toggle("hidden", !privat);
}

function closeTerminModal() {
  document.getElementById("termin-modal").classList.add("hidden");
  editingTerminId = null;
  pendingAnhaenge = [];
  removedExistingIds = [];
  pendingShareUsers = [];
  pendingShareGroupIds = [];
  pendingUmfrageTermine = [];
}

async function saveTermin() {
  const titel = document.getElementById("tf-titel").value.trim();
  const kategorie = document.getElementById("tf-kategorie").value;
  const ort = document.getElementById("tf-ort").value.trim();
  const notiz = document.getElementById("tf-notiz").value.trim();
  const umfrageAktiv = document.getElementById("tf-umfrage").checked;
  const privat = document.getElementById("tf-privat").checked;

  if (!titel) { alert("Bitte einen Titel eingeben."); return; }

  let datum, endDatum, ganztags, startZeit, endZeit, umfrageCandidates = null;

  if (umfrageAktiv) {
    const rows = Array.from(document.querySelectorAll(".umfrage-cand-datum")).map((el) => el.value);
    const validDates = [...new Set(rows.filter((d) => ISO_RE.test(d)))].sort();
    if (validDates.length === 0) { alert("Bitte mindestens einen gültigen Terminvorschlag eintragen."); return; }
    // Bestehende Ids anhand des Datums wiederverwenden, damit Stimmen bei
    // unveränderten Vorschlägen erhalten bleiben; neue Vorschläge bekommen neue Ids.
    umfrageCandidates = validDates.map((d) => {
      const existing = pendingUmfrageTermine.find((c) => c.datum === d);
      return { id: existing ? existing.id : uuid(), datum: d };
    });
    datum = validDates[0];
    endDatum = validDates[validDates.length - 1] === datum ? "" : validDates[validDates.length - 1];
    ganztags = true;
    startZeit = ""; endZeit = "";
  } else {
    datum = document.getElementById("tf-datum").value;
    endDatum = document.getElementById("tf-enddatum").value;
    const ganztagsChecked = document.getElementById("tf-ganztags").checked;
    startZeit = ganztagsChecked ? "" : document.getElementById("tf-startzeit").value;
    endZeit = ganztagsChecked ? "" : document.getElementById("tf-endzeit").value;

    if (!ISO_RE.test(datum)) { alert("Bitte ein gültiges Datum wählen."); return; }
    if (endDatum && !ISO_RE.test(endDatum)) { alert("Bitte ein gültiges Enddatum wählen."); return; }
    if (endDatum && endDatum < datum) { alert("Das Enddatum darf nicht vor dem Datum liegen."); return; }
    if (endDatum && endDatum <= datum) endDatum = ""; // gleich/kleiner => eintägig
    ganztags = ganztagsChecked || (!startZeit && !endZeit);
    if (!ganztags && startZeit && endZeit && !endDatum && endZeit <= startZeit) {
      alert("Die Endzeit muss nach der Startzeit liegen."); return;
    }
  }

  const btn = document.getElementById("btn-save-termin");
  btn.disabled = true;
  setSaveStatus("Speichern…", "pending");
  try {
    // Neue Dateien jetzt hochladen (Metadaten für die JSON einsammeln).
    const anhaenge = [];
    for (const a of pendingAnhaenge) {
      if (a.neu) {
        setSaveStatus("Datei wird hochgeladen…", "pending");
        const meta = await gatewayUploadFile(a.file);
        anhaenge.push(meta);
      } else {
        anhaenge.push({ id: a.id, name: a.name, mime: a.mime, size: a.size });
      }
    }

    let t = editingTerminId ? appData.termine.find((x) => x.id === editingTerminId) : null;
    const isNew = !t;
    // Schnappschuss VOR den Feld-Mutationen unten (t ist dieselbe Objektreferenz
    // wie in appData.termine, kein Klon) -- Grundlage für den Teilen-/Änderungs-
    // Abgleich in notifyShareTargets() nach dem Speichern.
    const before = t ? {
      geteiltUsers: Array.isArray(t.geteiltUsers) ? t.geteiltUsers.slice() : [],
      titel: t.titel, datum: t.datum, endDatum: t.endDatum,
      ort: t.ort, startZeit: t.startZeit, endZeit: t.endZeit
    } : null;
    if (!t) { t = { id: uuid() }; appData.termine.push(t); }
    // vorhandene Felder ersetzen (undefined bewusst weglassen)
    t.titel = titel;
    t.kategorie = kategorie;
    t.ort = ort || undefined;
    t.datum = datum;
    t.endDatum = endDatum || undefined;
    t.ganztags = ganztags;
    t.startZeit = ganztags ? undefined : (startZeit || undefined);
    t.endZeit = ganztags ? undefined : (endZeit || undefined);
    t.notiz = notiz || undefined;
    t.anhaenge = anhaenge;
    t.umfrage = umfrageAktiv ? { aktiv: true, termine: umfrageCandidates, stimmen: (t.umfrage && t.umfrage.stimmen) || {} } : undefined;
    t.privat = privat || undefined;
    const geteiltGruppen = Array.from(document.querySelectorAll(".tf-group-checkbox:checked")).map((el) => el.value);
    t.geteiltUsers = (privat && pendingShareUsers.length) ? pendingShareUsers.map((u) => u.username) : undefined;
    t.geteiltGruppen = (privat && geteiltGruppen.length) ? geteiltGruppen : undefined;
    if (isNew) {
      if (currentUser) t.ersteller = currentUser.username;
      t.erstelltAm = new Date().toISOString();
    }

    // Entfernte bestehende Anhänge physisch löschen (best-effort).
    for (const id of removedExistingIds) await gatewayDeleteFile(id);

    await gatewaySaveWithStand();
    // Best-effort, NACH erfolgreichem Speichern -- ein Mail-Fehler darf den schon
    // gespeicherten Termin nie als "nicht gespeichert" erscheinen lassen.
    try { await notifyShareTargets(t, before); } catch (e) { console.warn("Teilen-Benachrichtigung fehlgeschlagen", e); }
    renderAll();
    closeTerminModal();
  } catch (e) {
    if (e instanceof ConflictError) { await reloadAfterConflict(); }
    else if (e instanceof NotLoggedInError) { showConnectScreen("Sitzung abgelaufen — bitte neu anmelden."); }
    else { console.error("Speichern fehlgeschlagen", e); setSaveStatus("Nicht gespeichert", "error"); alert("Speichern fehlgeschlagen: " + e.message); }
  } finally {
    btn.disabled = false;
  }
}

// ---------- Private Termine: E-Mail-Hinweis bei (erstmaligem) Teilen oder Änderung ----------
// Trigger: Nutzer NEU in geteiltUsers ("geteilt") ODER bereits geteilt UND
// sichtbarer Inhalt hat sich geändert ("geändert"). Kein Hinweis beim Entfernen
// aus geteiltUsers oder wenn der Termin gar nicht (mehr) privat ist. Adresse wird
// serverseitig über den Nutzernamen aufgelöst (Aktion "notify-user", siehe
// admin-worker.js) -- diese App kennt selbst keine E-Mail-Adressen.
async function notifyShareTargets(t, before) {
  if (!t.privat) return;
  const now = Array.isArray(t.geteiltUsers) ? t.geteiltUsers : [];
  const prev = before ? before.geteiltUsers : [];
  const neu = now.filter((u) => !prev.includes(u));
  const bestehend = now.filter((u) => prev.includes(u));
  if (!neu.length && !bestehend.length) return;

  const inhaltGeaendert = !!before && (
    before.titel !== t.titel || before.datum !== t.datum || before.endDatum !== t.endDatum ||
    before.ort !== t.ort || before.startZeit !== t.startZeit || before.endZeit !== t.endZeit
  );

  const von = (currentUser && currentUser.vorname && currentUser.nachname)
    ? `${currentUser.vorname} ${currentUser.nachname}` : "Jemand";
  const link = "https://tecko1985.github.io/vereinskalender/";

  const sende = async (username, subject, message) => {
    try {
      await gatewayRequest({ action: "notify-user", username, subject, message });
    } catch (e) {
      console.warn("Benachrichtigung fehlgeschlagen für", username, e);
    }
  };

  for (const u of neu) {
    await sende(u, "Neuer privater Termin im Vereinskalender",
      `${von} hat einen privaten Termin mit dir geteilt: "${t.titel}". Bitte im Vereinskalender ansehen: ${link}`);
  }
  if (inhaltGeaendert) {
    for (const u of bestehend) {
      await sende(u, "Privater Termin geändert: " + t.titel,
        `${von} hat einen mit dir geteilten privaten Termin geändert: "${t.titel}". Bitte im Vereinskalender ansehen: ${link}`);
    }
  }
}

// ---------- Umfrage: Abstimmen direkt auf der Terminkarte ----------
// Bei Konflikt (409) wird der eigene Stimmversuch NICHT mit dem lauten
// reloadAfterConflict()-Hinweis verworfen (Abstimm-Kollisionen sind bei mehreren
// gleichzeitigen Wählern erwartbar), sondern still einmal auf dem frisch
// geladenen Stand wiederholt.
async function castVote(terminId, candId, val) {
  if (!currentUser) return;
  const applyVote = () => {
    const t = appData.termine.find((x) => x.id === terminId);
    if (!t || !terminIsUmfrage(t)) return false;
    if (!t.umfrage.stimmen) t.umfrage.stimmen = {};
    if (!t.umfrage.stimmen[currentUser.username]) t.umfrage.stimmen[currentUser.username] = {};
    const mine = t.umfrage.stimmen[currentUser.username];
    if (mine[candId] === val) delete mine[candId]; else mine[candId] = val;
    return true;
  };
  if (!applyVote()) return;
  renderTermine();
  try {
    await gatewaySaveWithStand();
  } catch (e) {
    if (e instanceof ConflictError) {
      try {
        const data = await gatewayLoad();
        appData = normalizeData(data);
        applyVote();
        await gatewaySaveWithStand();
        renderAll();
      } catch (e2) {
        console.error("Abstimmen fehlgeschlagen", e2);
        setSaveStatus("Nicht gespeichert", "error");
        alert("Deine Stimme konnte nicht gespeichert werden: " + e2.message);
        renderAll();
      }
    } else {
      console.error("Abstimmen fehlgeschlagen", e);
      setSaveStatus("Nicht gespeichert", "error");
      alert("Deine Stimme konnte nicht gespeichert werden: " + e.message);
    }
  }
}

async function deleteTermin() {
  if (!editingTerminId) return;
  if (!confirm("Diesen Termin wirklich löschen?")) return;
  const t = appData.termine.find((x) => x.id === editingTerminId);
  setSaveStatus("Löschen…", "pending");
  try {
    for (const a of (t && t.anhaenge ? t.anhaenge : [])) await gatewayDeleteFile(a.id);
    appData.termine = appData.termine.filter((x) => x.id !== editingTerminId);
    await gatewaySaveWithStand();
    renderAll();
    closeTerminModal();
  } catch (e) {
    if (e instanceof ConflictError) { await reloadAfterConflict(); }
    else { console.error("Löschen fehlgeschlagen", e); setSaveStatus("Nicht gespeichert", "error"); alert("Löschen fehlgeschlagen: " + e.message); }
  }
}

// ---------- Vergangene Termine automatisch aufräumen (nur Bearbeiter) ----------
async function purgePastEvents() {
  if (!canEdit()) return;
  const past = appData.termine.filter(isPast);
  if (past.length === 0) return;
  for (const t of past) {
    for (const a of (t.anhaenge || [])) await gatewayDeleteFile(a.id);
  }
  appData.termine = appData.termine.filter((t) => !isPast(t));
  try {
    await gatewaySaveWithStand();
  } catch (e) {
    console.warn("Aufräumen vergangener Termine konnte nicht gespeichert werden", e);
  }
}

// ---------- Anhang ansehen (neuer Tab, kein erzwungener Download) ----------
async function viewAnhang(id, mime) {
  // Leeres Fenster SOFORT (synchron im Klick-Handler) öffnen, sonst greift in
  // manchen Browsern der Popup-Blocker, weil der eigentliche Fetch erst nach
  // einem await zurückkommt und damit nicht mehr als direkte Nutzeraktion zählt.
  const win = window.open("", "_blank");
  try {
    const rawBlob = await gatewayFetchFileBlob(id);
    // Der Content-Type der dav-file-get-Antwort ist bei erweiterungslos
    // gespeicherten Dateien nicht verlässlich (siehe ToolsUebersicht-Gotcha) —
    // die selbst gespeicherten Anhang-Metadaten (mime) verwenden statt blob.type
    // zu vertrauen, sonst zeigt der Browser z. B. ein Bild nicht an, sondern
    // bietet es zum Download an.
    const blob = mime ? new Blob([rawBlob], { type: mime }) : rawBlob;
    const url = URL.createObjectURL(blob);
    if (win) win.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    console.error("Datei konnte nicht geöffnet werden", e);
    if (win) win.close();
    alert("Die Datei konnte nicht geöffnet werden: " + e.message);
  }
}

// ---------- Kategorien-Verwaltung (Einstellungen-Tab) ----------
function renderKategorien() {
  const el = document.getElementById("kategorie-list");
  if (!el) return;
  el.innerHTML = appData.kategorien.map((k) => `
    <div class="kategorie-row" data-id="${escapeHtml(k.id)}">
      <input type="color" class="kat-farbe-input" data-id="${escapeHtml(k.id)}" value="${escapeHtml(k.farbe)}" title="Farbe" />
      <input type="text" class="kat-name-input" data-id="${escapeHtml(k.id)}" value="${escapeHtml(k.name)}" maxlength="60" />
      <button type="button" class="kategorie-remove" data-id="${escapeHtml(k.id)}" aria-label="Kategorie löschen">×</button>
    </div>
  `).join("");
}

async function saveKategorien() {
  setSaveStatus("Speichern…", "pending");
  try {
    await gatewaySaveWithStand();
    renderAll();
  } catch (e) {
    if (e instanceof ConflictError) { await reloadAfterConflict(); }
    else if (e instanceof NotLoggedInError) { showConnectScreen("Sitzung abgelaufen — bitte neu anmelden."); }
    else { console.error("Speichern fehlgeschlagen", e); setSaveStatus("Nicht gespeichert", "error"); alert("Speichern fehlgeschlagen: " + e.message); }
  }
}

async function addKategorie() {
  const nameInput = document.getElementById("neue-kategorie-name");
  const farbeInput = document.getElementById("neue-kategorie-farbe");
  const name = nameInput.value.trim();
  if (!name) { alert("Bitte einen Namen für die Kategorie eingeben."); return; }
  appData.kategorien.push({ id: uuid(), name, farbe: farbeInput.value });
  nameInput.value = "";
  farbeInput.value = "#6b7280";
  await saveKategorien();
}

async function onKategorieFieldChange(e) {
  const id = e.target.dataset.id;
  const k = id ? kategorieById(id) : null;
  if (!k) return;
  if (e.target.classList.contains("kat-name-input")) {
    const name = e.target.value.trim();
    if (!name) { e.target.value = k.name; return; }
    k.name = name;
  } else if (e.target.classList.contains("kat-farbe-input")) {
    k.farbe = e.target.value;
  } else {
    return;
  }
  await saveKategorien();
}

async function onKategorieListClick(e) {
  const btn = e.target.closest(".kategorie-remove");
  if (!btn) return;
  const k = kategorieById(btn.dataset.id);
  if (!k) return;
  const used = appData.termine.filter((t) => t.kategorie === k.id).length;
  const hinweis = used > 0 ? ` Sie wird aktuell bei ${used} Termin${used === 1 ? "" : "en"} verwendet (diese zeigen danach keine Kategorie mehr an).` : "";
  if (!confirm(`Kategorie "${k.name}" wirklich löschen?${hinweis}`)) return;
  appData.kategorien = appData.kategorien.filter((x) => x.id !== k.id);
  await saveKategorien();
}

// ---------- Gateway: Speichern / Konflikte ----------
function setSaveStatus(text, kind) {
  const el = document.getElementById("save-status");
  if (!el) return;
  el.textContent = text;
  el.className = "header-status" + (kind ? " is-" + kind : "");
}

// Es darf immer nur EIN dav-save unterwegs sein. gatewayRev (das ETag, mit dem der
// Worker Konflikte erkennt) wird erst aktualisiert, wenn ein Save zurückkommt —
// ein zweiter Save, der währenddessen startet, schickt also dasselbe, inzwischen
// veraltete ETag und wird zwangsläufig mit 409 abgelehnt. Für die bearbeitende
// Person sah das aus wie "ein anderes Gerät hat geändert", obwohl sie allein war,
// und reloadAfterConflict() verwarf dabei ihre letzte Eingabe. Beim zügigen
// Abstimmen auf einer Umfragekarte (jeder Klick speichert sofort) oder beim
// Ziehen im Kategorie-Farbwähler passierte das mehrfach hintereinander, weil die
// WebDAV-Runde deutlich länger dauert als der Abstand zwischen zwei Klicks.
// Deshalb: Änderungen, die während eines laufenden Saves anfallen, nur vormerken
// und danach in einem Rutsch nachschreiben. appData wird ohnehin immer komplett
// geschrieben, es geht also nichts verloren, wenn mehrere Änderungen zusammenfallen.
// Fehler werden weiterhin an die Aufrufer geworfen — die ConflictError-/
// NotLoggedInError-Behandlung liegt dort und bleibt unverändert.
let saveRunner = null;
let saveDirty = false;
function gatewaySaveWithStand() {
  saveDirty = true;
  if (!saveRunner) saveRunner = runSaveLoop().finally(() => { saveRunner = null; });
  return saveRunner;
}
async function runSaveLoop() {
  while (saveDirty) {
    saveDirty = false;
    try {
      await writeToGateway();
    } catch (e) {
      // Bei Konflikt/Fehler lädt der Aufrufer den Stand neu bzw. zeigt den
      // Login-Screen — dann NICHT blind nachschreiben, das würde den fremden
      // Stand wieder überbügeln.
      saveDirty = false;
      throw e;
    }
  }
}
async function writeToGateway() {
  appData.meta = Object.assign({}, appData.meta, { stand: new Date().toISOString() });
  await gatewaySave(appData);
  const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  setSaveStatus("Gespeichert " + time, "ok");
}

async function reloadAfterConflict() {
  try {
    const data = await gatewayLoad();
    appData = normalizeData(data);
    renderAll();
    setSaveStatus("Von anderem Gerät aktualisiert", "");
    alert("Die Daten wurden zwischenzeitlich auf einem anderen Gerät geändert — die aktuelle Version wurde neu geladen. Bitte die letzte Änderung bei Bedarf erneut vornehmen.");
  } catch (e) {
    console.error("Neuladen nach Konflikt fehlgeschlagen", e);
  }
  closeTerminModal();
}

// ---------- Start ----------
function showConnectScreen(errorMsg) {
  document.getElementById("connect-screen").style.display = "";
  document.getElementById("app-shell").style.display = "none";
  document.getElementById("cloud-error").textContent = errorMsg ? "Fehler: " + errorMsg : "";
}

async function startApp() {
  document.getElementById("connect-screen").style.display = "none";
  document.getElementById("app-shell").style.display = "";
  try { currentUser = await fetchMe(); } catch (_) { /* best effort */ }
  renderHeaderUser();
  applyAdminVisibility();
  renderVersionInfo();
  // Für "Angelegt von <Name>"-Anzeige auf den Karten — auch für Nicht-Bearbeiter,
  // damit Namen (statt nur Nutzernamen) direkt beim ersten Rendern verfügbar sind.
  await ensureDirectoryLoaded();
  await purgePastEvents();
  renderAll();
}

async function init() {
  setupListeners();
  if (!getSessionToken()) { showConnectScreen(); return; }
  try {
    const data = await gatewayLoad();
    appData = normalizeData(data);
    await startApp();
  } catch (e) {
    if (e instanceof NotLoggedInError) { showConnectScreen(); return; }
    console.error("Nextcloud-Zugriff über Login fehlgeschlagen", e);
    showConnectScreen(e.message);
  }
}

function setupListeners() {
  document.querySelectorAll("nav button[data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  const versionBadgeHeader = document.getElementById("version-badge");
  versionBadgeHeader.addEventListener("click", () => switchTab("info"));
  versionBadgeHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchTab("info"); }
  });

  document.getElementById("btn-new-termin").addEventListener("click", () => openTerminModal(null));

  // Termin-Karte antippen -> bearbeiten (nur Bearbeiter).
  document.getElementById("hero").addEventListener("click", onCardClick);
  document.getElementById("termin-list").addEventListener("click", onCardClick);

  document.getElementById("termin-modal-close").addEventListener("click", closeTerminModal);
  document.getElementById("btn-cancel-termin").addEventListener("click", closeTerminModal);
  document.getElementById("btn-save-termin").addEventListener("click", saveTermin);
  document.getElementById("btn-delete-termin").addEventListener("click", deleteTermin);
  document.getElementById("termin-modal").addEventListener("click", (e) => { if (e.target.id === "termin-modal") closeTerminModal(); });
  document.getElementById("termin-form").addEventListener("submit", (e) => { e.preventDefault(); saveTermin(); });
  document.getElementById("tf-ganztags").addEventListener("change", updateFormModeUi);
  document.getElementById("tf-umfrage").addEventListener("change", updateFormModeUi);
  document.getElementById("tf-privat").addEventListener("change", updateFormModeUi);

  // Umfrage-Terminvorschläge im Formular
  document.getElementById("btn-add-umfrage-termin").addEventListener("click", addUmfrageTermin);
  document.getElementById("tf-umfrage-termine").addEventListener("input", onUmfrageListInput);
  document.getElementById("tf-umfrage-termine").addEventListener("click", onUmfrageListClick);

  // Teilen mit Nutzern/Gruppen im Formular
  document.getElementById("tf-user-search").addEventListener("input", onUserSearchInput);
  document.getElementById("tf-user-results").addEventListener("click", onUserResultClick);
  document.getElementById("tf-user-chips").addEventListener("click", onShareChipsClick);

  // Anhänge im Formular
  document.getElementById("btn-add-anhang").addEventListener("click", () => document.getElementById("anhang-file-input").click());
  document.getElementById("anhang-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { alert("Datei ist zu groß (max. " + Math.round(MAX_FILE_BYTES / 1024 / 1024) + " MB)."); return; }
    pendingAnhaenge.push({ file, name: file.name, mime: file.type || "application/octet-stream", size: file.size, neu: true });
    renderAnhangEditList();
  });
  document.getElementById("tf-anhaenge").addEventListener("click", (e) => {
    const btn = e.target.closest(".anhang-remove");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    const a = pendingAnhaenge[idx];
    if (a && a.existing) removedExistingIds.push(a.id);
    pendingAnhaenge.splice(idx, 1);
    renderAnhangEditList();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("termin-modal").classList.contains("hidden")) closeTerminModal();
  });

  // Kategorien-Verwaltung (Einstellungen-Tab)
  document.getElementById("btn-kategorie-add").addEventListener("click", addKategorie);
  document.getElementById("kategorie-list").addEventListener("change", onKategorieFieldChange);
  document.getElementById("kategorie-list").addEventListener("click", onKategorieListClick);
}

function onCardClick(e) {
  const detailsBtn = e.target.closest(".umfrage-details-toggle");
  if (detailsBtn) { toggleUmfrageDetails(detailsBtn.dataset.terminId, detailsBtn.dataset.candId, detailsBtn.closest(".umfrage-row")); return; }
  const vote = e.target.closest(".umfrage-vote");
  if (vote) { castVote(vote.dataset.terminId, vote.dataset.candId, vote.dataset.val); return; }
  const anhang = e.target.closest(".anhang");
  if (anhang) { viewAnhang(anhang.dataset.fileId, anhang.dataset.mime); return; }
  const card = e.target.closest(".termin-card");
  if (card && canEdit()) openTerminModal(card.dataset.id);
}

document.addEventListener("DOMContentLoaded", init);
