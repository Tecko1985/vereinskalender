// Persistenz über das zentrale ToolsUebersicht-Login-Gateway.
// Gleiches Gateway-Muster wie E:\platzbelegung\db.js — reines Gateway ohne
// lokalen Datei-Modus. Zusätzlich Datei-Upload/-Download/-Löschung über die
// neuen Worker-Aktionen dav-file-put / dav-file-get / dav-file-delete.
const GATEWAY_URL = "https://landingpage.michel-brunner.workers.dev";
const TOKEN_STORAGE_KEY = "tu_session_token";
const GATEWAY_APP_ID = "vereinskalender";

class NotLoggedInError extends Error {
  constructor(message) {
    super(message || "Nicht angemeldet");
    this.name = "NotLoggedInError";
  }
}

class ConflictError extends Error {
  constructor(message) {
    super(message || "Daten wurden zwischenzeitlich von einem anderen Gerät geändert");
    this.name = "ConflictError";
  }
}

// ETag des zuletzt geladenen/geschriebenen Stands. Wird bei dav-save mitgeschickt,
// damit der Worker Konflikte (anderes Gerät hat inzwischen gespeichert) erkennt.
let gatewayRev = null;

function getSessionToken() {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY); } catch (_) { return null; }
}

async function gatewayRequest(payload) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(payload)
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (resp.status === 403) {
    // Den Grund des Servers durchreichen statt pauschal "Kein Zugriff auf dieses
    // Tool": der Worker unterscheidet fehlenden Tool-Zugriff von fehlendem
    // Bearbeiten-Recht, und genau diese Unterscheidung braucht man, um eine
    // Fehlermeldung aus dem echten Betrieb ueberhaupt einordnen zu koennen.
    let detail = "";
    try { const b = await resp.json(); if (b && b.error) detail = String(b.error); } catch (_) {}
    throw new Error(detail || "Kein Zugriff auf dieses Tool.");
  }
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok) {
    let detail = "";
    try { const b = await resp.json(); if (b && b.error) detail = ": " + b.error; } catch (_) {}
    throw new Error(`Gateway-Fehler (HTTP ${resp.status})${detail}`);
  }
  return resp.json();
}

// Das "me" aus der letzten dav-load-Antwort. Der Worker legt es bei, weil er
// nutzer.json und die Rechte-Datei fuer diesen Request ohnehin gelesen hat --
// der erste fetchMe() nach dem Laden kommt damit ohne eigenen Roundtrip aus.
let gatewayMe = null;

async function gatewayLoad() {
  const body = await gatewayRequest({ action: "dav-load", app: GATEWAY_APP_ID });
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
  gatewayMe = (body.me && typeof body.me === "object") ? body.me : null;
  return body.data; // Objekt oder null (Datei noch nicht vorhanden)
}

async function gatewaySave(dataObj) {
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = await gatewayRequest(payload);
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
}

// Letzter Rettungsversuch beim Verlassen der Seite. Ein normaler fetch wird beim
// Entladen abgebrochen -- mit keepalive ueberlebt der Request das Schliessen des
// Tabs. Betrifft zwei Faelle: einen noch nicht abgelaufenen Debounce-Timer und
// einen gerade laufenden Schreibvorgang.
// Bewusst MIT gatewayRev: ein unbedingter Schreibvorgang wuerde hier zwar immer
// durchgehen, koennte aber die Aenderung eines anderen Geraets ueberschreiben,
// ohne dass es jemand merkt. Lieber ein wirkungsloser 409 als stiller fremder
// Datenverlust.
//
// Grenze: Browser erlauben fuer keepalive-Requests nur 64 KB Body. Groessere
// Datenbestaende gehen auf diesem Weg gar nicht raus -- deshalb meldet die
// Funktion zurueck, ob sie abschicken konnte; der Aufrufer (beforeunload in
// app.js) fragt dann stattdessen nach.
const KEEPALIVE_MAX_BYTES = 64 * 1024;

function gatewaySaveBeacon(dataObj) {
  const token = getSessionToken();
  if (!token) return false;
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = JSON.stringify(payload);
  if (new Blob([body]).size > KEEPALIVE_MAX_BYTES) return false;
  try {
    fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body,
      keepalive: true
    });
    return true;
  } catch (_) {
    return false; // z.B. wenn der Browser den keepalive-Request doch ablehnt
  }
}

