import path from 'node:path';
import { DUB_EXTENSION, EditorWasmUnavailable, sourceSentences } from '@baocut/jobs';
import {
  framesToSeconds,
  itemAssetRefs,
  localizeText,
  mediaTimeToSeconds,
  posterFrame,
  sequenceDurationFrames,
  type Id,
  type MessageRef,
  type SpaceSearchDocumentKind,
  type VideoDubGroupFact,
  type VideoSnapshot,
  type VideoTranscriptFact,
  type VideoTranslationFact,
} from '@baocut/protocol';
import type { PlannedDocument, TextEntry, TextPlan } from '../exports/export-plan.ts';
import { segmentsOf } from '../exports/text-export.ts';

/**
 * 把引擎 `videos.readContent` 的结果（快照与文字类文档）变成内容索引里的一个视频（架构设计 §5.11）：
 * 可检索的段落，以及 Space 目录派生状态要用的事实（时间线上用着哪些素材、链接的素材指向哪些文件）。纯函数，不碰磁盘。
 *
 * - 转写与字幕优先用根序列上的投影（与导出同一套句子切分，`segmentsOf`），时间是序列时间；
 *   文档对应的素材不在时间线上（投影为空或出错）时退回正文里的源时间。
 * - 译文没有时间：借用它的转写那一句的时间。`baocut.translation/2` 按 `sourceSentenceId`，找不到那一句时（转写没有存句子）
 *   按对齐的词（`alignment.sourceWordIds`）或句子 ID 里的首词（`s-<词 ID>`）；`/1` 按单元 ID。标成过期的单元不收。
 * - 章节取根序列上 `kind: 'chapter'` 的标记，标题与简介。
 */

export interface ReadContentDocument extends Partial<PlannedDocument> {
  documentId: Id;
  kind: string;
  plan?: TextPlan | null;
  planError?: { code: string; message: string };
  /** 读不出正文时引擎的英文缺省说明与它的消息引用。 */
  error?: string;
  errorRef?: MessageRef;
}

export interface ReadContentResult {
  videoId: Id;
  name: string;
  revision: string;
  snapshot: VideoSnapshot;
  documents: ReadContentDocument[];
}

