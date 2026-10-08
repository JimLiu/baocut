import { pluralForm } from '../../i18n.ts';
const s = (n: number, one: string, many: string) => pluralForm('de', n, { one, other: many });
import type { RcExportMessages } from './rc-export.ts';

export const de: RcExportMessages = {

  listSeparator: ", ",
  clauseSeparator: "; ",

  destinationNotAbsolute: "Der Exportordner muss ein absoluter Pfad sein",
  destinationCreateFailed: (p: { reason: string }) => `Exportordner konnte nicht erstellt werden: ${p.reason}`,
  destinationNotDirectory: "Der Exportordner ist nicht vorhanden oder kein Ordner",
  destinationNotWritable: "Der Exportordner ist nicht beschreibbar",
  destinationFileExists: (p: { fileName: string }) => `Die Datei ist bereits vorhanden: ${p.fileName}`,
  destinationWriteFailed: (p: { reason: string }) => `Schreiben in den Exportordner fehlgeschlagen: ${p.reason}`,
  destinationTooManyDuplicates: "Zu viele Dateien mit gleichem Namen",
  destinationExistsRecovery: "Einen anderen Dateinamen auswählen oder ausdrücklich Überschreiben anfordern (overwrite)",
  destinationUnwritableRecovery: "Einen beschreibbaren Ordner auswählen oder den Benutzer die Berechtigungen ändern lassen",

  exportTaskNotFound: "Exportaufgabe nicht gefunden",
  exportKindUnsupported: (p: { kind: string }) => `Diese Version kann noch nicht exportieren: ${p.kind}`,
  videoNotOpen: "Das Video ist nicht geöffnet; zuerst öffnen",
  fileNameWithMultipleRanges: "Jeder Bereich erzeugt eine eigene Datei; sie können daher nicht denselben fileName verwenden",
  documentNotExportable: (p: { kind: string }) => `${p.kind}-Dokumente können nicht als Untertitel oder Transkript exportiert werden`,
  nothingInRange: "Im Exportbereich gibt es keinen Text (möglicherweise wurde alles herausgeschnitten oder das Dokument ist leer)",
  audioExportNeeds: (p: { missing: string }) => `Audioexport benötigt ${p.missing}`,
  loudnessNeedsWorker: "Lautheitsnormalisierung benötigt den Render Worker (export-worker); dieser wurde nicht gefunden",
  videoExportNeeds: (p: { missing: string }) => `Videoexport benötigt ${p.missing}`,
  videoExportNeedsWorker: "Videoexport benötigt den Render Worker (export-worker); dieser wurde nicht gefunden",
  videoExportNeedsEncoders: (p: { encoders: string }) => `Videoexport benötigt die ffmpeg-Encoder ${p.encoders}`,
  unsupportedContent: (p: { count: number; items: string }) =>
    `${p.count} ${s(p.count, "Eintrag kann nicht", "Einträge können nicht")} im Export gerendert werden: ${p.items}`,
  unsupportedContentRemedy: "Diesen Inhalt entfernen oder ersetzen oder mit onUnsupported: 'skip' überspringen (jeder Eintrag wird als Warnung aufgezeichnet)",
  workerRemedy: "Render Worker bauen (`npm run build:engine`) oder BAOCUT_EXPORT_WORKER auf den Speicherort von export-worker setzen",
  workerGone: (p: { error: string }) => `Der Render Worker (export-worker) ist nicht mehr vorhanden: ${p.error}`,
  fontCensusNeedsWorker: "Schriftprüfung benötigt den Render Worker (export-worker); dieser wurde nicht gefunden",
  sequenceNotFound: (p: { sequenceId: string }) => `Sequenz ${p.sequenceId} ist nicht vorhanden`,
  sequenceMissing: "Die Sequenz ist nicht vorhanden",
  dubGroupNotFound: (p: { groupId: string }) => `Diese Sequenz hat keine Vertonungsgruppe ${p.groupId}`,
  projectNothingToExport:
    "Die Sequenz enthält keine Clips für eine Projektdatei (Video, Bilder, Audio oder vorgerenderte Kompositionen)",
  noSourceForLanguage: (p: { language: string }) => `Keine Untertitel oder kein Transkript in ${p.language}`,
  noSource: "Das Video enthält keine exportierbaren Untertitel oder Transkripte",
  bilingualDocumentNotFound: "Das Dokument zum zweisprachigen Zusammenführen ist nicht vorhanden",
  bilingualNeedsOtherDocument: "Zweisprachige Ausgabe benötigt ein anderes Dokument",
  noBilingualCounterpart: "Keine andere Sprache zum Zusammenführen (Übersetzung oder Untertitel in einer anderen Sprache)",
  sourceAmbiguous: "Mehrere Dokumente sind exportierbar; mit documentId (oder language) eines auswählen",
  linkedAssetMissing: (p: { name: string }) => `Verknüpftes Material „${p.name}“ ist nicht mehr am ursprünglichen Speicherort`,
  linkedAssetContentChanged: (p: { name: string }) =>
    `Verknüpftes Material „${p.name}“ wurde seit der Verknüpfung geändert; erneut verknüpfen oder ausdrücklich die Revision wechseln`,
  linkedAssetGoneBeforeExport: (p: { name: string }) => `Verknüpftes Material „${p.name}“ ist vor dem Exportstart verschwunden`,
  linkedAssetChangedBeforeExport: (p: { name: string }) => `Verknüpftes Material „${p.name}“ wurde vor dem Exportstart geändert`,

  fileNotExported: (p: { fileName: string; problems: string }) => `${p.fileName} wurde nicht exportiert: ${p.problems}`,
  noFilesExported: "Keine der Dateien wurde exportiert",
  partiallyPublished: (p: { failed: number; published: number }) =>
    `${p.failed} ${s(p.failed, "Datei wurde nicht", "Dateien wurden nicht")} exportiert; ${p.published} ${s(p.published, "wurde", "wurden")} veröffentlicht`,
  xmlIncomplete: "Das geschriebene XML ist unvollständig",

  toolStartFailed: (p: { tool: string; error: string }) => `${p.tool} konnte nicht starten: ${p.error}`,
  toolExited: (p: { tool: string; code: string; output: string }) => `${p.tool} wurde beendet mit ${p.code}: ${p.output}`,
  ffmpegEncoder: (p: { encoder: string }) => `ffmpeg-${p.encoder}-Encoder`,
  ffmpegAmixNormalize: "ffmpeg 4.4 oder neuer (normalize-Option von amix)",
  ffmpegFilter: (p: { filter: string }) => `ffmpeg-${p.filter}-Filter`,
  masterNeedsWorker: "Lautheitsnormalisierung benötigt export-worker",
  workerExitedUnexpectedly: (p: { signal: string | null; code: string; output: string }) =>
    `export-worker wurde unerwartet beendet (${p.signal ?? `Exit-Code ${p.code}`})${p.output ? `: ${p.output}` : ""}`,

  planAssetNotFrozen: (p: { assetId: string }) => `Material ${p.assetId} im Plan wurde nicht eingefroren`,
  loudnessNotMeasurable: "Die Mischung ist stumm oder zu kurz für eine Lautheitsmessung; nur die True-Peak-Grenze wurde angewendet",
  audioNote: (p: { itemId: string; note: string }) => `Eintrag ${p.itemId}: ${p.note}`,
  noteDuckNoSpeech:
    "Sprachgesteuerte Absenkung hat die Lautstärke nicht verringert: Das Video hat kein Transkript oder keine transkribierten Wörter in der Zeitleiste",
  noteHoldIsSilent: "Standbildeinträge sind stumm (wie in der Vorschau)",
  noteAssetHasNoAudio: "Das Material hat keinen Audiostream; es gibt nichts zu mischen",
  noteCrossfadeHandleShort:
    "Die Audioüberblendung des Übergangs benötigt Medien außerhalb des Eintragsbereichs (Handles); das Material ist auf dieser Seite zu kurz, daher wird der fehlende Teil als Stille exportiert",
  gainAbovePreview: (p: { itemId: string; gainDb: number }) =>
    `Eintrag ${p.itemId} hat eine Spitzenverstärkung von +${p.gainDb} dB: Die Vorschau begrenzt die Lautstärke auf 0 dB, aber der Export übernimmt die Einstellung und klingt daher lauter als die Vorschau`,

  outputSizeAdjusted: (p: { width: number; height: number; canvasWidth: number; canvasHeight: number }) =>
    `Ergebnisgröße festgelegt auf ${p.width}×${p.height} (entspricht dem Seitenverhältnis der Arbeitsfläche ${p.canvasWidth}×${p.canvasHeight}, mit gerader Breite und Höhe)`,
  outputSizeLetterboxed: (p: { width: number; height: number; pictureWidth: number; pictureHeight: number }) =>
    `Ergebnisgröße festgelegt auf ${p.width}×${p.height} (gerade Breite und Höhe; Bildgröße ${p.pictureWidth}×${p.pictureHeight}, der Rest sind schwarze Balken)`,
  contentSkippedEffect: (p: { itemId: string; effectId: string; kind: string; message: string }) =>
    `Effekt ${p.effectId} (${p.kind}) auf Eintrag ${p.itemId} wurde übersprungen: ${p.message}`,
  contentSkippedTransition: (p: { transitionId: string; kind: string; message: string }) =>
    `Übergang ${p.transitionId} (${p.kind}) als Schnitt gerendert: ${p.message}`,
  contentSkippedItem: (p: { itemId: string; layerKind: string; message: string }) =>
    `Eintrag ${p.itemId} (${p.layerKind}) wurde nicht gerendert: ${p.message}`,
  fontNotDownloaded: (p: { family: string; weight: number; italic: boolean; reason: string; fallback: string }) =>
    `„${p.family}“ ${p.weight}${p.italic ? " kursiv" : ""}: ${p.reason}; stattdessen „${p.fallback}“ verwendet`,
  fontNotDownloadedReason: "Nicht heruntergeladen",
  fontStillMissingAfterDownload: "Auch nach dem Herunterladen nicht gefunden",
  fontDownloadUnavailable: "Schriftdownload ist nicht verfügbar",

  translationPartialSkipped: (p: { count: number }) =>
    `${p.count} ${s(p.count, "Satz wurde", "Sätze wurden")} teilweise herausgeschnitten und nicht übersetzt`,
  translationStale: (p: { count: number }) => pluralForm('de', p.count, { one: `${p.count} Übersetzungseinheit ist veraltet (Quelle geändert) und wurde nicht geschrieben`, other: `${p.count} Übersetzungseinheiten sind veraltet (Quelle geändert) und wurden nicht geschrieben` }),
  bilingualUnmatched: (p: { count: number }) => pluralForm('de', p.count, { one: `${p.count} Eintrag in der anderen Sprache liegt außerhalb der Sätze des Hauptdokuments und wurde nicht geschrieben`, other: `${p.count} Einträge in der anderen Sprache liegen außerhalb der Sätze des Hauptdokuments und wurden nicht geschrieben` }),
  cueSplitEstimated: (p: { count: number }) =>
    `${p.count} ${s(p.count, "Satz wurde", "Sätze wurden")} anhand interpolierter Wortzeiten in mehrere Cues aufgeteilt; die Trennzeiten sind Schätzungen`,
  assStyleUnmapped: (p: { styles: string }) => `Stile, die ASS nicht ausdrücken kann (nicht geschrieben): ${p.styles}`,
  assWholeStyle: (p: { schema: string | null }) => `Der gesamte Stil (${p.schema ?? "kein Schema"})`,

  durationMismatch: (p: { actual: number; expected: number; tolerance: number }) =>
    `Dauer: ${p.actual} s, erwartet ${p.expected} s (Toleranz ${p.tolerance})`,
  sampleRateMismatch: (p: { actual: number; expected: number }) => `Abtastrate: ${p.actual}, Einstellung jedoch ${p.expected}`,
  channelsMismatch: (p: { actual: number; expected: number }) =>
    `${p.actual} ${s(p.actual, "Kanal", "Kanäle")}, Einstellung jedoch ${p.expected}`,
  validationFailed: (p: { problems: string }) => `Das Ergebnis hat die Validierung nicht bestanden: ${p.problems}`,
  probeFailed: (p: { error: string }) => `ffprobe kann das Ergebnis nicht lesen: ${p.error}`,
  probeNotJson: "Die Ausgabe von ffprobe ist kein JSON",
  noAudioStream: "Kein Audiostream",
  noDecodableFrame: "Kein einziger Frame kann decodiert werden",
  noVideoStream: "Das Ergebnis enthält keinen Videostream",
  frameCountMismatch: (p: { actual: number; expected: number }) => `${p.actual} Frames, erwartet ${p.expected}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) =>
    `Größe: ${p.width}×${p.height}, erwartet ${p.expectedWidth}×${p.expectedHeight}`,
  fpsMismatch: (p: { actual: string; expected: string }) => `Bildrate: ${p.actual}, erwartet ${p.expected}`,
  codecMismatch: (p: { actual: string; expected: string }) => `Videocodec: ${p.actual}, erwartet ${p.expected}`,
  videoDurationMismatch: (p: { actual: number; expected: number }) =>
    `Bilddauer: ${p.actual} s, erwartet ${p.expected} s (Toleranz: ein Frame)`,
  noAudioInOutput: "Das Ergebnis enthält kein Audio",
  audioDurationMismatch: (p: { actual: number; expected: number }) =>
    `Audiodauer: ${p.actual} s; muss dem Bild entsprechen (${p.expected} s)`,
  vttMissingHeader: "VTT hat keinen WEBVTT-Kopf",
  cueMissingIndex: (p: { n: number }) => `Cue ${p.n} hat keinen Index`,
  cueTimeLineUnparsable: (p: { n: number }) => `Timing-Zeile des Cues konnte nicht ausgewertet werden: ${p.n}`,
  cueNoText: (p: { n: number }) => `Cue ${p.n} enthält keinen Text`,
  assMissingSections: "In ASS fehlen Abschnittsköpfe",
  cueTimeUnparsable: (p: { n: number }) => `Zeiten des Cues konnten nicht ausgewertet werden: ${p.n}`,
  wordTimeOutsideSentence: "Wortzeiten liegen außerhalb des Satzes",
  invalidJson: "Kein gültiges JSON",
  cueEndNotAfterStart: (p: { n: number }) => `Cue ${p.n} endet nicht nach seinem Beginn`,
  cueOverlapsPrevious: (p: { n: number }) => `Cue ${p.n} überschneidet sich mit dem vorherigen`,
  lastCueBeyondRange: (p: { end: number; range: number }) => `Der letzte Cue endet bei ${p.end} s, außerhalb des Exportbereichs von ${p.range} s`,
  entryCountMismatch: (p: { parsed: number; written: number }) => `Ausgewertet: ${p.parsed} Einträge, geschrieben wurden jedoch ${p.written}`,
  noContent: "Kein Inhalt",

  itemKindVideo: "Video",
  itemKindImage: "Bild",
  itemKindAudio: "Audio",
  itemKindText: "Text",
  itemKindShape: "Form",
  itemKindComposition: "Komposition",
  itemKindCaption: "Untertitel",
  itemKindSticker: "Sticker",
  itemKindVisualizer: "Audiovisualisierung",
  itemKindProgress: "Fortschrittsbalken",
  itemKindDraw: "Wird erstellt",
  itemKindPlaceholder: "Platzhalter",
  itemKindConfetti: "Konfetti",
  itemKindWhiteboard: "Whiteboard-Zeichnung",
  projectItemOmitted: (p: { kind: string; itemId: string; name: string | null; reason: string }) =>
    `${p.kind}-Eintrag ${p.itemId}${p.name ? ` „${p.name}“` : ""}: ${p.reason}`,
  projectFpsInexact: (p: { fps: string; timebase: number }) =>
    `Die Sequenzbildrate ${p.fps} kann nur geschrieben werden als ${p.timebase} in xmeml`,
  projectAssetOffline: (p: { name: string; reason: string }) =>
    `Material konnte nicht gelesen werden: „${p.name}“ (${p.reason}); es ist ein Offline-Clip in der Projektdatei`,
  projectTransitionOmitted: (p: { kind: string }) => `Übergang ${p.kind} nicht in die Projektdatei geschrieben (als Schnitt geschrieben)`,
  embeddedAudioTrack: (p: { n: number }) => `Eingebettetes Audio ${p.n}`,
  omitCaption: "Untertitel nicht in die Projektdatei geschrieben (SRT-Untertitel separat exportieren)",
  omitUnsupportedKind: "nicht in die Projektdatei geschrieben (xmeml kann dies nicht ausdrücken)",
  omitNoPrerender: "Komposition hat kein Prerender und wurde daher nicht in die Projektdatei geschrieben",
  omitAssetMissing: "Referenzmaterial ist nicht vorhanden",
  omitFreezeFrame: "Standbild nicht in die Projektdatei geschrieben",
  omitSpeed: "Geschwindigkeitsänderung nicht in die Projektdatei geschrieben (mit normaler Geschwindigkeit geschrieben)",
  omitSubframe: "Subframe-Start auf den nächsten Frame gerundet",
  omitAudioMix: "Lautstärke, Blenden und Hüllkurve nicht in die Projektdatei geschrieben",
  omitPlacement: "Position, Skalierung, Drehung und Spiegelung nicht in die Projektdatei geschrieben (füllend auf Arbeitsfläche geschrieben)",
  omitOpacity: "Deckkraft nicht in die Projektdatei geschrieben",
  omitCornerRadius: "Abgerundete Ecken nicht in die Projektdatei geschrieben",
  omitEffects: "Effekte nicht in die Projektdatei geschrieben",
  omitMask: "Maske nicht in die Projektdatei geschrieben",
  omitAnimation: "Elementanimation nicht in die Projektdatei geschrieben",
  omitKeyframes: "Keyframes nicht in die Projektdatei geschrieben",
  omitCrop: "Zuschnitt nicht in die Projektdatei geschrieben",
  omitEmbeddedAudioMix: "Lautstärke, Blenden und Hüllkurve des eingebetteten Audios nicht in die Projektdatei geschrieben",
};
