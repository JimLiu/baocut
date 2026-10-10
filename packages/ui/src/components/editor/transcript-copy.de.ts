import type { RestoreRefusal } from '../../model/transcript-cut.ts';
import { pluralForm } from '@baocut/protocol';
function secondsLabel(seconds: number): string { return seconds < 10 ? `${(Math.round(seconds * 10) / 10).toFixed(1).replace('.', ',')} s` : `${Math.round(seconds)} s`; }
export const deSeconds = secondsLabel;
const words = (n: number) => pluralForm('de', n, { one: `${n} Wort`, other: `${n} Wörter` });
import type { TranscriptMessages, TranscriptToolsMessages } from './transcript-copy.ts';

export const deTranscript: TranscriptMessages = {
  title: "Transkript",
  modes: "Transkript-Bearbeitungsmodus",
  modeEdit: "Text bearbeiten",
  modeCut: "Medien schneiden",

  hintEdit: "Ändert nur den transkribierten Text; Video und Audio bleiben unverändert. Zum Bearbeiten auf ein Wort doppelklicken; ⌫ löscht nur Text.",
  hintCut: "Text auswählen und mit ⌫ gemeinsam aus Video, Audio und Untertiteln herausschneiden. Herausgeschnittene Wörter bleiben durchgestrichen und können wiederhergestellt werden.",

  emptyTitle: "Noch kein Transkript",
  emptyNoMedia: "Zuerst eine Video- oder Audiodatei hinzufügen. Nach der Transkription erscheinen die gesprochenen Wörter hier.",
  emptyNotPlaced: "Video oder Audio liegt noch nicht in der Zeitleiste. Dort platzieren und transkribieren; das Transkript erscheint hier.",
  emptyNotTranscribed: "Die Materialien in der Zeitleiste wurden nicht transkribiert. Im Untertitel-Bereich transkribieren; das Transkript erscheint hier.",
  gotoSubtitle: "Unter Untertitel transkribieren",
  addMedia: "Medien hinzufügen",
  loading: "Transkript wird geladen…",
  noWords: "Dieses Transkript enthält keine anzuzeigenden Wörter.",
  notSpeech: "Das Format dieses Transkripts wird nicht erkannt.",


  stats: (count: number, cut: number) => (cut ? `${words(count)} · ${cut} herausgeschnitten` : words(count)),
  jump: "Hierher springen",
  cutWordTitle: "Aus der Zeitleiste schneiden",
  partialWordTitle: "Ein Schnitt liegt innerhalb dieses Wortes; nur ein Teil bleibt in der Zeitleiste",

  selected: (count: number, seconds: number | null) =>
    seconds === null ? `${words(count)} ausgewählt` : `${words(count)} ausgewählt · ${secondsLabel(seconds)}`,
  cut: "Schneiden",
  restore: "Wiederherstellen",
  editWord: "Wort bearbeiten",
  deleteText: "Text löschen",
  clear: "Auswahl aufheben · Esc",
  aiFind: "Schnitte finden",
  aiFindHint: "Oder zuerst Füllwörter und Pausen mit KI finden",

  cutDone: (seconds: number, ranges: number) =>
    ranges > 1 ? `Schnitt ${secondsLabel(seconds)} · ${ranges} Bereiche` : `Schnitt ${secondsLabel(seconds)}`,
  cutNothing: "Die ausgewählten Wörter liegen nicht mehr in der Zeitleiste; nichts zu schneiden.",
  cutTooShort: "Die Auswahl ist kürzer als ein Frame und kann nicht geschnitten werden.",
  restoreDone: (seconds: number) => `Wiederhergestellt: ${secondsLabel(seconds)}`,
  restoreNotRelaid: "Einige Schnitte haben keine passende Naht in der Zeitleiste. Sie wurden aus der Schnittliste entfernt, aber der Inhalt wurde nicht wiederhergestellt.",
  restoreRefused: {
    untracked: "Dieser Bereich wurde nicht mit einem Schnitt entfernt (etwa durch Trimmen am Cliprand); es gibt keinen wiederherstellbaren Schnitt. Den Cliprand in der Zeitleiste ziehen, um ihn wiederherzustellen.",
    partial: "Nur ein Teil dieses Bereichs wurde durch einen Schnitt entfernt; sein Bereich kann daher nicht geändert werden. Zuerst auf das Schnittband klicken, um diesen Teil wiederherzustellen.",
  } satisfies Record<RestoreRefusal, string>,
  textSaved: "Text aktualisiert · Video und Audio unverändert",
  textDeleted: (count: number) => `Text gelöscht von ${words(count)} · Video und Audio unverändert`,

  stale: (count: number) =>
    pluralForm('de', count, { one: "1 Untertitelspur wurde aus einem älteren Transkript erstellt und nicht aktualisiert.", other: `${count} Untertitelspuren wurden aus einem älteren Transkript erstellt und nicht aktualisiert.` }),
  gotoCaptions: "Untertitel öffnen",
  undo: "Rückgängig machen",

  seamLabel: (seconds: number) => `Schnitt ${secondsLabel(seconds)} · klicken zum Wiederherstellen`,
  cutLabel: "Im Transkript schneiden",
  restoreLabel: "Geschnittenen Inhalt wiederherstellen",
  liveCopy: "Bisher Transkribiertes kopieren",
  liveCopied: "Bisher Transkribiertes kopiert · Transkription läuft noch",
  liveSpeaker: "Wird erkannt",
  liveWaiting: "Erkannter Text erscheint hier, sobald er eintrifft. Manche Dienste liefern alles erst am Ende.",
  liveNote: "Erkannter Text erscheint Absatz für Absatz. Bearbeiten können Sie ihn, sobald die Transkription fertig ist.",
  liveJump: "Zum Neuesten",
  liveSaving: "Transkript wird gespeichert",
};

