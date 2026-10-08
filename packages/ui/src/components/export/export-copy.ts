import { defineMessages, intlLocale } from '@baocut/protocol';
import { revealLabel } from '../../copy.ts';
import { zhHans } from './export-copy.zh-Hans.ts';
import { zhHant } from './export-copy.zh-Hant.ts';
import { ja } from './export-copy.ja.ts';
import { ko } from './export-copy.ko.ts';
import { es } from './export-copy.es.ts';
import { fr } from './export-copy.fr.ts';
import { de } from './export-copy.de.ts';
import { nl } from './export-copy.nl.ts';
import { ptBR } from './export-copy.pt-BR.ts';
import { it } from './export-copy.it.ts';
import { ru } from './export-copy.ru.ts';
import { pl } from './export-copy.pl.ts';
import { tr } from './export-copy.tr.ts';
import { vi } from './export-copy.vi.ts';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const list = (labels: readonly string[]) => new Intl.ListFormat(intlLocale('en'), { type: 'conjunction' }).format(labels);

/**
 * 导出弹层的文案（设计稿 export.jsx、export-range.jsx、export-audio.jsx、export-loudness.jsx、export-transcript.jsx、
 * export-project.jsx）。设计稿里 Runtime 做不到的，置灰并照实说一句原因（与 tools-gallery.ts 的 `plannedReason` 同一个说法）。
 * 英文是键与类型的来源，译文在 `export-copy.<语言>.ts`。
 */
