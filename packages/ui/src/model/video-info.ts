import { live, type AssetRecord, type DocumentRecord, type Id, type Provenance, type Sequence, type SpaceEntry } from '@baocut/protocol';
import { durationSeconds, formatFps } from './editor.ts';
import { assetFilePath } from './editor-ops.ts';
import { formatClock } from './format.ts';
import { measureText } from './space.ts';
import { readSpeechWords } from './speech-cues.ts';
import { transcriptParagraphs, transcriptWords } from './transcript-cut.ts';
import { M } from './video-info-copy.ts';

/**
 * 视频详情框（设计稿 project-info.jsx、model-project-info.js）的行装配。纯函数，不碰 React 与 Runtime。
 *
 * 两个入口共用同一份分区行：编辑器顶栏标题旁的 ⓘ，与 Space 视频卡 / 行的「视频详情…」。渲染与「复制全部」也共用同一份——
 * 屏幕上看得见的每一行都能原样粘出去，复制文本里也不出现屏幕上没有的行。
 *
 * 照设计稿的三条语义：
 * 1. 缺的行整行省略，不写占位；三项内容计数全 0 时「内容」行不出；空分区连标题一起丢。
 * 2. 内容与译文只有编辑器那条路给得出（要读已打开视频的文稿），是调用方传进来的 `extras`；Space 那条路只有条目记录。
 * 3. 省略号只进眼睛不进剪贴板：hero 的文件名显示时中间省略，复制走完整值，「位置」行始终是完整路径。
 *
 * 与设计稿的出入：
 * - 没有「播放量」：链接导入记下的来源元数据里没有这一项。
 * - 「网址」是「来源信息」里的只读行（链接导入记下的原网页），不是可编辑的表单项；简介、备注没有地方存，界面置灰写明原因，
 *   也就不进「复制全部」（设计稿的「详情」一段）。
 * - 来源种类按素材记下的 `provenance.origin` 写，认不出的种类不写；设计稿的「录制」现在没有对应的来源。
 * - 设计稿的「位置」是源文件；这里「位置」是视频目录，主素材是链接的原文件时另有一行「源文件」（从网址下载的在下载目录里，
 *   不在视频旁边）。两行都带 `reveal`：桌面端在行尾放「在文件夹中显示」。收进视频目录的素材由 BaoCut 管理，没有这一行。
 *
 * 「来源信息」里的原标题与原简介是下载时记下的平台原文（`provenance.source.title`、`description`）：原标题与视频名一样时省略
 * （hero 已经写着）；原简介可以很长，标 `long`，框里限高滚动，复制仍是全文。
 */

export interface InfoRow {
  label: string;
  value: string;
  /** 路径、ID、网址这类用等宽字。 */
  mono: boolean;
  /** 磁盘上的位置：行尾放「在文件夹中显示」（能交给系统文件管理器时）。 */
  reveal?: string;
  /** 长文本（原简介）：限高滚动。 */
  long?: boolean;
}

export interface InfoSection {
  title: string;
  rows: InfoRow[];
}

/** hero 第二行（源文件名）在对话框里放得下的字符数。 */
export const HERO_NAME_MAX = 56;

/** 两个分区的标题：「来源与媒体」「来源信息」。 */
export const VIDEO_INFO_SECTION: { media: string; source: string } = live(() => M.section);

const row = (label: string, value: string, mono = false, extra: Pick<InfoRow, 'reveal' | 'long'> = {}): InfoRow => ({ label, value, mono, ...extra });

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 中间省略：留头留尾砍中段——尾巴留住扩展名，头部留住能认出是谁。按字符（不是 UTF-16 码元）数。 */
export function elideMiddle(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max || max < 4) return value;
  const tail = Math.floor((max - 1) / 3);
  const head = max - 1 - tail;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}

/** `20260420` → `2026-04-20`；不是八位数字就是 null（整行不出，不猜格式）。 */
export function prettyDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
}

/** 「内容」一行：`3 位说话人 · 4 章 · 62 段`。为 0 的项省略，全 0 时整行缺席。 */
export function contentsRow(speakers: number, chapters: number, paragraphs: number): InfoRow | null {
  const parts: string[] = [];
  if (speakers > 0) parts.push(M.speakers(speakers));
  if (chapters > 0) parts.push(M.chapters(chapters));
  if (paragraphs > 0) parts.push(M.paragraphs(paragraphs));
  return parts.length ? row(M.row.contents, parts.join(' · ')) : null;
}

