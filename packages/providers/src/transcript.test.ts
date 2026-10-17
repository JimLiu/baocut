import { describe, expect, it } from 'vitest';
import { validateAsrResult } from '@baocut/models';
import { parseGeneralInteraction, parseTranscribeInteraction, offsetSec } from './google/google-adapter.ts';
import { languageTagOf, parseOpenAiTranscription } from './openai/openai-transcription.ts';
import {
  buildAsrResult,
  groupWords,
  joinWords,
  noAudioResult,
  repairWordTimes,
  resolveOverlaps,
  type ResultContext,
} from './transcript.ts';

const context = (overrides: Partial<ResultContext> = {}): ResultContext => ({
  providerId: 'openai',
  modelId: 'whisper-1',
  workerVersion: 'test@1',
  contentHash: 'sha256:abc',
  runGeneration: 1,
  timescale: 1000,
  language: { mode: 'prefer', tag: null },
  offsetSec: 0,
  ...overrides,
});

describe('buildAsrResult', () => {
  it('供应商的词时间标 provider，没有词的段按字符长度插值标 estimated；时间换回素材时钟的整数 tick', () => {
    const result = buildAsrResult({
      context: context({ offsetSec: 10 }),
      decodedSec: 20,
      chunks: [
        {
          startSec: 0,
          endSec: 8,
          transcript: {
            text: 'hello world',
            segments: [{ start: 1, end: 2.5, text: ' hello world' }],
            words: [
              { start: 1, end: 1.5, text: 'hello' },
              { start: 1.6, end: 2.4, text: 'world' },
            ],
            language: 'english',
            usage: { seconds: 8 },
          },
        },
        {
          startSec: 8,
          endSec: 20,
          transcript: { text: '第二段', segments: [{ start: 0.5, end: 2, text: '第二段' }], usage: { seconds: 12 } },
        },
      ],
    });
    expect(validateAsrResult(result, { runGeneration: 1 })).toMatchObject({ ok: true });
    expect(result).toMatchObject({ outcome: 'transcribed', duration: 30_000, coverage: [{ start: 10_000, end: 30_000 }], warnings: [] });
    expect(result.segments.map((s) => [s.id, s.start, s.end, s.text])).toEqual([
      ['seg-0001', 11_000, 12_500, 'hello world'],
      ['seg-0002', 18_500, 20_000, '第二段'],
    ]);
    expect(result.segments[0]!.words).toEqual([
      { start: 11_000, end: 11_500, text: 'hello', confidence: null, timingQuality: 'provider' },
      { start: 11_600, end: 12_400, text: 'world', confidence: null, timingQuality: 'provider' },
    ]);
    expect(result.segments[1]!.words.length).toBeGreaterThan(0);
    expect(result.segments[1]!.words.every((w) => w.timingQuality === 'estimated')).toBe(true);
    expect(result.segments[1]!.words[0]!.start).toBe(18_500);
    expect(result.segments[1]!.words.at(-1)!.end).toBe(20_000);
    expect(result.language).toEqual({ tag: 'english', source: 'detected', confidence: null });
    expect(result.provenance).toMatchObject({
      provider: 'openai',
      bundleId: null,
      backend: 'online',
      device: 'remote',
      inputHash: 'sha256:abc',
      cost: { status: 'reported', usage: [{ seconds: 8 }, { seconds: 12 }] },
    });
  });

  it('词超出段、段与前一段重叠：在重叠区中点分开、修正并记 timing-adjusted；换算之后没有长度的段丢弃并记 segment-degenerate', () => {
    const result = buildAsrResult({
      context: context(),
      decodedSec: 10,
      chunks: [
        {
          startSec: 0,
          endSec: 10,
          transcript: {
            text: '',
            segments: [
              { start: 0, end: 3, text: 'one two' },
              { start: 2.5, end: 5, text: 'three' },
              { start: 6, end: 6.0001, text: 'blip' },
            ],
            words: [
              { start: 0.2, end: 1, text: 'one' },
              { start: 0.9, end: 3.4, text: 'two' },
              { start: 2.6, end: 4, text: 'three' },
            ],
          },
        },
      ],
    });
    expect(validateAsrResult(result, { runGeneration: 1 })).toMatchObject({ ok: true });
    expect(result.segments.map((s) => [s.start, s.end])).toEqual([
      [0, 2750],
      [2750, 5000],
    ]);
    expect(result.warnings.map((w) => w.code).sort()).toEqual(['segment-degenerate', 'timing-adjusted', 'timing-adjusted']);
    expect(result.segments[1]!.words[0]).toMatchObject({ start: 2750, end: 4000, timingQuality: 'provider' });
  });

  it('供应商的词时间里零星丢或多一位数字：按前后插值修好、标 estimated，不把后面的词拖塌', () => {
    // gemini-3.5-transcribe 实测：4.2 秒写成 "404.200s"（下一个词的起点照抄），13.4 秒写成 "3.400s"。
    // 修之前：排序把 3.4 的词挪到前面、404.2 夹到块尾，整块之后的词全挤成一点，几乎每段都带 timing-adjusted。
    // 坏点取前后可信点之间的插值；最后一个词越出块尾时以块尾为界。
    const w = (start: number, end: number, text: string) => ({ start, end, text });
    const result = buildAsrResult({
      context: context({ providerId: 'google', modelId: 'gemini-3.5-transcribe', language: { mode: 'assert', tag: 'zh-CN' } }),
      decodedSec: 30,
      chunks: [
        {
          startSec: 0,
          endSec: 30,
          transcript: {
            text: '',
            words: [
              w(3.7, 3.9, '轮'),
              w(3.9, 404.2, '到'),
              w(404.2, 4.5, '时，'),
              w(4.6, 4.8, '拿'),
              w(4.8, 5.0, '代码。'),
              w(12.5, 12.7, '出错。'),
              w(3.4, 13.5, '合'),
              w(13.5, 13.7, '并'),
              w(13.7, 14.0, '以后。'),
              w(20, 20.3, '最'),
              w(20.3, 205, '后。'),
            ],
          },
        },
      ],
    });
    expect(validateAsrResult(result, { runGeneration: 1, assertedLanguage: 'zh-CN' })).toMatchObject({ ok: true });
    expect(result.segments.map((s) => [s.start, s.end, s.text])).toEqual([
      [3700, 5000, '轮到时，拿代码。'],
      [12_500, 12_700, '出错。'],
      [13_100, 14_000, '合并以后。'],
      [20_000, 25_150, '最后。'],
    ]);
    const words = result.segments.flatMap((s) => s.words);
    expect(words.map((x) => [x.text, x.start, x.end, x.timingQuality])).toEqual([
      ['轮', 3700, 3900, 'provider'],
      ['到', 3900, 4100, 'estimated'],
      ['时，', 4300, 4500, 'estimated'],
      ['拿', 4600, 4800, 'provider'],
      ['代码。', 4800, 5000, 'provider'],
      ['出错。', 12_500, 12_700, 'provider'],
      ['合', 13_100, 13_500, 'estimated'],
      ['并', 13_500, 13_700, 'provider'],
      ['以后。', 13_700, 14_000, 'provider'],
      ['最', 20_000, 20_300, 'provider'],
      ['后。', 20_300, 25_150, 'estimated'],
    ]);
    expect(result.warnings).toEqual([
      { code: 'timing-adjusted', segmentId: 'seg-0001' },
      { code: 'timing-adjusted', segmentId: 'seg-0003' },
      { code: 'timing-adjusted', segmentId: 'seg-0004' },
    ]);
  });

  it('相邻词一秒以内的正常重叠不算离群；没有离群值时原样返回', () => {
    const words = [
      { start: 0.2, end: 1, text: 'one' },
      { start: 0.9, end: 3.4, text: 'two' },
      { start: 2.6, end: 4, text: 'three' },
    ];
    expect(repairWordTimes(words, 10)).toEqual(words);
    expect(repairWordTimes([], 10)).toEqual([]);
  });

  it('整个落在前一段里的插话不丢：从包住它的那段尾巴上分出来，记 timing-adjusted', () => {
    // 多人会议：第一位说话时第二位插了一句，第二位又在第一位说完前开口。原来插话算出来没有长度，被丢弃。
    const result = buildAsrResult({
      context: context({ language: { mode: 'assert', tag: 'zh-Hans' } }),
      decodedSec: 12,
      chunks: [
        {
          startSec: 0,
          endSec: 12,
          transcript: {
            text: '',
            segments: [
              { start: 0, end: 11.5, text: '我们下周发布这个版本。' },
              { start: 0.2, end: 5.4, text: '对，我同意。' },
              { start: 5.5, end: 11.8, text: '测试还没跑完，可能要晚两天。' },
            ],
          },
        },
      ],
    });
    expect(validateAsrResult(result, { runGeneration: 1, assertedLanguage: 'zh-Hans' })).toMatchObject({ ok: true });
    // 第一段与第三段照常在重叠区中点（8.5 秒）分开；插话至多分走第一段剩下的一半。
    expect(result.segments.map((s) => [s.id, s.start, s.end, s.text])).toEqual([
      ['seg-0001', 0, 4250, '我们下周发布这个版本。'],
      ['seg-0002', 4250, 8500, '对，我同意。'],
      ['seg-0003', 8500, 11_800, '测试还没跑完，可能要晚两天。'],
    ]);
    expect(result.warnings).toEqual([{ code: 'timing-adjusted', segmentId: 'seg-0002' }]);
  });

  it('只有词：按停顿与句末标点分段；只有文本：整块一段；什么都没有：no-speech', () => {
    const words = buildAsrResult({
      context: context(),
      decodedSec: 10,
      chunks: [
        {
          startSec: 0,
          endSec: 10,
          transcript: {
            text: '',
            words: [
              { start: 0.1, end: 0.4, text: 'Hi' },
              { start: 0.5, end: 0.9, text: 'there.' },
              { start: 1.0, end: 1.3, text: 'New' },
              { start: 1.4, end: 1.8, text: 'one' },
              { start: 4.0, end: 4.5, text: 'later' },
            ],
          },
        },
      ],
    });
    expect(words.segments.map((s) => s.text)).toEqual(['Hi there.', 'New one', 'later']);
    const text = buildAsrResult({
      context: context(),
      decodedSec: 4,
      chunks: [{ startSec: 0, endSec: 4, transcript: { text: '  整块文本 ' } }],
    });
    expect(text.segments).toMatchObject([{ start: 0, end: 4000, text: '整块文本' }]);
    expect(text.provenance.cost).toEqual({ status: 'unknown' });
    const empty = buildAsrResult({ context: context(), decodedSec: 4, chunks: [{ startSec: 0, endSec: 4, transcript: { text: '' } }] });
    expect(empty).toMatchObject({ outcome: 'no-speech', segments: [], coverage: [{ start: 0, end: 4000 }] });
    expect(validateAsrResult(empty)).toMatchObject({ ok: true });
  });

  it('断言的语言原样写回；没有音轨时 duration 为 0、coverage 为空', () => {
    const asserted = buildAsrResult({
      context: context({ language: { mode: 'assert', tag: 'zh-Hans' } }),
      decodedSec: 2,
      chunks: [{ startSec: 0, endSec: 2, transcript: { text: '你好', language: 'en' } }],
    });
    expect(asserted.language).toEqual({ tag: 'zh-Hans', source: 'asserted', confidence: null });
    expect(validateAsrResult(asserted, { assertedLanguage: 'zh-Hans' })).toMatchObject({ ok: true });
    const none = noAudioResult(context({ language: { mode: 'prefer', tag: 'ja' } }));
    expect(none).toMatchObject({ outcome: 'no-audio-track', duration: 0, coverage: [], language: { tag: 'ja', source: 'unknown' } });
    expect(validateAsrResult(none)).toMatchObject({ ok: true });
  });

  it('拼词：中日文之间与标点之前不加空格', () => {
    expect(joinWords(['Hello', ',', 'world', '!'])).toBe('Hello, world!');
    expect(joinWords(['你好', '世界', 'BaoCut'])).toBe('你好世界BaoCut');
    expect(
      groupWords([
        { start: 0, end: 31, text: 'long', confidence: null },
        { start: 31, end: 32, text: 'next', confidence: null },
      ]),
    ).toHaveLength(2);
  });
});

