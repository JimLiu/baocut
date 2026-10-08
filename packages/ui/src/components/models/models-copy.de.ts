const count = (n: number, one: string, many: string) => `${n} ${pluralForm('de', n, { one, other: many })}`;
import { pluralForm } from '@baocut/protocol';
import type { OnlineCapability } from '@baocut/protocol';
import type { RefreshKind } from '../../model/models-cloud.ts';
import type { ModelsMessages } from './models-copy.ts';

export const de: ModelsMessages = {
  page: {
    title: "Modelle",
    nav: "Modellnavigation",
    navSection: "Funktionen",
    categories: "Modellkategorien",
    tabs: (label: string) => `${label}: Modellverwaltung`,
    offline: "Modelle erscheinen nach Verbindung mit der Runtime.",
    loading: "Modelle werden geladen…",
    goAgent: "Zu Einstellungen › Agent",
  },
  local: {
    defaultLabel: "Standardmodell",
    defaultDesc: "Für neue Videos vorausgewählt und für CLI-Transkription verwendet.",
    separateDefaultDesc: "Für die Hintergrundtrennung bei übersetzten Vertonungen ohne Modellauswahl und für CLI-Vertonung verwendet.",
    auto: "Automatisch",
    autoUses: (id: string) => `Automatisch verwendet derzeit ${id}.`,
    otherDefault: (name: string) => `Aktueller Standard ist ${name} (unter Cloud-Modellen festgelegt); Auswahl eines lokalen Modells ersetzt ihn.`,
    defaultSet: "Standard festgelegt",
    defaultFailed: (message: string) => `Standard konnte nicht festgelegt werden: ${message}`,
    installed: "Installiert",
    available: "Zum Herunterladen verfügbar",
    emptyInstalled: "Noch keine Modelle installiert.",
    emptyAvailable: "Alle Modelle dieser Kategorie sind installiert.",
    remove: "Löschen",
    reenable: "Erneut aktivieren",
    reenabled: (id: string) => `Erneut aktiviert: ${id}`,
    reenableFailed: (message: string) => `Erneute Aktivierung fehlgeschlagen: ${message}`,
    emptyTitle: (label: string) => `Keine lokalen Modelle für ${label} noch`,
    emptyBody:
      "Der Modellordner dieses Computers enthält nur Modellpakete für Spracherkennung, Sprachsynthese, Bilderzeugung und Quellentrennung. Lokale Modelle dieser Kategorie werden noch nicht unterstützt.",
  },

  imageLocal: {
    defaultDesc: "Für neue Bildaufgaben vorausgewählt. Ohne Standard muss jedes Mal ein Modell gewählt werden; manuelle Auswahl hat immer Vorrang.",
    cloudDefault: (name: string) =>
      `Der Standard ist ein Cloud-Modell (${name}); unter Einstellungen › Cloud-Modelle ändern. Auswahl eines lokalen Modells wechselt zu diesem.`,
    noInstalled: "Noch kein Bilderzeugungsmodell installiert. Zuerst eines unten herunterladen.",
    licenseUse: "Damit erzeugte Bilder dürfen nur in nichtkommerziellen Inhalten verwendet werden; für kommerziell geplante Videos ein anderes Bildmodell wählen.",

    tryButton: "Ausprobieren",
    tryTitle: (name: string) => `Ausprobieren: ${name}`,
    tryPromptTitle: "Test-Prompt · ein Bild 512 × 512",
    tryPromptLabel: "Testaufforderung",
    tryPlaceholder: "Bild beschreiben",
    tryChars: (n: number, max: number) => `${n} / ${max} Zeichen`,
    trySample: "Anderes Beispiel",
    tryFacts: (steps: number) => `1:1 · 512 × 512 · ${steps} Schritte · 1 Bild · offline · belegt den Platz für schwere Aufgaben dieses Computers`,
    tryNote:
      "Erzeugt ein kleines Bild auf diesem Computer, um das Ergebnis offline zu prüfen. Belegt den Platz für schwere Aufgaben; andere lokale Modellaufgaben warten auf den Abschluss. Schließen des Dialogs stoppt nicht; die Ausführung erscheint auch unter Hintergrundaufgaben.",
    tryReady: "Bereit zum Start",
    tryRunning: (steps: number) => `512² wird gezeichnet · ${steps} Schritte…`,
    tryDone: (seconds: number | null) => (seconds !== null ? `Fertig · ${seconds}s` : "Fertig"),
    tryFailed: "Bild konnte nicht gezeichnet werden",
    tryResult: "Testergebnis",
    tryImageAlt: "Beim Test erzeugtes Bild",
    tryOpenFailed: (message: string) => `Ergebnisbild konnte nicht geöffnet werden: ${message}`,
    tryWhere: "Wie andere erzeugte Bilder wird das Ergebnis unter Werkzeuge › Bild erzeugen aufgeführt; nicht ins Video hinzugefügt",
    tryDownload: "Bild herunterladen",
    tryCopy: "Prompt kopieren",
    tryClose: "Schließen",
    tryStopWaiting: "Hör auf zu warten",
    tryStart: "Generieren starten",
    tryAgain: "Noch eins generieren",
    tryBusy: "Wird generiert…",

    tryFileName: (id: string) => `image-try-${id}`,
  },
  cloud: {
    heading: {
      transcribe: "Verwandeln Sie Ihre Rede in ein Transkript",
      synthesizeSpeech: "Text vorlesen",
      generateImage: "Beschreibungen in Bilder verwandeln",
      generateText: "Untertitel übersetzen und Text erzeugen",
    } satisfies Record<OnlineCapability, string>,
    lede: {
      transcribe: "Nimmt Audio und liefert erkannten Text. Spracherkennung hat ein einziges Standardmodell, gemeinsam mit der Seite für lokale Modelle.",
      synthesizeSpeech: "Nimmt Text und liefert Sprache. Für Spracherzeugung und Vertonung verfügbar; online und kostenpflichtig, meist pro Zeichen.",
      generateImage:
        "Nimmt einen Prompt und liefert ein Bild. Für Bilderzeugung verfügbar; online und pro Bild abgerechnet. Codex CLI kann ebenfalls zeichnen: ohne Schlüssel, mit Ihrem Codex-Abonnement. Der Schalter steht auf der ersten Karte der Anbieterliste unten.",
      generateText:
        "Nimmt Textanweisungen und liefert erzeugten Text. Für Untertitelübersetzung, übersetzte Vertonung und Werkzeuge › Texterzeugung; online und pro Token abgerechnet.",
    } satisfies Record<OnlineCapability, string>,
    defaultLabel: {
      transcribe: "Standard-Cloud-Sprachmodell",
      synthesizeSpeech: "Standardmodell für Cloud-Sprachsynthese",
      generateImage: "Standard-Cloud-Bildmodell",
      generateText: "Standardtextmodell",
    } satisfies Record<OnlineCapability, string>,
    defaultDesc: {
      transcribe:
        "Für Transkription ohne Modellauswahl. Spracherkennung hat einen einzigen Standard: Ein Cloud-Modell hier ersetzt die Auswahl der lokalen Seite. „Lokales Modell verwenden“ entfernt den Cloud-Standard und kehrt zur automatischen lokalen Auswahl zurück.",
      synthesizeSpeech:
        "Für Spracherzeugung oder Vertonung ohne Modellauswahl. „Jedes Mal auswählen“ bedeutet keinen Standard; Anfragen ohne Modell werden abgelehnt, und bei Nutzung muss ausgewählt werden.",
      generateImage:
        "Für Bilderzeugung, bcut image oder den Agenten ohne Modellauswahl. Codex wird nie automatisch gewählt; zum Festlegen als Standard hier auswählen. „Jedes Mal auswählen“ bedeutet keinen Standard; bei Erzeugung muss ausgewählt werden.",
      generateText:
        "Für Untertitelübersetzung, übersetzte Vertonung oder Texterzeugung ohne Modellauswahl. „Jedes Mal auswählen“ bedeutet keinen Standard; Runtime wählt nichts automatisch, lehnt Anfragen ohne Modell ab, und bei Nutzung muss ausgewählt werden.",
    } satisfies Record<OnlineCapability, string>,

    localDefaultDesc: "Auf der Seite für lokale Modelle festgelegt · „Jedes Mal auswählen“ entfernt den Standard",
    none: {
      transcribe: "Lokales Modell verwenden",
      synthesizeSpeech: "Wählen Sie jedes Mal",
      generateImage: "Wählen Sie jedes Mal",
      generateText: "Wählen Sie jedes Mal",
    } satisfies Record<OnlineCapability, string>,
    noneDesc: {
      transcribe: "Zur automatischen Auswahl auf der Seite für lokale Modelle zurückkehren",
      synthesizeSpeech: "Bei Spracherzeugung oder Vertonung auswählen",
      generateImage: "Bei Bilderzeugung auswählen",
      generateText: "Bei Nutzung auswählen (Runtime wählt nicht automatisch)",
    } satisfies Record<OnlineCapability, string>,
    codexItem: "Codex CLI · Bilder",
    codexItemDesc: "Verwendet Ihr Codex-Abonnement · ein Bild gleichzeitig · 5–10× langsamer",
    unavailable: "Nicht verfügbar",
    pickerEmpty: { image: "Anbieter verbinden oder Codex-Bilder einschalten, um auszuwählen", other: "Zum Auswählen einen Anbieter verbinden" },
    defaultSet: "Standardmodell geändert",
    defaultFailed: (message: string) => `Standardmodell konnte nicht geändert werden: ${message}`,
    providers: "Anbieter",
    providersDesc: "Alle Modellarten eines Anbieters teilen seinen Schlüssel. Testergebnisse gelten nur für das getestete Modell.",

    providersExtra: {
      transcribe: "",
      synthesizeSpeech: " Sprachsynthese wird meist pro Zeichen abgerechnet.",
      generateImage: " Bilderzeugung wird pro Bild abgerechnet; für erzeugte Bilder gelten die Nutzungsbedingungen des Anbieters.",
      generateText: " Texterzeugung wird pro Token abgerechnet.",
    } satisfies Record<OnlineCapability, string>,
    addCustom: "Benutzerdefinierten Anbieter hinzufügen",
    connected: "Verbunden",
    manageKey: "Schlüssel verwalten",
    connect: "Verbinden",
    addModel: "Modell hinzufügen",
    defaultChip: "Standard",
    expand: (name: string) => `Einblenden: ${name} Modelle`,
    collapse: (name: string) => `Ausblenden: ${name} Modelle`,
    probe: {
      transcribe: "Testrede",
      synthesizeSpeech: "Synthese testen",
      generateImage: "Bild testen",
      generateText: "Testgenerierung",
    } satisfies Record<OnlineCapability, string>,
    probeUnsupported: "Einzeltests sind noch nicht verfügbar",
    headNoModels: (kind: string) => `Noch keine Modelle für ${kind}; unten eines hinzufügen, das diesen Schlüssel verwendet`,
    headCustomOff: "Nicht verbunden · Benutzerdefiniert · nach Verbindung Modelle für jeden Zweck hinzufügen",
    headOff: (first: string, total: number) =>
      `Nicht verbunden · ${first}${total > 1 ? ` und ${count(total - 1, "weiteres Modell", "weitere Modelle")}` : ""} · verbinden zum Testen und Festlegen als Standard`,
    headCount: (total: number) => count(total, "Modell", "Modelle"),
    headDefault: (id: string) => ` · Standard: ${id}`,

    refresh: { models: "Modelle aktualisieren", voices: "Stimmenkatalog aktualisieren" } satisfies Record<RefreshKind, string>,
    refreshNeedsKey: (label: string) => `${label} (zuerst einen Schlüssel verbinden)`,
    refreshing: { models: "Modelle werden aktualisiert…", voices: "Stimmenkatalog wird aktualisiert…" } satisfies Record<RefreshKind, string>,
    refreshFailedLine: { models: "Modelle konnten nicht aktualisiert werden", voices: "Stimmen konnten nicht aktualisiert werden" } satisfies Record<RefreshKind, string>,
    builtinModels: "Integrierte Liste · aktualisieren, um mit diesem Schlüssel nutzbare Modelle zu sehen",
    builtinVoices: (models: number, voices: number) =>
      `${count(models, "Modell", "Modelle")} · ${count(voices, "Stimme", "Stimmen")} · integrierter Katalog · aktualisieren, um mit diesem Schlüssel nutzbare Stimmen zu sehen`,
    freshModels: (models: number, ago: string) => `${count(models, "Modell", "Modelle")} · aktualisiert ${ago}`,
    freshVoices: (models: number, voices: number, ago: string) =>
      `${count(models, "Modell", "Modelle")} · ${count(voices, "Stimme", "Stimmen")} · neu abgerufen ${ago}`,
    unusable: (n: number) => ` · ${n} mit diesem Schlüssel nicht nutzbar`,
    refreshFailed: (message: string) => `Aktualisieren fehlgeschlagen: ${message}`,
    modelVoices: (n: number) => (n ? `${count(n, "voreingestellte Stimme", "voreingestellte Stimmen")}` : "Keine voreingestellten Stimmen · Tests benötigen eine Stimmen-ID"),
    modelSizes: (sizes: string[], max: number) =>
      `${sizes.length ? sizes.join(" / ") : "Größe vom Dienst vorgegeben"} · bis zu ${count(max, "Bild", "Bilder")} gleichzeitig`,
    customTag: "Benutzerdefiniert",
    emptyProviders: "Noch keine Cloud-Anbieter für diese Kategorie. Ein benutzerdefinierter OpenAI-kompatibler Dienst kann hinzugefügt werden.",
    noCloud: "Diese Kategorie hat keine Cloud-Modelle.",
  },

  textParams: {
    effort: "Denkaufwand",
    effortDesc:
      "Gilt nur für Modelle mit Denksteuerung; bei fehlender Stufe wird die nächstgelegene verwendet. Nicht einstellbare Modelle ignorieren sie. „Automatisch“ verwendet den Modellstandard.",

    effortCount: (tunable: number, total: number) => (total ? ` ${tunable} von insgesamt ${count(total, "verbundenes Modell", "verbundene Modelle")} können eingestellt werden.` : ""),
    concurrency: "Gleichzeitige Anfragen",
    concurrencyDesc: (min: number, max: number) =>
      `Maximale gleichzeitige Textanfragen pro Anbieter (${min}–${max}), gemeinsam für Untertitelübersetzung und Texterzeugung. Bei Ratenbegrenzung verringern.`,
    saved: "Gespeichert",
    failed: (message: string) => `Speichern fehlgeschlagen: ${message}`,
  },
  codexCard: {
    title: "Codex CLI",
    on: "Ein · verwendet Ihr Codex-Abonnement, ohne Schlüssel · ein Bild gleichzeitig · ignoriert Größe · 5–10× langsamer",
    off: "Aus · einschalten, um es für Bilderzeugung und hier als Standardmodell auszuwählen",
    missing: "Codex nicht gefunden · Codex CLI vor dem Zeichnen installieren und anmelden.",
    switchLabel: "Mit Codex zeichnen",
    toggleFailed: (enabled: boolean, message: string) => `Umschalten fehlgeschlagen: ${enabled ? "ein" : "aus"} für Codex-Bilder: ${message}`,
  },
  key: {
    title: (name: string) => `${name} · API-Schlüssel`,
    shared: (name: string, kinds: string) => `Dieser Schlüssel wird geteilt von allen ${name}-Modellen (${kinds}); einmal eingeben, damit jede Liste ihn verwendet.`,
    sharedCustom: (name: string) =>
      `Dieser Schlüssel wird geteilt von allen ${name}-Modellen. Spracherkennungs-, Text-, Sprachsynthese- und Bildmodelle können hinzugefügt werden; den Schlüssel nur einmal eingeben.`,
    field: "API-Schlüssel",
    fieldCustom: "Leer lassen, wenn der Dienst keinen Schlüssel benötigt.",
    endpoint: (url: string) => `Basis-URL · ${url}`,
    keep: "Ein Schlüssel ist bereits gespeichert. Leer lassen, um ihn zu behalten und nur erneut zu prüfen.",
    verifyNote:
      "Vor dem Speichern prüft eine schreibgeschützte Anfrage an den Anbieter den Schlüssel; bei Fehler wird nicht gespeichert. Der Schlüssel bleibt nur auf diesem Computer und wird nicht erneut angezeigt.",
    removeKey: "Schlüssel abziehen",
    removeProvider: "Anbieter löschen",
    cancel: "Abbrechen",
    save: "Prüfen und speichern",
    saved: (name: string) => `Verbunden: ${name}`,
    failed: (message: string) => message,
    removed: (name: string) => `Schlüssel entfernt: ${name}`,
    providerRemoved: (name: string) => `Gelöscht: ${name}`,
    removeFailed: (message: string) => `Entfernen fehlgeschlagen: ${message}`,
    confirmTitle: (name: string) => `Löschen: „${name}“?`,
    confirmBody: "Seine deklarierten Modelle werden zusammen mit dem Schlüssel gelöscht. Darauf zeigende Standardmodelle bleiben erhalten und werden als nicht verfügbar angezeigt.",
    confirm: "Löschen",
  },
  custom: {
    title: "Benutzerdefinierten Anbieter hinzufügen",
    name: "Anbietername",
    url: "Basis URL",
    urlPlaceholder: "https://api.example.com/v1",
    model: "Erste Modell-ID",
    kind: "Verwenden",
    voices: "Stimmen-IDs",
    voicesPlaceholder: "Kommagetrennt (optional) · z. B. zh-female, zh-male",
    taken: (name: string) => `Diese URL ist bereits hinzugefügt als „${name}“. Darunter Modelle hinzufügen, um denselben Schlüssel wiederzuverwenden.`,
    takenAction: (name: string) => `Hinzufügen zu „${name}“`,
    note: {
      transcribe: "Muss Audiotranskription unterstützen (/v1/audio/transcriptions); reine Chat-Endpunkte können keine Sprache erkennen.",
      synthesizeSpeech: "Muss /v1/audio/speech unterstützen; ohne Stimmen-IDs muss bei Nutzung eine angegeben werden.",
      generateImage: "Muss /v1/images/generations unterstützen; Größen nutzen konservative Standardwerte (1024 × 1024, ein Bild gleichzeitig).",
      generateText: "Muss /v1/chat/completions unterstützen; Kontext- und Ausgabelängen nutzen konservative Standardwerte (32K und 4K Token).",
    } satisfies Record<OnlineCapability, string>,

    noteHead: "Ein OpenAI-kompatibler Dienst. ",
    noteTail: " Danach verbinden (Schlüssel eingeben oder leer lassen) und das Modell testen.",
    add: "Hinzufügen",
    added: (name: string) => `Hinzugefügt: ${name} · als Nächstes verbinden`,
    failed: (message: string) => `Hinzufügen fehlgeschlagen: ${message}`,
  },

  kindLabel: {
    transcribe: "Spracherkennung · ASR",
    generateText: "Textgenerierung · LLM",
    synthesizeSpeech: "Sprachsynthese · TTS",
    generateImage: "Bildgenerierung · Image",
  } satisfies Record<OnlineCapability, string>,
  addModel: {
    title: "Modell hinzufügen",
    model: "Modell-ID",
    taken: "Dieser Anbieter hat diese Modell-ID bereits.",
    note: "Der Verwendungszweck bestimmt Modellliste und Testart (Text senden oder Bild empfangen). Nach dem Hinzufügen testen.",
    added: (id: string) => `Hinzugefügt: ${id}`,
    failed: (message: string) => `Modell konnte nicht hinzugefügt werden: ${message}`,
  },
  probe: {
    title: {
      synthesizeSpeech: "Sprachsynthese testen",
      generateImage: "Bildgenerierung testen",
      generateText: "Testen Sie die Textgenerierung",
    } as Partial<Record<OnlineCapability, string>>,
    chip: { transcribe: "ASR", synthesizeSpeech: "TTS", generateImage: "Bild", generateText: "LLM" } satisfies Record<OnlineCapability, string>,
    sample: {
      synthesizeSpeech: "Testtext · vereinfachtes Chinesisch",
      generateImage: "Testprompt · ein Bild · Standardgröße",
      generateText: "Testaufforderung",
    } as Partial<Record<OnlineCapability, string>>,
    voice: (voice: string) => `Stimme · ${voice}`,
    voiceField: "Stimmen-ID",
    voiceDesc: "Dieses Modell hat keine voreingestellten Stimmen; der Test benötigt eine dem Anbieter bekannte Stimmen-ID.",
    note: {
      synthesizeSpeech: "Sendet diesen Text zur Synthese an das gewählte Modell und prüft, ob Audio zurückkommt.",
      generateImage: "Sendet diesen Prompt zum Zeichnen an das gewählte Modell und prüft, ob ein Bild zurückkommt.",
      generateText: "Sendet den obigen Prompt an das gewählte Modell und prüft, ob erzeugter Text zurückkommt.",
    } as Partial<Record<OnlineCapability, string>>,
    cost: "Der Anbieter kann Nutzung berechnen. Schließen des Dialogs zieht keine bereits gesendete Anfrage zurück; der Test erscheint auch unter Hintergrundaufgaben.",
    ready: "Bereit zum Start",
    running: {
      synthesizeSpeech: "Text wird gesendet, warte auf Audio…",
      generateImage: "Prompt wird gesendet, warte auf das Bild…",
      generateText: "Wartet auf Modellantwort…",
    } as Partial<Record<OnlineCapability, string>>,
    done: (seconds: number | null) => (seconds !== null ? `Test bestanden · ${seconds}s` : "Test bestanden"),
    failed: "Test fehlgeschlagen",
    result: "Testergebnis",
    resultNote: "Das Ergebnis wird nur hier angezeigt und nicht ins Video eingefügt.",

    textResultNote: "Die Antwort wird nicht ins Video eingefügt; wie anderer erzeugter Text wird sie als Dokument in Space gespeichert.",
    start: "Test starten",
    retry: "Testen Sie noch einmal",
    testing: "Wird getestet…",
    close: "Schließen",
    openFailed: (message: string) => `Ergebnis konnte nicht geöffnet werden: ${message}`,
    asrUnsupported: "Spracherkennung kann noch nicht einzeln getestet werden",
  },
  voices: {
    title: "Meine Stimmen",
    lede:
      "Eine Referenzaufnahme als Stimme speichern und bei Spracherzeugung oder übersetzter Vertonung nach Namen auswählen; die Aufnahme bleibt auf diesem Computer. Für eine Cloud-Engine (ElevenLabs) zuerst hier hochladen und einen Klon erstellen. Jederzeit löschbar.",
    emptyTitle: "Noch keine Stimmen",
    emptyBody: "Eine 5–12 Sekunden lange Referenzaufnahme auswählen oder ein exportiertes Stimmpaket importieren. Nach dem Speichern überall auswählbar.",
  },

  quoted: (text: string) => `„${text}“`,
};
