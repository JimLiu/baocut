import { ModelsAsrResult as M } from '@baocut/protocol/messages/models/asr-result.ts';
import type { Localized } from '@baocut/protocol';
import { ASR_RESULT_SCHEMA, ASR_WARNING_CODES, TIMING_QUALITIES, type AsrResult } from './worker-contract.ts';

/**
 * `baocut.asr-result/v1` 的校验（Model Worker 协议规范 §6）。Runtime 在发布产物之前执行；不通过就是
 * `MODEL_OUTPUT_INVALID`，不重试同一输入。
 *
 * 不检查的两条：`aligned` 的词要求 ASR 自身有词级时间能力——Runtime 看不出这一点，只在没有对齐器时也接受；
 * `provenance.inputHash`——`job.run` 不携带输入 hash，Worker 无从回填（见最终报告）。
 */

export interface AsrExpectations {
  /** 请求里断言的语言：`language.source === 'asserted'` 时结果必须等于它。 */
  assertedLanguage?: string;
  /** 这次尝试的 `runGeneration`，结果的 `provenance.runGeneration` 必须原样回填。 */
  runGeneration?: number;
}

export type AsrValidation = { ok: true; result: AsrResult } | { ok: false; problems: string[] };

const MAX_PROBLEMS = 20;

/** 合法的 BCP 47 标签返回规范形式，否则 null。 */
export function canonicalLanguageTag(tag: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    return canonical ?? null;
  } catch {
    return null;
  }
}

