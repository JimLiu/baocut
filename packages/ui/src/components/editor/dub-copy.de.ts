const sentences = (n: number) => pluralForm('de', n, { one: `${n} Satz`, other: `${n} Sätze` });
const these = (n: number) => n === 1 ? 'Diesen Satz' : pluralForm('de', n, { other: `Diese ${n} Sätze` });
import { pluralForm } from '@baocut/protocol';
import type { DubOriginalAudio } from '@baocut/protocol';
import type { DubMessages, DubRegenMessages, TimelineDubMessages } from './dub-copy.ts';

export const deDub: DubMessages = {

  title: "Übersetzte Vertonung",
  back: "Zurück",
  web: "Übersetzte Vertonung benötigt die Desktop-App",
  webBody: "BaoCut im Browser bietet keine festen Workflows (pipelines.*); übersetzte Vertonung kann hier nicht gestartet werden. Dieses Video in der Desktop-App öffnen.",
  summary: (language: string, count: number | null, translate: boolean) => `${translate ? `Übersetzt zuerst nach ${language}` : `Verwendet die vorhandene Übersetzung in ${language}`} und synthetisiert Sprache ${count === null ? 'Satz für Satz' : `für ${sentences(count)} einzeln`}, richtet sie am Timing der Original-Sätze aus und schreibt sie als eine Vertonungsgruppe in die Zeitleiste`,
  language: "Vertonungssprache",
  languagePicker: "Vertonungssprache",
  languageLine: (translate: boolean, count: number | null) =>
    `${translate ? "Noch keine Übersetzung in dieser Sprache · wird zuerst übersetzt" : "Verwendet vorhandene Übersetzung · keine neue Übersetzung"}${count === null ? "" : ` · ${sentences(count)}`}`,
  allTaken: "Keine Sprachen für Vertonung verfügbar.",
  staleNote: (n: number) => `${pluralForm('de', n, { one: `${n} Satz in dieser Übersetzung ist`, other: `${n} Sätze in dieser Übersetzung sind` })} veraltet (Original geändert oder als veraltet markiert). Keine Synthese; in der Zusammenfassung aufgeführt. Für eine vollständige Vertonung zuerst im Untertitel-Bereich erneut übersetzen.`,
  source: "Original",
  sourcePicker: "Zu vertonendes Transkript",
  sourceLine: (language: string, count: number | null) => (count === null ? language : `${language} · ${sentences(count)}`),
  voiceModel: "Stimmenmodell",
  voiceModelPicker: "Sprachmodell für Synthese",
  voiceModelsLoading: "Sprachmodelle werden geladen…",
  manageVoiceModels: "Sprachmodelle verwalten…",
  ttsMissingTitle: "Noch kein Sprachmodell verfügbar",
  goTts: "Modelle › Sprachsynthese öffnen",
  voice: "Standardstimme",
  voicePicker: "Für Sprecher ohne eigene Stimme verwendet",
  voiceDefault: "Modellstandard",
  voiceCustom: "Stimmen-ID",
  voiceCustomPlaceholder: "Stimmen-ID aus Ihrem Anbieterkonto",
  voiceHint: "Sprecher mit unten zugewiesener Stimme verwenden diese; alle anderen die hier gewählte.",
  voiceCustomEmpty: "Zuerst eine Stimmen-ID eingeben oder eine andere Stimme auswählen",
  speakers: "Sprecher",
  speakersAside: (n: number) => `${n}`,
  speakersNone: "Dieses Transkript enthält keine Sprecherinformationen; jeder Satz verwendet die obige Standardstimme.",
  speakersNote: "Zuweisungen werden in diesem Video gespeichert (rückgängig zu machende Bearbeitung) und beim nächsten Mal wiederverwendet. Vorrang: zugewiesen → Standardstimme → Modellstandard.",
  speakerLine: (count: number) => sentences(count),
  speakerBinding: (name: string) => `Stimme zugewiesen für ${name}`,
  bindingNone: "Keine",
  bindingOther: (label: string) => `${label} (anderswo zugewiesen)`,
  bindingIgnored: (provider: string) => `Die zugewiesene Stimme stammt von einem anderen Anbieter und wird nicht verwendet mit ${provider}`,
  bindingReadOnly: "Das Video ist schreibgeschützt; Sprecherstimmen können nicht geändert werden.",
  bindingFailed: (message: string) => `Sprecherstimme konnte nicht geändert werden: ${message}`,
  bindingLoading: "Sprecherstimmen werden geladen…",
  bindingReadFailed: (message: string) => `Zugewiesene Sprecherstimmen dieses Videos konnten nicht gelesen werden: ${message}`,
  bindingSaved: (name: string) => `Stimme zugewiesen für ${name}`,
  bindingCleared: (name: string) => `Stimmzuweisung für ${name} entfernt`,
  sourceVideo: "Zugewiesen",
  sourceParams: "Standardstimme",
  sourceDefault: "Modellstandard",

  effective: (label: string, source: string | null) => (source ? `Verwendet: ${label} (${source})` : `Verwendet: ${label}`),
  speakerWarning: (reason: string) => `Die Sätze dieses Sprechers werden nicht synthetisiert: ${reason}`,
  manageVoices: "Meine Stimmen verwalten…",
  mix: "Mischung",
  separate: "Hintergrundaudio trennen",
  separateHint: "Die Vertonung ersetzt nur die Sprache; Musik und Umgebungsgeräusche bleiben",
  separateMissing: "Auf diesem Computer ist kein Trennmodell verfügbar; auch bei Aktivierung wird die Trennung übersprungen und der Originalton als Ganzes verarbeitet.",
  installSeparate: "Trennmodell installieren…",
  original: "Originalton",
  originalPicker: "Was mit dem Originalton beim Abspielen der Vertonung geschieht",
  originalLabel: { duck: "Absenken", mute: "Stummschalten", keep: "Behalten" } satisfies Record<DubOriginalAudio, string>,

  mixHint: (o: { separated: boolean; original: DubOriginalAudio; duckDb: number }) => {
  if (o.original === 'keep') return `Der Originalton bleibt unverändert und spielt unter der Vertonung${o.separated ? '; beim Beibehalten wird nichts getrennt' : ''}.`;
  const action = o.original === 'mute' ? 'stummgeschaltet' : `um −${o.duckDb} dB abgesenkt`;
  return `${o.separated ? 'Hintergrundaudio bekommt eine eigene Spur; der Originalton enthält nur noch die Sprache, die' : 'Ohne Trennung wird der gesamte Originalton'} ${action}. Über den Vertonungsspur-Kopf kann jederzeit zum Originalton zurückgewechselt werden.`;
},
  duckDb: "Absenkung (dB)",
  duckLabel: "Absenken",
  duckUnit: "dB",
  translate: "Übersetzung",
  textModel: "Textmodell",
  textModelPicker: "Textmodell für Übersetzung",
  textModelsLoading: "Textmodelle werden geladen…",
  manageTextModels: "Textmodelle verwalten…",
  textMissingTitle: "Noch kein Textmodell verfügbar",
  goLlm: "Modelle › Texterzeugung öffnen",
  noStructured: "Keine strukturierte Ausgabe · nicht zum Übersetzen geeignet",
  style: "Stilhinweis",
  stylePlaceholder: "Zum Beispiel: natürlich und knapp; Namen im Original beibehalten",
  styleHint: "Optional; höchstens 500 Zeichen.",
  cta: (language: string) => `Vertonen in ${language}`,

  ctaHint: (language: string, stems: { separated: boolean; original: DubOriginalAudio }) => {
 const tracks = [`„Vertonung · ${language}“`];
 if (stems.separated && stems.original !== 'keep') tracks.push('„Hintergrund“');
 if (stems.separated && stems.original === 'duck') tracks.push('„Stimmen“');
 const list = new Intl.ListFormat('de', { style: 'long', type: 'conjunction' }).format(tracks);
 return `Nach Abschluss wird in der Zeitleiste auf ${pluralForm('de', tracks.length, { one: 'die Spur', other: 'die Spuren' })} ${list} geschrieben; mit einem Klick rückgängig zu machen. Onlinemodelle werden pro Aufruf abgerechnet.`;
},
  noSpeechTitle: "Noch kein Transkript zum Vertonen",
  noSpeech: "Vertonung arbeitet Satz für Satz anhand eines Transkripts. Zuerst Material mit „Untertitel erzeugen“ im Untertitel-Bereich transkribieren.",
  busy: "Dieses Video hat bereits eine laufende Vertonung; vor einer weiteren auf den Abschluss warten.",
  readOnly: "Das Video ist schreibgeschützt und kann keine Vertonung erhalten.",

  submitting: "Vertonung wird eingereicht",
  queued: "In Warteschlange",
  running: (language: string) => `Wird vertont · ${language}`,
  stepUnits: (step: 'translate' | 'synthesize', done: number, total: number | null) => `${step === 'translate' ? 'Übersetzt' : 'Synthetisiert'} ${done}${total ? ` / ${total}` : ''} ${pluralForm('de', total ?? done, { one: 'Satz', other: 'Sätze' })}`,
  sentences: (running: number, failed: number) => [running ? pluralForm('de', running, { one: `${running} Satz wird synthetisiert`, other: `${running} Sätze werden synthetisiert` }) : '', failed ? `${sentences(failed)} fehlgeschlagen` : ''].filter(Boolean).join(' · '),
  cancel: "Vertonung abbrechen",
  cancelled: "Vertonung abgebrochen",
  cancelFailed: (message: string) => `Vertonung konnte nicht abgebrochen werden: ${message}`,
  liveNote: "Nach Abschluss schreibt die Runtime direkt in die Zeitleiste; jederzeit rückgängig zu machen. Sie können diese Seite verlassen.",
  foreign: "Diese Vertonung wurde nicht hier gestartet. Nach Abschluss die Zeitleiste prüfen; mit „Rückgängig machen“ im Editor zurücknehmen.",

  grantTitle: (recipient: string) => `Noch keine Berechtigung zum Senden des Transkripts an ${recipient}`,
  grantBody:
    "Vertonung sendet die zu synthetisierende Übersetzung (und bei fehlender Übersetzung das Original) an den Anbieter. Zum Fortfahren eine auf dieses Video begrenzte Berechtigung erteilen; ohne sie wird nichts gesendet.",
  grantAction: "Berechtigung erteilen und starten",
  grantRetryAction: "Berechtigung erteilen und erneut versuchen",
  grantDialogTitle: "Berechtigung zur Datenweitergabe erteilen",
  grantDialogIntro: "Nach Bestätigung speichert BaoCut diese Berechtigung und setzt die Vertonung fort:",
  grantConfirm: "Berechtigung erteilen und fortfahren",
  grantCancel: "Nicht jetzt",
  granting: "Berechtigung wird erteilt…",
  grantFailed: (message: string) => `Berechtigung konnte nicht erteilt werden: ${message}`,
  grantStillRefused: "Auch nach Berechtigungserteilung abgelehnt",
  grantNext: "Wenn Übersetzung und Synthese unterschiedliche Anbieter verwenden, benötigt jeder eine eigene Berechtigung.",
  commands: "Befehlszeile",

  notConfigured: "Vertonung ist noch nicht verfügbar",
  submitFailed: "Vertonung konnte nicht gestartet werden",
  failed: "Vertonung fehlgeschlagen",
  interrupted: "Vertonung unterbrochen",
  retry: "Erneut versuchen",
  retryFailed: (message: string) => `Erneuter Versuch fehlgeschlagen: ${message}`,
  retryCharges:
    "Ein erneuter Versuch setzt am gestoppten Schritt fort. Bei Stopp unter „Übersetzen“ läuft der gesamte Schritt erneut; bereits übersetzte Pakete rufen das Modell erneut auf und können erneut berechnet werden.",
  retryPartial: "Ein erneuter Versuch setzt bei „Sätze synthetisieren“ fort: Synthetisierte Sätze werden wiederverwendet; nur fehlgeschlagene oder verbleibende Sätze werden synthetisiert.",
  retryFree: "Ein erneuter Versuch setzt am gestoppten Schritt fort; vorher abgeschlossene Schritte werden ohne erneuten Modellaufruf wiederverwendet.",
  retryFrozen:
    "Sprecherstimmzuweisungen wurden beim Start eingefroren: Eine Stimme korrigieren (erneut klonen, Erklärung des Eigentümers ergänzen) hilft bei erneutem Versuch; geänderte Zuweisungen benötigen eine neue Vertonung.",
  failedUnits: (n: number) => pluralForm('de', n, { one: `${n} Satz konnte nicht synthetisiert werden`, other: `${n} Sätze konnten nicht synthetisiert werden` }),
  stoppedAt: (synthesized: number, remaining: number) => `Gestoppt: ${sentences(synthesized)} synthetisiert; ${remaining} verbleibend`,
  dismiss: "OK",

  doneTitle: (language: string) => `Vertont in ${language}`,
  doneToast: (language: string, placed: number) => `Vertont in ${language} · ${sentences(placed)} in der Zeitleiste platziert`,
  placed: (placed: number, total: number) => `${placed} / ${total} Sätze in der Zeitleiste platziert`,
  fitHead: "Wo die einzelnen Sätze platziert wurden",
  speakersHead: "Sprecherstimmen",
  speakerUnits: (n: number) => sentences(n),
  speakerNone: "Kein Sprecher",
  voiceFailedHead: "Die Sätze dieser Sprecher wurden nicht synthetisiert",
  voiceFailedLine: (name: string, n: number, reason: string) => `${name} · ${sentences(n)} · ${reason}`,
  voiceFailedFix:
    "Diese Vertonung ist abgeschlossen und kann nicht erneut versucht werden: Vertonungsgruppe rückgängig machen → Stimme korrigieren (erneut klonen, Erklärung des Eigentümers ergänzen) oder Zuweisung ändern → erneut vertonen.",
  synthesisLine: (calls: number, retries: number, failures: number, reused: number) =>
    [
      `${calls} ${pluralForm('de', calls, { one: "Aufruf", other: "Aufrufe" })}`,
      retries ? `${retries} erneut gesendet` : "",
      failures ? `${failures} fehlgeschlagen` : "",
      reused ? `${sentences(reused)} wiederverwendet` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  translationCreated: "Die diesmal neu erstellte Übersetzung wird im Video gespeichert (Rückgängigmachen der Vertonung löscht sie nicht)",
  translationUsed: "Vorhandene Übersetzung verwendet",
  glossaryUsed: (n: number) => `Verwendet: ${n} ${pluralForm('de', n, { one: "Glossar", other: "Glossare" })}`,
  warnings: "Warnungen",
  undo: "Diese Vertonung rückgängig machen",
  undoing: "Wird rückgängig gemacht…",
  undone: "Vertonung rückgängig gemacht",
  undonePartial:
    "Clips, Stummschaltungen und Absenkungen dieser Vertonung wurden rückgängig gemacht. Leere Vertonungsspur und Vertonungsplan-Dokument bleiben im Video (das Protokoll hat keine Operation zum Löschen von Spuren oder Dokumenten).",
  undoLabel: (language: string) => `Vertonung rückgängig machen (${language})`,
  undoFailed: "Vertonung konnte nicht rückgängig gemacht werden",
  undoNotOpen: "Zuerst dieses Video öffnen, um die Vertonung rückgängig zu machen.",
  close: "Schließen",
  again: "Erneut vertonen",
  providerFallback: "diesen Anbieter",
  unknownLanguage: "Unbekannte Sprache",
};

export const deTimelineDub: TimelineDubMessages = {
  trackLabel: (language: string) => `Vertonung · ${language}`,

  stemTrackLabel: (stem: 'background' | 'vocals', language: string) => `${stem === 'vocals' ? "Stimmen" : "Hintergrund"} · ${language}`,

  rate: (rate: number, fast: boolean) => `${rate.toFixed(2)}×${fast ? " · zu schnell" : ""}`,

  stretching: (rate: number, seconds: number) => `${rate.toFixed(2)}× · ${seconds.toFixed(2)} s`,
  tip: (parts: { text: string; speaker: string | null; rate: string; muted: boolean; manual: boolean; editable: boolean }) =>
    [
      parts.text,
      parts.speaker,
      parts.rate,
      parts.muted ? "Stumm" : "",
      parts.manual ? "Geschwindigkeit manuell geändert" : "",
      parts.editable ? "Rechten Rand ziehen, um die Länge zu ändern · Rechtsklick für weitere Optionen" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  menuLabel: (title: string) => `Vertonungsmenü für „${title}“`,
  selection: (n: number) => `${sentences(n)} ausgewählt`,
  count: (n: number) => (n > 1 ? `Diese ${n} Sätze` : "Dieser Satz"),
  listen: "Diesen Satz abspielen",
  listenHint: (timecode: string, seconds: number, rate: string) => `${timecode} · ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  mute: (allMuted: boolean, n: number) => allMuted ? pluralForm('de', n, { one: 'Stummschaltung dieses Satzes aufheben', other: `Stummschaltung dieser ${n} Sätze aufheben` }) : `${these(n)} stummschalten`,
  muteHint: (allMuted: boolean): string => (allMuted ? "Vertonung dieser Sätze wiederherstellen" : "Diese Sätze werden stumm · auch in Exporten"),
  remove: (n: number) => `${these(n)} löschen`,
  removeHint: "Entfernt aus der Vertonungsspur · rückgängig zu machen",
  removeGroup: "Diese Vertonungsgruppe entfernen",
  removeGroupHint: (bed: boolean) =>
    `${bed ? "Entfernt sie einschließlich ihres Hintergrundaudios" : "Entfernt alle Vertonungen in dieser Sprache"} · dadurch stummgeschalteter Originalton kehrt zurück`,
  labelMute: "Vertonung stummschalten",
  labelUnmute: "Stummschaltung der Vertonung aufheben",
  labelRemove: "Vertonung löschen",
  labelRemoveGroup: (language: string) => `Vertonung entfernen (${language})`,
  labelStretch: "Vertonungsgeschwindigkeit ändern",
  muted: (n: number) => `Stummgeschaltet: ${sentences(n)} der Vertonung`,
  unmuted: (n: number) => `Stummschaltung aufgehoben: ${sentences(n)} der Vertonung`,
  removed: (n: number) => `Gelöscht: ${sentences(n)} der Vertonung`,
  groupRemoved: (language: string) =>
    `Entfernt: „Vertonung · ${language}“ · leere Vertonungsspur und Vertonungsplan-Dokument bleiben im Video`,
  planUnread: "Vertonungsplan konnte nicht gelesen werden: Dadurch stummgeschalteter Originalton wurde nicht wiederhergestellt. Er kann in den Originalclips wieder eingeschaltet werden.",
};

export const deDubRegen: DubRegenMessages = {

  headMenu: (label: string) => `„${label}“-Spur`,
  headLine: (c: { total: number; fast: number; muted: number; failed: number; queued: number }) =>
    [
      sentences(c.total),
      c.failed ? `${c.failed} nicht synthetisiert` : "",
      c.fast ? `${c.fast} zu schnell` : "",
      c.muted ? `${c.muted} stummgeschaltet` : "",
      c.queued ? `${c.queued} wird erneut erzeugt` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  listenDub: "Vertonung hören",
  listenDubHint: (o: { bed: boolean; duck: boolean; others: boolean }) =>
    `Vertonung dieser Gruppe${o.bed ? " + Hintergrund" : ""} · ${o.duck ? "Original abgesenkt" : "Original stummgeschaltet"}${o.others ? " · andere Sprachen aus" : ""}`,
  listenDubKeep: "Diese Vertonungsgruppe hat den Originalton beibehalten und keine Bereiche aufgezeichnet; „Beides hören“ verwenden",
  listenOriginal: "Original hören",
  listenOriginalHint: (others: boolean) => `Stellt den Originalton des Videos wieder her · ${others ? "alle Vertonungsgruppen" : "diese Vertonungsgruppe"} stummgeschaltet`,
  listenBoth: "Beides hören",
  listenBothHint: (bed: boolean) => `Zum Vergleichen${bed ? " · Hintergrund dieser Gruppe aus" : ""}`,
  sourceLabel: { dub: "Vertonung hören", original: "Original hören", both: "Beides hören" },
  sourceDone: {
    dub: (language: string) => `Wiedergabe: „Vertonung · ${language}“`,
    original: "Original wird abgespielt · Vertonung stummgeschaltet",
    both: "Original und Vertonung werden zusammen abgespielt",
  },
  regenSome: (n: number) => (n ? `Erneut erzeugen: ${sentences(n)}…` : "Erneut erzeugen…"),
  regenSomeHint: (failed: number, fast: number) =>
    failed || fast
      ? `${[failed ? `${failed} nicht synthetisiert` : "", fast ? `${fast} zu schnell` : ""].filter(Boolean).join(" · ")} · Übersetzung kann zuerst bearbeitet werden`
      : "Keine fehlgeschlagenen oder zu schnellen Sätze",
  redub: "Erneut vertonen…",
  redubHint: "Öffnet Übersetzte Vertonung: Sprache oder Stimme ändern und die gesamte Gruppe wiederholen",
  readOnly: "Das Video ist schreibgeschützt",

  regenBlocks: (n: number) => `${these(n)} erneut erzeugen`,
  regenBlocksHint: "Dieselbe Übersetzung und Stimme erneut synthetisieren · neuer Seed · alte Aufnahme bleibt erhalten",
  retext: "Übersetzung bearbeiten und neu vertonen…",
  retextHint: "Zuerst Längen prüfen und Übersetzung bearbeiten, dann nur diese Sätze neu vertonen",
  inQueue: "Einige Sätze werden erneut erzeugt",

  queued: "Wird erneut erzeugt…",
  queuedTip: (text: string) => `${text} · wird erneut erzeugt`,
  version: (k: number, seed: number | null) => (seed === null ? `Aufnahme ${k}` : `Aufnahme ${k} · Seed ${seed}`),

  submitted: (n: number) => `Erneute Erzeugung gestartet: ${sentences(n)} der Vertonung`,
  submitFailed: (message: string) => `Erneute Erzeugung konnte nicht gestartet werden: ${message}`,
  grantRefused: (recipient: string) =>
    `Erneute Erzeugung sendet die Übersetzung an ${recipient}; dafür besteht noch keine Berechtigung. In den Einstellungen erteilen oder von Übersetzte Vertonung neu starten`,
  busy: "Diese Gruppe wird eingereicht; einen Moment warten",
  done: (replaced: number, total: number) =>
    replaced === total ? `Erneut erzeugt: ${sentences(replaced)} der Vertonung` : `Erneut erzeugt: ${replaced}/${total} Sätze der Vertonung`,
  doneNone: "Kein Satz erhielt eine neue Aufnahme",
  notPlaced: (status: string, n: number) => status === 'overlong' ? pluralForm('de', n, { one: `${n} Satz passte nicht; die vorherige Aufnahme blieb erhalten`, other: `${n} Sätze passten nicht; die vorherige Aufnahme blieb erhalten` }) : status === 'stale' ? pluralForm('de', n, { one: `${n} Satz hatte eine veraltete Übersetzung und wurde nicht synthetisiert`, other: `${n} Sätze hatten eine veraltete Übersetzung und wurden nicht synthetisiert` }) : status === 'voice-unavailable' ? pluralForm('de', n, { one: `${n} Satz hatte eine nicht verfügbare Stimme und wurde nicht synthetisiert`, other: `${n} Sätze hatten eine nicht verfügbare Stimme und wurden nicht synthetisiert` }) : pluralForm('de', n, { one: `${n} Satz ist nicht in der Zeitleiste`, other: `${n} Sätze sind nicht in der Zeitleiste` }),
  failed: (message: string) => `Erneute Erzeugung nicht abgeschlossen: ${message}`,
  cancelled: "Erneute Erzeugung abgebrochen",
  undo: "Rückgängig machen",
  undoMissing: "Die Änderung dieser erneuten Erzeugung wurde nicht gefunden; „Rückgängig machen“ im Editor verwenden",
  labelRetext: "Übersetzung bearbeiten (neu vertonen)",

  fitTitle: (n: number) => `Übersetzung bearbeiten und neu vertonen: ${sentences(n)}`,
  fitIntro:
    "Sie bearbeiten den gesprochenen übersetzten Satz (bearbeitete Sätze werden als geprüft markiert); daraus erstellte Untertitel werden nicht neu aufgeteilt. Jeder Satz wird mit einem neuen Seed erneut synthetisiert; die alte Aufnahme bleibt erhalten.",
  fitDub: (seconds: number, rate: string) => `Vertonung ${seconds.toFixed(1)} s${rate ? ` · ${rate}` : ""}`,
  fitVoice: "Nicht synthetisiert: Stimme nicht verfügbar",
  fitOverlong: (seconds: number | null) => (seconds === null ? "Nicht platziert: zu lang" : `Nicht platziert: ${seconds.toFixed(1)} s zu lang`),
  fitLoading: "Übersetzung wird geladen…",
  fitUnreadable: (message: string) => `Die Übersetzung dieser Vertonung konnte nicht gelesen werden (${message}); nur anhand der ursprünglichen Übersetzung neu vertonen`,
  fitMissing: "Dieser Satz ist nicht in der Übersetzung enthalten; anhand des Skripts im Plan neu vertonen",
  fitText: (index: number) => `Übersetzung des Satzes ${index}`,
  fitCancel: "Abbrechen",
  fitSubmit: (n: number, changed: number) => (changed ? `Bearbeiten: ${changed} und neu vertonen: ${sentences(n)}` : `Neu vertonen: ${sentences(n)}`),
  fitBusy: "Wird eingereicht…",

  takesTitle: "Aufnahmen",
  takesAside: (n: number) => `${n} ${pluralForm('de', n, { one: "Aufnahme", other: "Aufnahmen" })}`,
  takeCurrent: "Aktuell",
  takeUse: "Zu dieser Aufnahme wechseln",
  takeLine: (seed: number | null, seconds: number | null, tempo: number | null) =>
    [
      seed !== null ? `Seed ${seed}` : "",
      seconds !== null ? `${seconds.toFixed(1)} s` : "nicht platziert",
      tempo !== null && Math.abs(tempo - 1) >= 0.005 ? `${tempo.toFixed(2)}×` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  takeUnavailable: "Diese Aufnahme ist nicht in der Zeitleiste oder ihr Material wurde nicht gefunden",
  takesNote: "Jede erneute Erzeugung speichert eine Aufnahme; Wechsel zu einer älteren Aufnahme ist eine rückgängig zu machende Bearbeitung ohne erneute Synthese.",
  takeName: (k: number) => `Aufnahme ${k}`,
  labelSwitchTake: (k: number) => `Zu Vertonungsaufnahme wechseln: ${k}`,
  switched: (k: number) => `Gewechselt zu Aufnahme ${k}`,
  regenThis: "Diesen Satz erneut erzeugen",
  unreadableFormat: "Nicht erkanntes Format",
  unreadableNoTranslation: "Der Plan enthält keine Übersetzung",
};
