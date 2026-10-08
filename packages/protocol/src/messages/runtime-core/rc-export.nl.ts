import { pluralForm } from '../../i18n.ts';
const s = (n: number, one: string, many: string) => pluralForm('nl', n, { one, other: many });
import type { RcExportMessages } from './rc-export.ts';

export const nl: RcExportMessages = {

  listSeparator: ", ",
  clauseSeparator: "; ",

  destinationNotAbsolute: "De exportmap moet een absoluut pad zijn",
  destinationCreateFailed: (p: { reason: string }) => `Kan de exportmap niet maken: ${p.reason}`,
  destinationNotDirectory: "De exportmap bestaat niet of is geen map",
  destinationNotWritable: "De exportmap is niet schrijfbaar",
  destinationFileExists: (p: { fileName: string }) => `Het bestand bestaat al: ${p.fileName}`,
  destinationWriteFailed: (p: { reason: string }) => `Kan niet schrijven naar de exportmap: ${p.reason}`,
  destinationTooManyDuplicates: "Te veel bestanden met dezelfde naam",
  destinationExistsRecovery: "Kies een andere bestandsnaam of vraag expliciet om overschrijven (overwrite)",
  destinationUnwritableRecovery: "Kies een schrijfbare map of laat de gebruiker de toestemmingen wijzigen",

  exportTaskNotFound: "Exporttaak niet gevonden",
  exportKindUnsupported: (p: { kind: string }) => `Deze versie kan nog niet exporteren: ${p.kind}`,
  videoNotOpen: "De video is niet geopend; open die eerst",
  fileNameWithMultipleRanges: "Elk bereik maakt een eigen bestand, dus ze kunnen niet dezelfde fileName gebruiken",
  documentNotExportable: (p: { kind: string }) => `${p.kind}-documenten kunnen niet worden geëxporteerd als ondertitels of transcript`,
  nothingInRange: "Er staat geen tekst in het exportbereik (mogelijk is alles geknipt of is het document leeg)",
  audioExportNeeds: (p: { missing: string }) => `Audio-export vereist ${p.missing}`,
  loudnessNeedsWorker: "Normalisatie van luidheid vereist de Render Worker (export-worker), die niet is gevonden",
  videoExportNeeds: (p: { missing: string }) => `Video-export vereist ${p.missing}`,
  videoExportNeedsWorker: "Video-export vereist de Render Worker (export-worker), die niet is gevonden",
  videoExportNeedsEncoders: (p: { encoders: string }) => `Video-export vereist de ffmpeg-encoders ${p.encoders}`,
  unsupportedContent: (p: { count: number; items: string }) =>
    `${p.count} ${s(p.count, "item kan niet", "items kunnen niet")} worden gerenderd in de export: ${p.items}`,
  unsupportedContentRemedy: "Verwijder of vervang deze inhoud of sla die over met onUnsupported: 'skip' (elk item wordt geregistreerd als waarschuwing)",
  workerRemedy: "Bouw de Render Worker (`npm run build:engine`) of stel BAOCUT_EXPORT_WORKER in op de locatie van export-worker",
  workerGone: (p: { error: string }) => `De Render Worker (export-worker) is verdwenen: ${p.error}`,
  fontCensusNeedsWorker: "Lettertypen controleren vereist de Render Worker (export-worker), die niet is gevonden",
  sequenceNotFound: (p: { sequenceId: string }) => `Sequentie ${p.sequenceId} bestaat niet`,
  sequenceMissing: "De sequentie bestaat niet",
  dubGroupNotFound: (p: { groupId: string }) => `Deze sequentie heeft geen nasynchronisatiegroep ${p.groupId}`,
  projectNothingToExport:
    "De sequentie bevat geen clips voor een projectbestand (video, afbeeldingen, audio of composities met een voorrender)",
  noSourceForLanguage: (p: { language: string }) => `Geen ondertitels of transcript in ${p.language}`,
  noSource: "De video heeft geen ondertitels of transcript om te exporteren",
  bilingualDocumentNotFound: "Het document om samen te voegen voor tweetalige uitvoer bestaat niet",
  bilingualNeedsOtherDocument: "Tweetalige uitvoer vereist een ander document",
  noBilingualCounterpart: "Er is geen andere taal om samen te voegen (een vertaling of ondertitels in een andere taal)",
  sourceAmbiguous: "Meerdere documenten kunnen worden geëxporteerd; kies er een met documentId (of language)",
  linkedAssetMissing: (p: { name: string }) => `Gekoppelde media ‘${p.name}’ staan niet meer op de oorspronkelijke locatie`,
  linkedAssetContentChanged: (p: { name: string }) =>
    `Gekoppelde media ‘${p.name}’ zijn gewijzigd sinds het koppelen; koppel ze opnieuw of kies expliciet een andere revisie`,
  linkedAssetGoneBeforeExport: (p: { name: string }) => `Gekoppelde media ‘${p.name}’ zijn verdwenen voordat de export begon`,
  linkedAssetChangedBeforeExport: (p: { name: string }) => `Gekoppelde media ‘${p.name}’ zijn gewijzigd voordat de export begon`,

  fileNotExported: (p: { fileName: string; problems: string }) => `${p.fileName} is niet geëxporteerd: ${p.problems}`,
  noFilesExported: "Geen van de bestanden is geëxporteerd",
  partiallyPublished: (p: { failed: number; published: number }) =>
    `${p.failed} ${s(p.failed, "bestand is niet", "bestanden zijn niet")} geëxporteerd; ${p.published} ${s(p.published, "is", "zijn")} gepubliceerd`,
  xmlIncomplete: "De geschreven XML is onvolledig",

  toolStartFailed: (p: { tool: string; error: string }) => `${p.tool} kan niet starten: ${p.error}`,
  toolExited: (p: { tool: string; code: string; output: string }) => `${p.tool} is afgesloten met ${p.code}: ${p.output}`,
  ffmpegEncoder: (p: { encoder: string }) => `ffmpeg-${p.encoder}-encoder`,
  ffmpegAmixNormalize: "ffmpeg 4.4 of nieuwer (de normalize-optie van amix)",
  ffmpegFilter: (p: { filter: string }) => `ffmpeg-${p.filter}-filter`,
  masterNeedsWorker: "Normalisatie van luidheid vereist export-worker",
  workerExitedUnexpectedly: (p: { signal: string | null; code: string; output: string }) =>
    `export-worker is onverwacht afgesloten (${p.signal ?? `afsluitcode ${p.code}`})${p.output ? `: ${p.output}` : ""}`,

  planAssetNotFrozen: (p: { assetId: string }) => `Media ${p.assetId} in het plan zijn niet bevroren`,
  loudnessNotMeasurable: "De mix is stil of te kort om de luidheid te meten; alleen de true-peakgrens is toegepast",
  audioNote: (p: { itemId: string; note: string }) => `Item ${p.itemId}: ${p.note}`,
  noteDuckNoSpeech:
    "Spraakgestuurd verlagen heeft het volume niet verlaagd: de video heeft geen transcript of geen getranscribeerde woorden staan op de tijdlijn",
  noteHoldIsSilent: "Stilstaandbeeld-items zijn stil (net als het voorbeeld)",
  noteAssetHasNoAudio: "De media hebben geen audiostream, dus er is niets om te mixen",
  noteCrossfadeHandleShort:
    "De audio-overvloeiing van de overgang vereist media buiten het itembereik (handles); de media zijn aan die kant niet lang genoeg, dus het ontbrekende deel wordt geëxporteerd als stilte",
  gainAbovePreview: (p: { itemId: string; gainDb: number }) =>
    `Item ${p.itemId} heeft een piekversterking van +${p.gainDb} dB: het voorbeeld beperkt het volume tot 0 dB, maar de export past de instelling toe, dus het klinkt luider dan het voorbeeld`,

  outputSizeAdjusted: (p: { width: number; height: number; canvasWidth: number; canvasHeight: number }) =>
    `Uitvoergrootte ingesteld op ${p.width}×${p.height} (komt overeen met de beeldverhouding van het canvas ${p.canvasWidth}×${p.canvasHeight}, met even breedte en hoogte)`,
  outputSizeLetterboxed: (p: { width: number; height: number; pictureWidth: number; pictureHeight: number }) =>
    `Uitvoergrootte ingesteld op ${p.width}×${p.height} (even breedte en hoogte; het beeld is ${p.pictureWidth}×${p.pictureHeight}, de rest zijn zwarte balken)`,
  contentSkippedEffect: (p: { itemId: string; effectId: string; kind: string; message: string }) =>
    `Effect ${p.effectId} (${p.kind}) op item ${p.itemId} is overgeslagen: ${p.message}`,
  contentSkippedTransition: (p: { transitionId: string; kind: string; message: string }) =>
    `Overgang ${p.transitionId} (${p.kind}) gerenderd als een knip: ${p.message}`,
  contentSkippedItem: (p: { itemId: string; layerKind: string; message: string }) =>
    `Item ${p.itemId} (${p.layerKind}) is niet gerenderd: ${p.message}`,
  fontNotDownloaded: (p: { family: string; weight: number; italic: boolean; reason: string; fallback: string }) =>
    `‘${p.family}’ ${p.weight}${p.italic ? " cursief" : ""}: ${p.reason}; in plaats daarvan ‘${p.fallback}’ gebruikt`,
  fontNotDownloadedReason: "Niet gedownload",
  fontStillMissingAfterDownload: "Ook na downloaden niet gevonden",
  fontDownloadUnavailable: "Lettertypen downloaden is niet beschikbaar",

  translationPartialSkipped: (p: { count: number }) =>
    `${p.count} ${s(p.count, "zin is", "zinnen zijn")} gedeeltelijk geknipt en niet vertaald`,
  translationStale: (p: { count: number }) => pluralForm('nl', p.count, { one: `${p.count} vertaaleenheid is verouderd (de bron is gewijzigd) en is niet geschreven`, other: `${p.count} vertaaleenheden zijn verouderd (de bron is gewijzigd) en zijn niet geschreven` }),
  bilingualUnmatched: (p: { count: number }) => pluralForm('nl', p.count, { one: `${p.count} item in de andere taal ligt buiten de zinnen van het hoofddocument en is niet geschreven`, other: `${p.count} items in de andere taal liggen buiten de zinnen van het hoofddocument en zijn niet geschreven` }),
  cueSplitEstimated: (p: { count: number }) =>
    `${p.count} ${s(p.count, "zin is", "zinnen zijn")} gesplitst in meerdere cues op geïnterpoleerde woordtijden; de splitsingstijden zijn schattingen`,
  assStyleUnmapped: (p: { styles: string }) => `Stijlen die ASS niet kan weergeven (niet geschreven): ${p.styles}`,
  assWholeStyle: (p: { schema: string | null }) => `De hele stijl (${p.schema ?? "geen schema"})`,

  durationMismatch: (p: { actual: number; expected: number; tolerance: number }) =>
    `Duur: ${p.actual} s, verwacht ${p.expected} s (tolerantie ${p.tolerance})`,
  sampleRateMismatch: (p: { actual: number; expected: number }) => `Samplefrequentie: ${p.actual}, maar ingesteld: ${p.expected}`,
  channelsMismatch: (p: { actual: number; expected: number }) =>
    `${p.actual} ${s(p.actual, "kanaal", "kanalen")}, maar ingesteld: ${p.expected}`,
  validationFailed: (p: { problems: string }) => `De uitvoer heeft de validatie niet doorstaan: ${p.problems}`,
  probeFailed: (p: { error: string }) => `ffprobe kan de uitvoer niet lezen: ${p.error}`,
  probeNotJson: "De uitvoer van ffprobe is geen JSON",
  noAudioStream: "Geen audiostream",
  noDecodableFrame: "Kan geen enkel frame decoderen",
  noVideoStream: "De uitvoer heeft geen videostream",
  frameCountMismatch: (p: { actual: number; expected: number }) => `${p.actual} frames, verwacht ${p.expected}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) =>
    `Grootte: ${p.width}×${p.height}, verwacht ${p.expectedWidth}×${p.expectedHeight}`,
  fpsMismatch: (p: { actual: string; expected: string }) => `Framesnelheid: ${p.actual}, verwacht ${p.expected}`,
  codecMismatch: (p: { actual: string; expected: string }) => `Videocodec: ${p.actual}, verwacht ${p.expected}`,
  videoDurationMismatch: (p: { actual: number; expected: number }) =>
    `Beeldduur: ${p.actual} s, verwacht ${p.expected} s (tolerantie één frame)`,
  noAudioInOutput: "De uitvoer heeft geen audio",
  audioDurationMismatch: (p: { actual: number; expected: number }) =>
    `Audioduur: ${p.actual} s; moet overeenkomen met het beeld (${p.expected} s)`,
  vttMissingHeader: "VTT heeft geen WEBVTT-header",
  cueMissingIndex: (p: { n: number }) => `Cue ${p.n} heeft geen index`,
  cueTimeLineUnparsable: (p: { n: number }) => `Kan de timingregel van de cue niet verwerken: ${p.n}`,
  cueNoText: (p: { n: number }) => `Cue ${p.n} heeft geen tekst`,
  assMissingSections: "ASS mist sectiekoppen",
  cueTimeUnparsable: (p: { n: number }) => `Kan de tijden van de cue niet verwerken: ${p.n}`,
  wordTimeOutsideSentence: "Woordtijden vallen buiten de zin",
  invalidJson: "Geen geldige JSON",
  cueEndNotAfterStart: (p: { n: number }) => `Cue ${p.n} eindigt niet na het begin`,
  cueOverlapsPrevious: (p: { n: number }) => `Cue ${p.n} overlapt de vorige`,
  lastCueBeyondRange: (p: { end: number; range: number }) => `De laatste cue eindigt op ${p.end} s, voorbij het exportbereik van ${p.range} s`,
  entryCountMismatch: (p: { parsed: number; written: number }) => `Verwerkt: ${p.parsed} items, maar geschreven: ${p.written}`,
  noContent: "Geen inhoud",

  itemKindVideo: "Video",
  itemKindImage: "Afbeelding",
  itemKindAudio: "Audio",
  itemKindText: "Tekst",
  itemKindShape: "Vorm",
  itemKindComposition: "Compositie",
  itemKindCaption: "Ondertitels",
  itemKindSticker: "Sticker",
  itemKindVisualizer: "Audiovisualisatie",
  itemKindProgress: "Voortgangsbalk",
  itemKindDraw: "Bezig",
  itemKindPlaceholder: "Tijdelijke aanduiding",
  itemKindConfetti: "Confetti",
  itemKindWhiteboard: "Whiteboardtekening",
  projectItemOmitted: (p: { kind: string; itemId: string; name: string | null; reason: string }) =>
    `${p.kind}-item ${p.itemId}${p.name ? ` ‘${p.name}’` : ""}: ${p.reason}`,
  projectFpsInexact: (p: { fps: string; timebase: number }) =>
    `De sequentieframesnelheid ${p.fps} kan alleen worden geschreven als ${p.timebase} in xmeml`,
  projectAssetOffline: (p: { name: string; reason: string }) =>
    `Kan de media niet lezen: ‘${p.name}’ (${p.reason}); het is een offline clip in het projectbestand`,
  projectTransitionOmitted: (p: { kind: string }) => `Overgang ${p.kind} niet naar het projectbestand geschreven (geschreven als knip)`,
  embeddedAudioTrack: (p: { n: number }) => `Ingebouwde audio ${p.n}`,
  omitCaption: "ondertitels niet naar het projectbestand geschreven (exporteer SRT-ondertitels afzonderlijk)",
  omitUnsupportedKind: "niet naar het projectbestand geschreven (xmeml kan dit niet weergeven)",
  omitNoPrerender: "de compositie heeft geen voorrender en is dus niet naar het projectbestand geschreven",
  omitAssetMissing: "de gekoppelde media bestaan niet",
  omitFreezeFrame: "stilstaand beeld niet naar het projectbestand geschreven",
  omitSpeed: "snelheidswijziging niet naar het projectbestand geschreven (geschreven op normale snelheid)",
  omitSubframe: "subframebegin afgerond naar het dichtstbijzijnde frame",
  omitAudioMix: "volume, fades en envelop niet naar het projectbestand geschreven",
  omitPlacement: "positie, schaal, rotatie en spiegelen niet naar het projectbestand geschreven (geschreven als canvasvullend)",
  omitOpacity: "dekking niet naar het projectbestand geschreven",
  omitCornerRadius: "afgeronde hoeken niet naar het projectbestand geschreven",
  omitEffects: "effecten niet naar het projectbestand geschreven",
  omitMask: "masker niet naar het projectbestand geschreven",
  omitAnimation: "elementanimatie niet naar het projectbestand geschreven",
  omitKeyframes: "sleutelbeelden niet naar het projectbestand geschreven",
  omitCrop: "bijsnijden niet naar het projectbestand geschreven",
  omitEmbeddedAudioMix: "volume, fades en envelop van ingebouwde audio niet naar het projectbestand geschreven",
};
