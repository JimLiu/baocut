import {
  defineMessages,
  DEFAULT_LOUDNESS_TARGET,
  type AudioExportFormat,
  type AudioExportSource,
  type DocumentRecord,
  type ExportScope,
  type ExportSettings,
  type Id,
  type LoudnessTarget,
  type Sequence,
  type SubtitleExportFormat,
  type TranscriptExportFormat,
} from '@baocut/protocol';
import { captionChips, languageName } from './caption-tracks.ts';
import { zhHans } from './export-settings.zh-Hans.ts';
import { zhHant } from './export-settings.zh-Hant.ts';
import { ja } from './export-settings.ja.ts';
import { ko } from './export-settings.ko.ts';
import { es } from './export-settings.es.ts';
import { fr } from './export-settings.fr.ts';
import { de } from './export-settings.de.ts';
import { nl } from './export-settings.nl.ts';
import { ptBR } from './export-settings.pt-BR.ts';
import { it } from './export-settings.it.ts';
import { ru } from './export-settings.ru.ts';
import { pl } from './export-settings.pl.ts';
import { tr } from './export-settings.tr.ts';
import { vi } from './export-settings.vi.ts';

/** 导出设置的文案（英文是键与类型的来源，译文在 `export-settings.zh-Hans.ts`）。格式名（WAV、SRT……）不进目录。 */
const en = {
  quality: { small: 'Smaller file', standard: 'Standard', high: 'High quality' } as Record<'small' | 'standard' | 'high', string>,
  qualityNote: {
    small: 'Stronger compression, slightly less detail, smaller file',
    standard: 'Default quality and size',
    high: 'More detail, larger file',
  } as Record<'small' | 'standard' | 'high', string>,
  loudnessOn: (lufs: string, truePeak: string) => `Normalize the whole mix to ${lufs} LUFS, with true peak no higher than ${truePeak} dBTP.`,
  loudnessOff: 'Off: export the mix as it is in the video.',
  audioFormatNote: {
    wav: 'Lossless · Largest file · Use this for further post-production',
    mp3: 'Universal · Works with podcast platforms, car stereos, and older devices',
    m4a: 'AAC · A little clearer than MP3 at the same bitrate · Native to Apple devices',
  } as Record<'wav' | 'mp3' | 'm4a', string>,
  dubGroup: (language: string | null) => (language ? `${language} voice-over` : 'This voice-over group'),
  mix: 'Export mix',
  mixNote: 'Same as what you hear on the timeline now',
  originalOnly: 'Original audio only',
  originalOnlyNote: 'Removes all voice-overs and restores original audio they muted',
  dubOnly: (label: string) => `${label} only`,
  dubOnlyNote: 'Keeps only this voice-over group, without the original audio, music, or other voice-overs',
  mono: 'Mono',
  stereo: 'Stereo',
  subtitleFormatNote: {
    srt: 'Universal: works with almost every player and platform',
    vtt: 'For web players, with position hints',
    ass: 'Keeps subtitle styling (font, outline, position); fewer players support it',
    json: 'Word-level timestamps for each entry, for scripts and tools',
  } as Record<'srt' | 'vtt' | 'ass' | 'json', string>,
  transcription: 'Transcript',
  plainText: 'Plain text',
  transcriptFormatNote: {
    md: 'Optional front matter, chapters as headings, speakers in bold, translations as quotes · Paste into notes or documents',
    txt: 'No formatting marks · Chapter headings get their own line',
  } as Record<'md' | 'txt', string>,
};
export type ExportSettingsMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 导出弹层各页的设置 → `exports.create` 的 `settings`（设计稿 model-export.js、model-audio-export.js、model-loudness.js、
 * model-transcript.js；架构设计 §9.13，合同见 packages/protocol/src/exports.ts）。
 *
 * 只算 Runtime 认的东西：设计稿里 Runtime 没有对应参数的（码率与体积预估、逐轨覆盖、人声分份……）不在这里，
 * 界面上置灰并写明原因。
 */

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// ---- 成片：体积档 ----

