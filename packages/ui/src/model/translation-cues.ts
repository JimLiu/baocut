import type { DocumentRecord, EditOperation, Id, Sequence } from '@baocut/protocol';
import { defaultStyleName } from './caption-presets.ts';
import type { CaptionChip } from './caption-tracks.ts';
import { DEFAULT_CAPTION_STYLE } from './property-values.ts';
import {
  CUE_PARAMS,
  captionPlacement,
  deriveCues,
  splitUntimed,
  type CueParams,
  type DerivedCue,
  type SpeechWord,
  type SpeechWords,
} from './speech-cues.ts';
import { unitText, type TranslationUnit } from './translation-doc.ts';

/**
 * 译文 → 字幕（产品设计 S02、架构设计 §10.3）：一句译文的时间取原文那一句的成员词的时间（素材时钟，与生成的原文字幕
 * 同一个时钟，经作用实例投到序列上，剪切、拆分、删除媒体后跟着走）。译文按 speech-cues.ts 的同一套规则切条
 * （`splitUntimed` 按空白与标点拆开、时间按显示宽度插值，`deriveCues` 贪心切条、一条不超过 7 秒），所以译文的条数
 * 与断行可以和原文不同，但不会跨出原文那一句。
 *
 * 字幕条的 ID 是 `q-<单元 ID>`，后面可能跟 `~n`（同一句拆出来的第 n 块起头的一条）。改一句译文时按这个前缀找到它的
 * 几条，只换这几条（`retextCaption`）。
 *
 * 智能体的 `captions_create` 在 Runtime 里用同一套切法：`packages/jobs/src/pipelines/caption-cues.ts` 的 `translationCues`
 * 是这里的移植，事务与 `translationCaptionOperations` 相同（`caption-layer.ts`）。没有合成一份：界面不能依赖只在 Node 里
 * 跑的 jobs，jobs 也不依赖界面（架构设计 §14「转录工具的字幕层」）；改切法时两处一起改。
 */

type Json = Record<string, unknown>;

export const TRANSLATION_CAPTION_EXTENSION = 'baocut.translationCues';

/** `w12~3`（没有词时间的段拆出来的块）→ `w12`。 */
const baseWordId = (id: string) => id.replace(/~\d+$/, '');

/** 译文单元 → 字幕条（素材时钟，秒）。标了过期的与没有译文的单元不出字幕（与文本导出同一条规矩）；原句的词都找不到的也没有。 */
export function translationCues(speech: SpeechWords, units: readonly TranslationUnit[], params: CueParams = CUE_PARAMS): DerivedCue[] {
  const byBase = new Map<string, SpeechWord[]>();
  for (const word of speech.words) {
    const base = baseWordId(word.id);
    byBase.set(base, [...(byBase.get(base) ?? []), word]);
  }
  const pseudo: SpeechWord[] = [];
  for (const unit of units) {
    const text = unitText(unit);
    if (unit.status === 'stale' || !text) continue;
    const words = (unit.alignment?.sourceWordIds ?? []).flatMap((id) => byBase.get(id) ?? []);
    if (!words.length) continue;
    const start = Math.min(...words.map((w) => w.start));
    const end = Math.max(...words.map((w) => w.end));
    const speaker = words.find((w) => w.start === start)!.speaker;
    splitUntimed(text, start, end, params.maxChars).forEach((piece, n) => {
      pseudo.push({
        id: n === 0 ? unit.id : `${unit.id}~${n + 1}`,
        start: piece.start,
        end: piece.end,
        text: piece.text.trim(),
        ...(speaker !== undefined ? { speaker } : {}),
        // 一句译文自成一句：不和相邻的译文接成一条。
        sentenceId: unit.id,
        paragraphStart: false,
      });
    });
  }
  return deriveCues(pseudo, params);
}