describe('resolveOverlaps', () => {
  const span = (start: number, end: number, text = '') => ({ start, end, text, words: [] as { start: number; end: number; text: string; confidence: number | null }[] });

  it('插话挪到包住它的那段尾巴上，词跟着平移；下一段的分法与没有插话时相同', () => {
    const segments = [
      span(0, 10, 'A'),
      { ...span(2, 3, 'B'), words: [{ start: 2.2, end: 2.6, text: '对', confidence: null }] },
      span(9.5, 15, 'C'),
    ];
    const moved = resolveOverlaps(segments);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [0, 8.75],
      [8.75, 9.75],
      [9.75, 15],
    ]);
    expect([...moved].map((s) => s.text)).toEqual(['B']);
    expect(segments[1]!.words[0]!.start).toBeCloseTo(8.95, 9);
    expect(segments[1]!.words[0]!.end).toBeCloseTo(9.35, 9);
  });

  it('几段插话合起来至多分走一半；起止相同的两段照常对半分开', () => {
    const nested = [span(0, 20), span(1, 10), span(2, 3), span(4, 25)];
    expect(resolveOverlaps(nested).size).toBe(2);
    expect([nested[0], nested[3]].map((s) => [s!.start, s!.end])).toEqual([
      [0, 6],
      [12, 25],
    ]);
    expect(nested[1]!.start).toBe(6);
    expect(nested[1]!.end).toBeCloseTo(11.4, 9);
    expect(nested[2]!.end).toBe(12);
    const duplicate = [span(100, 105), span(100, 105)];
    expect(resolveOverlaps(duplicate).size).toBe(0);
    expect(duplicate.map((s) => [s.start, s.end])).toEqual([
      [100, 102.5],
      [102.5, 105],
    ]);
  });
});