export type QualityKey = 'small' | 'standard' | 'high';

/**
 * 体积三档（设计稿 `QUALITY`）。设计稿按码率倍率算；Runtime 的成片参数是恒定质量（crf）或目标码率，这里落成 H.264 的 crf：
 * 省空间 26、标准不带（Runtime 默认 20）、高画质 16。没有码率与体积预估（Runtime 不给），说明句只写质量的取舍。
 */
export const QUALITY_CHOICES: readonly { key: QualityKey; label: string; crf: number | undefined; note: string }[] = [
  ...(
    [
      ['small', 26],
      ['standard', undefined],
      ['high', 16],
    ] as const
  ).map(([key, crf]) => ({
    key,
    crf,
    get label() {
      return M.quality[key];
    },
    get note() {
      return M.qualityNote[key];
    },
  })),
];

// ---- 成片：分辨率 ----

export interface ResolutionChoice {
  /** 短边（像素）：分辨率承诺的那条边。 */
  short: number;
  width: number;
  height: number;
  /** 「4K」「1080p」。 */
  label: string;
  /** 画布本来的尺寸（不带 `height`）。 */
  source: boolean;
}

/** 短边 → 展示名（设计稿 `resLabel`）：2160 念「4K」，其余念「{短边}p」。 */
export function resolutionLabel(short: number): string {
  return short === 2160 ? '4K' : `${short}p`;
}

const STANDARD_SHORTS = [2160, 1080, 720];

/**
 * 可选分辨率（设计稿 `resChoices`）：画布本来的尺寸排第一（默认），往下是比它小的标准档。不往上放大——
 * 放大不会让画面更清楚。宽高按画布比例、取偶数（与 Runtime 对 yuv420p 的处理一致）。
 *
 * 选了别的画幅（`ratio`）时短边照旧由档位定，长边按画幅推、取偶数（`outputSize`）；推出来超过 `exports.create` 上限
 * （宽 7680、高 4320）的档不列（例如短边大于 2430 的画布出 9:16 时，画布本来的那一档）。
 */
export function resolutionChoices(canvas: { width: number; height: number }, ratio?: RatioChoice): ResolutionChoice[] {
  const shortSide = Math.min(canvas.width, canvas.height);
  if (!(shortSide > 0)) return [];
  const scaled = (short: number, source: boolean): ResolutionChoice => {
    if (ratio) return { short, ...outputSize(short, ratio), label: resolutionLabel(short), source };
    const k = short / shortSide;
    return { short, width: source ? canvas.width : even(canvas.width * k), height: source ? canvas.height : even(canvas.height * k), label: resolutionLabel(short), source };
  };
  const all = [scaled(shortSide, true), ...STANDARD_SHORTS.filter((s) => s < shortSide).map((s) => scaled(s, false))];
  return ratio ? all.filter((c) => c.width <= MAX_OUTPUT.width && c.height <= MAX_OUTPUT.height) : all;
}

/** `exports.create` 的输出宽高上限（packages/protocol/src/schemas.ts）。 */
const MAX_OUTPUT = { width: 7680, height: 4320 };

// ---- 成片：画幅 ----

export type RatioKey = '16:9' | '9:16' | '1:1' | '4:5';

export interface RatioChoice {
  key: RatioKey;
  /** 宽 : 高。 */
  w: number;
  h: number;
}

/**
 * 换画幅导出的常用档：横屏、竖屏、方形与 4:5 竖幅（设计稿 data.js 的 `ratios` 另有 4:3、2.35:1 等、没有 4:5，这里只取这四档）。
 * 与设计稿按新画幅裁切不同，v3 换画幅是加黑边：画面按画布比例放到放得下的最大、居中，其余是黑色，排版不重排
 * （架构设计 §14「成片导出的输出比例」）。缺省「跟随画布」，不带宽高。
 */
