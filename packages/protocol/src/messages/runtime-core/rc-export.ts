import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-export.zh-Hans.ts';
import { zhHant } from './rc-export.zh-Hant.ts';
import { ja } from './rc-export.ja.ts';
import { ko } from './rc-export.ko.ts';
import { es } from './rc-export.es.ts';
import { fr } from './rc-export.fr.ts';
import { de } from './rc-export.de.ts';
import { nl } from './rc-export.nl.ts';
import { ptBR } from './rc-export.pt-BR.ts';
import { it } from './rc-export.it.ts';
import { ru } from './rc-export.ru.ts';
import { pl } from './rc-export.pl.ts';
import { tr } from './rc-export.tr.ts';
import { vi } from './rc-export.vi.ts';

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** 导出（exports/）：导出任务的错误、警告与说明。英文是键与类型的来源，译文在 `rc-export.<语言>.ts`。 */
const en = {
  // 列表分隔：顿号式（`、`）与分句式（`；`）。
  listSeparator: ', ',
  clauseSeparator: '; ',

  // 导出的落点与发布
  destinationNotAbsolute: 'The export folder must be an absolute path',
  destinationCreateFailed: (p: { reason: string }) => `Can't create the export folder: ${p.reason}`,
  destinationNotDirectory: "The export folder doesn't exist or isn't a folder",
  destinationNotWritable: "The export folder isn't writable",
  destinationFileExists: (p: { fileName: string }) => `The file already exists: ${p.fileName}`,
  destinationWriteFailed: (p: { reason: string }) => `Can't write to the export folder: ${p.reason}`,
  destinationTooManyDuplicates: 'Too many files with the same name',
  destinationExistsRecovery: 'Choose another file name, or explicitly ask to overwrite (overwrite)',
  destinationUnwritableRecovery: 'Choose a writable folder, or have the user change its permissions',

  // 预检与提交
  exportTaskNotFound: 'Export task not found',
  exportKindUnsupported: (p: { kind: string }) => `This version can't export ${p.kind} yet`,
  videoNotOpen: "The video isn't open; open it first",
  fileNameWithMultipleRanges: "Each range produces its own file, so they can't share one fileName",
  documentNotExportable: (p: { kind: string }) => `${p.kind} documents can't be exported as subtitles or a transcript`,
  nothingInRange: 'There is no text in the export range (it may all have been cut, or the document is empty)',
  audioExportNeeds: (p: { missing: string }) => `Audio export needs ${p.missing}`,
  loudnessNeedsWorker: "Loudness normalization needs the Render Worker (export-worker), which wasn't found",
  videoExportNeeds: (p: { missing: string }) => `Video export needs ${p.missing}`,
  videoExportNeedsWorker: "Video export needs the Render Worker (export-worker), which wasn't found",
  videoExportNeedsEncoders: (p: { encoders: string }) => `Video export needs the ffmpeg encoders ${p.encoders}`,
  unsupportedContent: (p: { count: number; items: string }) =>
    `${p.count} ${s(p.count, "item can't", "items can't")} be rendered in the export: ${p.items}`,
  unsupportedContentRemedy: "Remove or replace this content, or skip it with onUnsupported: 'skip' (each item is recorded as a warning)",
  workerRemedy: 'Build the Render Worker (`npm run build:engine`), or set BAOCUT_EXPORT_WORKER to the location of export-worker',
  workerGone: (p: { error: string }) => `The Render Worker (export-worker) is gone: ${p.error}`,
  fontCensusNeedsWorker: "Checking fonts needs the Render Worker (export-worker), which wasn't found",
  sequenceNotFound: (p: { sequenceId: string }) => `Sequence ${p.sequenceId} doesn't exist`,
  sequenceMissing: "The sequence doesn't exist",
  dubGroupNotFound: (p: { groupId: string }) => `This sequence has no voice-over group ${p.groupId}`,
  projectNothingToExport:
    'The sequence has no clips that can go into a project file (video, images, audio, or compositions with a prerender)',
  noSourceForLanguage: (p: { language: string }) => `No subtitles or transcript in ${p.language}`,
  noSource: 'The video has no subtitles or transcript to export',
  bilingualDocumentNotFound: "The document to merge for bilingual output doesn't exist",
  bilingualNeedsOtherDocument: 'Bilingual output needs a different document',
  noBilingualCounterpart: 'There is no other language to merge (a translation, or subtitles in another language)',
  sourceAmbiguous: 'Several documents could be exported; pick one with documentId (or language)',
  linkedAssetMissing: (p: { name: string }) => `Linked asset "${p.name}" is no longer where it was`,
  linkedAssetContentChanged: (p: { name: string }) =>
    `Linked asset "${p.name}" has changed since it was linked; relink it, or explicitly switch revisions`,
  linkedAssetGoneBeforeExport: (p: { name: string }) => `Linked asset "${p.name}" disappeared before the export started`,
  linkedAssetChangedBeforeExport: (p: { name: string }) => `Linked asset "${p.name}" was modified before the export started`,

  // 任务的结果
  fileNotExported: (p: { fileName: string; problems: string }) => `${p.fileName} wasn't exported: ${p.problems}`,
  noFilesExported: 'None of the files were exported',
  partiallyPublished: (p: { failed: number; published: number }) =>
    `${p.failed} ${s(p.failed, "file wasn't", "files weren't")} exported; ${p.published} ${s(p.published, 'was', 'were')} published`,
  xmlIncomplete: 'The written XML is incomplete',

  // 外部工具
  toolStartFailed: (p: { tool: string; error: string }) => `${p.tool} failed to start: ${p.error}`,
  toolExited: (p: { tool: string; code: string; output: string }) => `${p.tool} exited with ${p.code}: ${p.output}`,
  ffmpegEncoder: (p: { encoder: string }) => `the ffmpeg ${p.encoder} encoder`,
  ffmpegAmixNormalize: 'ffmpeg 4.4 or later (the normalize option of amix)',
  ffmpegFilter: (p: { filter: string }) => `the ffmpeg ${p.filter} filter`,
  masterNeedsWorker: 'Loudness normalization needs export-worker',
  workerExitedUnexpectedly: (p: { signal: string | null; code: string; output: string }) =>
    `export-worker exited unexpectedly (${p.signal ?? `exit code ${p.code}`})${p.output ? `: ${p.output}` : ''}`,

  // 音频
  planAssetNotFrozen: (p: { assetId: string }) => `Asset ${p.assetId} in the plan wasn't frozen`,
  loudnessNotMeasurable: 'The mix is silent or too short to measure loudness; only the true-peak ceiling was applied',
  audioNote: (p: { itemId: string; note: string }) => `Item ${p.itemId}: ${p.note}`,
  noteDuckNoSpeech:
    "Speech-triggered ducking didn't lower the volume: the video has no transcript, or none of the transcribed words are on the timeline",
  noteHoldIsSilent: 'Freeze-frame items are silent (same as the preview)',
  noteAssetHasNoAudio: 'The asset has no audio stream, so there is nothing to mix',
  noteCrossfadeHandleShort:
    "The transition's audio crossfade needs media beyond the item's range (handles); the asset isn't long enough on that side, so the missing part is exported as silence",
  gainAbovePreview: (p: { itemId: string; gainDb: number }) =>
    `Item ${p.itemId} has a peak gain of +${p.gainDb} dB: the preview caps volume at 0 dB, but the export applies the setting, so it will sound louder than the preview`,

  // 成片
  outputSizeAdjusted: (p: { width: number; height: number; canvasWidth: number; canvasHeight: number }) =>
    `Output size set to ${p.width}×${p.height} (matching the ${p.canvasWidth}×${p.canvasHeight} canvas aspect ratio, with even width and height)`,
  outputSizeLetterboxed: (p: { width: number; height: number; pictureWidth: number; pictureHeight: number }) =>
    `Output size set to ${p.width}×${p.height} (even width and height; the picture is ${p.pictureWidth}×${p.pictureHeight}, the rest is black bars)`,
  contentSkippedEffect: (p: { itemId: string; effectId: string; kind: string; message: string }) =>
    `Effect ${p.effectId} (${p.kind}) on item ${p.itemId} was skipped: ${p.message}`,
  contentSkippedTransition: (p: { transitionId: string; kind: string; message: string }) =>
    `Transition ${p.transitionId} (${p.kind}) rendered as a cut: ${p.message}`,
  contentSkippedItem: (p: { itemId: string; layerKind: string; message: string }) =>
    `Item ${p.itemId} (${p.layerKind}) wasn't rendered: ${p.message}`,
  fontNotDownloaded: (p: { family: string; weight: number; italic: boolean; reason: string; fallback: string }) =>
    `"${p.family}" ${p.weight}${p.italic ? ' italic' : ''}: ${p.reason}; using "${p.fallback}" instead`,
  fontNotDownloadedReason: 'Not downloaded',
  fontStillMissingAfterDownload: 'Still not found after downloading',
  fontDownloadUnavailable: 'Font download is unavailable',

  // 字幕与文稿
  translationPartialSkipped: (p: { count: number }) =>
    `${p.count} ${s(p.count, 'sentence was', 'sentences were')} cut partway and got no translation`,
  translationStale: (p: { count: number }) =>
    `${p.count} translation ${s(p.count, 'unit is', 'units are')} out of date (the source changed) and ${s(p.count, 'was', 'were')} not written`,
  bilingualUnmatched: (p: { count: number }) =>
    `${p.count} ${s(p.count, 'entry', 'entries')} in the other language fall outside the main document's sentences and ${s(p.count, 'was', 'were')} not written`,
  cueSplitEstimated: (p: { count: number }) =>
    `${p.count} ${s(p.count, 'sentence was', 'sentences were')} split into several cues at interpolated word times; the split times are estimates`,
  assStyleUnmapped: (p: { styles: string }) => `Styles ASS can't express (not written): ${p.styles}`,
  assWholeStyle: (p: { schema: string | null }) => `The whole style (${p.schema ?? 'no schema'})`,

  // 校验（发布前按格式读回来）
  durationMismatch: (p: { actual: number; expected: number; tolerance: number }) =>
    `Duration is ${p.actual} s, expected ${p.expected} s (tolerance ${p.tolerance})`,
  sampleRateMismatch: (p: { actual: number; expected: number }) => `Sample rate is ${p.actual}, but the setting is ${p.expected}`,
  channelsMismatch: (p: { actual: number; expected: number }) =>
    `${p.actual} ${s(p.actual, 'channel', 'channels')}, but the setting is ${p.expected}`,
  validationFailed: (p: { problems: string }) => `The output failed validation: ${p.problems}`,
  probeFailed: (p: { error: string }) => `ffprobe can't read the output: ${p.error}`,
  probeNotJson: "ffprobe's output isn't JSON",
  noAudioStream: 'No audio stream',
  noDecodableFrame: "Can't decode a single frame",
  noVideoStream: 'The output has no video stream',
  frameCountMismatch: (p: { actual: number; expected: number }) => `${p.actual} frames, expected ${p.expected}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) =>
    `Size is ${p.width}×${p.height}, expected ${p.expectedWidth}×${p.expectedHeight}`,
  fpsMismatch: (p: { actual: string; expected: string }) => `Frame rate is ${p.actual}, expected ${p.expected}`,
  codecMismatch: (p: { actual: string; expected: string }) => `Video codec is ${p.actual}, expected ${p.expected}`,
  videoDurationMismatch: (p: { actual: number; expected: number }) =>
    `Picture duration is ${p.actual} s, expected ${p.expected} s (tolerance one frame)`,
  noAudioInOutput: 'The output has no audio',
  audioDurationMismatch: (p: { actual: number; expected: number }) =>
    `Audio duration is ${p.actual} s; it should match the picture (${p.expected} s)`,
  vttMissingHeader: 'VTT has no WEBVTT header',
  cueMissingIndex: (p: { n: number }) => `Cue ${p.n} has no index`,
  cueTimeLineUnparsable: (p: { n: number }) => `Can't parse the timing line of cue ${p.n}`,
  cueNoText: (p: { n: number }) => `Cue ${p.n} has no text`,
  assMissingSections: 'ASS is missing section headers',
  cueTimeUnparsable: (p: { n: number }) => `Can't parse the times of cue ${p.n}`,
  wordTimeOutsideSentence: 'Word times fall outside the sentence',
  invalidJson: 'Not valid JSON',
  cueEndNotAfterStart: (p: { n: number }) => `Cue ${p.n} doesn't end after it starts`,
  cueOverlapsPrevious: (p: { n: number }) => `Cue ${p.n} overlaps the previous one`,
  lastCueBeyondRange: (p: { end: number; range: number }) => `The last cue ends at ${p.end} s, past the ${p.range} s export range`,
  entryCountMismatch: (p: { parsed: number; written: number }) => `Parsed ${p.parsed} entries, but ${p.written} were written`,
  noContent: 'No content',

  // 工程（xmeml）导出：表达不了、没有写进工程文件的内容
  itemKindVideo: 'Video',
  itemKindImage: 'Image',
  itemKindAudio: 'Audio',
  itemKindText: 'Text',
  itemKindShape: 'Shape',
  itemKindComposition: 'Composition',
  itemKindCaption: 'Subtitles',
  itemKindSticker: 'Sticker',
  itemKindVisualizer: 'Audio visualizer',
  itemKindProgress: 'Progress bar',
  itemKindDraw: 'Drawing',
  itemKindPlaceholder: 'Placeholder',
  itemKindConfetti: 'Confetti',
  itemKindWhiteboard: 'Whiteboard drawing',
  projectItemOmitted: (p: { kind: string; itemId: string; name: string | null; reason: string }) =>
    `${p.kind} item ${p.itemId}${p.name ? ` "${p.name}"` : ''}: ${p.reason}`,
  projectFpsInexact: (p: { fps: string; timebase: number }) =>
    `The sequence frame rate ${p.fps} can only be written as ${p.timebase} in xmeml`,
  projectAssetOffline: (p: { name: string; reason: string }) =>
    `Can't read asset "${p.name}" (${p.reason}); it's an offline clip in the project file`,
  projectTransitionOmitted: (p: { kind: string }) => `Transition ${p.kind} not written to the project file (written as a cut)`,
  embeddedAudioTrack: (p: { n: number }) => `Embedded audio ${p.n}`,
  omitCaption: 'subtitles not written to the project file (export SRT subtitles separately)',
  omitUnsupportedKind: "not written to the project file (xmeml can't express it)",
  omitNoPrerender: 'the composition has no prerender, so it was not written to the project file',
  omitAssetMissing: "the referenced asset doesn't exist",
  omitFreezeFrame: 'freeze frame not written to the project file',
  omitSpeed: 'speed change not written to the project file (written at normal speed)',
  omitSubframe: 'subframe start rounded to the nearest frame',
  omitAudioMix: 'volume, fades and envelope not written to the project file',
  omitPlacement: 'position, scale, rotation and flip not written to the project file (written as filling the canvas)',
  omitOpacity: 'opacity not written to the project file',
  omitCornerRadius: 'rounded corners not written to the project file',
  omitEffects: 'effects not written to the project file',
  omitMask: 'mask not written to the project file',
  omitAnimation: 'element animation not written to the project file',
  omitKeyframes: 'keyframes not written to the project file',
  omitCrop: 'crop not written to the project file',
  omitEmbeddedAudioMix: 'embedded audio volume, fades and envelope not written to the project file',
};

export type RcExportMessages = typeof en;

export const RcExport = defineCatalog('rcExport', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