export const deTranscriptTools: TranscriptToolsMessages = {


  findTip: "Suchen und ersetzen · ⌘F",
  findLabel: "Suchen und ersetzen",
  findPlaceholder: "Im Transkript suchen",

  lockTranslation: "Übersetzungen können hier durchsucht, aber nicht bearbeitet werden – der Transkript-Bereich bearbeitet nur das Original",
  lockLoading: "Eine neuere Transkriptversion wird noch geladen; nach Abschluss ersetzen",
  replaceLabel: "Transkripttext ersetzen",
  replaceDone: (count: number) => `Ersetzt: ${count} ${pluralForm('de', count, { one: "Treffer", other: "Treffer" })} · Video und Audio unverändert`,
  replaceNothing: "Keine Treffer müssen geändert werden",

  copyMenu: "Transkript kopieren",
  copyAllHead: (lang: string) => `Alles kopieren · ${lang}`,
  copyText: "Text kopieren",
  copySettings: "Kopiereinstellungen",
  copyWithSettings: "Mit Einstellungen kopieren",
  copyTextOnly: "Nur Text kopieren",
  textOnly: "Nur Text",
  keepCut: "Mit geschnittenen Teilen",
  copyConfirm: "Kopieren",
  copyTranslationOnly: "Nur die Übersetzung wird angezeigt, daher wird aus dem Bereich kopiert: ohne Metadatenkopf, geschnittene Teile fehlen.",
  copyScopeHead: (scope: string) => `Kopieren: ${scope}`,
  copied: (scope: string, receipt: string) => `Kopiert: ${scope} · ${receipt}`,
  copyFailed: "Kopieren fehlgeschlagen · Browser verweigert Zwischenablagezugriff",
  copyEmpty: "Nichts zum Kopieren",
  scopeAll: "alles",
  scopePara: "diesen Absatz",
  scopeChapter: (title: string) => `„${title}“`,
  scopeSelection: "ausgewählten Text",
  copySelection: "Kopieren",
  copySelectionTip: "Ausgewählten Text kopieren · ⌘C",

  langLabel: "Transkriptsprache",
  langSource: "Original",
  langTranslation: "Übersetzung",
  langBoth: (source: string, translation: string) => `${source} + ${translation}`,
  showBoth: "Original daneben anzeigen",
  showBothNeedsTranslation: "Zuerst eine Übersetzung auswählen",
  showBothHint: "Nebeneinander",
  noTranslation: "Noch keine Übersetzungen",
  noTranslationHint: "Im Untertitel-Bereich mit „+ Übersetzen nach…“ übersetzen",
  translationNote: "Übersetzungen folgen der Wiedergabe nur nach Absätzen; Wortzeiten gibt es nur im Original. Wortweise Hervorhebung wäre erfunden.",
  translationOnly: "Beim Anzeigen nur einer Übersetzung kann nicht bearbeitet oder geschnitten werden; zum Bearbeiten zum Original oder zur Ansicht nebeneinander wechseln.",
  noParagraphTranslation: "Dieser Absatz hat keine Übersetzung",

  paraMenu: "Dieser Absatz…",
  moveUp: "Zum vorherigen Kapitel verschieben",
  moveDown: "Zum nächsten Kapitel verschieben",
  play: "Absatz abspielen",
  moveHead: "Zu Kapitel verschieben",
  moveTo: (title: string) => `Verschieben nach „${title}“`,
  moveWith: (count: number) => (count > 1 ? `Wird mit den benachbarten Absätzen auf dieser Seite verschoben; insgesamt ${count} Absätze` : "Verschiebt nur diesen Absatz"),

  noPrev: "Vor diesem Absatz gibt es kein Kapitel",
  noNext: "Nach diesem Absatz gibt es kein Kapitel",
  moveBlocked: "Verschieben würde dieses Kapitel leeren oder den Beginn des benachbarten Kapitels überschreiten",
  moveLabel: "Absatz zum benachbarten Kapitel verschieben",
  moved: (title: string, count: number) => (count > 1 ? `Verschoben: ${count} Absätze nach „${title}“` : `Verschoben nach „${title}“`),
  cutPara: "Diesen Absatz schneiden",
  cutParaHint: "Schneidet Video, Audio und Untertitel gemeinsam; wiederherstellbar",

  chapterMenu: "Dieses Kapitel…",
  renameChapter: "Umbenennen…",
  cutChapter: "Dieses Kapitel schneiden",
  cutChapterHint: "Schneidet Video, Audio und Untertitel gemeinsam; spätere Kapitel rücken nach",
  cutChapterLabel: "Kapitel schneiden",
  cutChapterRefused: {
    empty: "Dieses Kapitel hat keine Länge",
    whole: "Dieses Kapitel umfasst das ganze Video; Schneiden würde nichts übriglassen",
    'no-tracks': "Keine Spur in der Zeitleiste verwendet die transkribierten Materialien; nichts zu schneiden",
  } satisfies Record<'empty' | 'whole' | 'no-tracks', string>,
  cutChapterDone: (title: string, seconds: number) => `Schneiden: „${title}“ · ${secondsLabel(seconds)}`,
  removeMarker: "Kapitelmarkierung löschen",
  removeMarkerHint: "Löscht nur die Markierung; Inhalt bleibt",
  find: "Finden",
  badRegex: "Ungültiger regulärer Ausdruck",
  noResults: "Keine Ergebnisse",
  previous: "Zurück",
  next: "Als Nächstes",
  closeFind: "Suche schließen",
  replaceWith: "Ersetzen durch",
  matchCase: "Groß-/Kleinschreibung beachten",
  wholeWordShort: "Wort",
  wholeWord: "Nur ganze Wörter",
  regex: "Regulärer Ausdruck · Ersatztext wird unverändert eingefügt",
  replace: "Ersetzen",
  replaceAll: "Alle ersetzen",
  regexError: (error: string) => `Fehler im regulären Ausdruck: ${error}`,
};