export const RATIO_CHOICES: readonly RatioChoice[] = [
  { key: '16:9', w: 16, h: 9 },
  { key: '9:16', w: 9, h: 16 },
  { key: '1:1', w: 1, h: 1 },
  { key: '4:5', w: 4, h: 5 },
];

/** 画布能选的画幅：与画布比例相同的档不列（它就是「跟随画布」）。 */
export function ratioChoices(canvas: { width: number; height: number }): RatioChoice[] {
  return RATIO_CHOICES.filter((r) => r.w * canvas.height !== r.h * canvas.width);
}

/** 输出尺寸（v2 `dims`）：短边由分辨率定，长边按画幅推、取偶数——9:16 的 1080 是 1080×1920。 */
export function outputSize(short: number, ratio: { w: number; h: number }): { width: number; height: number } {
  const s = even(short);
  return ratio.w >= ratio.h ? { width: even((s * ratio.w) / ratio.h), height: s } : { width: s, height: even((s * ratio.h) / ratio.w) };
}

// ---- 响度（设计稿 model-loudness.js）----

export interface LoudnessForm {
  on: boolean;
  lufs: number;
  truePeak: number;
}

/** 缺省关；打开后的初值取 Runtime 的缺省目标（−16 LUFS、−1.2 dBTP）。 */
export const DEFAULT_LOUDNESS_FORM: LoudnessForm = { on: false, lufs: DEFAULT_LOUDNESS_TARGET.integratedLufs, truePeak: DEFAULT_LOUDNESS_TARGET.truePeakDb };
/** 常用档：流媒体 −14、播客 / 短视频 −16、−19、广播 EBU R128 −23、ATSC A/85 −24。 */
export const LUFS_CHOICES = [-14, -16, -19, -23, -24];
export const TRUE_PEAK_CHOICES = [-1, -1.2, -1.5, -2];

/** 排版减号（U+2212），一位小数只在需要时出现：−16、−1.5。 */
export function formatDb(value: number): string {
  const n = Math.round(value * 10) / 10;
  return `${n < 0 ? '−' : ''}${Math.abs(n)}`;
}

/** 下拉里的档：当前值不在常用档里时补进去，从大到小排。 */
export function dbChoices(list: readonly number[], value: number): number[] {
  return [...new Set([...list, value])].sort((a, b) => b - a);
}

export function loudnessTarget(form: LoudnessForm): LoudnessTarget | undefined {
  return form.on ? { integratedLufs: form.lufs, truePeakDb: form.truePeak } : undefined;
}

export function loudnessNote(form: LoudnessForm): string {
  return form.on ? M.loudnessOn(formatDb(form.lufs), formatDb(form.truePeak)) : M.loudnessOff;
}

// ---- 成片 ----

export interface VideoForm {
  quality: QualityKey;
  /** 选的短边；null 是画布本来的尺寸。 */
  short: number | null;
  /** 换的画幅；null 是跟随画布。 */
  ratio: RatioKey | null;
  burnCaptions: boolean;
  /** 画不出来的内容：默认拒绝；被拒后用户选「跳过它们再导」时是 `skip`。 */
  onUnsupported: 'fail' | 'skip';
  /** 成片的声音来源（与音频导出相同，只换声音，画面照旧）。 */
  source: AudioSourceKey;
}

export const DEFAULT_VIDEO_FORM: VideoForm = {
  quality: 'standard',
  short: null,
  ratio: null,
  burnCaptions: true,
  onUnsupported: 'fail',
  source: 'mix',
};

/** 表单里的画幅落到这块画布上：跟随画布或与画布同比例时是 undefined。 */
export function videoRatio(form: Pick<VideoForm, 'ratio'>, canvas: { width: number; height: number }): RatioChoice | undefined {
  return ratioChoices(canvas).find((r) => r.key === form.ratio);
}

