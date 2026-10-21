import type { DocumentRecord, Id } from '@baocut/protocol';
import { SPEECH_CAPTION_EXTENSION, rewordSpeechCaption } from '@baocut/jobs';
import type { DocumentBodyReader } from './translation-captions.ts';

/**
 * 智能体改了转写的词文本之后，从它生成的原文字幕层跟着改字（视频格式规范 §3.8「句子的词」，命令与协议规范 §4.2）。
 *
 * `edits_apply` 的 `updateWords`、改 `words` 里 `text` 的 `patchDocument`，以及 `documents_put` / `putDocument` 整份替换已有的
 * 转写时，这里把这一笔里对这份转写的改动按次序套到当前正文上，得到改字之后的词；每份派生自这份转写（`sourceDocumentId`）的
 * 字幕文档里，句子带 `words`、文字等于这些词改字之前按切条的拼法拼出来的，换成改字之后拼出来的（`rewordSpeechCaption`）。
 * 时间、切条与句子 ID 不动；文字对不上的句子是手改过的，不覆盖，用到了改过的词的报在 `kept` 里。字幕文档的新版本加进
 * 同一笔编辑：撤销一次两边一起回去。同一笔里已经写了（`putDocument` / `patchDocument`）的字幕文档不动；转写或字幕读不了时不跟。
 *
 * 字幕原本跟着当前这版转写（来源记录 `baocut.speechCues` 的 `speechRevision` 是转写当前的版本）、这一笔只有一个操作写这份
 * 转写、而且所有用到改过的词的句子都换了字时，来源记录的 `speechRevision` 一并改成转写的下一个版本号，编辑器就不把它当成
 * 「旧版文稿生成的字幕」。版本号按引擎的规矩推算（已有版本的最大号加一）：撤销过的版本号引擎不会复用，推算落空时只是照旧
 * 提示过期，不会把过期的字幕当成新的。
 *
 * 只在智能体工具的提交路径上（与译文跟改字幕条 `translation-captions.ts` 同一处）；编辑器直接提交的 `edits.apply` 不经过这里。
 */

type Json = Record<string, unknown>;

/** 一份字幕文档里没跟着改字的句子：`cueIds` 至多列 `KEPT_CUE_LIMIT` 个，`total` 是一共几句（多于列出的时才写）。 */
export interface KeptCaptionCues {
  documentId: Id;
  cueIds: Id[];
  total?: number;
}

export interface SpeechCaptionSync {
  /** 跟着改了字的字幕文档数。 */
  synced: number;
  kept: KeptCaptionCues[];
}

const KEPT_CUE_LIMIT = 20;
const CAPTION_SCHEMA = 'baocut.caption/1';

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 写这份文档的操作。 */
const WRITES = new Set(['putDocument', 'patchDocument', 'updateWords', 'renameSpeakers']);

