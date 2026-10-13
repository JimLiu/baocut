import { describe, expect, it } from 'vitest';
import { importElevenLabsTranscript } from './elevenlabs-transcript.ts';

const word = (patch: Record<string, unknown> = {}) => ({ type: 'word', text: 'Hello', start: 0.125, end: 0.5, speaker_id: 'speaker_1', ...patch });

describe('offline ElevenLabs transcript import', () => {
  it('keeps provider word times, speaker IDs and text; reports excluded tokens', () => {
    const result = importElevenLabsTranscript({ language_code: 'en', text: 'Hello world!', words: [
      word(), { type: 'spacing', text: ' ' }, word({ text: 'world!', start: 0.6, end: 1, speaker_id: 'speaker_2' }),
      { type: 'audio_event', text: '(laughter)' },
    ] });
    expect(result.language).toBe('en');
    expect(result.body).toMatchObject({ schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1_000_000, sentences: null, chapters: [] });
    expect(result.body.words).toEqual([
      { id: 'w-elevenlabs-1', text: 'Hello', start: 125000, end: 500000, speaker: 'speaker_1' },
      { id: 'w-elevenlabs-2', text: 'world!', start: 600000, end: 1000000, speaker: 'speaker_2' },
    ]);
    expect(result.body.speakers).toEqual([{ id: 'speaker_1', name: 'speaker_1' }, { id: 'speaker_2', name: 'speaker_2' }]);
    expect(result.imported).toEqual({ format: 'elevenlabs', wordCount: 2, skipped: { spacing: 1, audioEvents: 1 } });
  });

  it('does not invent speakers or language, and preserves non-Latin text', () => {
    const result = importElevenLabsTranscript({ words: [word({ text: '你好', speaker_id: null }), word({ text: '世界', start: 0.5, end: 1, speaker_id: null })] });
    expect(result.language).toBeUndefined();
    expect(result.body.speakers).toEqual([]);
    expect(result.body.words.map((entry) => entry.text)).toEqual(['你好', '世界']);
    expect(result.body.words[0]).not.toHaveProperty('speaker');
  });

  it('rounds seconds to integer microseconds and allows overlapping speaker times', () => {
    const result = importElevenLabsTranscript({ words: [word({ start: 0.1234567, end: 0.8 }), word({ start: 0.2, end: 0.4 })] });
    expect(result.body.words[0]!.start).toBe(123457);
    expect(result.body.speakers).toHaveLength(1);
  });

  it.each([
    { start: null }, { end: null }, { start: undefined }, { end: undefined },
    { start: -1 }, { start: NaN }, { end: Infinity }, { start: 0.8, end: 0.5 },
    { start: 1e12, end: 1e12 + 1 }, { text: '' }, { text: ' ' }, { type: 'other' }, { speaker_id: '' },
  ])('rejects invalid or absent word evidence: %j', (patch) => {
    expect(() => importElevenLabsTranscript({ words: [word(patch)] })).toThrow();
  });

  it('rejects out-of-order words rather than silently changing transcript order', () => {
    expect(() => importElevenLabsTranscript({ words: [word({ start: 1, end: 2 }), word()] })).toThrow(/ordered/);
  });

  it.each([{ text: 'Untimed' }, { words: [] }, { words: [{ type: 'audio_event', text: '(music)' }] }, { transcripts: [], words: [word()] }])('rejects unsupported transcript envelopes: %j', (body) => {
    expect(() => importElevenLabsTranscript(body)).toThrow();
  });
});
