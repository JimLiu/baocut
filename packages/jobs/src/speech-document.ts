import type { EditOperation, Id } from '@baocut/protocol';
import type { AsrResult } from '@baocut/models';
import { JobsSpeechDocument as J } from '@baocut/protocol/messages/jobs/speech-document.ts';

/**
 * `asr-result` → `speech` 文档（架构设计 §6.6 的「应用到视频」）。正文与旧工程导入器写的 `baocut.speech/1` 一致
 * （`scripts/legacy-import/bcut-project.ts`）：词表、说话人、`sentences: null`（句子切分由后续步骤补）、空章节。
 * 每段的词按顺序接在词表里；某段没有词级时间时，整段文本作为一个词，覆盖这一段，标 `timingQuality: 'missing'`。
 * 词时间不可信（`estimated` 插值、`missing`）的词带上 `timingQuality`，导出据此不把它们当逐词同步（验收 AT-05）；
 * 对齐的与服务商给的词不写这个字段。
 */

export interface SpeechDocumentContext {
  assetId: Id;
  jobId: Id;
  /** 执行这次转写的 Provider（`local` 或 `node:<nodeId>`）：文档记的是任务经过的路由，不是节点自报的名字。 */
  providerId: string;
  inputHash: string;
  rawResultArtifactId: string;
  createdAt: string;
  /** 词 ID 的前缀，缺省 `w-`。换用文稿时另给一个，新词的 ID 不与旧文稿的重复（视频格式规范 §5.3）。 */
  wordIdPrefix?: string;
}

export interface SpeechWord {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  /** 只在词时间不可信时出现。 */
  timingQuality?: 'estimated' | 'missing';
}

export function speechWords(result: AsrResult, prefix = 'w-'): SpeechWord[] {
  const words: SpeechWord[] = [];
  const push = (start: number, end: number, text: string, speaker: string | null, quality: string) => {
    words.push({
      id: `${prefix}${String(words.length + 1).padStart(6, '0')}`,
      start,
      end,
      text,
      ...(speaker ? { speaker } : {}),
      ...(quality === 'estimated' || quality === 'missing' ? { timingQuality: quality } : {}),
    });
  };
  for (const segment of result.segments) {
    if (segment.words.length === 0) push(segment.start, segment.end, segment.text.trim(), segment.speakerId, 'missing');
    // 说话人区分给词标了说话人（§6.6）时按词，否则取段的。
    else for (const word of segment.words) push(word.start, word.end, word.text, word.speakerId ?? segment.speakerId, word.timingQuality);
  }
  return words;
}

export function speechDocumentOperation(
  result: AsrResult,
  context: SpeechDocumentContext,
): Extract<EditOperation, { type: 'putDocument' }> {
  const words = speechWords(result, context.wordIdPrefix);
  const speakers = result.speakers.map((s, i) => ({ id: s.id, name: s.label ?? J.speakerName({ n: i + 1 }).text }));
  const language = result.language.tag;
  const p = result.provenance;
  return {
    type: 'putDocument',
    ref: 'speech',
    kind: 'speech',
    name: J.documentName().text,
    ...(language ? { language } : {}),
    sourceAsset: { assetId: context.assetId },
    body: {
      schema: 'baocut.speech/1',
      clock: 'source-asset',
      timescale: result.timescale,
      engine: {
        provider: context.providerId,
        bundleId: p.bundleId,
        models: p.models,
        backend: p.backend,
        device: p.device,
        workerVersion: p.workerVersion,
        ...(p.cost ? { cost: p.cost } : {}),
      },
      createdAt: context.createdAt,
      speakers,
      words,
      sentences: null,
      chapters: [],
    },
    summary: {
      wordCount: words.length,
      speakerCount: speakers.length,
      sentenceCount: null,
      chapterCount: 0,
      language,
    },
    extensions: {
      rawResultArtifactId: context.rawResultArtifactId,
      asrOutcome: result.outcome,
      language: result.language,
      warnings: result.warnings,
      jobId: context.jobId,
      inputHash: context.inputHash,
    },
  };
}