/** 「译文」一行：各份译文的目标语，用「、」连。没有译文时缺席。 */
export function translationRow(targets: readonly string[]): InfoRow | null {
  const names = targets.map((t) => t.trim()).filter(Boolean);
  return names.length ? row(M.row.translation, M.list(names)) : null;
}

/** 来源种类（素材的 `provenance.origin`）。认不出的种类返回 null，不猜。 */
export function sourceKindLabel(origin: string | null | undefined): string | null {
  switch (origin) {
    case 'link-import':
    case 'user-import':
    case 'generated':
    case 'library':
      return M.sourceKind[origin];
    default:
      return null;
  }
}

export interface HeroSource {
  /** 来源种类：网址导入、本地文件……认不出时 null。 */
  kind: string | null;
  /** 导入时的原文件名（完整值）。 */
  fileName: string | null;
}

/** hero 那行的复制形态：`本地文件 · talk.mp4`。缺的那半边省掉，两边都缺时 null。 */
export function heroLine(source: HeroSource | null): string | null {
  if (!source) return null;
  return [source.kind, source.fileName?.trim()].filter(Boolean).join(' · ') || null;
}

/** 链接导入记下的来源元数据（`provenance.source`），逐项放行。 */
export interface LinkFacts {
  /** 平台上的标题（下载时记下的，视频改名后不变）。 */
  title: string | null;
  /** 平台上的简介原文。 */
  description: string | null;
  uploader: string | null;
  /** 发布日期，`YYYY-MM-DD`。 */
  published: string | null;
  platform: string | null;
  /** 平台上的视频 ID。 */
  mediaId: string | null;
  /** 原网页（没有时用下载用的链接）。 */
  url: string | null;
}

export function linkFacts(provenance: Pick<Provenance, 'origin' | 'source'> | null | undefined): LinkFacts | null {
  if (provenance?.origin !== 'link-import' || !isObject(provenance.source)) return null;
  const s = provenance.source;
  return {
    title: str(s.title),
    description: str(s.description),
    uploader: str(s.uploader),
    published: prettyDate(s.uploadDate),
    platform: str(s.platform),
    mediaId: str(s.mediaId),
    url: str(s.webpageUrl) ?? str(s.url),
  };
}

/**
 * 转写用的模型（`baocut.speech/1` 的 `engine`）：在线模型写模型 ID，本机模型写模型包（没有包时写模型族）。旧项目导入的正文
 * 形状不一，认不出时 null。
 */
export function speechModel(body: unknown): string | null {
  if (!isObject(body)) return null;
  const engine = body.engine;
  if (typeof engine === 'string') return str(engine);
  if (!isObject(engine)) return null;
  const asr = isObject(engine.models) && isObject(engine.models.asr) ? engine.models.asr : null;
  if (engine.backend === 'online') return str(asr?.revision) ?? str(engine.provider);
  return str(engine.bundleId) ?? str(asr?.family) ?? str(engine.model) ?? str(engine.provider);
}

/** 只读区要的事实。缺的一律 null，对应的行整行省略。 */
export interface VideoInfoFacts {
  title: string;
  source: HeroSource | null;
  /** 视频目录的完整路径。 */
  location: string | null;
  /** 主素材的原文件（链接的素材才有；收进视频目录的由 BaoCut 管理，不给路径）。 */
  file?: string | null;
  /** `时长 · 分辨率 · 帧率`（Space 那条路只有时长与分辨率）。 */
  media: string | null;
  /** `模型 · 语言`。 */
  transcript: string | null;
  link: LinkFacts | null;
}

export interface SnapshotInput {
  title: string;
  location: string | null;
  sequence: Sequence | null;
  /** 时间线上放着的视频与音频，按第一次出现的先后（`mediaCandidates`）；第一个当作主素材。 */
  candidates: readonly { asset: AssetRecord; speech: DocumentRecord | null }[];
  /** 第一份转写（第一个有转写的素材）的正文；还没取到时 undefined。 */
  speechBody: unknown;
  /** 语言标签 → 名字（`langName`）；测试里注入，免得依赖运行环境的 Intl。 */
  languageName: (tag: string) => string;
}

/** 编辑器那条路：从打开的视频快照装配。 */
export function snapshotFacts(input: SnapshotInput): VideoInfoFacts {
  const { sequence, candidates } = input;
  const main = candidates[0]?.asset ?? null;
  const provenance = main?.revisions[main.currentRevision]?.provenance ?? null;
  const source: HeroSource | null = main
    ? { kind: sourceKindLabel(provenance?.origin), fileName: str(provenance?.importedFrom?.originalName) ?? str(main.name) }
    : null;
  const media = sequence
    ? [formatClock(durationSeconds(sequence), { tenths: true }), `${sequence.canvas.width}×${sequence.canvas.height}`, formatFps(sequence.fps)].join(' · ')
    : null;
  const speech = candidates.find((c) => c.speech)?.speech ?? null;
  const transcript = speech
    ? [speechModel(input.speechBody), speech.language ? input.languageName(speech.language) : null].filter(Boolean).join(' · ') || null
    : null;
  const file = main ? assetFilePath(main, input.location) : null;
  return { title: input.title, source, location: input.location, file, media, transcript, link: linkFacts(provenance) };
}

