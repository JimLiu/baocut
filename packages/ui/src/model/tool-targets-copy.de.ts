import type { ToolTargetsMessages } from './tool-targets-copy.ts';

export const de: ToolTargetsMessages = {
  unknownLanguage: "Unbekannte Sprache",
  langCount: (label: string, count: number) => `${label} ×${count}`,
  joinLangs: (labels: readonly string[]) => labels.join(", "),
  tagTranscript: (langs: string) => `Transkript · ${langs}`,
  tagTranslation: (langs: string) => `Übersetzung · ${langs}`,
  tagDub: (langs: string) => `Vertonung · ${langs}`,
  tagPending: "Der Inhalt wird noch gelesen; beim Start wird ein Transkript ausgewählt",
  blockTranscribing: 'Wird gerade transkribiert; nach Abschluss kannst du neu transkribieren',
  blockQueued: 'Bereits zur Transkription eingereiht',
  blockTranscribingWait: 'Wird gerade transkribiert; nach Abschluss auswählbar',
  blockQueuedWait: 'Zur Transkription eingereiht; nach Abschluss auswählbar',
  blockFailed: 'Die letzte Transkription ist fehlgeschlagen; zuerst erneut transkribieren',
  blockNoTranscript: 'Noch kein Transkript; zuerst transkribieren',
  duplicateTranscript: (langs: string) =>
    `Dieses Video hat bereits ein Transkript in ${langs}. Standardmäßig wird ein neues Video erstellt; dieses Video und seine Übersetzungen bleiben unverändert. Mit „Transkript dieses Videos ersetzen“ wird das aktuelle Transkript getauscht: Übersetzungen werden über den Ausgangstext zugeordnet und übernommen, Sätze mit geändertem Ausgangstext als veraltet markiert – alles als eine Änderung, die sich rückgängig machen lässt.`,
  duplicateTranslation: (lang: string) =>
    `Dieses Video hat bereits eine Version in ${lang} als Übersetzung. Eine weitere wird hinzugefügt und die vorhandene bleibt erhalten; im Editor auswählen, welche verwendet werden soll.`,
  duplicateDub: (lang: string) => `Dieses Video hat bereits eine Version in ${lang} als Vertonung. Ein weiterer Satz wird hinzugefügt und der vorhandene bleibt erhalten.`,
  duplicateTitle: {
    transcribe: 'Dieses Video hat bereits ein Transkript',
    'translate-subtitles': "Vorhandene Übersetzungen bleiben erhalten",
    dub: "Vorhandene Vertonungen bleiben erhalten",
  },
  translationOption: (lang: string, nth: number | null) => `${lang} Übersetzung${nth === null ? "" : ` #${nth}`}`,
  translatedFrom: (lang: string) => `Aus dem ${lang} Transkript`,
  destNewVideo: 'Neues Video',
  destNewVideoNote:
    'Ein neues Video im selben Projekt, das dasselbe Material verknüpft; dieses Video und seine Übersetzungen bleiben unverändert',
  destReplace: 'Transkript dieses Videos ersetzen',
  destReplaceNote:
    'Tauscht das aktuelle Transkript; Übersetzungen, Untertitel und Vertonungen werden in derselben Änderung übernommen, die sich rückgängig machen lässt',
  newVideoName: (name: string) => `${name} · Neu transkribiert`,
  impactTranslation: (lang: string, units: number) => `${lang} · ${units} ${units === 1 ? 'Satz' : 'Sätze'}`,
  impactDub: (lang: string, groups: number) =>
    `${lang} · ${groups} ${groups === 1 ? 'Satz Vertonungen' : 'Sätze Vertonungen'} · Vertonungen von Sätzen mit unveränderter Übersetzung bleiben erhalten und werden als möglicherweise nicht synchron markiert`,
  impactRule:
    'Sätze mit unverändertem Ausgangstext behalten Übersetzung und Prüfstatus, zugeordnet auf Satzebene; geänderte oder nicht zuordenbare Sätze werden als veraltet markiert und danach mit „Veraltete Übersetzungen erneuern“ neu übersetzt. Die genauen Zahlen stehen im Ergebnis.',
  impactUndo: 'Eine Änderung, die sich rückgängig machen lässt',
};
