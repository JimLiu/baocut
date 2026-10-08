import { describe, expect, it } from 'vitest';
import { canonicalLanguageTag, validateAsrResult } from './asr-result.ts';
import type { AsrResult } from './worker-contract.ts';

function valid(): AsrResult {
  return {
    schema: 'baocut.asr-result/v1',
    outcome: 'transcribed',
    timescale: 1_000_000,
    clock: 'source-asset',
    duration: 3_000_000,
    language: { tag: 'en', source: 'detected', confidence: 0.9 },
    segments: [
      {
        id: 'seg-0001',
        start: 0,
        end: 1_000_000,
        text: 'hello world',
        speakerId: 'S1',
        words: [
          { start: 0, end: 400_000, text: 'hello', confidence: 0.9, timingQuality: 'aligned' },
          { start: 500_000, end: 900_000, text: 'world', confidence: null, timingQuality: 'estimated' },
        ],
      },
      {
        id: 'seg-0002',
        start: 1_000_000,
        end: 2_000_000,
        text: 'again',
        speakerId: null,
        words: [{ start: 1_000_000, end: 1_000_000, text: 'again', confidence: null, timingQuality: 'missing' }],
      },
    ],
    speakers: [{ id: 'S1', label: null }],
    coverage: [{ start: 0, end: 3_000_000 }],
    warnings: [{ code: 'diarization-unavailable' }],
    provenance: {
      provider: 'local',
      bundleId: 'b',
      models: { asr: { family: 'qwen3-asr', revision: 'r' } },
      backend: 'mlx',
      device: 'metal',
      workerVersion: '0.1.0',
      inputHash: '',
      runGeneration: 1,
    },
  };
}

function problemsOf(mutate: (r: AsrResult) => void, expect_ = {}): string[] {
  const r = valid();
  mutate(r);
  const v = validateAsrResult(r, expect_);
  return v.ok ? [] : v.problems;
}

describe('validateAsrResult', () => {
  it('合规的结果通过', () => {
    expect(validateAsrResult(valid(), { runGeneration: 1 })).toMatchObject({ ok: true });
  });

  it('分段：递增、不重叠、在 duration 之内、文本非空', () => {
    expect(problemsOf((r) => (r.segments[1]!.start = 900_000))).toContain('segments[1] 与前一段重叠或没有按 start 递增');
    expect(problemsOf((r) => (r.segments[1]!.end = 4_000_000))).toContain('segments[1] 超出 duration');
    expect(problemsOf((r) => (r.segments[0]!.end = 0))).toContain('segments[0] 的 start 应小于 end');
    expect(problemsOf((r) => (r.segments[0]!.text = '  '))).toContain('segments[0].text 应为非空文本');
    expect(problemsOf((r) => (r.segments[0]!.start = 1.5))).toContain('segments[0] 的时间应为非负整数 tick');
  });

  it('词：在段内、单调、时间缺失的取段首', () => {
    expect(problemsOf((r) => (r.segments[0]!.words[1]!.end = 1_200_000))).toContain('segments[0].words[1] 超出所在段');
    expect(problemsOf((r) => (r.segments[0]!.words[1]!.start = 300_000))).toContain('segments[0].words[1] 没有单调递增');
    expect(problemsOf((r) => (r.segments[0]!.words[0]!.timingQuality = 'guess' as never))).toContain(
      'segments[0].words[0].timingQuality 不在取值范围内',
    );
    expect(
      problemsOf((r) => {
        r.segments[1]!.words[0]!.start = 1_100_000;
        r.segments[1]!.words[0]!.end = 1_100_000;
      }),
    ).toContain('segments[1].words[0] 的时间缺失时应为所在段的 start');
  });

  it('说话人、语言与结果种类', () => {
    expect(problemsOf((r) => (r.segments[0]!.speakerId = 'S9'))).toContain('segments[0].speakerId 不在 speakers 里');
    expect(problemsOf((r) => (r.language.tag = 'not a tag!'))).toContain('language.tag 不是合法的 BCP 47');
    expect(problemsOf((r) => (r.language.source = 'asserted'), { assertedLanguage: 'zh-CN' })).toContain('language.tag 与断言的语言不一致');
    expect(problemsOf((r) => (r.language = { tag: 'zh-cn', source: 'asserted', confidence: null }), { assertedLanguage: 'zh-CN' })).toEqual(
      [],
    );
    expect(problemsOf((r) => (r.outcome = 'no-speech'))).toContain('outcome 为 no-speech 时 segments 应为空');
    expect(problemsOf((r) => (r.schema = 'other' as never))).toContain('schema 应为 baocut.asr-result/v1');
    expect(problemsOf((r) => (r.provenance.runGeneration = 2), { runGeneration: 1 })).toContain('provenance.runGeneration 与这次尝试不符');
    expect(validateAsrResult(null)).toEqual({ ok: false, problems: ['结果不是一个对象'] });
  });

  it('BCP 47 规范化', () => {
    expect(canonicalLanguageTag('zh-cn')).toBe('zh-CN');
    expect(canonicalLanguageTag('???')).toBeNull();
  });
});
