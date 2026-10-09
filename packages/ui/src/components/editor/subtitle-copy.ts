import { defineMessages, live, type CapabilityNotConfiguredReason } from '@baocut/protocol';
import { zhCaptionStyle, zhNotConfigured, zhSubtitle } from './subtitle-copy.zh-Hans.ts';
import { zhHantCaptionStyle, zhHantNotConfigured, zhHantSubtitle } from './subtitle-copy.zh-Hant.ts';
import { jaCaptionStyle, jaNotConfigured, jaSubtitle } from './subtitle-copy.ja.ts';
import { koCaptionStyle, koNotConfigured, koSubtitle } from './subtitle-copy.ko.ts';
import { esCaptionStyle, esNotConfigured, esSubtitle } from './subtitle-copy.es.ts';
import { frCaptionStyle, frNotConfigured, frSubtitle } from './subtitle-copy.fr.ts';
import { deCaptionStyle, deNotConfigured, deSubtitle } from './subtitle-copy.de.ts';
import { nlCaptionStyle, nlNotConfigured, nlSubtitle } from './subtitle-copy.nl.ts';
import { ptBRCaptionStyle, ptBRNotConfigured, ptBRSubtitle } from './subtitle-copy.pt-BR.ts';
import { itCaptionStyle, itNotConfigured, itSubtitle } from './subtitle-copy.it.ts';
import { ruCaptionStyle, ruNotConfigured, ruSubtitle } from './subtitle-copy.ru.ts';
import { plCaptionStyle, plNotConfigured, plSubtitle } from './subtitle-copy.pl.ts';
import { trCaptionStyle, trNotConfigured, trSubtitle } from './subtitle-copy.tr.ts';
import { viCaptionStyle, viNotConfigured, viSubtitle } from './subtitle-copy.vi.ts';

const subtitles = (n: number) => `${n} subtitle${n === 1 ? '' : 's'}`;

