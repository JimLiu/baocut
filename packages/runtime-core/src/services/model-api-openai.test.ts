import { describe, expect, it } from 'vitest';
import { ASR_RESULT_SCHEMA, type AsrResult, type Segment } from '@baocut/models';
import { ApiError } from './model-api-errors.ts';
import { UNKNOWN_SPEAKER, transcriptionBody, transcriptionOptions } from './model-api-openai.ts';

const MS = 1000;

function word(text: string, start: number, end: number, speakerId?: string) {
  return { text, start: start * MS, end: end * MS, confidence: null, timingQuality: 'aligned' as const, ...(speakerId ? { speakerId } : {}) };
}

function segment(id: string, text: string, speakerId: string | null, words: Segment['words']): Segment {
  return { id, start: words[0]!.start, end: words.at(-1)!.end, text, speakerId, words };
}

function result(segments: Segment[], extra: Partial<AsrResult> = {}): AsrResult {
  return {
    schema: ASR_RESULT_SCHEMA,
    outcome: 'transcribed',
    timescale: MS,
    clock: 'source-asset',
    duration: 12 * MS,
    language: { tag: 'en', source: 'detected', confidence: null },
    segments,
    speakers: [],
    coverage: [],
    warnings: [],
    provenance: {} as AsrResult['provenance'],
    ...extra,
  };
}

function fields(entries: Record<string, string | string[]>): Map<string, string[]> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
}

const trace = { jobId: 'job_1', providerId: 'local', modelId: 'qwen3-asr-1.7b@mlx-8bit' };

describe('diarized_json', () => {
  it('只有 diarized_json 要区分说话人', () => {
    expect(transcriptionOptions(fields({ response_format: 'diarized_json' })).diarize).toBe(true);
    for (const format of ['json', 'verbose_json', 'text', 'srt', 'vtt']) {
      expect(transcriptionOptions(fields({ response_format: format })).diarize).toBe(false);
    }
  });

  it('已知说话人的参数回答 UNSUPPORTED_PARAMETER；chunking_strategy 照旧忽略', () => {
    for (const key of ['known_speaker_names[]', 'known_speaker_references[]', 'known_speaker_names']) {
      const error = (() => {
        try {
          transcriptionOptions(fields({ response_format: 'diarized_json', [key]: 'agent' }));
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe('UNSUPPORTED_PARAMETER');
    }
    expect(transcriptionOptions(fields({ response_format: 'diarized_json', chunking_strategy: 'auto' })).diarize).toBe(true);
  });

  it('形状同 OpenAI：说话人按首次出现标 A、B；段里够长的插话按词切出来，文字与标点照段文字', () => {
    const asr = result(
      [
        segment('s1', 'Hello there.', 'spk-2', [word('Hello', 0, 0.5, 'spk-2'), word('there.', 0.5, 1, 'spk-2')]),
        segment('s2', 'So what do you think? I agree, ship it.', 'spk-1', [
          word('So', 1.2, 1.4, 'spk-1'),
          word('what', 1.4, 1.6, 'spk-1'),
          word('do', 1.6, 1.7, 'spk-1'),
          word('you', 1.7, 1.8, 'spk-1'),
          word('think?', 1.8, 2.2, 'spk-1'),
          word('I', 2.5, 2.6, 'spk-2'),
          word('agree,', 2.6, 3, 'spk-2'),
          word('ship', 3.1, 3.4),
          word('it.', 3.4, 3.8, 'spk-2'),
        ]),
        segment('s3', '我们明天上线。', 'spk-3', [word('我们', 4, 4.4, 'spk-3'), word('明天', 4.4, 4.8, 'spk-3'), word('上线', 4.8, 5.2, 'spk-3')]),
      ],
      { speakers: [{ id: 'spk-1', label: null }, { id: 'spk-2', label: null }, { id: 'spk-3', label: null }] },
    );
    const { body, contentType } = transcriptionBody(asr, transcriptionOptions(fields({ response_format: 'diarized_json' })), trace);
    expect(contentType).toMatch(/^application\/json/);
    expect(JSON.parse(body)).toEqual({
      task: 'transcribe',
      duration: 12,
      text: 'Hello there. So what do you think? I agree, ship it.我们明天上线。',
      segments: [
        { type: 'transcript.text.segment', id: 'seg_001', start: 0, end: 1, text: 'Hello there.', speaker: 'A' },
        { type: 'transcript.text.segment', id: 'seg_002', start: 1.2, end: 2.2, text: 'So what do you think?', speaker: 'B' },
        { type: 'transcript.text.segment', id: 'seg_003', start: 2.5, end: 3.8, text: 'I agree, ship it.', speaker: 'A' },
        { type: 'transcript.text.segment', id: 'seg_004', start: 4, end: 5.2, text: '我们明天上线。', speaker: 'C' },
      ],
      baocut: { ...trace, language: 'en' },
    });
  });

  it('词在段文字里对不上时不切，整段算段的说话人', () => {
    const asr = result([
      segment('s1', 'Hello, there!', 'spk-1', [word('hello', 0, 0.5, 'spk-1'), word('there', 0.5, 1, 'spk-2')]),
    ]);
    const parsed = JSON.parse(transcriptionBody(asr, transcriptionOptions(fields({ response_format: 'diarized_json' })), trace).body);
    expect(parsed.segments).toEqual([
      { type: 'transcript.text.segment', id: 'seg_001', start: 0, end: 1, text: 'Hello, there!', speaker: 'A' },
    ]);
  });

  it('说话人区分没跑成：speaker 仍是字符串，警告带在 baocut 里', () => {
    const asr = result([segment('s1', 'Hello there.', null, [word('Hello', 0, 0.5), word('there.', 0.5, 1)])], {
      warnings: [{ code: 'diarization-unavailable' }],
    });
    const parsed = JSON.parse(transcriptionBody(asr, transcriptionOptions(fields({ response_format: 'diarized_json' })), trace).body);
    expect(parsed.segments[0].speaker).toBe(UNKNOWN_SPEAKER);
    expect(parsed.baocut.warnings).toEqual(['diarization-unavailable']);
  });

  it('超过 26 个说话人接着标 AA、AB', () => {
    const segments = Array.from({ length: 28 }, (_, i) =>
      segment(`s${i}`, `w${i}`, `spk-${i + 1}`, [word(`w${i}`, i, i + 0.5, `spk-${i + 1}`)]),
    );
    const parsed = JSON.parse(transcriptionBody(result(segments), transcriptionOptions(fields({ response_format: 'diarized_json' })), trace).body);
    expect(parsed.segments.map((s: { speaker: string }) => s.speaker).slice(24)).toEqual(['Y', 'Z', 'AA', 'AB']);
  });
});
