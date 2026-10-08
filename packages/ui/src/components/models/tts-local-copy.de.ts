import type { TtsLocalMessages } from './tts-local-copy.ts';

export const de: TtsLocalMessages = {
  ttsLocal: {

    unset: "Nicht festgelegt",
    defaultDesc: "Für neue Syntheseaufgaben vorausgewählt. Ohne Standard muss jedes Mal ein Modell gewählt werden; manuelle Auswahl hat immer Vorrang.",
    cloudDefault: (name: string) =>
      `Der Standard ist ein Cloud-Modell (${name}); unter Einstellungen › Cloud-Modelle ändern. Auswahl eines lokalen Modells wechselt zu diesem.`,
    noInstalled: "Noch kein Sprachsynthesemodell installiert. Zuerst eines unten herunterladen.",

    audition: "Vorschau",
    hideAudition: "Vorschau ausblenden",
    engine: "Engine",
    license: "Lizenz",
    components: "Komponenten",

    licenseTitle: "Lizenz",
    licenseUse: "Damit erzeugte Sprache darf nur in nichtkommerziellen Inhalten verwendet werden; für kommerziell geplante Videos ein anderes Sprachmodell wählen.",
    licenseConfirm: (size: string) => `Verstanden, herunterladen: ${size}`,

    voice: "Stimme",
    tone: "Ton",
    say: "Was gesprochen werden soll",
    lines: "Sätze",
    more: "Weitere Stimmen",
    cloneNew: "Neue Stimme klonen…",
    writeOwn: "Eigenen Text schreiben",
    ownPlaceholder: "Einen Satz zum Anhören eingeben",
    ownLabel: "Vorschautext",
    describeLabel: "Stimmbeschreibung",
    describePlaceholder: "z. B. eine tiefe, ruhige ältere Männerstimme",
    builtinRef: (label: string, seconds: number | null) =>
      `Referenzaufnahme · ${label}${seconds !== null ? ` · ${seconds}s` : ""} · ihr Transkript wird automatisch einbezogen`,
    describedBuiltin: (label: string) => `Stimme aus einer Beschreibung · verwendet die mitgelieferte Beschreibung von „${label}“`,
    describePreset: (text: string) => `Beschreibung: ${text}`,
    myVoice: (name: string) => `Meine Stimmen · ${name} · aus Referenzaufnahme und Transkript geklont`,
    presetOnly: (models: string | null) =>
      models
        ? `Dieses Modell hat nur integrierte Sprecher · „Meine Stimmen“ mit einem klonfähigen Modell testen: ${models} (Vorschau in dessen Zeile)`
        : "Dieses Modell hat nur integrierte Sprecher · für „Meine Stimmen“ zuerst ein klonfähiges Modell herunterladen",

    nameList: (names: readonly string[]) => names.join(", "),
    cloneHint: "5–15 Sekunden klare Sprache verwenden: eine Person, ohne Hintergrundmusik. WAV, MP3, M4A, FLAC oder eine Videodatei sind geeignet.",
    yourFile: (name: string) => `Ihre Aufnahme · ${name}`,
    sampleFile: (label: string) => `Beispielaufnahme · ${label} · in BaoCut enthalten; keine Dateisuche nötig`,
    pickFile: "Aufnahme wählen…",
    changeFile: "Wählen Sie ein anderes…",
    useSample: "Beispielaufnahme verwenden",
    crossLang: "Funktioniert auch sprachübergreifend: eine chinesische Aufnahme kann Englisch vorlesen.",
    noPicker:
      "Der Browser kann keine Dateien auf diesem Computer auswählen. Für eine einmalige Aufnahme die Desktop-App verwenden; alternativ Beispielaufnahme nutzen oder zuerst unter „Meine Stimmen“ speichern.",
    pickTitle: "Referenzaufnahme auswählen",
    pickButton: "Auswählen",
    pickFilter: "Audio oder Video",
    transcriptLabel: "Aufnahmetranskript (optional)",
    transcriptHint: "Aufschreiben des gesprochenen Textes erhöht die Ähnlichkeit",
    fileChip: (name: string, sample: boolean) => (sample ? `Beispiel · ${name}` : name),
    generate: "Vorschau erzeugen",
    again: "Erneut erzeugen",
    cancel: "Abbrechen",
    busy: (phase: string) => `Wird synthetisiert · ${phase}`,
    stalePrefix: "Vorherige · ",
    stale: "Dieser Clip entstand mit Ihrer vorherigen Auswahl. Nach Änderung von Stimme oder Text auf „Vorschau erzeugen“ klicken, um die neue Aufnahme zu hören.",
    download: "Herunterladen",
    resultLabel: "Vorschauergebnis",
    credit: (credit: string) => `Integrierte Stimmaufnahme: ${credit}`,
    loadingAudio: "Audio wird geladen…",
    audioFailed: (message: string) => `Audio konnte nicht geladen werden: ${message}`,
    downloadFailed: (message: string) => `Herunterladen fehlgeschlagen: ${message}`,
    fileName: (name: string) => `${name.replace(/[^\w.-]+/g, "-")}-preview.wav`,

    handoffFrom: (name: string) => `Aus der Vorschau von „${name}“ · aufnehmen oder aus einem Video entnehmen; nach dem Speichern kehren Sie zurück`,
    handoffSaved: (name: string) => `Gespeichert · zurück zur Vorschau von „${name}“; dort wird diese Stimme ausgewählt`,
    handoffBack: "Zurückkehren und verwenden",
    handoffCancel: "Nein, zurück",
    auditionClone: "Klon-Vorschau",
    auditionCloneLabel: (name: string) => `Klon-Vorschau · ${name}`,
    noCloneModel:
      "Noch kein lokales klonfähiges Modell installiert. Zuerst auf der Seite für lokale Modelle herunterladen (IndexTTS2, Qwen3-TTS Base, GPT-SoVITS…).",
    goLocal: "Zu lokalen Modellen",
  },
};
