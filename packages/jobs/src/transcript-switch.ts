import type {
  DocumentRecord,
  EditOperation,
  Id,
  TranscriptCarryDub,
  TranscriptCarryTranslation,
  TranscriptReplace,
  TranscriptSwitchImpact,
} from '@baocut/protocol';
import { EditorWasmError, speechSentences, type SourceSentence, type SpeechSentences } from '@baocut/editor-wasm';
import { JobsTranscribe } from '@baocut/protocol/messages/jobs/transcribe.ts';
import { sha256Hex } from './input-hash.ts';
import { ApplyRejected, StaleInput } from './job-application.ts';
import { withCause } from './job-text.ts';
import { captionBody, deriveCues, readSpeechWords, translationCues, type CueTranslationUnit } from './pipelines/caption-cues.ts';
import { SPEECH_CAPTION_EXTENSION, TRANSLATION_CAPTION_EXTENSION } from './pipelines/caption-layer.ts';
import { DUB_EXTENSION } from './pipelines/dub.ts';
import { TRANSLATION_SCHEMA, type TranslationBody, type TranslationUnit } from './pipelines/translation-document.ts';

/**
 * 换用文稿（架构设计 §6.6；转录流程的 `destination: 'replace'`）：转写 Job 应用结果时，一笔事务写已有 `speech` 文档的新版本，
 * 并结转依赖它的内容。这里只算操作，不提交；Application 照常校验版本、提交、记回执。
 *
 * - 手工修改闸门：应用前重读当前文稿，全文指纹（与 `stages.asr` 同一种写法）不再是提交时的那个就拒绝
 *   （`TRANSCRIPT_EDITED`）；提交时的 `acceptEdited` 只覆盖提交那一刻的指纹。
 * - 译文（视频格式规范 §5.3「源文稿换版本时的结转」）：新旧句子按素材时钟的重叠贪心配对，规范化原文相同的保留译文与状态、
 *   对齐降为句级；变了的、新句没配上的标过期；旧句没配上的不结转。每种语言写同一份文档的新版本。
 * - 字幕：派生自这份文稿与结转了的译文的字幕文档按新文稿重新切条（与流程建字幕层同一份切法），正文里别的字段与样式不动。
 * - 正文的 `userBreaks`、`paragraphBreaks`（§5.5）按时间重锚：旧词源时间区间的中点落在哪个新词里、两词规范化文本相同就换成
 *   那个新词，否则条目原样留着（指向不存在的词，不生效），记为 `orphaned`。`layoutProfileId` 原样带过去。
 * - 配音计划（§7.2）随译文结转：原文没变的单元换成新 ID 与新句，音频与其余字段保留；原文变了的标过期、去掉台词。
 *
 * 版本号：同一笔事务里后面的操作要引用文稿与译文的新版本号（`speechRef.revision`、`translationRef.revision`），而版本号由引擎
 * 分配。这里按文档记录里最大的数字版本 + 1 预测（引擎的规则；撤销过的版本另有下限，记录里看不到，那时预测会偏小）。
 */

export const TRANSCRIPT_SWITCH_EXTENSION = 'baocut.transcriptSwitch';

/** 换用要读的视频能力。 */
export interface SwitchVideos {
  state?(videoId: Id): { revision: string; documents: Record<Id, DocumentRecord> } | null;
  document?(videoId: Id, documentId: Id, revision?: string): Promise<{ revision: string; body: unknown }>;
}

type PutDocument = Extract<EditOperation, { type: 'putDocument' }>;

interface Word {
  id: string;
  start: number;
  end: number;
  text: string;
  timingQuality?: string;
}