export function videoSettings(form: VideoForm, canvas: { width: number; height: number }, scope: ExportScope, loudness: LoudnessForm): ExportSettings {
  const ratio = videoRatio(form, canvas);
  const choices = resolutionChoices(canvas, ratio);
  const choice = choices.find((c) => c.short === form.short) ?? (ratio ? choices[0] : undefined);
  const crf = QUALITY_CHOICES.find((q) => q.key === form.quality)?.crf;
  const target = loudnessTarget(loudness);
  return {
    kind: 'video',
    format: 'mp4',
    ...scope,
    // 换画幅时宽高都给（引擎加黑边）；只换分辨率时只给高，宽按画布比例。
    ...(ratio && choice ? { width: choice.width, height: choice.height } : choice && !choice.source ? { height: choice.height } : {}),
    ...(crf !== undefined ? { crf } : {}),
    burnCaptions: form.burnCaptions,
    ...(form.source !== 'mix' ? { source: audioSource(form.source) } : {}),
    ...(form.onUnsupported === 'skip' ? { onUnsupported: 'skip' as const } : {}),
    ...(target ? { audio: { loudness: target } } : {}),
  };
}

// ---- 音频（设计稿 model-audio-export.js）----

export const AUDIO_FORMATS: readonly { key: AudioExportFormat; label: string; lossless: boolean; note: string }[] = [
  ...(
    [
      ['wav', 'WAV', true],
      ['mp3', 'MP3', false],
      ['m4a', 'M4A', false],
    ] as const
  ).map(([key, label, lossless]) => ({
    key,
    label,
    lossless,
    get note() {
      return M.audioFormatNote[key];
    },
  })),
];
export const BITRATES = [128, 192, 320];
export const DEFAULT_BITRATE = 192;

/** 一组配音：实例 `extensions['baocut.dub']` 带同一个 `groupId`、没有 `stem`（分离出的背景带 `stem`，不算配音本体）。 */
export interface DubGroup {
  groupId: string;
  language: string | null;
  /** 「English 配音」。 */
  label: string;
  items: number;
}

export function dubGroups(sequence: Sequence): DubGroup[] {
  const groups = new Map<string, DubGroup>();
  for (const item of sequence.items) {
    const mark = item.extensions?.['baocut.dub'] as { groupId?: unknown; language?: unknown; stem?: unknown } | undefined;
    if (!mark || typeof mark !== 'object' || typeof mark.groupId !== 'string' || mark.stem !== undefined) continue;
    const language = typeof mark.language === 'string' ? mark.language : null;
    const known = groups.get(mark.groupId);
    if (known) known.items += 1;
    else groups.set(mark.groupId, { groupId: mark.groupId, language, label: M.dubGroup(language ? languageName(language) : null), items: 1 });
  }
  return [...groups.values()];
}

/** 快速选择（设计稿 `presets`）：成片混音 / 只要原声 / 每组配音各一档。「只要音乐」Runtime 没有对应的声音来源，置灰。 */
export type AudioSourceKey = 'mix' | 'original' | `dub:${string}`;

export interface AudioSourceChoice {
  key: AudioSourceKey;
  label: string;
  note: string;
}

export function audioSourceChoices(groups: readonly DubGroup[]): AudioSourceChoice[] {
  return [
    { key: 'mix', label: M.mix, note: M.mixNote },
    ...(groups.length ? [{ key: 'original' as const, label: M.originalOnly, note: M.originalOnlyNote }] : []),
    ...groups.map((g) => ({ key: `dub:${g.groupId}` as const, label: M.dubOnly(g.label), note: M.dubOnlyNote })),
  ];
}

export function audioSource(key: AudioSourceKey): AudioExportSource {
  return key === 'mix' || key === 'original' ? key : { dubGroupId: key.slice('dub:'.length) };
}

export interface AudioForm {
  format: AudioExportFormat;
  bitrate: number;
  channels: 1 | 2;
  source: AudioSourceKey;
}

export const DEFAULT_AUDIO_FORM: AudioForm = { format: 'mp3', bitrate: DEFAULT_BITRATE, channels: 2, source: 'mix' };

