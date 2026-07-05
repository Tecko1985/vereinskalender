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
// Bearbeiten dürfen Site-Admins sowie Mitglieder der Gruppe EDITOR_GROUP_ID
// (Pflege in der Tools-Übersicht-Benutzerverwaltung) — alle anderen eingeloggten
// Nutzer dürfen die Termine nur ansehen.
function canEdit() {
  if (!currentUser) return false;
  if (currentUser.isAdmin) return true;
  return (currentUser.groupIds || []).includes(EDITOR_GROUP_ID);
}

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
    `<button type="button" class="anhang" data-file-id="${escapeHtml(a.id)}" data-file-name="${escapeHtml(a.name)}">📎 ${escapeHtml(a.name)}</button>`
  ).join("") + `</div>`;
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
  return `
    <div class="termin-card${isHero ? " is-hero" : ""}" data-id="${escapeHtml(t.id)}" style="--kat:${escapeHtml(farbe)}">
      ${isHero ? `<div class="hero-label">Nächster Termin</div>` : ""}
      <div class="tc-inner">
        <div class="tc-date">${dayBadge}</div>
        <div class="tc-body">
          <div class="tc-top">
            <span class="kat-chip"><span class="kat-dot" style="background:${escapeHtml(farbe)}"></span>${escapeHtml(katName(t.kategorie))}</span>
            <span class="tc-time">🕘 ${escapeHtml(terminZeitLabel(t))}</span>
          </div>
          <div class="tc-title">${escapeHtml(t.titel)}</div>
          <div class="tc-sub tc-datespan">📅 ${escapeHtml(wochentagLabel(start))}, ${escapeHtml(terminDatumLabel(t))}</div>
          ${ort}
          ${notiz}
          ${anhaengeHtml(t)}
        </div>
      </div>
    </div>`;
}

function renderTermine() {
  const upcoming = appData.termine.filter(isUpcoming).sort(sortTermine);
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

// ---------- Termin-Formular ----------
function openTerminModal(idOrNew) {
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
  updateGanztagsUi();
  renderAnhangEditList();

  document.getElementById("termin-modal-title").textContent = t ? "Termin bearbeiten" : "Neuer Termin";
  document.getElementById("btn-delete-termin").classList.toggle("hidden", !t);
  document.getElementById("termin-modal").classList.remove("hidden");
  document.getElementById("tf-titel").focus();
}

function updateGanztagsUi() {
  const ganz = document.getElementById("tf-ganztags").checked;
  document.getElementById("tf-zeit-grid").classList.toggle("hidden", ganz);
}

function closeTerminModal() {
  document.getElementById("termin-modal").classList.add("hidden");
  editingTerminId = null;
  pendingAnhaenge = [];
  removedExistingIds = [];
}

async function saveTermin() {
  const titel = document.getElementById("tf-titel").value.trim();
  const kategorie = document.getElementById("tf-kategorie").value;
  const ort = document.getElementById("tf-ort").value.trim();
  const datum = document.getElementById("tf-datum").value;
  let endDatum = document.getElementById("tf-enddatum").value;
  const ganztags = document.getElementById("tf-ganztags").checked;
  const startZeit = ganztags ? "" : document.getElementById("tf-startzeit").value;
  const endZeit = ganztags ? "" : document.getElementById("tf-endzeit").value;
  const notiz = document.getElementById("tf-notiz").value.trim();

  if (!titel) { alert("Bitte einen Titel eingeben."); return; }
  if (!ISO_RE.test(datum)) { alert("Bitte ein gültiges Datum wählen."); return; }
  if (endDatum && !ISO_RE.test(endDatum)) { alert("Bitte ein gültiges Enddatum wählen."); return; }
  if (endDatum && endDatum < datum) { alert("Das Enddatum darf nicht vor dem Datum liegen."); return; }
  if (endDatum && endDatum <= datum) endDatum = ""; // gleich/kleiner => eintägig
  const effGanztags = ganztags || (!startZeit && !endZeit);
  if (!effGanztags && startZeit && endZeit && !endDatum && endZeit <= startZeit) {
    alert("Die Endzeit muss nach der Startzeit liegen."); return;
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
    if (!t) { t = { id: uuid() }; appData.termine.push(t); }
    // vorhandene Felder ersetzen (undefined bewusst weglassen)
    t.titel = titel;
    t.kategorie = kategorie;
    t.ort = ort || undefined;
    t.datum = datum;
    t.endDatum = endDatum || undefined;
    t.ganztags = effGanztags;
    t.startZeit = effGanztags ? undefined : (startZeit || undefined);
    t.endZeit = effGanztags ? undefined : (endZeit || undefined);
    t.notiz = notiz || undefined;
    t.anhaenge = anhaenge;

    // Entfernte bestehende Anhänge physisch löschen (best-effort).
    for (const id of removedExistingIds) await gatewayDeleteFile(id);

    await gatewaySaveWithStand();
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

// ---------- Herunterladen eines Anhangs ----------
async function downloadAnhang(id, name) {
  try {
    const blob = await gatewayFetchFileBlob(id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "datei";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  } catch (e) {
    console.error("Datei-Download fehlgeschlagen", e);
    alert("Die Datei konnte nicht geladen werden: " + e.message);
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

async function gatewaySaveWithStand() {
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
  document.getElementById("tf-ganztags").addEventListener("change", updateGanztagsUi);

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
  const anhang = e.target.closest(".anhang");
  if (anhang) { downloadAnhang(anhang.dataset.fileId, anhang.dataset.fileName); return; }
  const card = e.target.closest(".termin-card");
  if (card && canEdit()) openTerminModal(card.dataset.id);
}

document.addEventListener("DOMContentLoaded", init);