// Liefert {username, isAdmin, groupIds, vorname, nachname, canEdit} der eingeloggten Person.
async function fetchMe() {
  // Genau EINMAL aus dem letzten dav-load bedienen, danach wieder echt fragen:
  // ein spaeterer Aufruf will den aktuellen Stand (etwa nach einem Rechte-
  // wechsel), nicht eine beliebig alte Kopie. Faellt von selbst auf den Request
  // zurueck, wenn der Worker das Feld noch nicht mitschickt.
  if (gatewayMe) { const me = gatewayMe; gatewayMe = null; return me; }
  return gatewayRequest({ action: "me", app: GATEWAY_APP_ID });
}

// Eigene Stimme bei einem Umfrage-Termin setzen ("ja"/"nein") oder zurückziehen
// (wert = ""). Bewusst NICHT über dav-save: Termine anlegen und ändern ist
// serverseitig den Bearbeitern vorbehalten (vereinskalender steht in
// WRITE_REQUIRES_EDIT_PERMISSION), abstimmen darf dagegen jeder, der den Termin
// sieht. Der Worker liest dafür frisch, setzt nur das eigene Feld und liefert den
// aktuellen Stimmenstand zurück — deshalb braucht es hier auch keine
// Konflikt-Wiederholung im Client.
async function gatewayVote(terminId, candId, wert) {
  const body = await gatewayRequest({
    action: "vereinskalender-vote",
    terminId,
    candId,
    wert
  });
  // Die Datei hat sich serverseitig geändert — ohne das neue rev liefe der
  // nächste eigene dav-save (als Bearbeiter) in einen Schein-Konflikt.
  if (typeof body.rev === "string") gatewayRev = body.rev;
  return (body.stimmen && typeof body.stimmen === "object") ? body.stimmen : null;
}

// Liefert {users:[{username,displayName}], groups:[{id,name}]} für den
// "Teilen mit"-Picker bei privaten Terminen/Umfragen — für jeden eingeloggten
// Nutzer abrufbar, keine sensiblen Felder.
async function fetchDirectory() {
  return gatewayRequest({ action: "list-directory" });
}

// ---------- Datei-Anhänge (Binär-Upload über das Gateway) ----------

// Liest eine Datei als reines base64 (ohne data:-Präfix) für den Transport im
// JSON-Body an dav-file-put.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result || "");
      const comma = res.indexOf(",");
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    r.readAsDataURL(file);
  });
}

// Lädt eine Datei ins Nextcloud-Verzeichnis der App hoch und liefert die
// Metadaten {id, name, mime, size} zurück, die im Termin gespeichert werden.
async function gatewayUploadFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Datei ist zu groß (max. " + Math.round(MAX_FILE_BYTES / 1024 / 1024) + " MB).");
  }
  const id = uuid();
  const dataBase64 = await fileToBase64(file);
  await gatewayRequest({
    action: "dav-file-put",
    app: GATEWAY_APP_ID,
    id,
    name: file.name,
    contentType: file.type || "application/octet-stream",
    dataBase64
  });
  return { id, name: file.name, mime: file.type || "application/octet-stream", size: file.size };
}

// Holt eine hochgeladene Datei als Blob (mit Bearer-Token; die Nextcloud-Datei
// ist nicht öffentlich). Rückgabe eignet sich für URL.createObjectURL.
async function gatewayFetchFileBlob(id) {
  const token = getSessionToken();
  if (!token) throw new NotLoggedInError();
  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ action: "dav-file-get", app: GATEWAY_APP_ID, id })
  });
  if (resp.status === 401) throw new NotLoggedInError("Sitzung abgelaufen");
  if (!resp.ok) throw new Error("Datei nicht abrufbar (HTTP " + resp.status + ")");
  return resp.blob();
}

// Löscht eine hochgeladene Datei (best-effort — Fehler werden nur geloggt, damit
// das Aufräumen/Löschen von Terminen nicht blockiert).
async function gatewayDeleteFile(id) {
  try {
    await gatewayRequest({ action: "dav-file-delete", app: GATEWAY_APP_ID, id });
  } catch (e) {
    console.warn("Datei-Löschen fehlgeschlagen für", id, e);
  }
}
