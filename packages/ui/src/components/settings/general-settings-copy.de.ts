import type { GeneralSettingsMessages } from './general-settings-copy.ts';

export const de: GeneralSettingsMessages = {
  interfaceGroup: "Oberfläche",
  language: "Sprache",
  languageDesc: "Sofort wirksam; kein Neustart nötig.",
  languageSystem: (current: string) => `System (${current})`,
  appearance: "Aussehen",
  appearanceDesc: "Betrifft nur BaoCut-Fenster auf diesem Computer.",
  schemeSystem: "System",
  schemeLight: "Hell",
  schemeDark: "Dunkel",

  saveFailed: (message: string) => `Speichern fehlgeschlagen: ${message}`,

  editingGroup: "Bearbeitung und Transkription",
  autoOpen: "Video nach Transkription automatisch öffnen",
  autoOpenDesc: "Für lokale Importe. Beim Abschluss eines Linkimports im Hintergrund erfolgt nur eine Benachrichtigung; Ihre aktuelle Seite bleibt geöffnet.",
  autoOpenNote: "Noch nicht angebunden: Nach Transkription bleibt immer die aktuelle Seite geöffnet; das Video öffnet sich nicht automatisch.",
  lineLength: "Länge der Untertitelzeile",
  lineLengthDesc: "Zielzeilenlänge für automatische Umbrüche. Manuell bearbeitete Zeilen bleiben unverändert.",

  lineLengthNote: (maxChars: number, custom: string | null) =>
    `Noch nicht angebunden: Automatische Zeilenumbrüche sind derzeit festgelegt auf ${maxChars} Halbbreitenzeichen pro Zeile (jedes CJK-Zeichen zählt doppelt).${custom ? ` Der gespeicherte Wert ist benutzerdefiniert (${custom}).` : ""}`,
  cueShading: "Cue-Hinterlegung im Transkript",
  cueShadingDesc: "Unterlegt jeden Untertitelbereich leicht, damit die Umbruchstellen sichtbar sind.",
  cueShadingNote: "Noch nicht implementiert: Untertitelbereiche im Transkript haben keine Hinterlegung.",

  downloadsGroup: "Downloads und Aktualisierungen",
  autoUpdateOn: "Automatische Updateprüfung und Downloads aktiviert",
  autoUpdateOff: "Automatische Updatedownloads deaktiviert",
  downloaderWeb: "Der Browser prüft keine Downloadwerkzeuge auf diesem Computer; in der BaoCut-Desktop-App prüfen.",

  sourcesGroup: "Downloadquellen und Offline",
  strictOffline: "Strikter Offlinemodus",
  strictOfflineDesc:
    "Bei Aktivierung werden Modelle, externe Werkzeuge und Videos über Links nicht heruntergeladen. Internetverbindungen von Cloud-Modellen und Agenten-Engines bleiben unbeeinflusst.",
  strictOfflineOn: "Strikter Offlinemodus aktiviert",
  strictOfflineOff: "Strikter Offlinemodus deaktiviert",

  trashDays: "Aufbewahrungstage im Papierkorb",
  trashDaysDesc: (fallback: number | null) =>
    `Ältere nicht referenzierte Papierkorbeinträge und gelöschte Videos werden dauerhaft gelöscht (Prüfung beim Start und danach alle 6 Stunden). Referenzierte Einträge bleiben erhalten. Leeren stellt den Standard wieder her${fallback ? ` von ${fallback} Tage` : ""}.`,
  webNote: "Im Browser lässt sich diese Einstellung nicht ändern. Ändern Sie sie in der BaoCut-Desktop-App.",
  webViewOnly: "Im Browser können Sie dies nur ansehen. Änderungen nehmen Sie in der BaoCut-Desktop-App vor.",
  webUnavailable: "Im Browser ist dies nicht verfügbar. Verwenden Sie die BaoCut-Desktop-App.",
};