/** 字幕条是不是这一句译文的：`q-<单元 ID>` 之后要么结束，要么紧跟 `~`（`t-s-w1` 不吞掉 `t-s-w10`）。 */
export function cueOfUnit(cueId: string, unitId: Id): boolean {
  const base = `q-${unitId}`;
  if (!cueId.startsWith(base)) return false;
  const rest = cueId.slice(base.length);
  return rest === '' || rest[0] === '~';
}

interface BodyCue {
  id?: unknown;
  start: number;
  end: number;
  text?: unknown;
  speaker?: unknown;
}

/**
 * 改了一句译文之后的字幕正文：去掉这一句原来的几条，按新译文重新切出的几条放回原处（没有原来的就按时间插进去），
 * 再照 `speechCaptionBody` 的取整规矩修掉重叠。别的条原样不动（手工改过的字也保留）。
 */
export function retextCaption(body: Json, unitId: Id, fresh: readonly DerivedCue[], speakers: ReadonlyMap<string, string>): Json {
  const scale = typeof body.timescale === 'number' && body.timescale > 0 ? body.timescale : 1000;
  const cues = (Array.isArray(body.cues) ? body.cues : []) as BodyCue[];
  const firstOld = cues.findIndex((cue) => typeof cue.id === 'string' && cueOfUnit(cue.id, unitId));
  const kept = cues.filter((cue) => !(typeof cue.id === 'string' && cueOfUnit(cue.id, unitId)));
  // 只有原来写了说话人时新条才写（一个人说话的视频不写说话人）。
  const withSpeaker = cues.some((cue) => typeof cue.speaker === 'string');
  const made: BodyCue[] = fresh.map((cue) => ({
    id: cue.id,
    start: Math.round(cue.start * scale),
    end: Math.round(cue.end * scale),
    text: cue.text,
    ...(withSpeaker && cue.speaker !== undefined ? { speaker: speakers.get(cue.speaker) ?? cue.speaker } : {}),
  }));
  let at: number;
  if (firstOld >= 0) at = cues.slice(0, firstOld).filter((cue) => !(typeof cue.id === 'string' && cueOfUnit(cue.id, unitId))).length;
  else {
    const from = made[0]?.start ?? 0;
    at = kept.findIndex((cue) => cue.start > from);
    if (at < 0) at = kept.length;
  }
  const merged = [...kept.slice(0, at), ...made, ...kept.slice(at)].map((cue) => ({ ...cue }));
  merged.forEach((cue, i) => {
    const next = merged[i + 1];
    if (next && cue.end > next.start) cue.end = next.start;
    if (cue.end <= cue.start) cue.end = cue.start + 1;
    if (next && next.start < cue.end) next.start = cue.end;
  });
  return { ...body, cues: merged };
}

/**
 * 和译文配对的原文字幕：从同一份转写生成的那条；没有时画面上的第一条原文。都没有时 null。
 */
export function pairedOriginal(chips: readonly CaptionChip[], documents: Record<Id, DocumentRecord>, speechDocumentId: Id): CaptionChip | null {
  const originals = chips.filter((chip) => chip.kind === 'original');
  return (
    originals.find((chip) => documents[chip.documentId]?.sourceDocumentId === speechDocumentId) ??
    originals.find((chip) => chip.state !== 'shelved') ??
    null
  );
}

export interface TranslationCaptionSource {
  translationDocumentId: Id;
  translationRevision: string;
  speechDocumentId: Id;
  speechRevision: string;
  assetId: Id;
  language: string;
  /** 字幕文档、字幕实例与新轨道的名字。 */
  name: string;
  /** 和原文一起显示（双语）；否则只显示译文，原文从画面上拿下来（不删）。 */
  bilingual: boolean;
}

const TRACK_REF = 'translation-track';
const DOCUMENT_REF = 'translation-caption';
const STYLE_REF = 'translation-style';

