# Vereinskalender

Übersicht der als Nächstes anstehenden Vereinstermine des 1. SC 1911 Heiligenstadt —
Teil der [Tools-Übersicht](https://tecko1985.github.io/ToolsUebersicht/).

Bewusst **kein voller Kalender**, sondern nur die kommenden Termine auf einen Blick: gesperrte
Hallen/Plätze, Trainingszeiten, Veranstaltungen. Der nächste Termin steht oben als Karte, danach
folgen die weiteren nach Monat gruppiert. **Vergangene Termine verschwinden automatisch** aus der
Ansicht — inklusive der zu ihnen hochgeladenen Dateien.

Alle eingeloggten Nutzer können die Termine einsehen; **Eintragen/Bearbeiten dürfen Administratoren
und Mitglieder der Gruppe „Vereinskalender-Bearbeiter“** (Pflege in der
Tools-Übersicht-Benutzerverwaltung — zunächst nur die Geschäftsstelle / Uwe Meinhold).

## Bedienung

- **Termine** — anstehende Termine chronologisch; zu jedem Termin lassen sich angehängte Dateien
  (PDF, Bild o. Ä.) herunterladen.
- **Eintragen** (nur berechtigte Nutzer) — „+ Neuer Termin“ bzw. auf einen Termin tippen zum
  Ändern/Löschen: Titel, Kategorie, Datum (auch mehrtägig), optionale Uhrzeit oder ganztägig,
  Ort/Platz, Notiz und Datei-Anhänge.

## Technik

Vanilla-JS-App (kein Build-Step), Anmeldung & Speicherung laufen über das zentrale
ToolsUebersicht-Login-Gateway (`admin-worker.js`), das die Daten serverseitig in der
Vereins-Nextcloud ablegt (`vereinskalender.json`, Datei-Anhänge im Unterordner `dateien/`). Kein
separates Passwort im Client; gleichzeitige Änderungen von zwei Geräten werden erkannt und gemeldet.

- `index.html`, `app.js`, `db.js`, `config.js`, `style.css` — die App
- Datei-Upload/-Download nutzt die Worker-Aktionen `dav-file-put` / `dav-file-get` / `dav-file-delete`.