/** 字幕面板的文案（空态、转录、轨条、接缝）。原型：panel-subtitle.jsx、panel-shared.jsx `LiveHead`、panel-substrip.jsx、subtrack.jsx。译文在 `subtitle-copy.zh-Hans.ts`。 */
const en = {
  emptyTitle: 'No subtitles yet',
  emptyReady: 'Transcribe your media, then proofread the subtitles here.',
  emptyNoMedia: 'Add a video or audio file first, then generate subtitles.',
  /** 素材在库里、还没放上时间线：字幕跟着时间线走，转录了也落不到画面上。 */
  emptyNotPlaced: 'The video or audio isn’t on the timeline yet. Place it there before generating subtitles.',
  emptyReuse: (name: string) => `“${name}” is already transcribed; generating subtitles uses that transcript without recognizing it again.`,
  generate: 'Generate subtitles',
  addMedia: 'Add media',
  importFile: 'Import subtitle file',
  pickAsset: 'Asset to generate subtitles for',
  pickTranscribe: 'Transcribe, then generate',
  pickReuse: 'Generate from existing transcript · no re-recognition',

  // 转录中（LiveHead）
  liveTitle: 'Transcribing',
  submitting: 'Submitting transcription',
  writing: 'Generating subtitles',
  transcribed: (done: string, total: string | null) => (total ? `Transcribed ${done} / ${total}` : `Transcribed ${done}`),
  segments: (done: number, total: number | null) => (total ? `Recognized ${done} / ${total} segments` : `Recognized ${done} segment${done === 1 ? '' : 's'}`),
  stages: ['Decode audio', 'Recognize', 'Align words', 'Save'],
  cancel: 'Cancel transcription',
  /** 转录中字幕面板列出已识别的段落（只读卡，subtitle-live.tsx），字幕要等转录完成才生成、才能校对。 */
  liveNote: 'Recognized parts appear one by one. When transcription finishes, subtitles are generated and you can proofread them here line by line.',
  foreignNote: 'This transcription wasn’t started from the Subtitles panel. When it finishes, click “Generate subtitles” to use its result.',
  /** 时间线上转录中的临时字幕行（原型 timeline-rows.jsx 第 220 轮）：行头与待定带的提示。百分比不明时不写。 */
  liveTip: (pct: number | null, at: string, remain: string | null) =>
    [pct === null ? 'Transcribing' : `Transcribing ${pct}%`, `transcribed up to ${at}`, ...(remain ? [`${remain} left`] : [])].join(' · '),
  pendingLeft: (remain: string) => `Transcribing · ${remain} left`,
  cancelled: 'Transcription cancelled',
  cancelFailed: (message: string) => `Couldn’t cancel transcription: ${message}`,

  // 结果与问题
  generated: (count: number, from: string, to: string) => `Generated ${subtitles(count)} · ${from} → ${to}`,
  created: (count: number) => `Generated ${subtitles(count)}`,
  /** 这个素材已经有原文字幕显示着：新的一层停用着放上去（轨条上的虚线 chip）。 */
  createdShelved: (count: number) =>
    `Generated ${subtitles(count)} · original subtitles are already on screen, so the new layer isn’t shown yet; click it on the strip to put it on screen`,
  notConfigured: (reason: string) => `Can’t transcribe yet · ${reason}`,
  submitFailed: 'Couldn’t start transcription',
  failed: 'Transcription failed',
  interrupted: 'Transcription was interrupted',
  noSpeechTitle: 'No speech recognized',
  noSpeech: 'No one is heard speaking in this asset.',
  noAudioTitle: 'This asset has no audio track',
  noAudio: 'Try again with a video or audio file that has sound.',
  offTimelineTitle: 'None of the recognized speech is on the timeline',
  offTimeline: 'The part of this asset used on the timeline has no speech, or the asset has been removed from the timeline.',
  badSpeech: 'The transcript format isn’t recognized, so it can’t be split into subtitles.',
  pendingTitle: 'Transcription finished, but subtitles aren’t generated yet',
  pending: 'The transcript is saved in the video; click “Generate subtitles” again to use it without transcribing again.',
  writeFailedTitle: 'The subtitles weren’t written to the video',
  otherVideo: (name: string) => `“${name}” transcribed · go back to that video and click “Generate subtitles”`,
  retry: 'Try again',
  dismiss: 'OK',
  unsettledTitle: 'Transcription result unknown',
  unsettled:
    'The Runtime restarted before this recognition responded. It may already have been billed, so it won’t be resent automatically. Decide in Background tasks whether to try again or give up; once the transcript is written to the video, “Generate subtitles” uses it directly.',
  unappliedTitle: 'The transcript wasn’t written to the video',
  unapplied: (message: string) =>
    `${message ? `${message}. ` : ''}The recognition result is still available; you can write it to the video again from Background tasks. After that, “Generate subtitles” uses it directly.`,
  decide: 'Resolve in Background tasks',

  // 轨条与样式入口卡
  onScreen: 'On screen',
  defaultStyle: 'Default style',
  styleEntry: (n: number) => (n ? `Edit style · ${n} subtitle track${n === 1 ? '' : 's'} on screen` : 'Edit style'),
  styleEntryLabel: 'Edit subtitle style',
  chipPick: 'Proofread this one below',
  chipOff: 'Turned off · turn it on from the track header',
  chipLocked: 'Locked · unlock it from the track header',
  drop: (name: string) => `Take “${name}” off screen`,
  dropTip: 'Take off screen · keeps the data',
  dropLast: 'This is the only subtitle track left on screen—taking it off leaves no subtitles',
  dropped: (name: string) => `Took “${name}” off screen · put it back from the track header`,
  putBackTip: (name: string, stacked: boolean) => `Put “${name}” back on screen${stacked ? ' · a third one asks first' : ''}`,
  putBack: (name: string) => `Put “${name}” back on screen`,
  stacked: (name: string, n: number) => `Stacked “${name}” · ${n} on screen now`,
  stackTitle: (n: number) => `${n} subtitle tracks will be on screen`,
  stackBody: (name: string, n: number) => `Putting “${name}” back shows ${n} together—in a vertical video, three take up a good part of the screen.`,
  stackConfirm: 'Stack another',
  cancelLabel: 'Cancel',
  translate: 'Translate to…',
  translateOff: 'Translation isn’t hooked up yet: the text model and translation workflow are in progress',
  translateTip: 'Choose a target language and text model; the translation goes on screen as a new subtitle track',
  translatingLabel: (language: string) => `Translating to ${language}`,
  flip: 'Flip ⇅',
  flipTip: 'Swap the two lines—the top line is the main one, in larger text',
  flipOff: 'You can flip only when the original and translation share a style and are both on screen; there’s no such pair yet',
  flipped: (translationFirst: boolean) =>
    `Flipped · ${translationFirst ? 'translation on top, original below' : 'original on top, translation below'}`,

  // 列表
  stats: (cues: number, sentences: number) => `${subtitles(cues)} · ${sentences} sentence${sentences === 1 ? '' : 's'}`,
  seam: 'Merge into previous',
  seamSpeaker: 'Different speakers · can’t merge',
  undo: 'Undo',
  panelTitle: 'Subtitles',
  importFileTip: 'Import subtitle file (SRT, WebVTT, ASS)',
  importUnsupported: 'Only SRT, WebVTT, and ASS subtitle files are supported',
  importEmpty: (file: string) => `No subtitles found in “${file}”`,
  importLabel: 'Import subtitles',
  imported: (count: number, end: string) => `Imported ${count} subtitles · 0:00 → ${end}`,
  readingCues: 'Loading subtitles…',
  unsupportedDoc: 'This subtitle document’s format can’t be edited here yet.',
  rewriteLabel: 'Edit subtitle',
  rewritten: 'Subtitle edited',
  splitLabel: 'Split subtitle',
  splitDone: 'Split in two · timing divided by character count',
  mergeSpeaker: 'Different speakers · can’t merge',
  firstCue: 'Already the first one',
  lastCue: 'Already the last one',
  mergeLabel: 'Merge subtitles',
  mergedUp: 'Merged into the previous one · timing joined',
  mergedDown: 'Merged into the next one · timing joined',
  noChanges: 'No matches need changing',
  replaceLabel: 'Replace subtitle text',
  replaced: (count: number) => `Replaced ${count}`,
  tooFast: (count: number) => `${count} over reading speed`,
  keysHint: 'Enter splits · ⌫ at start merges up · ⌦ at end merges down',
  findReplace: 'Find and replace',
  findReplaceTip: 'Find and replace · ⌘F',
  noSentences: 'This subtitle document has no sentences yet.',
  badRegex: 'Invalid regex',
  noResults: 'No results',
  find: 'Find',
  findPlaceholder: 'Find in subtitles',
  previous: 'Previous',
  next: 'Next',
  closeFind: 'Close find',
  replaceWith: 'Replace with',
  matchCase: 'Match case',
  wholeWordShort: 'Word',
  wholeWord: 'Match whole word',
  regex: 'Regular expression · replacement text is inserted literally',
  replace: 'Replace',
  replaceAll: 'Replace all',
  regexError: (error: string) => `Regex error: ${error}`,
  cutAway: 'The footage for this sentence has been cut',
  seekHere: 'Move playhead to this sentence',
  readingSpeed: 'Reading speed: characters per second',
  editCue: (n: number) => `Edit subtitle ${n}`,
  cueText: 'Subtitle text',
  dropLabel: 'Remove subtitles from the canvas',
  landLabel: 'Put subtitles back on the canvas',
  flipLabel: 'Swap subtitle order',
  applyStyleLabel: 'Apply subtitle style',
  listSeparator: ', ',
  noSchema: '(no schema)',
  editPreset: (name: string) => `Edit this style: ${name}`,
  trackName: 'Subtitles',
  transcriptRow: 'Transcript',
  transcriptRowTip: 'Transcript · read-only · This video has no subtitle track yet. Generate one in the Subtitles tab.',
};

