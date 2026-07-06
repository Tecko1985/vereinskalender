# Vereinskalender (v1.0)

Übersicht der als Nächstes anstehenden Vereinstermine des 1. SC 1911 Heiligenstadt —
Teil der [Tools-Übersicht](https://tecko1985.github.io/ToolsUebersicht/).

Bewusst **kein voller Kalender**, sondern nur die kommenden Termine auf einen Blick: gesperrte
Hallen/Plätze, Trainingszeiten, Veranstaltungen. Der nächste Termin steht oben als Karte, danach
folgen die weiteren nach Monat gruppiert. **Vergangene Termine verschwinden automatisch** aus der
Ansicht — inklusive der zu ihnen hochgeladenen Dateien. Jede Terminkarte zeigt, von wem und wann
der Termin angelegt wurde.

Alle eingeloggten Nutzer können die Termine einsehen; **Eintragen/Bearbeiten dürfen Administratoren
und Mitglieder von Gruppen mit Bearbeiten-Recht für Vereinskalender** (vergeben in der
Tools-Übersicht-Gruppenverwaltung).

## Bedienung

- **Termine** — anstehende Termine chronologisch; zu jedem Termin lassen sich angehängte Dateien
  (PDF, Bild o. Ä.) zum Ansehen in einem neuen Tab öffnen oder herunterladen.
- **Privattermine & Teilen** — Termine lassen sich als „Privattermin“ markieren (sichtbar nur für
  die anlegende Person) und gezielt mit einzelnen Nutzern oder ganzen Gruppen teilen, die den
  Termin dann zusätzlich sehen.
- **Umfrage-Termine** — statt eines einzelnen Datums mehrere Terminvorschläge eintragen; abstimmen
  per Haken/Kreuz-Button direkt auf der Terminkarte, ein 👥-Button zeigt die Namen der Zu-/Absagen
  je Vorschlag.
- **Eintragen** (nur berechtigte Nutzer) — „+ Neuer Termin“ bzw. auf einen Termin tippen zum
  Ändern/Löschen: Titel, Kategorie, Datum (auch mehrtägig), optionale Uhrzeit oder ganztägig,
  Ort/Platz, Notiz und Datei-Anhänge.
- **Einstellungen** (nur berechtigte Nutzer) — Kategorien für Termine anlegen, umbenennen,
  umfärben und löschen.

## Technik

Vanilla-JS-App (kein Build-Step), Anmeldung & Speicherung laufen über das zentrale
ToolsUebersicht-Login-Gateway (`admin-worker.js`), das die Daten serverseitig in der
Vereins-Nextcloud ablegt (`vereinskalender.json`, Datei-Anhänge im Unterordner `dateien/`). Kein
separates Passwort im Client; gleichzeitige Änderungen von zwei Geräten werden erkannt und gemeldet.

- `index.html`, `app.js`, `db.js`, `config.js`, `style.css` — die App
- Datei-Upload/-Download nutzt die Worker-Aktionen `dav-file-put` / `dav-file-get` / `dav-file-delete`.