export function validateAsrResult(value: unknown, expect: AsrExpectations = {}): AsrValidation {
  const problems: string[] = [];
  // problems 是给人看的文本（调用方只收字符串）；按生成时的语言存文本，不带引用。
  const fail = (message: Localized) => {
    if (problems.length < MAX_PROBLEMS) problems.push(message.text);
  };
  if (!isObject(value)) return { ok: false, problems: [M.notObject().text] };
  const r = value;

  if (r.schema !== ASR_RESULT_SCHEMA) fail(M.schemaShouldBe({ schema: ASR_RESULT_SCHEMA }));
  const outcome = r.outcome;
  if (outcome !== 'transcribed' && outcome !== 'no-audio-track' && outcome !== 'no-speech') fail(M.outcomeOutOfRange());
  if (!isPositiveInt(r.timescale)) fail(M.timescaleInvalid());
  if (r.clock !== 'source-asset') fail(M.clockInvalid());
  const duration = r.duration;
  if (!isNonNegativeInt(duration)) fail(M.durationInvalid());
  const limit = isNonNegativeInt(duration) ? duration : Number.MAX_SAFE_INTEGER;

  // 语言
  if (!isObject(r.language)) fail(M.languageNotObject());
  else {
    const { tag, source, confidence } = r.language;
    if (tag !== null && (typeof tag !== 'string' || canonicalLanguageTag(tag) === null)) fail(M.languageTagInvalid());
    if (source !== 'asserted' && source !== 'detected' && source !== 'unknown') fail(M.languageSourceOutOfRange());
    if (confidence !== null && !isUnit(confidence)) fail(M.languageConfidenceInvalid());
    if (source === 'asserted') {
      const wanted = expect.assertedLanguage === undefined ? undefined : canonicalLanguageTag(expect.assertedLanguage);
      const got = typeof tag === 'string' ? canonicalLanguageTag(tag) : null;
      if (wanted === undefined) fail(M.assertedWithoutRequest());
      else if (got !== wanted) fail(M.languageMismatch());
    }
  }

  // 说话人
  const speakerIds = new Set<string>();
  if (!Array.isArray(r.speakers)) fail(M.speakersNotArray());
  else
    for (const speaker of r.speakers) {
      if (!isObject(speaker) || typeof speaker.id !== 'string' || speaker.id === '') fail(M.speakerIdInvalid());
      else if (speakerIds.has(speaker.id)) fail(M.speakerDuplicate({ id: speaker.id }));
      else {
        speakerIds.add(speaker.id);
        if (speaker.label !== null && typeof speaker.label !== 'string') fail(M.speakerLabelInvalid({ id: speaker.id }));
      }
    }

  // 分段与词
  if (!Array.isArray(r.segments)) fail(M.segmentsNotArray());
  else {
    if (outcome !== 'transcribed' && r.segments.length > 0) fail(M.segmentsNotEmpty({ outcome: String(outcome) }));
    const segmentIds = new Set<string>();
    let previousEnd = 0;
    r.segments.forEach((segment: unknown, i: number) => {
      const at = `segments[${i}]`;
      if (!isObject(segment)) return fail(M.notObjectAt({ at }));
      if (typeof segment.id !== 'string' || segment.id === '') fail(M.idInvalid({ at }));
      else if (segmentIds.has(segment.id)) fail(M.idDuplicate({ at }));
      else segmentIds.add(segment.id);
      const { start, end } = segment;
      if (!isNonNegativeInt(start) || !isNonNegativeInt(end)) return fail(M.timeInvalid({ at }));
      if (!(start < end)) fail(M.startNotBeforeEnd({ at }));
      if (end > limit) fail(M.beyondDuration({ at }));
      if (start < previousEnd) fail(M.overlaps({ at }));
      previousEnd = Math.max(previousEnd, end);
      if (typeof segment.text !== 'string' || segment.text.trim() === '') fail(M.textEmpty({ at }));
      if (segment.speakerId !== null && (typeof segment.speakerId !== 'string' || !speakerIds.has(segment.speakerId))) {
        fail(M.speakerUnknown({ at }));
      }
      if (!Array.isArray(segment.words)) return fail(M.wordsNotArray({ at }));
      let wordEnd = start;
      segment.words.forEach((word: unknown, j: number) => {
        const wat = `${at}.words[${j}]`;
        if (!isObject(word)) return fail(M.notObjectAt({ at: wat }));
        if (!isNonNegativeInt(word.start) || !isNonNegativeInt(word.end)) return fail(M.timeInvalid({ at: wat }));
        if (word.start > word.end) fail(M.wordStartAfterEnd({ at: wat }));
        if (word.start < start || word.end > end) fail(M.wordOutsideSegment({ at: wat }));
        if (word.start < wordEnd) fail(M.wordNotMonotonic({ at: wat }));
        wordEnd = Math.max(wordEnd, word.end);
        if (typeof word.text !== 'string' || word.text.trim() === '') fail(M.textEmpty({ at: wat }));
        if (word.confidence !== null && !isUnit(word.confidence)) fail(M.confidenceInvalid({ at: wat }));
        if (word.speakerId !== undefined && (typeof word.speakerId !== 'string' || !speakerIds.has(word.speakerId))) {
          fail(M.speakerUnknown({ at: wat }));
        }
        if (!TIMING_QUALITIES.includes(word.timingQuality as never)) fail(M.timingQualityOutOfRange({ at: wat }));
        if (word.timingQuality === 'missing' && (word.start !== word.end || word.start !== start)) {
          fail(M.missingTimingStart({ at: wat }));
        }
      });
    });
  }

  // 覆盖范围
  if (!Array.isArray(r.coverage)) fail(M.coverageNotArray());
  else
    r.coverage.forEach((range: unknown, i: number) => {
      if (!isObject(range) || !isNonNegativeInt(range.start) || !isNonNegativeInt(range.end)) return fail(M.coverageInvalid({ at: `coverage[${i}]` }));
      if (range.start > range.end || range.end > limit) fail(M.coverageOutOfRange({ at: `coverage[${i}]` }));
    });

  // 警告
  if (!Array.isArray(r.warnings)) fail(M.warningsNotArray());
  else
    r.warnings.forEach((warning: unknown, i: number) => {
      if (!isObject(warning) || !ASR_WARNING_CODES.includes(warning.code as never)) fail(M.warningCodeOutOfRange({ at: `warnings[${i}]` }));
      else if (warning.segmentId !== undefined && typeof warning.segmentId !== 'string') fail(M.warningSegmentIdInvalid({ at: `warnings[${i}]` }));
    });

  // 来源
  if (!isObject(r.provenance)) fail(M.provenanceNotObject());
  else {
    const p = r.provenance;
    for (const key of ['provider', 'backend', 'device', 'workerVersion'] as const) {
      if (typeof p[key] !== 'string' || p[key] === '') fail(M.provenanceFieldEmpty({ key }));
    }
    if (p.bundleId !== null && typeof p.bundleId !== 'string') fail(M.bundleIdInvalid());
    if (!isObject(p.models)) fail(M.modelsNotObject());
    if (!Number.isInteger(p.runGeneration)) fail(M.runGenerationInvalid());
    else if (expect.runGeneration !== undefined && p.runGeneration !== expect.runGeneration)
      fail(M.runGenerationMismatch());
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, result: value as unknown as AsrResult };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isUnit(value: unknown): boolean {
  return typeof value === 'number' && value >= 0 && value <= 1;
}
