const APP_VERSION = "1.0";

// Größenlimit pro hochgeladener Datei. base64 im Request bläht ~+33 % auf, bleibt
// damit klar unter dem Cloudflare-Free-Limit. Muss zum Worker-Cap passen.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Startbestand der Termin-Kategorien — greift, wenn im Gateway noch keine bzw.
// leere Daten liegen. Im Einstellungen-Tab (nur Administrieren-Stufe) frei anpassbar.
const DEFAULT_KATEGORIEN = [
  { id: "halle",         name: "Halle gesperrt",          farbe: "#c0392b" },
  { id: "platz",         name: "Kunstrasen/Platz gesperrt", farbe: "#e08a1e" },
  { id: "training",      name: "Training",                farbe: "#1a56a0" },
  { id: "veranstaltung", name: "Veranstaltung",           farbe: "#2d8c4e" },
  { id: "sonstiges",     name: "Sonstiges",               farbe: "#6b7280" }
];

const APP_CHANGELOG = [
  {
    version: "1.2",
    groups: [
      {
        title: "Kategorien-Verwaltung",
        items: [
          "Die Kategorien (Einstellungen-Tab) pflegt jetzt die Stufe „Administrieren“ (Häkchen im Sichtbarkeits-Panel der Tools-Übersicht) — Bearbeiter legen weiterhin Termine an und ändern sie, die Kategorien-Struktur ändert die Administration."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Abstimmen bei Umfrage-Terminen",
        items: [
          "Bei einer Umfrage kann jetzt jeder abstimmen, der den Termin sehen darf — vorher meldete der Haken bzw. das Kreuz „Kein Zugriff auf dieses Tool“, sobald jemand ohne Bearbeiten-Recht abstimmen wollte. Genau die eingeladenen Personen kamen damit nicht durch.",
          "Stimmen anderer werden beim Abstimmen sofort mit übernommen: die Zähler zeigen den aktuellen Stand, auch wenn in der Zwischenzeit jemand anderes abgestimmt hat.",
          "Ein zweiter Klick auf denselben Knopf zieht die eigene Stimme wieder zurück (wie bisher)."
        ]
      }
    ]
  },
  {
    version: "1.0",
    groups: [
      {
        title: "Vereinskalender",
        items: [
          "Übersicht der als Nächstes anstehenden Vereinstermine — bewusst kein voller Kalender, sondern nur die kommenden Termine auf einen Blick, chronologisch sortiert.",
          "Der nächste Termin wird oben als Karte hervorgehoben, danach folgen die weiteren Termine nach Monat gruppiert.",
          "Vergangene Termine verschwinden automatisch aus der Ansicht — inklusive der zu ihnen hochgeladenen Dateien.",
          "Jede Terminkarte zeigt, von wem und wann der Termin angelegt wurde (sofern bekannt)."
        ]
      },
      {
        title: "Privattermine & Teilen",
        items: [
          "Termine können als „Privattermin“ markiert werden — diese sieht nur die Person, die sie angelegt hat.",
          "Private Termine lassen sich gezielt mit einzelnen Nutzern (Suchfeld) oder ganzen Gruppen teilen, die den Termin dann zusätzlich sehen.",
          "Personen, mit denen ein privater Termin geteilt wird, bekommen zusätzlich eine kurze E-Mail-Benachrichtigung (beim erstmaligen Teilen und bei späteren Änderungen des Termins)."
        ]
      },
      {
        title: "Umfrage-Termine",
        items: [
          "Option „Umfrage“: statt eines einzelnen Datums mehrere Terminvorschläge eintragen, über die abgestimmt werden kann.",
          "Abstimmen geht direkt auf der Terminkarte per Haken/Kreuz-Button je Vorschlag, ganz ohne das Termin-Formular zu öffnen; ein 👥-Button zeigt die Namen der Zu- und Absagen je Vorschlag."
        ]
      },
      {
        title: "Kategorien-Verwaltung",
        items: [
          "Eigener Einstellungen-Tab (nur für Bearbeiter sichtbar): Kategorien für Termine anlegen, umbenennen, umfärben und löschen — sie stehen danach direkt im Termin-Formular als Auswahl zur Verfügung."
        ]
      },
      {
        title: "Eintragen (Admin & berechtigte Gruppen)",
        items: [
          "Termine anlegen, ändern und löschen: Titel, Kategorie, Datum (auch mehrtägig), optionale Uhrzeit oder ganztägig, Ort/Platz und Notiz.",
          "Zu jedem Termin lassen sich Dateien anhängen (PDF, Bilder oder andere Formate); alle eingeloggten Nutzer können sie zum Ansehen in einem neuen Tab öffnen oder herunterladen.",
          "Bearbeiten-Recht wird über die Gruppenverwaltung der Tools-Übersicht vergeben; alle übrigen eingeloggten Nutzer sehen die Termine nur an."
        ]
      },
      {
        title: "Daten & Speicherung",
        items: [
          "Automatische Nextcloud-Synchronisierung über die zentrale Anmeldung (Tools-Übersicht) — kein separates Passwort nötig; gleichzeitige Änderungen von zwei Geräten werden erkannt und gemeldet."
        ]
      }
    ]
  }
];
