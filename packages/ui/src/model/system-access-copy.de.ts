import type { SystemAccessMessages } from './system-access-copy.ts';

export const de: SystemAccessMessages = {
  cardTitle: (names) => `BaoCut das Lesen der ${names}-Cookies erlauben`,
  cardBody: "macOS verlangt zuerst, BaoCut den „Vollständigen Festplattenzugriff“ zu geben. Klicke auf „Systemeinstellungen öffnen“, dann führt BaoCut dich direkt zu dieser Seite. BaoCut liest nur die ausgewählten Browser, sonst nichts.",
  openedTitle: "Aktiviere BaoCut in den Systemeinstellungen und komm dann zurück",
  openedBody: "Aktiviere den Schalter neben BaoCut. Wenn macOS fragt, ob BaoCut beendet und erneut geöffnet werden soll, wähle „Beenden und erneut öffnen“. Fehlt BaoCut in der Liste, füge es mit „+“ unter der Liste hinzu. Bietet macOS keinen Neustart an, klicke unten auf „BaoCut neu starten“.",
  open: "Systemeinstellungen öffnen",
  openAgain: "Systemeinstellungen erneut öffnen",
  restart: "BaoCut neu starten",
  askTitle: (names) => `Zuerst den Zugriff auf die ${names}-Cookies erlauben?`,
  askBody: (names) => `Dieser Download nutzt deine ${names}-Anmeldung, und macOS verlangt zuerst, BaoCut den „Vollständigen Festplattenzugriff“ zu geben. Aktiviere ihn in den Systemeinstellungen und lade erneut herunter, oder überspringe ihn diesmal und fahre mit den anderen Browsern fort.`,
  skip: "Diesmal überspringen",
  settingLabel: "Vollständiger Festplattenzugriff",
  settingAllowed: "Erlaubt. BaoCut kann Dateien auf externen Laufwerken, im Schreibtisch-, Dokumente- und Download-Ordner sowie Safari-Cookies lesen, aber nur die Medien, Speicherorte und Browser, die du auswählst.",
  settingMissing: "Nicht erlaubt. macOS hindert Apps daran, externe Laufwerke, Schreibtisch, Dokumente, Downloads und Safari-Cookies zu lesen. Nach der Erlaubnis scheitert BaoCut an diesen Orten nicht mehr an fehlenden Rechten. Es liest nur die Medien, Speicherorte und Browser, die du auswählst.",
  openFailed: "Die Systemeinstellungen konnten nicht geöffnet werden. Öffne selbst Systemeinstellungen › Datenschutz & Sicherheit › Vollständiger Festplattenzugriff.",
};