/** Space 那条路：手上只有条目记录，不为详情框打开视频。没有的行省略。 */
export function entryFacts(entry: Pick<SpaceEntry, 'kind' | 'media'>, title: string, location: string | null): VideoInfoFacts {
  return { title, source: null, location, media: measureText(entry), transcript: null, link: null };
}

export interface ContentCounts {
  speakers: number;
  chapters: number;
  paragraphs: number;
}

/**
 * 内容计数，口径与文稿面板一致：说话人按每份转写里出现过的说话人数相加，段落按文稿面板的分段相加，章节是序列上的章节标记。
 * 正文还没取到的转写先不计。
 */
export function contentCounts(sequence: Sequence, sources: readonly { assetId: Id; body: unknown }[]): ContentCounts {
  let speakers = 0;
  let paragraphs = 0;
  for (const source of sources) {
    const read = source.body === undefined ? null : readSpeechWords(source.body);
    if (!read) continue;
    const words = transcriptWords(sequence, source.assetId, read.words);
    speakers += new Set(words.flatMap((w) => (w.speaker === undefined ? [] : [w.speaker]))).size;
    paragraphs += transcriptParagraphs(words).length;
  }
  const chapters = sequence.markers.filter((m) => m.kind === 'chapter').length;
  return { speakers, chapters, paragraphs };
}

/** 各份译文的目标语（去重，按出现的先后）。 */
export function translationTargets(documents: Record<Id, DocumentRecord>, languageName: (tag: string) => string): string[] {
  const tags: string[] = [];
  for (const record of Object.values(documents)) {
    if (record.kind === 'translation' && record.language && !tags.includes(record.language)) tags.push(record.language);
  }
  return tags.map(languageName);
}

/** 编辑器那条路多出来的两行，顺序即渲染顺序。 */
export function editorExtras(counts: ContentCounts, targets: readonly string[]): InfoRow[] {
  return [contentsRow(counts.speakers, counts.chapters, counts.paragraphs), translationRow(targets)].filter((r): r is InfoRow => r !== null);
}

/** 只读区的全部分区。`extras` 接在「来源与媒体」的尾巴上；空分区整个丢掉。 */
export function sections(facts: VideoInfoFacts, extras: readonly InfoRow[] = []): InfoSection[] {
  const media: InfoRow[] = [];
  if (facts.location) media.push(row(M.row.location, facts.location, true, { reveal: facts.location }));
  if (facts.file) media.push(row(M.row.file, facts.file, true, { reveal: facts.file }));
  if (facts.media) media.push(row(M.row.media, facts.media));
  if (facts.transcript) media.push(row(M.row.transcript, facts.transcript));
  media.push(...extras);

  const link = facts.link;
  const meta: InfoRow[] = [];
  if (link?.title && link.title !== facts.title.trim()) meta.push(row(M.row.title, link.title));
  if (link?.uploader) meta.push(row(M.row.channel, link.uploader));
  if (link?.published) meta.push(row(M.row.published, link.published));
  if (link?.platform) meta.push(row(M.row.platform, link.platform));
  if (link?.mediaId) meta.push(row(M.row.mediaId, link.mediaId, true));
  if (link?.url) meta.push(row(M.row.url, link.url, true));
  if (link?.description) meta.push(row(M.row.description, link.description, false, { long: true }));

  return [
    { title: VIDEO_INFO_SECTION.media, rows: media },
    { title: VIDEO_INFO_SECTION.source, rows: meta },
  ].filter((s) => s.rows.length > 0);
}

/** 一段可直接粘贴的纯文本：标题、hero 各一行，分区之间空一行，值内换行缩进两格。 */
export function copyText(title: string, hero: string | null, list: readonly InfoSection[]): string {
  const lines: string[] = [];
  if (title.trim()) lines.push(title.trim());
  if (hero?.trim()) lines.push(hero.trim());
  for (const section of list) {
    lines.push('', section.title);
    for (const r of section.rows) lines.push(`${r.label}: ${r.value.replace(/\n/g, '\n  ')}`);
  }
  return `${lines.join('\n')}\n`;
}