/** WAV 不接受码率；混音（缺省来源）不带 `source`。 */
export function audioSettings(form: AudioForm, scope: ExportScope, loudness: LoudnessForm): ExportSettings {
  const target = loudnessTarget(loudness);
  return {
    kind: 'audio',
    format: form.format,
    ...scope,
    ...(form.source !== 'mix' ? { source: audioSource(form.source) } : {}),
    channels: form.channels,
    ...(form.format !== 'wav' ? { bitrateKbps: form.bitrate } : {}),
    ...(target ? { loudness: target } : {}),
  };
}

export function audioQualityLine(form: AudioForm): string {
  const channels = form.channels === 1 ? M.mono : M.stereo;
  return form.format === 'wav' ? `48 kHz · 16-bit · ${channels}` : `${form.bitrate} kbps · ${channels}`;
}

// ---- 字幕 ----

export const SUBTITLE_FORMATS: readonly { key: SubtitleExportFormat; label: string; note: string }[] = [
  ...(
    [
      ['srt', 'SRT'],
      ['vtt', 'VTT'],
      ['ass', 'ASS'],
      ['json', 'JSON'],
    ] as const
  ).map(([key, label]) => ({
    key,
    label,
    get note() {
      return M.subtitleFormatNote[key];
    },
  })),
];

/** 「导哪几条」的一行：一份字幕文档（同一份文档在几条轨上只算一行）。 */
export interface SubtitleLane {
  documentId: Id;
  /** 「原文」或语言名（与字幕轨条同一个叫法）。 */
  label: string;
  /** 文档名。 */
  name: string;
  kind: 'original' | 'translation' | 'speech';
  language: string | null;
  /** 时间轴上开着（有启用的实例、轨道没被停用）。 */
  shown: boolean;
}

/** 时间轴上的字幕文档；一条字幕轨都没有时退回转写文档（`speech`），Runtime 会把它投影到时间线上。 */
export function subtitleLanes(sequence: Sequence, documents: Record<Id, DocumentRecord>): SubtitleLane[] {
  const lanes: SubtitleLane[] = [];
  for (const chip of captionChips(sequence, documents)) {
    const known = lanes.find((l) => l.documentId === chip.documentId);
    if (known) {
      known.shown ||= chip.state === 'on';
      continue;
    }
    lanes.push({ documentId: chip.documentId, label: chip.label, name: chip.name, kind: chip.kind, language: documents[chip.documentId]?.language ?? null, shown: chip.state === 'on' });
  }
  if (lanes.length) return [...lanes.filter((l) => l.kind === 'original'), ...lanes.filter((l) => l.kind !== 'original')];
  return Object.values(documents)
    .filter((d) => d.kind === 'speech')
    .map((d) => ({ documentId: d.id, label: M.transcription, name: d.name, kind: 'speech' as const, language: d.language ?? null, shown: false }));
}

/** 打开时勾上时间轴上开着的；一条都没开时勾第一条。 */
export function initialSubtitlePick(lanes: readonly SubtitleLane[]): Id[] {
  const shown = lanes.filter((l) => l.shown).map((l) => l.documentId);
  return shown.length ? shown : lanes.slice(0, 1).map((l) => l.documentId);
}

export type SubtitleBlock = 'none' | 'too-many' | 'each';

export interface SubtitlePlan {
  /** 发给 Runtime 的文档参数；不能导时为 null。 */
  options: { documentId: Id; bilingual?: { documentId: Id } } | null;
  block: SubtitleBlock | null;
}

/**
 * 勾选 → 文档参数。一次导出只出一份字幕文件：一条是它自己；两条且「合成一份」是双语（原文在前）；
 * 两条「各出一份」与三条以上 Runtime 一次做不了（要分几次导），置灰。
 */
export function subtitlePlan(lanes: readonly SubtitleLane[], picked: readonly Id[], merge: boolean): SubtitlePlan {
  const ordered = lanes.filter((l) => picked.includes(l.documentId));
  if (!ordered.length) return { options: null, block: 'none' };
  if (ordered.length > 2) return { options: null, block: 'too-many' };
  if (ordered.length === 2 && !merge) return { options: null, block: 'each' };
  const [first, second] = ordered as [SubtitleLane, SubtitleLane | undefined];
  return { options: { documentId: first.documentId, ...(second ? { bilingual: { documentId: second.documentId } } : {}) }, block: null };
}