/**
 * 把译文放到画面上的一笔事务（撤销一次就全回去）：新建一条字幕轨（一门语言一条），写字幕文档（素材时钟，派生自译文文档，
 * 记下素材与来自哪份译文、转写的哪个版本），放一个字幕实例：作用实例与区间同生成的原文字幕（`captionPlacement`）。
 *
 * 渲染内核按样式文档把字幕叠成一组（`crates/frame-render` 的 `styleDocumentId ?? itemId`），所以：
 * - 双语：和配对的原文共用一份样式——原文有就用它的，没有就新建一份默认样式，原文与译文一起用上；原文被拿下的放回来。
 * - 只看译文：配对的原文从画面上拿下；原文有样式时译文也用它，之后放回原文就自然叠成双语。
 * 配对的原文锁住时不动它（引擎会拒绝），只在它有样式时共用。
 */
export function translationCaptionOperations(
  sequence: Sequence,
  body: Json,
  source: TranslationCaptionSource,
  paired: CaptionChip | null,
): EditOperation[] {
  const cues = Array.isArray(body.cues) ? body.cues : [];
  const operations: EditOperation[] = [
    { type: 'addTrack', sequenceId: sequence.id, kind: 'subtitle', ref: TRACK_REF, name: source.name },
    {
      type: 'putDocument',
      ref: DOCUMENT_REF,
      kind: 'caption',
      name: source.name,
      language: source.language,
      sourceAsset: { assetId: source.assetId },
      sourceDocument: { documentId: source.translationDocumentId },
      body,
      summary: { cueCount: cues.length },
      extensions: {
        [TRANSLATION_CAPTION_EXTENSION]: {
          translationDocumentId: source.translationDocumentId,
          translationRevision: source.translationRevision,
          speechDocumentId: source.speechDocumentId,
          speechRevision: source.speechRevision,
          assetId: source.assetId,
        },
      },
    },
  ];
  const touch = paired && !paired.locked ? paired : null;
  let style: { styleDocumentId: Id } | { styleDocumentRef: string } | null = paired?.styleDocumentId
    ? { styleDocumentId: paired.styleDocumentId }
    : null;
  if (source.bilingual && touch) {
    if (!style) {
      operations.push({ type: 'putDocument', ref: STYLE_REF, kind: 'caption-style', name: defaultStyleName(), body: DEFAULT_CAPTION_STYLE });
      for (const itemId of touch.itemIds) {
        operations.push({ type: 'setCaptionStyle', sequenceId: sequence.id, itemId, styleDocument: { ref: STYLE_REF } });
      }
      style = { styleDocumentRef: STYLE_REF };
    }
    if (touch.state === 'shelved') {
      for (const itemId of touch.itemIds) operations.push({ type: 'updateItem', sequenceId: sequence.id, itemId, enabled: true });
    }
  } else if (!source.bilingual && touch && touch.state !== 'shelved') {
    for (const itemId of touch.itemIds) operations.push({ type: 'updateItem', sequenceId: sequence.id, itemId, enabled: false });
  }
  const { span, scopeItemIds } = captionPlacement(sequence, source.assetId, body);
  operations.push({
    type: 'insertItems',
    sequenceId: sequence.id,
    items: [
      {
        type: 'caption',
        name: source.name,
        span,
        documentRef: DOCUMENT_REF,
        trackRef: TRACK_REF,
        ...(scopeItemIds.length ? { scopeItemIds } : {}),
        ...(style ?? {}),
      },
    ],
  });
  return operations;
}

/** 字幕文档是不是从这份译文生成的（只有这种改译文时跟着改；别人生成的切法不同，不去动）。 */
export function derivedFrom(record: DocumentRecord, translationDocumentId: Id): boolean {
  const ext = record.extensions?.[TRANSLATION_CAPTION_EXTENSION] as { translationDocumentId?: unknown } | undefined;
  return record.kind === 'caption' && record.sourceDocumentId === translationDocumentId && ext?.translationDocumentId === translationDocumentId;
}