export type SubtitleMessages = typeof en;
export const SUBTITLE_COPY = defineMessages(en, { 'zh-Hans': zhSubtitle, 'zh-Hant': zhHantSubtitle, ja: jaSubtitle, ko: koSubtitle, es: esSubtitle, fr: frSubtitle, de: deSubtitle, nl: nlSubtitle, 'pt-BR': ptBRSubtitle, it: itSubtitle, ru: ruSubtitle, pl: plSubtitle, tr: trSubtitle, vi: viSubtitle });

/** `CAPABILITY_NOT_CONFIGURED` 的原因（协议 `CapabilityNotConfiguredReason`）。 */
const notConfigured: Record<CapabilityNotConfiguredReason, string> = {
  'no-default': 'No model chosen for transcription yet',
  'missing-credential': 'The transcription service has no key yet',
  'not-installed': 'The local transcription model isn’t installed yet',
  'signed-out': 'The agent isn’t signed in yet',
  outdated: 'The agent’s version is too old',
  'not-paired': 'The remote node isn’t paired yet',
  'not-connected': 'The remote node isn’t connected',
  unsupported: 'The chosen service doesn’t support transcription',
  disabled: 'The transcription service is turned off',
};

export type NotConfiguredMessages = typeof notConfigured;
const NOT_CONFIGURED = defineMessages({ reasons: notConfigured }, { 'zh-Hans': { reasons: zhNotConfigured }, 'zh-Hant': { reasons: zhHantNotConfigured }, ja: { reasons: jaNotConfigured }, ko: { reasons: koNotConfigured }, es: { reasons: esNotConfigured }, fr: { reasons: frNotConfigured }, de: { reasons: deNotConfigured }, nl: { reasons: nlNotConfigured }, 'pt-BR': { reasons: ptBRNotConfigured }, it: { reasons: itNotConfigured }, ru: { reasons: ruNotConfigured }, pl: { reasons: plNotConfigured }, tr: { reasons: trNotConfigured }, vi: { reasons: viNotConfigured } });
export const NOT_CONFIGURED_REASON: Record<CapabilityNotConfiguredReason, string> = live(() => NOT_CONFIGURED.reasons);