export function subtitleSettings(format: SubtitleExportFormat, options: NonNullable<SubtitlePlan['options']>, scope: ExportScope): ExportSettings {
  return { kind: 'subtitles', format, ...scope, ...options };
}

// ---- 文稿（设计稿 model-transcript.js、export-transcript.jsx）----

export const TRANSCRIPT_FORMATS: readonly { key: TranscriptExportFormat; label: string; note: string }[] = [
  {
    key: 'md',
    label: 'Markdown',
    get note() {
      return M.transcriptFormatNote.md;
    },
  },
  {
    key: 'txt',
    get label() {
      return M.plainText;
    },
    get note() {
      return M.transcriptFormatNote.txt;
    },
  },
];

/** 文稿的一份来源：转写（或时间轴上的字幕），连同派生自它的译文。 */
export interface TranscriptSource {
  documentId: Id;
  name: string;
  language: string | null;
  translations: { documentId: Id; language: string | null; label: string }[];
}

/**
 * 能出文稿的文档：先看转写（`speech`），没有时看时间轴上启用的字幕（与 Runtime 选文稿主文档的顺序一致）。
 * 译文（`translation`）只能作双语的另一份，不能单独成稿——Runtime 的主文档只认转写与字幕。
 */
export function transcriptSources(sequence: Sequence, documents: Record<Id, DocumentRecord>): TranscriptSource[] {
  const all = Object.values(documents);
  const speech = all.filter((d) => d.kind === 'speech');
  const shown = [
    ...new Set(sequence.items.filter((i) => i.type === 'caption' && i.enabled).map((i) => (i as { documentId: Id }).documentId)),
  ]
    .map((id) => documents[id])
    .filter((d): d is DocumentRecord => !!d);
  const primaries = speech.length ? speech : shown;
  return primaries.map((d) => ({
    documentId: d.id,
    name: d.name,
    language: d.language ?? null,
    translations: all
      .filter((t) => t.kind === 'translation' && t.sourceDocumentId === d.id)
      .map((t) => ({ documentId: t.id, language: t.language ?? null, label: t.language ? languageName(t.language) : t.name })),
  }));
}

export interface TranscriptForm {
  documentId: Id | null;
  /** 双语对照的译文；null 是只出原文。 */
  translationId: Id | null;
  format: TranscriptExportFormat;
  timestamps: boolean;
  /** 文首元信息：只有 Markdown 写，纯文本时不带。 */
  frontmatter: boolean;
  /** 章节小标题：视频没有章节标记时由界面关掉。 */
  chapters: boolean;
  speakers: boolean;
  /** 跳过剪掉的部分；关掉时是剪之前的整份原文，时间按素材算。 */
  skipCut: boolean;
}

/** 只带与协议默认值（文首、章节、时间戳关；说话人、跳过剪掉的部分开）不同的选项。 */

export function transcriptSettings(form: TranscriptForm, documentId: Id, scope: ExportScope): ExportSettings {
  return {
    kind: 'transcript',
    format: form.format,
    ...scope,
    documentId,
    ...(form.translationId ? { bilingual: { documentId: form.translationId } } : {}),
    ...(form.timestamps ? { timestamps: true } : {}),
    ...(form.frontmatter && form.format === 'md' ? { frontmatter: true } : {}),
    ...(form.chapters ? { chapters: true } : {}),
    ...(form.speakers ? {} : { speakers: false }),
    ...(form.skipCut ? {} : { skipCut: false }),
  };
}

// ---- 工程 ----

export type ProjectTarget = 'xmeml' | 'portable';

export function projectSettings(target: ProjectTarget, missingAssets: 'fail' | 'skip'): ExportSettings {
  return target === 'portable'
    ? { kind: 'portable', ...(missingAssets === 'skip' ? { missingAssets: 'skip' as const } : {}) }
    : { kind: 'project', format: 'xmeml' };
}

