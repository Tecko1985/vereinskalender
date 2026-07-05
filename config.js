const APP_VERSION = "1.2";

// Gruppen-Id (Tools-Übersicht-Benutzerverwaltung) für Nutzer ohne Admin-Status,
// die Termine trotzdem eintragen/bearbeiten dürfen. Mitgliederpflege dort, nicht
// hier. Zunächst steht dort nur Uwe Meinhold (Geschäftsstelle).
const EDITOR_GROUP_ID = "vereinskalender-bearbeiter";

// Größenlimit pro hochgeladener Datei. base64 im Request bläht ~+33 % auf, bleibt
// damit klar unter dem Cloudflare-Free-Limit. Muss zum Worker-Cap passen.
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Startbestand der Termin-Kategorien — greift, wenn im Gateway noch keine bzw.
// leere Daten liegen. Für v1.0 fest (keine Kategorie-Verwaltung in der App).
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
        title: "Navigation",
        items: [
          "„Zurück zum Dashboard“ ist jetzt ein Button direkt in der blauen Kopfzeile (mittig), statt eines separaten Links darüber."
        ]
      }
    ]
  },
  {
    version: "1.1",
    groups: [
      {
        title: "Navigation",
        items: [
          "„Zurück zum Dashboard“-Link ergänzt, da die Kacheln in der Tools-Übersicht jetzt im selben Tab statt in einem neuen Tab öffnen."
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
          "Vergangene Termine verschwinden automatisch aus der Ansicht — inklusive der zu ihnen hochgeladenen Dateien."
        ]
      },
      {
        title: "Eintragen (nur Geschäftsstelle)",
        items: [
          "Termine anlegen, ändern und löschen: Titel, Kategorie, Datum (auch mehrtägig), optionale Uhrzeit oder ganztägig, Ort/Platz und Notiz.",
          "Zu jedem Termin lassen sich Dateien hochladen (PDF, Bilder oder andere Formate), die alle eingeloggten Nutzer herunterladen können.",
          "Alle übrigen eingeloggten Nutzer sehen die Termine nur an — Eintragen ist der Geschäftsstelle vorbehalten."
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