interface SpeechBody {
  schema: string;
  timescale?: number;
  words: Word[];
  userBreaks?: Record<string, 'break' | 'no-break'>;
  paragraphBreaks?: string[];
  layoutProfileId?: string;
  stages?: Record<string, unknown>;
  [key: string]: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 转写正文的全文指纹（核心的 `fingerprint`，含隐藏的词）。WASM 没有构建或正文读不出时抛 `EditorWasmError`。 */
export function contentFingerprint(body: unknown): string {
  return speechSentences(body).contentFingerprint;
}

/** 正文记下的 `stages.asr`；没有时 null（例如这个 Runtime 早先写的转写，当作没改过）。 */
export function asrStage(body: unknown): string | null {
  const stages = isObject(body) ? body.stages : undefined;
  const asr = isObject(stages) ? stages.asr : undefined;
  return typeof asr === 'string' && asr !== '' ? asr : null;
}

/** 规范化文本（§5.3）：去掉标点与空白，做 NFKC，再做大小写折叠（先转大写再转小写，近似 Unicode 的完全折叠）。 */
export function normalizeText(text: string): string {
  const strip = (s: string) => s.replace(/[\p{P}\s]/gu, '');
  // NFKC 会把全角、兼容字符换成可能是标点或空白的写法，换过之后再去一次。
  return strip(strip(text).normalize('NFKC').toUpperCase().toLowerCase());
}

/** 文档的下一个版本号（引擎的规则：记录里最大的数字版本 + 1；撤销留下的下限看不到）。 */
export function nextRevision(record: DocumentRecord): string {
  const numbers = Object.keys(record.revisions)
    .map((r) => Number(r))
    .filter((n) => Number.isInteger(n));
  return String(Math.max(0, ...numbers) + 1);
}

/**
 * 新旧句子配对（§5.3）：按素材时钟（秒，各按自己的 `timescale`）；有重叠的是候选，重叠不到两句中较短那句时长的一半不算；
 * 在全部候选里先配重叠最长的一对，配上的两句不再参与。返回 新句下标 → 旧句下标。同样长的重叠按旧句、新句的先后。
 */
export function pairSentences(
  previous: readonly Pick<SourceSentence, 'start' | 'end'>[],
  previousScale: number,
  next: readonly Pick<SourceSentence, 'start' | 'end'>[],
  nextScale: number,
): Map<number, number> {
  const a = previous.map((s) => ({ start: s.start / previousScale, end: s.end / previousScale }));
  const b = next.map((s) => ({ start: s.start / nextScale, end: s.end / nextScale }));
  const order = b.map((_, j) => j).sort((x, y) => b[x]!.start - b[y]!.start || x - y);
  const candidates: { i: number; j: number; overlap: number }[] = [];
  a.forEach((old, i) => {
    for (const j of order) {
      const cur = b[j]!;
      if (cur.start >= old.end) break;
      const overlap = Math.min(old.end, cur.end) - Math.max(old.start, cur.start);
      if (overlap <= 0) continue;
      const shorter = Math.min(old.end - old.start, cur.end - cur.start);
      if (overlap >= shorter / 2) candidates.push({ i, j, overlap });
    }
  });
  candidates.sort((x, y) => y.overlap - x.overlap || x.i - y.i || x.j - y.j);
  const usedOld = new Set<number>();
  const pairs = new Map<number, number>();
  for (const c of candidates) {
    if (usedOld.has(c.i) || pairs.has(c.j)) continue;
    usedOld.add(c.i);
    pairs.set(c.j, c.i);
  }
  return pairs;
}

/** 旧单元换到哪个新单元：新句、原文是否没变。 */
export interface UnitMove {
  unitId: Id;
  sentence: SourceSentence;
  same: boolean;
}

/**
 * 一种语言的译文结转（§5.3）。`speechRevision` 是新文稿的版本号，`editViewHash` 按新句子重算的。返回新正文、计数与旧单元 →
 * 新单元的对应（配音计划用）。
 */
export function carryTranslation(
  body: TranslationBody,
  previous: readonly SourceSentence[],
  next: SpeechSentences,
  pairs: ReadonlyMap<number, number>,
  speechRef: { id: Id; revision: string },
): { body: TranslationBody; counts: Omit<TranscriptCarryTranslation, 'language' | 'documentId'>; moves: Map<Id, UnitMove> } {
  const unitBySentence = new Map<Id, TranslationUnit>();
  for (const unit of body.units) if (!unitBySentence.has(unit.sourceSentenceId)) unitBySentence.set(unit.sourceSentenceId, unit);
  const counts = { kept: 0, keptReviewed: 0, stale: 0, unmatched: 0 };
  const moves = new Map<Id, UnitMove>();
  const alignment = (sentence: SourceSentence, basis: 'natural' | 'display-rewrite', text: string): TranslationUnit['alignment'] => ({
    basis,
    correspondence: 'sentence',
    blocks: [],
    sourceWordIds: [...sentence.wordIds],
    textHash: `sha256:${sha256Hex(text)}`,
  });
  const units = next.sentences.map((sentence, j): TranslationUnit => {
    const id = `t-${sentence.id}`;
    const i = pairs.get(j);
    const old = i === undefined ? undefined : unitBySentence.get(previous[i]!.id);
    if (!old) {
      counts.unmatched++;
      counts.stale++;
      return {
        id,
        sourceSentenceId: sentence.id,
        sourceFingerprint: sentence.fingerprint,
        naturalText: '',
        alignment: alignment(sentence, 'natural', ''),
        status: 'stale',
      };
    }
    const same = normalizeText(previous[i!]!.text) === normalizeText(sentence.text);
    moves.set(old.id, { unitId: id, sentence, same });
    // 单元里认不得的字段原样带过去；ID、原句、对齐与状态按规则换。
    const { displayRewrite, alignment: oldAlignment, ...rest } = old;
    if (same) {
      const status = old.status;
      if (status === 'stale') counts.stale++;
      else {
        counts.kept++;
        if (status === 'reviewed') counts.keptReviewed++;
      }
      return {
        ...rest,
        id,
        sourceSentenceId: sentence.id,
        sourceFingerprint: sentence.fingerprint,
        ...(displayRewrite ? { displayRewrite } : {}),
        alignment: alignment(sentence, oldAlignment?.basis ?? 'natural', old.naturalText),
        status,
      };
    }
    counts.stale++;
    return {
      ...rest,
      id,
      sourceSentenceId: sentence.id,
      sourceFingerprint: sentence.fingerprint,
      alignment: alignment(sentence, 'natural', old.naturalText),
      status: 'stale',
    };
  });
  return {
    body: { ...body, sourceBasis: { ...body.sourceBasis, speechRef, editViewHash: next.editViewHash }, units },
    counts,
    moves,
  };
}

/**
 * `userBreaks` 与 `paragraphBreaks` 按时间重锚（§5.5）。换不上的条目原样留着（新词全是新 ID，所以它们不生效）。
 * 旧词没有源时间（`timingQuality: 'missing'`）时锚不上。旧正文里已经指向不存在的词的条目原样留着、不计数。
 */
export function reanchorBreaks(
  previous: SpeechBody,
  next: SpeechBody,
): { userBreaks?: SpeechBody['userBreaks']; paragraphBreaks?: string[]; reanchored: number; orphaned: number } {
  const oldScale = previous.timescale || 1_000_000;
  const newScale = next.timescale || 1_000_000;
  const oldWords = new Map(previous.words.map((w) => [w.id, w]));
  const newWords = [...next.words].sort((x, y) => x.start - y.start);
  let reanchored = 0;
  let orphaned = 0;
  const move = (wordId: string): string => {
    const old = oldWords.get(wordId);
    if (!old) return wordId;
    const target = old.timingQuality === 'missing' ? undefined : matchWord(old, oldScale, newWords, newScale);
    if (target) {
      reanchored++;
      return target;
    }
    orphaned++;
    return wordId;
  };
  const out: { userBreaks?: SpeechBody['userBreaks']; paragraphBreaks?: string[] } = {};
  if (isObject(previous.userBreaks) && Object.keys(previous.userBreaks).length) {
    const breaks: Record<string, 'break' | 'no-break'> = {};
    for (const [wordId, value] of Object.entries(previous.userBreaks)) {
      const key = move(wordId);
      // 两个旧词锚到同一个新词：先到的留着。
      if (!(key in breaks)) breaks[key] = value;
    }
    out.userBreaks = breaks;
  }
  if (Array.isArray(previous.paragraphBreaks) && previous.paragraphBreaks.length) {
    out.paragraphBreaks = [...new Set(previous.paragraphBreaks.map(move))];
  }
  return { ...out, reanchored, orphaned };
}

function matchWord(old: Word, oldScale: number, words: readonly Word[], scale: number): string | undefined {
  const mid = (old.start + old.end) / 2 / oldScale;
  const text = normalizeText(old.text);
  for (const word of words) {
    const start = word.start / scale;
    if (start > mid) break;
    if (mid < word.end / scale && word.timingQuality !== 'missing' && normalizeText(word.text) === text) return word.id;
  }
  return undefined;
}

/** 配音计划随译文结转（§7.2）。返回新正文与计数；没配上的单元不结转。 */
export function carryDubPlan(
  body: Record<string, unknown>,
  moves: ReadonlyMap<Id, UnitMove>,
  refs: { translation: { id: Id; revision: string }; speech: { id: Id; revision: string } },
): { body: Record<string, unknown>; kept: number; stale: number } {
  let kept = 0;
  let stale = 0;
  const units = (Array.isArray(body.units) ? body.units : []).flatMap((raw): Record<string, unknown>[] => {
    if (!isObject(raw)) return [];
    const extensions = isObject(raw.extensions) ? raw.extensions : {};
    const dub = isObject(extensions[DUB_EXTENSION]) ? (extensions[DUB_EXTENSION] as Record<string, unknown>) : {};
    const unitId =
      typeof dub.translationUnitId === 'string' ? dub.translationUnitId : typeof raw.id === 'string' ? raw.id.replace(/^d-/, '') : '';
    const move = moves.get(unitId);
    if (!move) return [];
    const anchor = isObject(raw.targetAnchor) ? raw.targetAnchor : { kind: 'sentence', edge: 'start' };
    const moved = {
      ...raw,
      id: `d-${move.unitId}`,
      sourceSentenceIds: [move.sentence.id],
      sourceFingerprint: move.sentence.fingerprint,
      targetAnchor: { ...anchor, speechRef: refs.speech, sentenceId: move.sentence.id },
    };
    if (move.same) {
      if (raw.status === 'stale') stale++;
      else kept++;
      return [{ ...moved, extensions: { ...extensions, [DUB_EXTENSION]: { ...dub, translationUnitId: move.unitId } } }];
    }
    stale++;
    const { actualSamples: _samples, sampleRate: _rate, ...rest } = moved as Record<string, unknown>;
    return [
      {
        ...rest,
        script: null,
        status: 'stale',
        extensions: { ...extensions, [DUB_EXTENSION]: { translationUnitId: move.unitId, staleReason: 'source-changed' } },
      },
    ];
  });
  return { body: { ...body, translationRef: refs.translation, units }, kept, stale };
}

/**
 * 换用文稿那一笔事务的全部操作。`speech` 是新转写的 `putDocument`（`speechDocumentOperation` 的结果，词 ID 已与旧文稿不同）；
 * 返回的第一个操作是写成已有文档新版本的它，之后是结转。闸门不通过时抛 `ApplyRejected`（`TRANSCRIPT_EDITED`），文稿不在、
 * 读不出时抛 `StaleInput`。
 */
export async function planTranscriptSwitch(
  videos: SwitchVideos,
  input: { videoId: Id; replace: TranscriptReplace; speech: PutDocument; jobId: Id },
): Promise<{ operations: EditOperation[]; impact: TranscriptSwitchImpact }> {
  const { videoId, replace } = input;
  const state = videos.state?.(videoId);
  if (!state || !videos.document) throw new StaleInput(JobsTranscribe.replaceDocumentGone());
  const read = videos.document.bind(videos);
  const record = state.documents[replace.documentId];
  if (!record || record.kind !== 'speech') throw new StaleInput(JobsTranscribe.replaceDocumentGone());
  const current = await read(videoId, record.id);
  let previousSentences: SpeechSentences;
  try {
    previousSentences = speechSentences(current.body);
  } catch (error) {
    if (error instanceof EditorWasmError) throw new StaleInput(withCause(JobsTranscribe.transcriptUnreadable(), error));
    throw error;
  }
  if (previousSentences.contentFingerprint !== replace.fingerprint) {
    throw new ApplyRejected('TRANSCRIPT_EDITED', JobsTranscribe.transcriptEditedSinceSubmit(), {
      documentId: record.id,
      fingerprint: previousSentences.contentFingerprint,
      expected: replace.fingerprint,
    });
  }
  const previous = current.body as SpeechBody;
  const speechRef = { id: record.id, revision: nextRevision(record) };

  // 新正文：重锚的换行与分段、排版方案、`stages.asr`（新词的全文指纹；对齐等别的阶段不带过去）。
  const fresh = input.speech.body as SpeechBody;
  const breaks = reanchorBreaks(previous, fresh);
  const body: SpeechBody = {
    ...fresh,
    ...(breaks.userBreaks ? { userBreaks: breaks.userBreaks } : {}),
    ...(breaks.paragraphBreaks ? { paragraphBreaks: breaks.paragraphBreaks } : {}),
    ...(typeof previous.layoutProfileId === 'string' && previous.layoutProfileId ? { layoutProfileId: previous.layoutProfileId } : {}),
  };
  const nextSentences = speechSentences(body);
  body.stages = { ...(isObject(fresh.stages) ? fresh.stages : {}), asr: nextSentences.contentFingerprint };
  const pairs = pairSentences(previousSentences.sentences, previousSentences.timescale, nextSentences.sentences, nextSentences.timescale);

  const operations: EditOperation[] = [];
  const translations: TranscriptCarryTranslation[] = [];
  const dubs: TranscriptCarryDub[] = [];
  /** 结转了的译文：文档 → 新版本号、新单元与旧单元的去向。 */
  const carried = new Map<Id, { revision: string; units: TranslationUnit[]; moves: Map<Id, UnitMove> }>();
  const documents = Object.values(state.documents).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (replace.translations === 'carry') {
    for (const doc of documents) {
      if (doc.kind !== 'translation' || doc.sourceDocumentId !== record.id) continue;
      const content = await read(videoId, doc.id);
      const translation = content.body as TranslationBody;
      // 旧项目的 `/1` 译文按句子 ID 配，格式与 `/2` 的对齐不能换算：不结转，留在旧版本上。
      if (!isObject(translation) || translation.schema !== TRANSLATION_SCHEMA || !Array.isArray(translation.units)) continue;
      const result = carryTranslation(translation, previousSentences.sentences, nextSentences, pairs, speechRef);
      const revision = nextRevision(doc);
      carried.set(doc.id, { revision, units: result.body.units, moves: result.moves });
      const summary = doc.revisions[doc.currentRevision]?.summary;
      operations.push({
        type: 'putDocument',
        documentId: doc.id,
        kind: doc.kind,
        body: result.body,
        ...(isObject(summary)
          ? { summary: { ...summary, ...('unitCount' in summary ? { unitCount: result.body.units.length } : {}) } }
          : {}),
      });
      translations.push({ language: translation.language ?? doc.language ?? '', documentId: doc.id, ...result.counts });
    }
  }

  // 字幕：派生自这份文稿的、派生自结转了的译文的，按新正文重新切条。
  const words = readSpeechWords(body);
  for (const doc of documents) {
    if (doc.kind !== 'caption' || !doc.sourceDocumentId || !words) continue;
    const fromSpeech = doc.sourceDocumentId === record.id;
    const translation = carried.get(doc.sourceDocumentId);
    if (!fromSpeech && !translation) continue;
    const content = await read(videoId, doc.id);
    if (!isObject(content.body)) continue;
    const cues = fromSpeech ? deriveCues(words.words) : translationCues(words, translation!.units.map(cueUnit));
    const extensions: Record<string, unknown> = {};
    const own = doc.extensions ?? {};
    if (isObject(own[SPEECH_CAPTION_EXTENSION])) {
      extensions[SPEECH_CAPTION_EXTENSION] = { ...own[SPEECH_CAPTION_EXTENSION], speechRevision: speechRef.revision };
    }
    if (translation && isObject(own[TRANSLATION_CAPTION_EXTENSION])) {
      extensions[TRANSLATION_CAPTION_EXTENSION] = {
        ...own[TRANSLATION_CAPTION_EXTENSION],
        translationRevision: translation.revision,
        speechRevision: speechRef.revision,
      };
    }
    const summary = doc.revisions[doc.currentRevision]?.summary;
    operations.push({
      type: 'putDocument',
      documentId: doc.id,
      kind: doc.kind,
      body: { ...content.body, ...(captionBody(cues, words.speakers) as Record<string, unknown>) },
      summary: { ...(isObject(summary) ? summary : {}), cueCount: cues.length },
      ...(Object.keys(extensions).length ? { extensions } : {}),
    });
  }

  // 配音计划：随结转了的译文。
  for (const doc of documents) {
    if (doc.kind !== 'dubbing-plan' || !doc.sourceDocumentId) continue;
    const translation = carried.get(doc.sourceDocumentId);
    if (!translation) continue;
    const content = await read(videoId, doc.id);
    if (!isObject(content.body)) continue;
    const result = carryDubPlan(content.body, translation.moves, {
      translation: { id: doc.sourceDocumentId, revision: translation.revision },
      speech: speechRef,
    });
    const summary = doc.revisions[doc.currentRevision]?.summary;
    operations.push({
      type: 'putDocument',
      documentId: doc.id,
      kind: doc.kind,
      body: result.body,
      ...(isObject(summary) ? { summary: { ...summary, stale: result.stale } } : {}),
    });
    const language = typeof content.body.language === 'string' ? content.body.language : (doc.language ?? '');
    dubs.push({ language, documentId: doc.id, kept: result.kept, stale: result.stale });
  }

  const impact: TranscriptSwitchImpact = {
    translations,
    captionPins: { reanchored: breaks.reanchored, orphaned: breaks.orphaned },
    dubs,
  };
  // 文稿名字保留用户的；换用的影响与之前的版本记在扩展里（与这一版本同一笔事务落下，流程的摘要读它）。
  const { name: _name, ...speech } = input.speech;
  operations.unshift({
    ...speech,
    documentId: record.id,
    body,
    extensions: {
      ...speech.extensions,
      [TRANSCRIPT_SWITCH_EXTENSION]: { jobId: input.jobId, previousRevision: replace.revision, revision: speechRef.revision, impact },
    },
  });
  return { operations, impact };
}

function cueUnit(unit: TranslationUnit): CueTranslationUnit {
  return {
    id: unit.id,
    naturalText: unit.naturalText,
    ...(unit.displayRewrite ? { displayRewrite: { text: unit.displayRewrite.text } } : {}),
    alignment: unit.alignment ? { sourceWordIds: unit.alignment.sourceWordIds } : null,
    status: unit.status,
  };
}
