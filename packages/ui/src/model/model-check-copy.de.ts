const outputWrong: Record<CheckSubject, string> = {
 transcribe: 'Modell läuft, erkennt aber die Sprache der Probe nicht richtig',
 synthesize: 'Modell läuft, aber die erzeugte Stimme ist nicht richtig',
 image: 'Modell läuft, aber das erzeugte Bild ist nicht richtig',
 separate: 'Modell läuft, hat Stimme und Hintergrund aber nicht getrennt',
};
const checkSentences = {
 APP_FILE_MISSING: () => ({ text: 'Eine mit BaoCut gelieferte Datei fehlt; kein Modellproblem', todo: 'BaoCut erneut installieren. Heruntergeladene Modelle bleiben unverändert.' }),
 MODEL_FILES_DAMAGED: () => ({ text: 'Modelldateien sind beschädigt', todo: 'Reparieren lädt beschädigte Dateien erneut herunter.' }),
 MODEL_OUTPUT_WRONG: (subject: CheckSubject) => ({ text: outputWrong[subject], todo: 'Zuerst reparieren. Bei Wiederholung technische Details kopieren und an uns senden.' }),
 MODEL_OUT_OF_MEMORY: () => ({ text: 'Nicht genug Arbeitsspeicher; Modell konnte nicht laden', todo: 'Andere große Modelle oder speicherintensive Apps schließen und erneut prüfen.' }),
 MODEL_WORKER_FAILED: () => ({ text: 'Hintergrundprozess des Modells hatte einen Fehler', todo: 'Erneut prüfen. Bei Wiederholung BaoCut neu starten oder technische Details kopieren und an uns senden.' }),
} satisfies Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence>;
import type { ModelCheckCode } from '@baocut/protocol';
import type { CheckSentence, CheckSubject, ModelCheckMessages, TrySubject } from './model-check-copy.ts';

export const de: ModelCheckMessages = {

  label: {
    check: "Prüfen",
    checkFull: "Modell prüfen",
    recheck: "Erneut prüfen",
    repair: "Reparieren…",
    repairSub: "Lädt nur beschädigte Dateien erneut herunter",
    details: "Technische Details",
    hideDetails: "Technische Details ausblenden",
    copy: "Technische Details kopieren",
    copied: "Technische Details kopiert",
    copyFailed: "Kopieren fehlgeschlagen. Text oben auswählen und manuell kopieren.",
    cancel: "Abbrechen",
    retry: "Erneut versuchen",
    pickRef: "Andere Aufnahme auswählen…",
    useSample: "Beispielaufnahme verwenden",
  },

  caption:
    "Prüfung bestätigt Modellfunktion; Reparatur lädt nur beschädigte Dateien erneut. Beim Löschen bleiben gemeinsam genutzte Komponenten anderer Modelle erhalten.",
  head: {
    running: "Überprüfen…",
    repairing: "Wird repariert…",
    failed: "Prüfung fehlgeschlagen:",
    notStarted: "Prüfung konnte nicht starten:",
  },

  sentence: (text: string) => `${text}.`,
  phase: {
    queued: "In Warteschlange",
    loading: "Modell wird geladen",
    running: "Kurze Probe wird ausgeführt",
    verifying: "Ergebnis wird geprüft",
    repairing: "Beschädigte Dateien werden erneut heruntergeladen; nach Reparatur automatische Prüfung",
  },

  checkSentences: checkSentences as Record<ModelCheckCode, (subject: CheckSubject) => CheckSentence>,

  unknown: {
    text: "Modell hat nicht korrekt funktioniert",
    todo: "Erneut prüfen. Bei Wiederholung technische Details kopieren und an uns senden.",
  } as CheckSentence,

  notStarted: {
    RUNTIME_UNREACHABLE: {
      text: "BaoCuts Hintergrunddienst antwortet nicht",
      todo: "Später erneut prüfen. Bei Wiederholung BaoCut neu starten.",
    },
    MODEL_IN_USE: {
      text: "Eine andere Aufgabe verwendet dieses Modell",
      todo: "Auf Abschluss warten oder unter Hintergrundaufgaben abbrechen, dann erneut prüfen.",
    },
    MODEL_UNAVAILABLE: { text: "Dieses Modell ist derzeit nicht verwendbar", todo: "Zuerst reparieren oder erneut aktivieren, dann prüfen." },
    RESOURCE_ADMISSION_UNSATISFIABLE: {
      text: "Nicht genug Arbeitsspeicher für dieses Modell",
      todo: "Kleineres Modell verwenden.",
    },
    WEB_METHOD_NOT_ALLOWED: { text: "Lokale Modelle können im Browser nicht geprüft werden", todo: "In der Desktop-App prüfen." },
    OFFLINE_STRICT: { text: "Strikter Offlinemodus aktiv", todo: "In Einstellungen ausschalten, dann erneut prüfen." },
  } as Record<string, CheckSentence>,
  notStartedUnknown: {
    text: "BaoCut hat diese Prüfung nicht angenommen",
    todo: "Später erneut prüfen. Bei Wiederholung technische Details kopieren und an uns senden.",
  } as CheckSentence,

  detail: {
    code: (code: string) => `Code ${code}`,
    model: (id: string, when: string) => `Modell ${id} · ${when}`,
    message: (message: string) => `Nachricht ${message}`,
    passed: (when: string) => `Prüfung bestanden · ${when}`,
  },

  noticeText: (what: string) => `Die letzte Prüfung dieses Modells ist fehlgeschlagen: ${what}`,

  refUnreadable: (file: string) => ({
    text: `Ihre Aufnahme konnte nicht gelesen werden: „${file}“. Datei möglicherweise beschädigt oder kein Audio`,
    todo: "Andere Aufnahme verwenden oder zuerst Beispielaufnahme anhören.",
  }),
  refUnknown: "Aufnahme",

  trySpeech: {
    noMemory: {
      text: "Nicht genug Arbeitsspeicher zum Abschließen der Synthese",
      todo: "Andere große Modelle oder speicherintensive Apps schließen und erneut versuchen.",
    },
    modelError: { text: "Modellfehler; kein Audio erzeugt", todo: "Modell prüfen, um den Fehler zu finden." },
    other: (message: string) => ({
      text: `Synthese fehlgeschlagen: ${message}`,
      todo: "Erneut versuchen. Bei Wiederholung Details unter Hintergrundaufgaben prüfen.",
    }),
    notStarted: (message: string) => ({ text: `Synthese konnte nicht gestartet werden: ${message}`, todo: "" }),
    noticeTodo: (todo: string) => `${todo} Auch eine Vorschau würde jetzt wahrscheinlich fehlschlagen.`,
  } as TrySubject,

  tryImage: {
    noMemory: {
      text: "Nicht genug Arbeitsspeicher zum Zeichnen",
      todo: "Andere große Modelle schließen oder Schrittzahl senken und erneut versuchen.",
    },
    modelError: { text: "Modellfehler; kein Bild erzeugt", todo: "Modell prüfen, um den Fehler zu finden." },
    other: (message: string) => ({
      text: `Zeichnen fehlgeschlagen: ${message}`,
      todo: "Erneut versuchen. Bei Wiederholung Details unter Hintergrundaufgaben prüfen.",
    }),
    notStarted: (message: string) => ({ text: `Zeichnen konnte nicht gestartet werden: ${message}`, todo: "" }),
    noticeTodo: (todo: string) => `${todo} Auch ein Testbild würde jetzt wahrscheinlich fehlschlagen.`,
  } as TrySubject,
};