describe('响应解析', () => {
  it('OpenAI：verbose_json 的段、词与语言名；json 只有文本与用量', () => {
    expect(
      parseOpenAiTranscription(
        {
          text: 'hi',
          language: 'japanese',
          segments: [{ start: 0, end: 1, text: 'hi' }, { bogus: true }],
          words: [{ word: 'hi', start: 0, end: 0.5 }],
          usage: { type: 'duration', seconds: 1 },
        },
        'OpenAI',
      ),
    ).toEqual({
      text: 'hi',
      segments: [{ start: 0, end: 1, text: 'hi' }],
      words: [{ start: 0, end: 0.5, text: 'hi' }],
      language: 'ja',
      usage: { type: 'duration', seconds: 1 },
    });
    expect(parseOpenAiTranscription({ text: 'x', usage: { type: 'tokens' } }, 'OpenAI')).toEqual({ text: 'x', usage: { type: 'tokens' } });
    expect(() => parseOpenAiTranscription({ nope: 1 }, 'OpenAI')).toThrow();
    expect(languageTagOf('en')).toBe('en');
    expect(languageTagOf('Klingon')).toBeNull();
  });

  it('Gemini：word_info 标注的偏移；结构化的段；读不出 JSON 时单段兜底；失败状态是拒绝', () => {
    expect(offsetSec('1.250s')).toBe(1.25);
    expect(offsetSec('x')).toBeNull();
    const words = parseTranscribeInteraction({
      status: 'completed',
      steps: [
        {
          content: [
            {
              type: 'text',
              text: 'a b',
              annotations: [
                { type: 'word_info', text: 'a', start_offset: '0.1s', end_offset: '0.2s' },
                { type: 'word_info', text: 'b', start_offset: '0.3s', end_offset: 'bad' },
                { type: 'citation' },
              ],
            },
          ],
        },
      ],
    });
    expect(words).toEqual({ text: 'a b', words: [{ start: 0.1, end: 0.2, text: 'a' }] });
    expect(
      parseGeneralInteraction({ output_text: JSON.stringify({ language: 'fr', segments: [{ start: 0, end: 1, text: 'salut' }] }) }),
    ).toEqual({
      text: 'salut',
      segments: [{ start: 0, end: 1, text: 'salut' }],
      language: 'fr',
    });
    expect(parseGeneralInteraction({ output_text: 'plain transcript', usage: { n: 1 } })).toEqual({
      text: 'plain transcript',
      usage: { n: 1 },
    });
    expect(() => parseGeneralInteraction({ status: 'failed', steps: [] })).toThrow(expect.objectContaining({ kind: 'rejected' }));
    expect(() => parseTranscribeInteraction({ id: 'x' })).toThrow(expect.objectContaining({ kind: 'protocol' }));
  });
});
