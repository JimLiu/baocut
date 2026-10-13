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

  it.each([
    ['tha', 'ลลิตา', 'ไม่ได้'],
    ['lao', 'ຂ້ອຍ', 'ຮັກ'],
    ['mya', 'ကျွန်တော်', 'ပါ'],
    ['khm', 'ខ្ញុំ', 'ចូលចិត្ត'],
    [undefined, 'inter', 'national'],
  ])('keeps provider no-space boundaries for %s, including an absent language', (language, before, after) => {
    const result = importElevenLabsTranscript({ language_code: language, words: [
      word({ text: before }), word({ text: after, start: 0.5, end: 1 }),
    ] });
    expect(result.body.words[0]).not.toHaveProperty('glue');
    expect(result.body.words[1]).toMatchObject({ text: after, glue: true });
  });

  it('keeps spacing boundaries across excluded audio events, without inventing gaps for those events', () => {
    const result = importElevenLabsTranscript({ words: [
      { type: 'spacing', text: ' ' }, word({ text: 'ลลิตา' }),
      { type: 'spacing', text: ' ' }, { type: 'audio_event', text: '(laughter)' },
      word({ text: 'ไม่ได้', start: 0.5, end: 1 }), { type: 'audio_event', text: '(music)' },
      word({ text: 'ยกเลิก', start: 1, end: 1.5 }), { type: 'spacing', text: ' ' },
    ] });
    expect(result.body.words.map((entry) => entry.glue)).toEqual([undefined, undefined, true]);
    expect(result.imported).toMatchObject({ wordCount: 3, skipped: { spacing: 3, audioEvents: 2 } });
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