// ---- 文件名 ----

/** 与 Runtime 同一个规则（export-publish.ts `safeFileStem`）：去掉文件名里不能用的字符，空了叫 video。 */
export function safeFileStem(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120);
  return cleaned || 'video';
}

/**
 * 提交前的预计文件名（Runtime 的默认命名，见 `ExportDestination`）：「视频名.种类后缀.扩展名」，成片没有后缀，
 * 几段各出一份时加 `.partN`。重名时 Runtime 会再加序号，所以这只是预计；提交后改读任务记录里的文件名。
 */
export function defaultFileNames(videoName: string, settings: ExportSettings, documents: Record<Id, DocumentRecord>): string[] {
  const stem = safeFileStem(videoName);
  if (settings.kind === 'portable') return [`${stem}.baocut`];
  if (settings.kind === 'project') return [`${stem}.xmeml.xml`];
  let suffix = '';
  if (settings.kind === 'audio') suffix = 'audio';
  else if (settings.kind === 'transcript') suffix = 'transcript';
  else if (settings.kind === 'subtitles') {
    const primary = settings.documentId ? documents[settings.documentId]?.language : undefined;
    const secondaryId = typeof settings.bilingual === 'object' ? settings.bilingual.documentId : undefined;
    const secondary = secondaryId ? documents[secondaryId]?.language : undefined;
    suffix = primary ? (secondary ? `${primary}-${secondary}` : primary) : 'subtitles';
  }
  const base = suffix ? `${stem}.${suffix}` : stem;
  const parts = settings.ranges?.length ?? 0;
  if (parts > 1) return Array.from({ length: parts }, (_, i) => `${base}.part${i + 1}.${settings.format}`);
  return [`${base}.${settings.format}`];
}

// ---- 音频：每种配音各一份（设计稿 export-audio.jsx「人声分几份」、model-audio-export.js `voiceParts` / `audioFiles`）----

/** 「人声分几份」：`one` 按快速选择混成一份；`each` 每组配音各出一份（每份一次 `exports.create`）。 */
export type VoiceSplit = 'one' | 'each';

/** 每种一份里的一份：一组配音、它的导出设置与文件名。 */
export interface DubPart {
  groupId: string;
  label: string;
  settings: ExportSettings;
  /**
   * 只出一个文件时给的固定文件名（`视频名.audio.<语言>.<扩展名>`），一眼看出是哪种配音；Runtime 的默认命名不带配音组。
   * 范围是几段各出一份时 `destination.fileName` 用不了（会套到每一段上），为 null，按 Runtime 的默认命名编号。
   */
  fileName: string | null;
}

/** 文件名里的配音标签：语言代码；没有语言的按位置叫 dub1、dub2；撞了的加 -2、-3。 */
export function dubTags(groups: readonly Pick<DubGroup, 'language'>[]): string[] {
  const seen = new Map<string, number>();
  return groups.map((g, i) => {
    const base = g.language ? safeFileStem(g.language) : `dub${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}-${n}` : base;
  });
}

/**
 * 每组配音各一份：来源是 `{ dubGroupId }`——只有这一组配音，原声、音乐、别的配音与分离出的背景声都不进
 * （设计稿里每份还带自己的背景声和音乐，Runtime 的声音来源表达不了）。
 */
export function dubParts(groups: readonly DubGroup[], form: AudioForm, scope: ExportScope, loudness: LoudnessForm, videoName: string): DubPart[] {
  const tags = dubTags(groups);
  const single = !(scope.ranges && scope.ranges.length > 1);
  const stem = safeFileStem(videoName);
  return groups.map((g, i) => ({
    groupId: g.groupId,
    label: g.label,
    settings: audioSettings({ ...form, source: `dub:${g.groupId}` }, scope, loudness),
    fileName: single ? `${stem}.audio.${tags[i]}.${form.format}` : null,
  }));
}