const en = {
  title: 'Export',
  button: 'Export',
  buttonBusyTitle: 'Exporting · open to see progress or cancel',
  tabsLabel: 'What to export',

  // ---- 通用 ----
  cancel: 'Cancel',
  close: 'Close',
  done: 'Done',
  again: 'Export another',
  resetup: 'Change settings',
  retry: 'Try again',
  get reveal() {
    return revealLabel();
  },
  file: 'File',
  files: 'Files',
  more: 'More',
  moreFiles: (n: number) => count(n, 'file', 'files'),
  moreItems: (n: number) => `${n} more`,
  willExport: 'Will export',
  estimate: 'Estimate',
  noEstimate: 'Time and size estimates aren’t available in this version yet',
  place: 'Location',
  defaultPlace: 'exports/ in the project',
  pickPlace: 'Choose location',
  resetPlace: 'Use default location',
  pickFailed: (message: string) => `Couldn’t choose a location: ${message}`,
  submitting: 'Submitting…',
  notOpen: 'The video isn’t fully open yet, so it can’t be exported',

  // ---- 运行态 ----
  running: 'Exporting',
  queued: 'Queued for export',
  cancelling: 'Cancelling…',
  keepsRunning: 'The export keeps going if you close this window ·',
  goTasks: 'Go to Background tasks',
  cancelExport: 'Cancel export',
  cancelConfirm: 'Cancel this export?',
  cancelConfirmBody: 'Unfinished files will be deleted; the video itself isn’t affected. Files that are already being saved can’t be stopped and will finish saving.',
  keepExporting: 'Keep exporting',
  cancelFailed: (message: string) => `Couldn’t cancel: ${message}`,
  plannedFiles: (first: string, n: number) => `${first} and ${n - 1} more`,

  // ---- 完成 / 取消 / 失败 ----
  exported: 'Exported',
  exportedToast: (name: string) => `Export finished · ${name}`,
  failedToast: (title: string) => `Export failed · ${title}`,
  interruptedToast: (title: string) => `Export interrupted · ${title}`,
  view: 'View',
  waiting: 'Submitted, waiting for the task to appear…',
  warnings: 'Export notes',
  moreWarnings: (n: number) => `${n} more · see them all in Background tasks`,
  cancelled: 'Export cancelled',
  interrupted: 'The export was interrupted',
  interruptedBody: 'Runtime stopped or restarted before this export finished. It won’t resume; export again if you still need it.',
  partial: 'Files already saved',
  pickDirAndRetry: 'Export to another location',
  skipUnsupported: 'Skip them and export again',
  skipMissing: 'Skip missing assets and export again',
  useDocument: (name: string) => `Use “${name}”`,

  // ---- 范围（export-range.jsx）----
  range: 'Range',
  rangeChapters: 'Chapters',
  rangeClips: 'Clips',
  pickChapters: 'Check chapters; adjacent ones are joined into one part',
  pickClips: 'Check clips; adjacent ones are joined into one part',
  noChapters: 'This sequence has no chapter markers yet',
  noClips: 'No enabled video clips on the timeline yet',
  selectAll: 'Select all',
  clear: 'Clear',
  start: 'Start',
  end: 'End',
  startLabel: 'Start timecode',
  endLabel: 'End timecode',
  takeNow: 'Use playhead',
  takeNowHint: 'Use the editor’s playhead position',
  length: (text: string) => `Total ${text}`,
  multi: 'Multiple parts',
  mergeOne: 'Combine into one',
  eachOne: 'One file each',
  eachNote: 'One file per part',
  mergeBlocked: 'Joining non-adjacent parts into one file isn’t available in this version yet; each part is exported as its own file',

  // ---- 视频页 ----
  quality: 'Quality & size',
  resolution: 'Resolution',
  sourceResolution: 'Original resolution',
  ratio: 'Aspect ratio',
  followCanvas: 'Match canvas',
  letterboxedTo: (ratio: string) => `${ratio} letterboxed`,
  letterboxNote: 'Changing the aspect ratio doesn’t crop: the picture is scaled up at its own ratio and centered, with black bars around it; layouts in the picture aren’t rearranged for the new ratio',
  size: 'Size',
  upscaleNote: (label: string) => `Resolution goes up to the original ${label} · anything higher is only upscaled and won’t look sharper`,
  pictureLanes: 'What’s in the picture',
  burnCaptions: 'Burn subtitles into the picture',
  burnCaptionsFor: (label: string) => `Burn subtitles into the picture: ${label}`,
  burnOff: 'Not burned in this time',
  lanesNote: 'Switches follow show and mute on the timeline · per-track overrides aren’t available in this version yet, so change them on the timeline; whether subtitles are burned in can be set here on its own',
  noLanes: 'Nothing on the timeline yet',
  dubChannels: 'Voice-over audio tracks',
  dubOne: 'One track',
  dubMulti: 'One per language',
  dubPick: 'Mixed into the main track',
  dubTrackDefault: 'Default',
  dubMultiBlocked: 'One audio track per language (MP4 multi-track audio) isn’t available yet · the choice here only changes the sound of this export; the picture stays the same',
  exportMp4: 'Export MP4',
  captionsBurned: 'Subtitles burned in',
  captionsNotBurned: 'Subtitles not burned in',

  // ---- 音频页 ----
  soundLanes: 'What’s in the sound',
  quick: 'Quick pick',
  musicOnly: 'Music only',
  musicOnlyBlocked: 'Exporting music only isn’t available in this version yet; you can mute the other tracks on the timeline first',
  noSound: 'This video has no sound',
  noSoundSub: 'There are no tracks or clips with sound on the timeline',
  soundNote: 'Switches follow mute on the timeline · per-track overrides aren’t available in this version yet, so change them on the timeline',
  sourceNote: 'The source chosen above decides which sounds are mixed; the list follows the timeline',
  formatQuality: 'Format & quality',
  format: 'Format',
  bitrate: 'Bitrate',
  channels: 'Channels',
  stereo: 'Stereo',
  mono: 'Mono',
  stereoNote: 'Stereo · keeps the left–right image of the original sound and music',
  monoNoteLossless: 'Mono · half the size · enough for speech-only videos',
  monoNoteLossy: 'Mono keeps the bitrate · the whole bitrate goes to one channel, so voices sound cleaner',
  exportAudio: (format: string) => `Export ${format}`,
  // 人声分几份（设计稿 export-audio.jsx）：这一版只能按配音组分
  voiceSplit: 'Voice files',
  splitOne: 'Mix into one',
  splitEach: 'One per voice-over',
  splitNoDub: 'This video has no voice-over yet · one file per voice-over needs a voice-over',
  splitOneNote: 'Mixes the source chosen above into one file',
  splitEachNote: 'One file per voice-over group · only that voice-over, without the original sound, music or background (the only way voice-over sources export in this version) · to get the original sound, export it separately',
  splitEachRanges: 'When parts are exported separately, file names use the default name plus a number, so they don’t show which voice-over they hold',
  splitQuickOff: 'Quick pick doesn’t apply to one file per voice-over: each file’s sound follows the list below',
  dubPartSub: (items: number) => count(items, 'voice-over segment', 'voice-over segments'),
  eachFiles: (n: number) => `${count(n, 'file', 'files')} in total`,
  eachWhat: (labels: readonly string[]) => `One file each for ${list(labels)}`,
  eachStarted: (n: number) => `Submitted ${count(n, 'export', 'exports')} · the first is shown here, the rest are in Background tasks`,
  eachPartial: (done: number, left: number, reason: string) => `Submitted ${done}; the remaining ${left} weren’t exported: ${reason}`,
  exportAudioEach: (n: number, format: string) => `Export ${n} ${format} ${n === 1 ? 'file' : 'files'}`,

  // ---- 响度（export-loudness.jsx）----
  loudness: 'Loudness',
  loudnessSwitch: 'Normalize loudness',
  loudnessTarget: 'Target',
  truePeak: 'Peak ceiling',
  defaultMark: 'Default',

  // ---- 字幕页 ----
  subtitleLanes: 'Which tracks',
  subtitlesWhat: (labels: readonly string[]) => (labels.length === 2 ? `${labels.join(' + ')} bilingual` : labels.join(' + ')),
  hiddenOnTimeline: 'Disabled on the timeline',
  noSubtitles: 'No subtitles or transcription yet',
  noSubtitlesSub: 'Transcribe first, or add a subtitle track on the timeline',
  multiTrack: 'Multiple tracks',
  bilingualNote: 'Two tracks combine into one bilingual subtitle file; the first one is the main text',
  eachBlocked: 'This version exports one subtitle file at a time; to get one file each, export several times',
  tooMany: 'At most two tracks can be combined at once (bilingual); export the rest separately',
  pickOne: 'Turn on at least one',
  exportSubtitles: 'Export subtitles',

  // ---- 文稿页 ----
  language: 'Language',
  original: 'Original',
  translation: 'Translation',
  originalSwitch: (name: string) => `Original: ${name}`,
  translationSwitch: (label: string) => `Translation: ${label}`,
  transcriptPair: (source: string, translation: string) => `${source} + ${translation} side by side`,
  sourceLocked: 'The transcript is based on the original; a translation can only be the other half of a bilingual pair',
  oneTranslation: 'Only one translation at a time · turning on another replaces the current one',
  sourceDocument: 'Transcript source',
  include: 'Include',
  frontmatter: 'Front matter',
  chapters: 'Chapter headings',
  timestamps: 'Paragraph timestamps',
  speakers: 'Speakers',
  skipCut: 'Skip cut parts',
  frontmatterMdOnly: 'Front matter is only written in Markdown',
  transcriptNoChapters: 'This video has no chapters · chapter headings come from chapter markers on the timeline',
  keepCutNote: 'Includes the parts cut from the timeline · times follow the original media',
  preview: 'Preview',
  previewLoading: 'Preparing the preview…',
  transcriptLength: 'Length',
  copyText: 'Copy text',
  copied: 'Copied',
  noTranscript: 'No transcript yet',
  noTranscriptSub: 'Transcribe first, or add a subtitle track on the timeline',
  exportTranscript: 'Export transcript',

  // ---- 工程页 ----
  editors: 'Export to an editor',
  xmemlName: 'Premiere Pro / DaVinci Resolve',
  xmemlMeta: 'FCP7 XML (.xml)',
  portableName: 'BaoCut portable package',
  portableMeta: '.baocut · the video, all documents and assets in one file',
  plannedTarget: 'This project file type isn’t available in this version yet',
  jianyingName: 'Jianying draft',
  capcutFolderMeta: 'Folder · .capcut',
  bake: 'Algorithmic elements',
  bakeAuto: 'Convert to video assets (recommended)',
  bakeLossy: 'Also convert animation, masks and other lossy properties',
  bakeNone: 'Don’t convert, just drop them',
  bakeBlocked: 'Converting text, graphics and compositions into video assets isn’t available in this version yet; anything that can’t be represented is listed in the export notes',
  xmemlNote: 'The project file carries the video, images and audio on the timeline · disabled clips stay disabled · assets are referenced by absolute paths on this computer · text, graphics, subtitles, transitions and effects can’t be written and are each listed in the export notes',
  portableNote: 'The portable package leaves out local paths, keys, licenses and task records · linked assets are included too · opening it creates a new video',
  missingAssets: 'Unreadable assets',
  missingFail: 'Stop and tell me',
  missingSkip: 'Skip them and mark them missing in the list',
  exportProject: 'Export project file',
  exportPortable: 'Export portable package',
};

