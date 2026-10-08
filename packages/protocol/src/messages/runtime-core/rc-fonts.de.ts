import type { RcFontsMessages } from './rc-fonts.ts';

export const de: RcFontsMessages = {
  manageOnlyInAppOrCli: "Schriften können nur in der Desktop-App oder CLI heruntergeladen, gelöscht und geprüft werden",
  catalogueInvalid: "Das Format des Schriftkatalogs ist falsch",

  remedyNetwork:
    "Netzwerk nicht erreichbar oder Download unterbrochen. Netzwerk prüfen und erneut herunterladen oder unter „Stylesheet-URL“ und „Schriftdatei-URL“ in Einstellungen › Schriften einen anderen Spiegelserver wählen",
  remedySource: "Der Schriftdienst hat keine Datei für diese Schrift bereitgestellt. Familienname und Schriftstärke oder Spiegelserveradressen in den Einstellungen prüfen",
  remedyIntegrity:
    "Der Download ist keine verwendbare Schrift (falscher Familienname, unlesbar oder zu groß). Die fehlerhafte Datei wurde gelöscht; einen anderen Spiegelserver wählen und erneut herunterladen",
  remedyNoSpace: "Die Festplatte mit Runtime Home ist voll. Speicher freigeben und erneut herunterladen",

  diskFullWriting: (p: { what: string }) => `Die Festplatte wurde beim Schreiben voll: ${p.what}`,
  sourceHttpStatus: (p: { what: string; status: number }) => `Der Schriftdienst hat HTTP zurückgegeben: ${p.status} für ${p.what}`,
  downloadFailed: (p: { what: string; reason: string }) => `Das Herunterladen von ${p.what} fehlgeschlagen: ${p.reason}`,
  overByteLimit: (p: { what: string; limit: number }) => `${p.what} überschreitet das Limit von ${p.limit} Bytes`,

  downloadCancelled: "Schriftdownload abgebrochen",
  cancelled: "Download abgebrochen",
  offlineStrict: "Im strikten Offlinemodus werden keine Schriften heruntergeladen",
  autoDownloadOff: "Automatischer Schriftdownload ist ausgeschaltet („Schriften automatisch herunterladen“ unter Einstellungen › Schriften)",
  downloadFailedOutcome: (p: { reason: string }) => `Download fehlgeschlagen: ${p.reason}`,
  notInCatalogue: (p: { family: string }) => `„${p.family}“ ist nicht im Schriftkatalog enthalten`,
  noNeedToDownload: (p: { family: string; bundled: boolean }) =>
    `„${p.family}“ ${p.bundled ? "ist in der App enthalten" : "ist bereits auf diesem Computer installiert"} und muss daher nicht heruntergeladen werden`,
  inUseByExport: (p: { family: string }) => `„${p.family}“ wird von einem nicht abgeschlossenen Export verwendet. Nach Abschluss des Exports löschen`,

  sampleLabel: (p: { family: string }) => `die ${p.family} Probe`,
  sampleCss: (p: { label: string }) => `das Stylesheet für ${p.label}`,
  noSampleBlock: (p: { label: string }) => `Die Antwort des Schriftdiensts enthält nicht ${p.label}`,
  sampleNotOnHost: (p: { label: string }) => `${p.label} liegt nicht auf dem konfigurierten Schriftdatei-Host`,
  sampleNotUsable: (p: { label: string }) => `Die heruntergeladene Datei ${p.label} ist keine verwendbare Schrift`,

  faceLabel: (p: { family: string; weight: number; italic: boolean }) => `${p.family} ${p.weight}${p.italic ? " Kursiv" : ""}`,
  faceCss: (p: { label: string }) => `das Schrift-Stylesheet für ${p.label}`,
  noFaceBlock: (p: { label: string }) => `Die Antwort des Schriftdiensts enthält nicht ${p.label}`,
  faceSplit: (p: { label: string }) => `Der Schriftdienst hat aufgeteilt: ${p.label} in Teilmengen pro Zeichen; BaoCut kann diese noch nicht zusammenführen`,
  faceNotOnHost: (p: { label: string }) => `Die Datei für ${p.label} liegt nicht auf dem konfigurierten Schriftdatei-Host`,
  faceNotUsable: (p: { label: string }) => `Die heruntergeladene Datei ${p.label} ist keine verwendbare Schrift`,
  familyMismatch: (p: { label: string }) => `Der Familienname der heruntergeladenen Schrift ${p.label} stimmt nicht überein`,
};
