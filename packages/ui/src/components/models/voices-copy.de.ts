import type { VoicesMessages } from './voices-copy.ts';

export const de: VoicesMessages = {
  myVoices: {
    offline: "Stimmen erscheinen nach Verbindung mit der Runtime.",
    add: "Stimme hinzufügen",
    fromFile: "Neu aus Audiodatei…",
    fromFileHint: "WAV, MP3 oder FLAC, höchstens 20 MB; am besten ein vollständiger Satz von 5–12 Sekunden",
    importPackage: "Stimmpaket importieren…",
    importHint: "Eine exportierte .bcvoice-Datei",
    record: "Mit Mikrofon aufnehmen",
    recordWhy:
      "Aufnehmen in der App ist noch nicht verfügbar: Vor der Übergabe an Runtime muss eine Dateiaufnahme gespeichert werden; dieser Schritt ist noch nicht implementiert. Zuerst mit einer anderen App aufnehmen (WAV, MP3 oder FLAC), dann „Neu aus Audiodatei“ verwenden.",

    recordWhyNoPicker:
      "Aufnehmen in der App ist noch nicht verfügbar: Vor der Übergabe an Runtime muss eine Dateiaufnahme gespeichert werden; dieser Schritt ist noch nicht implementiert. Zuerst mit einer anderen App aufnehmen (WAV, MP3 oder FLAC), dann „Neu aus Audiodatei“ verwenden. Stimmpaket importieren: Dieses Fenster kann den Systemdateidialog nicht öffnen; Desktop-App verwenden.",
    noPicker: "Dieses Fenster kann den Systemdateidialog nicht öffnen; Desktop-App verwenden.",
    pickAudioTitle: "Referenzaufnahme auswählen",
    pickAudioFilter: "Audio (WAV, MP3, FLAC)",
    pickPackageTitle: "Stimmpaket auswählen",
    pickPackageFilter: "Stimmpaket",
    pickButton: "Auswählen",
    notAudio: "Referenzaufnahmen müssen WAV-, MP3- oder FLAC-Dateien sein.",
    imported: (name: string) => `Importiert: „${name}“ · bei Spracherzeugung und Vertonung verfügbar`,
    importFailed: (text: string) => `Importieren fehlgeschlagen: ${text}`,
    foot:
      'A voice = a reference recording + what it says + a consent statement. The reference recording stays on this computer; an exported voice pack (name.bcvoice) includes the recording and can be sent to others to import, but clones don’t travel with it. ' +
      'Voices without a statement on whether they’re the speaker’s own are never uploaded to any third party.',

    play: (name: string) => `Vorschau: ${name}`,
    stop: (name: string) => `Vorschau stoppen: ${name}`,
    playFailed: (text: string) => `Vorschau fehlgeschlagen: ${text}`,
    more: (name: string) => `Weitere · ${name}`,
    edit: "Bearbeiten…",
    cloneTo: (label: string) => `Zum Klonen hochladen an ${label}…`,
    recloneTo: (label: string) => `Zum Klonen hochladen an ${label} erneut…`,
    recloneHint: "Die Referenzaufnahme wurde geändert; der alte Klon ist veraltet",
    removeClone: (label: string) => `Klon löschen bei ${label}…`,
    export: "Stimmpaket exportieren…",
    remove: "Löschen…",
    cloning: (label: string) => `Wird hochgeladen an ${label}…`,
    cloneFailed: (label: string, text: string) => `Der letzte Klon bei ${label} war nicht erfolgreich: ${text}`,
    loadingMeta: "Wird geladen…",

    createTitle: "Neue Stimme",
    editTitle: (name: string) => `Bearbeiten: „${name}“`,
    referenceFile: (file: string) => `Referenzaufnahme: ${file}`,
    name: "Name",
    language: "Sprache",
    languageHint: "In der Referenzaufnahme gesprochene Sprache",
    transcript: "Transkript",
    transcriptHint: "Gesprochener Text der Referenzaufnahme. Einige Engines benötigen ihn zum Klonen; bei Unsicherheit leer lassen.",
    consentHint: "Speichern ist ohne Auswahl möglich, aber die Stimme wird nicht zum Klonen an Dritte hochgeladen.",
    save: "Als Stimme speichern",
    saveEdit: "Speichern",
    cancel: "Abbrechen",
    loading: "Stimme wird geladen…",
    loadFailed: (text: string) => `Diese Stimme konnte nicht geladen werden: ${text}`,
    saved: (name: string) => `Gespeichert: „${name}“ · bei Spracherzeugung und Vertonung verfügbar`,
    updated: (name: string) => `Gespeichert: „${name}“`,
    unchanged: "Keine Änderungen",

    uploadTitle: (label: string) => `Zum Klonen hochladen an ${label}?`,
    upload: "Hochladen",
    cloneStarted: (label: string) => `Wird hochgeladen an ${label} · Fortschritt unter Hintergrundaufgaben`,
    cloneRejected: (text: string) => `Klonen konnte nicht gestartet werden: ${text}`,
    removeCloneTitle: (label: string) => `Klon löschen bei ${label}?`,
    removeCloneBody: (label: string) =>
      `${label} wird zum Löschen dieser geklonten Stimme aufgefordert. Zur späteren Nutzung dieser Stimme bei ${label} muss sie erneut hochgeladen werden.`,
    removeCloneConfirm: "Klon löschen",
    cloneRemoved: (label: string) => `Klon gelöscht bei ${label}`,
    cloneGoneRemote: (label: string) => `${label} hat diesen Klon nicht mehr; auch der Datensatz auf diesem Computer wurde gelöscht`,
    cloneRemoveFailed: (text: string) => `Klon konnte nicht gelöscht werden: ${text}`,

    exportTitle: "Stimmpaket exportieren",
    exportButton: "Exportieren",
    exported: (path: string) => `Exportiert nach ${path}`,
    exportFailed: (text: string) => `Exportieren fehlgeschlagen: ${text}`,
    exportExists: "BaoCut überschreibt keine vorhandenen Dateien. Anderen Namen oder Speicherort auswählen und erneut exportieren.",

    exportFailedExists: (text: string) =>
      `Exportieren fehlgeschlagen: ${text}. BaoCut überschreibt keine vorhandenen Dateien. Anderen Namen oder Speicherort auswählen und erneut exportieren.`,

    deleteTitle: (name: string) => `Löschen: „${name}“?`,
    deleteConfirm: "Löschen",
    deleted: (name: string) => `Gelöscht: „${name}“`,
    deleteFailed: (text: string) => `Löschen fehlgeschlagen: ${text}`,
    localOnlyTitle: (label: string) => `Der Klon bei ${label} wurde nicht gelöscht`,
    localOnlyBody: (label: string, text: string) =>
      `${text}\n\nDie Stimme ist noch vorhanden. Später erneut versuchen oder nur den Datensatz und die Stimme auf diesem Computer löschen. Der Klon im Konto bei ${label} bleibt dann erhalten und muss dort gelöscht werden: ${label} – manuell.`,
    localOnlyConfirm: "Nur auf diesem Computer löschen",
    later: "Später erneut versuchen",
  },
};