export type ExportMessages = typeof en;

export const EXPORT_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/** 设计稿里有、这一版还没有接上的工程目标（设计稿 model-export.js `PROJECT_TARGETS`）。 */
export const PLANNED_PROJECT_TARGETS: readonly { id: string; name: string; meta: string }[] = [
  {
    id: 'jianying',
    get name() {
      return EXPORT_COPY.jianyingName;
    },
    get meta() {
      return EXPORT_COPY.capcutFolderMeta;
    },
  },
  {
    id: 'capcut',
    name: 'CapCut',
    get meta() {
      return EXPORT_COPY.capcutFolderMeta;
    },
  },
  { id: 'final-cut-pro', name: 'Final Cut Pro', meta: '.fcpxml' },
  { id: 'shotcut', name: 'Shotcut', meta: '.mlt' },
  { id: 'kdenlive', name: 'Kdenlive', meta: '.kdenlive' },
];

/** 设计稿的算法元素三选一（对应设计稿内核 `--bake auto|lossy|none`），这一版置灰。 */
export const BAKE_POLICIES: readonly { key: string; label: string }[] = [
  {
    key: 'auto',
    get label() {
      return EXPORT_COPY.bakeAuto;
    },
  },
  {
    key: 'lossy',
    get label() {
      return EXPORT_COPY.bakeLossy;
    },
  },
  {
    key: 'none',
    get label() {
      return EXPORT_COPY.bakeNone;
    },
  },
];