type Choice<K extends string> = { readonly key: K; readonly label: string };
type Place = Choice<'top' | 'middle' | 'bottom'> & { readonly y: number; readonly valign: 'top' | 'center' | 'bottom' };
type Plate = Choice<'wrap' | 'block'> & { readonly note: string };

/** 字幕样式画廊与属性页的「原文 | 译文」（原型 panel-substyle.jsx `SubGallery` / `GalleryCard`，panel-subprops.jsx 的位置、大小写、背景形态与比例链）。 */
const captionStyle = {
  // 画廊
  title: 'Subtitle styles',
  back: 'Back to Subtitles',
  open: 'Change style',
  openTip: 'Open the subtitle style gallery: each card is a different look',
  scope: 'Apply to',
  scopeAll: 'All',
  hint: 'Each card shows the subtitles currently on your screen. Applying one only changes the look—it never adds or removes a line. To add or take off a line, use the strip above or the subtitle track header on the timeline.',
  hintScope: 'When “Apply to” points at one line, only that line changes; nothing else moves.',
  edit: 'Edit this style',
  applied: (name: string, lines: string) => `Applied “${name}” · restyled ${lines}`,
  appliedOne: (line: string, name: string, others: string) => `Applied “${name}” to ${line}${others ? ` · ${others} unchanged` : ''}`,
  loading: 'Loading subtitle styles…',
  foreign: (schema: string) => `This subtitle style is ${schema}; the gallery can’t apply to it.`,
  readOnly: 'This video can’t be changed right now; style cards are view-only.',

  // 属性页
  lineSwitch: 'Line to edit',
  original: 'Original',
  translation: 'Translation',
  lineOwn: (line: string, n: number) => `${line} has ${n} setting${n === 1 ? '' : 's'} of its own; the rest follow the style both lines share.`,
  lineShared: (line: string) => `Changes here apply only to ${line}; anything not changed follows the style both lines share.`,
  followShared: 'Follow shared style',
  ratio: (root: string, bi: string, orig: string, source: string, size: string, k: string) =>
    `Base size ${root} × bilingual scale ${bi} ≈ ${orig} (effective size of “${source}”); this line ${size} = original × ${k}.`,
  ratioOwn: (size: string) => `This line’s size is set to ${size} on its own and doesn’t follow the original’s ratio.`,
  originalOwn: (size: string) => `The original’s size is set to ${size} on its own; the translation no longer follows it.`,
  followRatio: 'Follow ratio again',
  originalChain: 'Change the original’s size, and the translation follows proportionally.',
  place: 'Position on screen',
  places: [
    { key: 'top', label: 'Top', y: 10, valign: 'top' },
    { key: 'middle', label: 'Middle', y: 50, valign: 'center' },
    { key: 'bottom', label: 'Bottom', y: 90, valign: 'bottom' },
  ] as readonly Place[],
  remembered: 'Changed options are remembered for new subtitles.',
  fromTop: 'From top',
  anchor: 'Anchor line',
  anchors: [
    { key: 'top', label: 'Top edge' },
    { key: 'center', label: 'Center line' },
    { key: 'bottom', label: 'Bottom edge' },
  ] as readonly Choice<'top' | 'center' | 'bottom'>[],
  anchorHint: {
    top: 'Top edge pinned to the anchor line → wrapped lines grow downward.',
    center: 'Center line pinned to the anchor line → wrapped lines grow up and down evenly.',
    bottom: 'Bottom edge pinned to the anchor line → wrapped lines grow upward (usual for subtitles).',
  },
  casing: 'Case',
  cases: [
    { key: 'none', label: 'As typed' },
    { key: 'uppercase', label: 'UPPERCASE' },
    { key: 'title', label: 'Title Case' },
    { key: 'lowercase', label: 'lowercase' },
  ] as readonly Choice<'none' | 'uppercase' | 'title' | 'lowercase'>[],
  plate: 'Shape',
  plates: [
    { key: 'wrap', label: 'Per line', note: 'Each line gets its own box, as wide as that line' },
    { key: 'block', label: 'Block', note: 'One rectangle for the whole subtitle, as wide as the widest line' },
  ] as readonly Plate[],
};

export type CaptionStyleMessages = typeof captionStyle;
export const CAPTION_STYLE_COPY = defineMessages(captionStyle, { 'zh-Hans': zhCaptionStyle, 'zh-Hant': zhHantCaptionStyle, ja: jaCaptionStyle, ko: koCaptionStyle, es: esCaptionStyle, fr: frCaptionStyle, de: deCaptionStyle, nl: nlCaptionStyle, 'pt-BR': ptBRCaptionStyle, it: itCaptionStyle, ru: ruCaptionStyle, pl: plCaptionStyle, tr: trCaptionStyle, vi: viCaptionStyle });
