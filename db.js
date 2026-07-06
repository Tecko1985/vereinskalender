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
  if (resp.status === 403) throw new Error("Kein Zugriff auf dieses Tool.");
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok) {
    let detail = "";
    try { const b = await resp.json(); if (b && b.error) detail = ": " + b.error; } catch (_) {}
    throw new Error(`Gateway-Fehler (HTTP ${resp.status})${detail}`);
  }
  return resp.json();
}

async function gatewayLoad() {
  const body = await gatewayRequest({ action: "dav-load", app: GATEWAY_APP_ID });
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
  return body.data; // Objekt oder null (Datei noch nicht vorhanden)
}

async function gatewaySave(dataObj) {
  const payload = { action: "dav-save", app: GATEWAY_APP_ID, data: dataObj };
  if (gatewayRev) payload.rev = gatewayRev;
  const body = await gatewayRequest(payload);
  gatewayRev = typeof body.rev === "string" ? body.rev : null;
}

// Liefert {username, isAdmin, groupIds, vorname, nachname, canEdit} der eingeloggten Person.
async function fetchMe() {
  return gatewayRequest({ action: "me", app: GATEWAY_APP_ID });
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