export interface ContentSegment {
  kind: SpaceSearchDocumentKind;
  documentId: Id | null;
  language: string | null;
  clock: 'sequence' | 'source';
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

/** Space 目录与工具的候选输入用的视频事实。 */
export interface VideoFacts {
  /** 任何序列上的实例引用着的素材。 */
  timelineAssetIds: Id[];
  /** 链接的素材（任何版本）指向的文件：绝对路径（相对路径按视频目录解析）。 */
  linkedFiles: { assetId: Id; name: string; path: string }[];
  /** 文稿：语言、有没有逐词时间、在不在时间线上（§7.9 的候选输入）。 */
  transcripts: VideoTranscriptFact[];
  /** 译文：目标语言、译自哪份文稿、过期的单元数。 */
  translations: VideoTranslationFact[];
  /** 配音组：语言与对应的译文、文稿。 */
  dubGroups: VideoDubGroupFact[];
  /**
   * 封面取的那一帧（`posterFrame`，Space 的缩略图用）：素材版本、源时间（秒）与媒体分析要的内容摘要、媒体类型和时长；
   * 根序列上没有可见的视频片段时 null。格式版本 3 之前的缓存里没有这一项（`undefined`），等重读。
   */
  poster?: VideoPosterFact | null;
  /**
   * 根序列的时长（秒，与智能体工具的视频摘要同一个 `sequenceDurationFrames`）与画布尺寸：Space 视频条目的 `media`。
   * 快照不全时 null。格式版本 4 之前的缓存里没有这一项（`undefined`），等重读。
   */
  timeline?: VideoTimelineFact | null;
}

export interface VideoTimelineFact {
  durationSec: number;
  width: number;
  height: number;
}

export interface VideoPosterFact {
  assetId: Id;
  revision: string;
  at: number;
  contentHash: string;
  mediaType: string;
  durationSec: number | null;
}

export interface ExtractedContent {
  segments: ContentSegment[];
  facts: VideoFacts;
  /** 读不出来的文档：ID 与原因。 */
  problems: { documentId: Id; detail: string }[];
}

interface SpeechWord {
  id: string;
  text?: string;
  start?: number;
  end?: number;
  speaker?: string;
  hidden?: boolean;
}

interface SpeechBody {
  timescale?: number;
  words?: SpeechWord[];
  sentences?: Array<{ id: string; first?: string; last?: string; wordIds?: string[] }> | null;
}

interface CaptionBody {
  timescale?: number;
  cues?: Array<{ id: string; start?: number; end?: number; text?: string; speaker?: string }>;
}

interface TranslationBody {
  schema?: string;
  units?: Array<{
    id: string;
    // baocut.translation/1
    text?: string;
    display?: string;
    // baocut.translation/2
    sourceSentenceId?: string;
    naturalText?: string;
    displayRewrite?: { text?: string } | null;
    alignment?: { sourceWordIds?: string[] } | null;
    status?: string;
  }>;
}

type TimeSpan = { clock: 'sequence' | 'source'; start: number; end: number };

export function extractContent(result: ReadContentResult, videoDir: string): ExtractedContent {
  const segments: ContentSegment[] = [];
  const problems: { documentId: Id; detail: string }[] = [];
  /** 每份转写的句子 ID → 时间，给译文用。 */
  const sentenceTimes = new Map<Id, Map<string, TimeSpan>>();
  /** 每份转写的词 ID → 时间（译文的对齐词）。 */
  const wordTimes = new Map<Id, Map<string, TimeSpan>>();
  const translations: ReadContentDocument[] = [];

  for (const doc of result.documents) {
    if (doc.error !== undefined) {
      problems.push({ documentId: doc.documentId, detail: localizeText(doc.error, doc.errorRef) });
      continue;
    }
    if (doc.schema === 'baocut.translation/1' || doc.schema === 'baocut.translation/2') {
      translations.push(doc);
      continue;
    }
    if (doc.schema !== 'baocut.speech/1' && doc.schema !== 'baocut.caption/1') continue;
    const kind: SpaceSearchDocumentKind = doc.schema === 'baocut.speech/1' ? 'speech' : 'caption';
    const document = plannedOf(doc);
    let clock: 'sequence' | 'source' = 'sequence';
    let plan = doc.plan && doc.plan.entries.length > 0 ? doc.plan : null;
    if (!plan) {
      clock = 'source';
      plan = kind === 'speech' ? sourcePlanOfSpeech(doc) : sourcePlanOfCaption(doc);
    }
    if (!plan) continue;
    let pieces;
    try {
      pieces = segmentsOf({ primary: { document, plan }, secondary: null }, []);
    } catch (error) {
      problems.push({ documentId: doc.documentId, detail: String(error) });
      continue;
    }
    const times = new Map<string, TimeSpan>();
    for (const piece of pieces) {
      const text = piece.text.trim();
      if (piece.sentenceId !== null && !times.has(piece.sentenceId))
        times.set(piece.sentenceId, { clock, start: piece.start, end: piece.end });
      if (!text) continue;
      segments.push({
        kind,
        documentId: doc.documentId,
        language: doc.language ?? null,
        clock,
        start: round(piece.start),
        end: round(piece.end),
        text,
        speaker: piece.speaker,
      });
    }
    if (kind === 'speech') {
      sentenceTimes.set(doc.documentId, times);
      const words = new Map<string, TimeSpan>();
      for (const entry of plan.entries)
        if (entry.id && !words.has(entry.id)) words.set(entry.id, { clock, start: entry.start, end: entry.end });
      wordTimes.set(doc.documentId, words);
    }
  }

  for (const doc of translations) {
    const times = doc.sourceDocumentId ? sentenceTimes.get(doc.sourceDocumentId) : undefined;
    const words = doc.sourceDocumentId ? wordTimes.get(doc.sourceDocumentId) : undefined;
    const v2 = doc.schema === 'baocut.translation/2';
    for (const unit of (doc.body as TranslationBody | null)?.units ?? []) {
      if (v2 && (unit.status === 'stale' || typeof unit.sourceSentenceId !== 'string')) continue;
      const text = (v2 ? unit.displayRewrite?.text?.trim() || unit.naturalText || '' : (unit.display ?? unit.text ?? '')).trim();
      if (!text) continue;
      const time = (v2 ? unitTime(unit.sourceSentenceId!, unit.alignment?.sourceWordIds, times, words) : times?.get(unit.id)) ?? {
        clock: 'source' as const,
        start: 0,
        end: 0,
      };
      segments.push({
        kind: 'translation',
        documentId: doc.documentId,
        language: doc.language ?? null,
        clock: time.clock,
        start: round(time.start),
        end: round(time.end),
        text,
        speaker: null,
      });
    }
  }

  const root = result.snapshot.sequences[result.snapshot.rootSequenceId];
  if (root) {
    const fps = root.fps.num / root.fps.den;
    for (const marker of root.markers ?? []) {
      if (marker.kind !== 'chapter') continue;
      const text = [marker.label, marker.summary].filter((s) => s && s.trim()).join('\n');
      if (!text) continue;
      const start = fps > 0 ? marker.frame / fps : 0;
      const end = fps > 0 && marker.durationFrames ? (marker.frame + marker.durationFrames) / fps : start;
      segments.push({
        kind: 'chapter',
        documentId: null,
        language: null,
        clock: 'sequence',
        start: round(start),
        end: round(end),
        text,
        speaker: null,
      });
    }
  }

  return {
    segments,
    facts: {
      ...factsOf(result.snapshot, videoDir),
      ...documentFacts(result),
      poster: posterOf(result.snapshot),
      timeline: timelineOf(result.snapshot),
    },
    problems,
  };
}

interface FactWord {
  id?: unknown;
  text?: unknown;
  hidden?: unknown;
  timingQuality?: unknown;
}

interface FactTranslationUnit {
  id?: unknown;
  sourceSentenceId?: unknown;
  sourceFingerprint?: unknown;
  naturalText?: unknown;
  text?: unknown;
  display?: unknown;
  status?: unknown;
}

/**
 * 文稿、译文与配音组的事实（§5.11、§7.9 的候选输入）。读的是 `videos.readContent` 已经给出的东西：文字类文档的正文与根序列上
 * 的投影、快照里的文档头与实例，不另外读视频。
 *
 * - 逐词时间：有可见的词，且没有一个词的 `timingQuality` 是 `estimated` 或 `missing`；
 * - 在时间线上：根序列上的投影有内容；
 * - 译文过期的单元按配音的规则数（标成过期、原文的句子不在了、指纹不符、译文为空），术语表改过要读用户库，这里不判断；
 *   `/1` 的译文没有指纹，只数标成过期的与空的；原文不在视频里时全部算过期；
 * - 配音组：`dubbing-plan` 文档（摘要里的 `groupId`、译自的译文）与带 `baocut.dub` 扩展的配音实例合起来。
 */
function documentFacts(result: ReadContentResult): Pick<VideoFacts, 'transcripts' | 'translations' | 'dubGroups'> {
  const records = result.snapshot.documents ?? {};
  const speechBodies = new Map<Id, unknown>();
  const transcripts: VideoTranscriptFact[] = [];
  const translations: VideoTranslationFact[] = [];
  for (const doc of result.documents) {
    if (doc.error !== undefined) continue;
    if (doc.schema === 'baocut.speech/1') {
      // 正文里的 `schema` 可能省略：文档头已经说明是转写。
      speechBodies.set(doc.documentId, doc.body && typeof doc.body === 'object' ? { schema: doc.schema, ...doc.body } : doc.body);
      const words = ((doc.body as { words?: FactWord[] } | null)?.words ?? []).filter(
        (w) => w && w.hidden !== true && typeof w.text === 'string' && w.text !== '',
      );
      transcripts.push({
        documentId: doc.documentId,
        name: doc.name ?? records[doc.documentId]?.name ?? '',
        language: doc.language ?? null,
        wordTiming: words.length > 0 && words.every((w) => w.timingQuality !== 'estimated' && w.timingQuality !== 'missing'),
        onTimeline: !!doc.plan && doc.plan.entries.length > 0,
      });
    }
  }
  for (const doc of result.documents) {
    if (doc.error !== undefined) continue;
    if (doc.schema !== 'baocut.translation/1' && doc.schema !== 'baocut.translation/2') continue;
    const body = doc.body as { units?: FactTranslationUnit[]; sourceBasis?: { speechRef?: { id?: unknown } } } | null;
    const units = Array.isArray(body?.units) ? body.units : [];
    const basis = body?.sourceBasis?.speechRef?.id;
    const sourceDocumentId = doc.sourceDocumentId ?? (typeof basis === 'string' ? basis : null);
    translations.push({
      documentId: doc.documentId,
      name: doc.name ?? records[doc.documentId]?.name ?? '',
      language: doc.language ?? null,
      sourceDocumentId,
      units: units.length,
      staleUnits: staleUnits(doc.schema === 'baocut.translation/2', units, sourceDocumentId, speechBodies),
    });
  }

  // 配音组：先从配音计划，再补上只有实例的组；实例数按组数。
  const groups = new Map<string, VideoDubGroupFact>();
  const translationSource = new Map(translations.map((t) => [t.documentId, t.sourceDocumentId]));
  for (const record of Object.values(records)) {
    if (record.kind !== 'dubbing-plan') continue;
    const summary = record.revisions?.[record.currentRevision]?.summary as { groupId?: unknown } | undefined;
    const groupId = typeof summary?.groupId === 'string' ? summary.groupId : null;
    if (!groupId) continue;
    const translationId = record.sourceDocumentId ?? null;
    groups.set(groupId, {
      groupId,
      language: record.language ?? null,
      planDocumentId: record.id,
      translationId,
      transcriptId: translationId ? (translationSource.get(translationId) ?? records[translationId]?.sourceDocumentId ?? null) : null,
      items: 0,
    });
  }
  for (const sequence of Object.values(result.snapshot.sequences)) {
    for (const item of sequence.items) {
      const extension = (item as { extensions?: Record<string, unknown> }).extensions?.[DUB_EXTENSION] as
        { groupId?: unknown; language?: unknown; stem?: unknown } | undefined;
      if (typeof extension?.groupId !== 'string' || extension.stem !== undefined) continue;
      const group = groups.get(extension.groupId) ?? {
        groupId: extension.groupId,
        language: typeof extension.language === 'string' ? extension.language : null,
        planDocumentId: null,
        translationId: null,
        transcriptId: null,
        items: 0,
      };
      group.items++;
      groups.set(extension.groupId, group);
    }
  }
  return { transcripts, translations, dubGroups: [...groups.values()] };
}

function staleUnits(v2: boolean, units: FactTranslationUnit[], sourceDocumentId: Id | null, speechBodies: Map<Id, unknown>): number {
  if (!v2) {
    return units.filter((u) => u.status === 'stale' || String(u.display ?? u.text ?? '').trim() === '').length;
  }
  const body = sourceDocumentId ? speechBodies.get(sourceDocumentId) : undefined;
  if (body === undefined) return units.length;
  const sentences = currentFingerprints(body);
  let stale = 0;
  for (const unit of units) {
    const text = typeof unit.naturalText === 'string' ? unit.naturalText.trim() : '';
    if (unit.status === 'stale' || typeof unit.sourceSentenceId !== 'string' || text === '') stale++;
    else if (sentences && sentences.get(unit.sourceSentenceId) !== unit.sourceFingerprint) stale++;
  }
  return stale;
}

/**
 * 转写当前句子的指纹（字幕与翻译核心的规则，经 editor-wasm）；正文读不了时 null。WASM 没有构建时也是 null：只按单元自己的
 * 状态与文本数过期的，不让整个内容索引失败。
 */
function currentFingerprints(body: unknown): Map<string, string> | null {
  try {
    const source = sourceSentences(body);
    return 'sentences' in source ? new Map(source.sentences.map((s) => [s.id, s.fingerprint])) : null;
  } catch (error) {
    if (error instanceof EditorWasmUnavailable) return null;
    throw error;
  }
}

/** `/2` 译文单元的时间：那一句的；转写没有存句子时，对齐的词的范围，或句子 ID 里的首词。 */
function unitTime(
  sentenceId: string,
  wordIds: string[] | undefined,
  sentences: Map<string, TimeSpan> | undefined,
  words: Map<string, TimeSpan> | undefined,
): TimeSpan | undefined {
  const sentence = sentences?.get(sentenceId);
  if (sentence) return sentence;
  if (!words) return undefined;
  const spans = (wordIds ?? []).map((id) => words.get(id)).filter((t): t is TimeSpan => t !== undefined);
  if (spans.length > 0) {
    return { clock: spans[0]!.clock, start: Math.min(...spans.map((t) => t.start)), end: Math.max(...spans.map((t) => t.end)) };
  }
  return sentenceId.startsWith('s-') ? words.get(sentenceId.slice(2)) : undefined;
}

export function factsOf(snapshot: VideoSnapshot, videoDir: string): Pick<VideoFacts, 'timelineAssetIds' | 'linkedFiles'> {
  const used = new Set<Id>();
  for (const sequence of Object.values(snapshot.sequences)) {
    for (const item of sequence.items) for (const ref of itemAssetRefs(item)) used.add(ref.id);
  }
  const linkedFiles: VideoFacts['linkedFiles'] = [];
  for (const asset of Object.values(snapshot.assets)) {
    const seen = new Set<string>();
    for (const revision of Object.values(asset.revisions)) {
      if (revision.storage.mode !== 'linked') continue;
      const file = path.resolve(videoDir, revision.storage.locator.path);
      if (seen.has(file)) continue;
      seen.add(file);
      linkedFiles.push({ assetId: asset.id, name: asset.name, path: file });
    }
  }
  return { timelineAssetIds: [...used].sort(), linkedFiles };
}

/** 封面那一帧的素材版本与时间（不含路径：文件在要画缩略图时再按视频目录找）。 */
export function posterOf(snapshot: VideoSnapshot): VideoPosterFact | null {
  // 快照不全（只带内容所需字段的旧读法、测试替身）时没有封面，不影响其余事实。
  const root = snapshot.sequences?.[snapshot.rootSequenceId];
  if (!root?.tracks || !root.items || !snapshot.assets) return null;
  const frame = posterFrame(snapshot);
  const record = frame ? snapshot.assets[frame.asset.id]?.revisions[frame.asset.revision] : undefined;
  if (!frame || !record) return null;
  return {
    assetId: frame.asset.id,
    revision: frame.asset.revision,
    at: frame.at,
    contentHash: record.contentHash,
    mediaType: record.mediaType,
    durationSec: record.duration ? mediaTimeToSeconds(record.duration) : null,
  };
}

/** 根序列的时长与画布尺寸。 */
export function timelineOf(snapshot: VideoSnapshot): VideoTimelineFact | null {
  // 快照不全（同 `posterOf`）时没有：实例缺了 `span` 时算不出时长。
  const root = snapshot.sequences?.[snapshot.rootSequenceId];
  if (!root?.tracks || !Array.isArray(root.items) || !root.canvas || !(root.fps?.num > 0) || !(root.fps.den > 0)) return null;
  const { width, height } = root.canvas;
  if (!(width > 0) || !(height > 0)) return null;
  const durationSec = framesToSeconds(sequenceDurationFrames(root), root.fps);
  if (!Number.isFinite(durationSec)) return null;
  return { durationSec: round(durationSec), width, height };
}

function plannedOf(doc: ReadContentDocument): PlannedDocument {
  return {
    documentId: doc.documentId,
    kind: doc.kind,
    name: doc.name ?? '',
    language: doc.language ?? null,
    revision: doc.revision ?? '0',
    sourceAssetId: doc.sourceAssetId ?? null,
    sourceDocumentId: doc.sourceDocumentId ?? null,
    schema: doc.schema ?? '',
    body: doc.body ?? null,
  };
}

/** 投影不出来时：转写正文里的词按源时间排成一份「计划」，句子 ID 来自正文的句子切分。 */
function sourcePlanOfSpeech(doc: ReadContentDocument): TextPlan | null {
  const body = doc.body as SpeechBody | null;
  if (!body || !Array.isArray(body.words)) return null;
  const scale = body.timescale && body.timescale > 0 ? body.timescale : 1000;
  const sentenceOf = new Map<string, string>();
  const order = new Map(body.words.map((w, i) => [w.id, i]));
  for (const sentence of body.sentences ?? []) {
    let ids: string[] = [];
    if (Array.isArray(sentence.wordIds)) ids = sentence.wordIds;
    else if (sentence.first !== undefined && sentence.last !== undefined) {
      const a = order.get(sentence.first);
      const b = order.get(sentence.last);
      if (a !== undefined && b !== undefined) ids = body.words.slice(a, b + 1).map((w) => w.id);
    }
    for (const id of ids) sentenceOf.set(id, sentence.id);
  }
  const entries: TextEntry[] = [];
  for (const word of body.words) {
    if (word.hidden || !word.text) continue;
    const start = (word.start ?? 0) / scale;
    const sentenceId = sentenceOf.get(word.id);
    entries.push({
      key: word.id,
      id: word.id,
      start,
      end: Math.max(start, (word.end ?? word.start ?? 0) / scale),
      text: word.text,
      ...(word.speaker !== undefined ? { speaker: word.speaker } : {}),
      ...(sentenceId !== undefined ? { sentenceId } : {}),
      wordTiming: false,
    });
  }
  entries.sort((a, b) => a.start - b.start);
  return pseudoPlan(doc, 'speech', entries);
}

function sourcePlanOfCaption(doc: ReadContentDocument): TextPlan | null {
  const body = doc.body as CaptionBody | null;
  if (!body || !Array.isArray(body.cues)) return null;
  const scale = body.timescale && body.timescale > 0 ? body.timescale : 1000;
  const entries: TextEntry[] = body.cues
    .filter((cue) => cue.text)
    .map((cue) => ({
      key: cue.id,
      id: cue.id,
      start: (cue.start ?? 0) / scale,
      end: (cue.end ?? cue.start ?? 0) / scale,
      text: cue.text!,
      ...(cue.speaker !== undefined ? { speaker: cue.speaker } : {}),
      wordTiming: false,
    }));
  entries.sort((a, b) => a.start - b.start);
  return pseudoPlan(doc, 'caption', entries);
}

function pseudoPlan(doc: ReadContentDocument, unit: 'speech' | 'caption', entries: TextEntry[]): TextPlan {
  return {
    sequenceId: '',
    documentId: doc.documentId,
    unit,
    clock: 'source',
    scope: { basis: 'source', captionItemIds: [], scopeItemIds: [] },
    range: { startSeconds: 0, endSeconds: entries.at(-1)?.end ?? 0, durationSeconds: entries.at(-1)?.end ?? 0 },
    entries,
    sourceCount: entries.length,
    omittedCount: 0,
  };
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