/** 在 `operations` 末尾加上要跟着改字的原文字幕文档。 */
export async function syncSpeechCaptions(
  operations: Record<string, unknown>[],
  documents: Readonly<Record<Id, DocumentRecord>>,
  readBody: DocumentBodyReader,
): Promise<SpeechCaptionSync> {
  const written = new Set(
    operations.flatMap((op) => ((op.type === 'putDocument' || op.type === 'patchDocument') && typeof op.documentId === 'string' ? [op.documentId] : [])),
  );
  // 转写 → 这一笔里写它的操作（按次序）。
  const edits = new Map<Id, Record<string, unknown>[]>();
  for (const op of operations) {
    if (!WRITES.has(op.type as string) || typeof op.documentId !== 'string' || documents[op.documentId]?.kind !== 'speech') continue;
    edits.set(op.documentId, [...(edits.get(op.documentId) ?? []), op]);
  }
  const added: Record<string, unknown>[] = [];
  const kept: KeptCaptionCues[] = [];
  for (const [speechId, ops] of edits) {
    if (!ops.some(changesText)) continue;
    const speech = documents[speechId]!;
    const captions = Object.values(documents).filter((d) => d.kind === 'caption' && d.sourceDocumentId === speechId && !written.has(d.id));
    if (captions.length === 0) continue;
    const before = await readBody(speechId, speech.currentRevision).catch(() => null);
    if (!isObject(before)) continue;
    const after = ops.reduce<Json>(applyText, before);
    const nextRevision = ops.length === 1 ? followingRevision(speech) : null;
    for (const caption of captions) {
      const body = await readBody(caption.id, caption.currentRevision).catch(() => null);
      if (!isObject(body) || body.schema !== CAPTION_SCHEMA) continue;
      const result = rewordSpeechCaption(body, before, after);
      if (!result) break;
      if (result.kept.length) {
        kept.push({
          documentId: caption.id,
          cueIds: result.kept.slice(0, KEPT_CUE_LIMIT),
          ...(result.kept.length > KEPT_CUE_LIMIT ? { total: result.kept.length } : {}),
        });
      }
      if (result.changed === 0) continue;
      const source = caption.extensions?.[SPEECH_CAPTION_EXTENSION];
      const follows = isObject(source) && source.speechDocumentId === speechId && source.speechRevision === speech.currentRevision;
      const summary = caption.revisions[caption.currentRevision]?.summary;
      added.push({
        type: 'putDocument',
        documentId: caption.id,
        kind: caption.kind,
        body: result.body,
        ...(summary !== undefined ? { summary } : {}),
        ...(follows && nextRevision && result.kept.length === 0
          ? { extensions: { [SPEECH_CAPTION_EXTENSION]: { ...source, speechRevision: nextRevision } } }
          : {}),
      });
      written.add(caption.id);
    }
  }
  operations.push(...added);
  return { synced: added.length, kept };
}

/** 这个操作可能改了词文本。 */
function changesText(op: Record<string, unknown>): boolean {
  if (op.type === 'updateWords') return Array.isArray(op.words) && op.words.length > 0;
  if (op.type === 'patchDocument') return wordTexts(op.changes).length > 0;
  return op.type === 'putDocument' && isObject(op.body);
}

/** 把一个写转写的操作对词文本的改动套到正文上；别的改动（说话人、隐藏、句子）不管。 */
function applyText(body: Json, op: Record<string, unknown>): Json {
  if (op.type === 'putDocument') return isObject(op.body) ? op.body : body;
  const texts =
    op.type === 'updateWords'
      ? (Array.isArray(op.words) ? op.words : []).flatMap((word): [string, string][] =>
          isObject(word) && typeof word.id === 'string' && typeof word.text === 'string' ? [[word.id, word.text]] : [],
        )
      : op.type === 'patchDocument'
        ? wordTexts(op.changes)
        : [];
  if (!texts.length || !Array.isArray(body.words)) return body;
  const next = new Map(texts);
  return {
    ...body,
    words: body.words.map((word) => (isObject(word) && typeof word.id === 'string' && next.has(word.id) ? { ...word, text: next.get(word.id) } : word)),
  };
}

/** `patchDocument` 里改词文本的几项：`path` 是 `['words', { id }, 'text']`、给了字符串 `value`。 */
function wordTexts(changes: unknown): [string, string][] {
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((change): [string, string][] => {
    if (!isObject(change) || !Array.isArray(change.path) || change.path.length !== 3 || typeof change.value !== 'string') return [];
    const [field, entry, key] = change.path as unknown[];
    return field === 'words' && key === 'text' && isObject(entry) && typeof entry.id === 'string' ? [[entry.id, change.value]] : [];
  });
}

/** 引擎给这份文档的下一个版本号：已有版本的最大号加一（不是数字的版本号时 null）。 */
function followingRevision(record: DocumentRecord): string | null {
  const numbers = Object.keys(record.revisions ?? {}).map(Number);
  if (numbers.length === 0 || numbers.some((n) => !Number.isSafeInteger(n) || n < 0)) return null;
  return String(Math.max(...numbers) + 1);
}
