import { z } from 'zod';
import { ToolError } from './tool-catalog.ts';

const wordSchema = z.object({
  type: z.enum(['word', 'spacing', 'audio_event']),
  text: z.string(),
  start: z.number().finite().nonnegative().nullable().optional(),
  end: z.number().finite().nonnegative().nullable().optional(),
  speaker_id: z.string().min(1).max(200).nullable().optional(),
});
const transcriptSchema = z.object({
  language_code: z.string().regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/).nullable().optional(),
  words: z.array(wordSchema).min(1).max(250_000),
});

/** Offline import of a single Scribe transcript; never sends media or requests inference. */
export function importElevenLabsTranscript(input: Record<string, unknown>) {
  // i18n-ignore-start: Agent tool diagnostics, not UI copy.
  if ('transcripts' in input) throw new ToolError('INVALID_ARGUMENTS', 'Import one ElevenLabs transcript at a time, not a multichannel transcripts envelope.');
  const parsed = transcriptSchema.safeParse(input);
  if (!parsed.success) throw new ToolError('INVALID_ARGUMENTS', 'Expected an ElevenLabs transcript with typed words and word timestamps.');
  const words: Array<{ id: string; text: string; start: number; end: number; speaker?: string; glue?: true }> = [];
  const speakers = new Map<string, { id: string; name: string }>();
  const skipped = { spacing: 0, audioEvents: 0 };
  let previousStart = -1;
  let spacingSinceWord = false;
  for (const word of parsed.data.words) {
    if (word.type === 'spacing') { skipped.spacing++; spacingSinceWord = true; continue; }
    if (word.type === 'audio_event') { skipped.audioEvents++; continue; }
    if (!word.text.trim() || word.start == null || word.end == null || word.end < word.start || word.start < previousStart) {
      throw new ToolError('INVALID_ARGUMENTS', 'Speech words need nonempty text and nonnegative, ordered start/end timestamps in source seconds.');
    }
    const start = Math.round(word.start * 1_000_000);
    const end = Math.round(word.end * 1_000_000);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new ToolError('INVALID_ARGUMENTS', 'ElevenLabs timestamps exceed the safe integer range in microseconds.');
    }
    previousStart = word.start;
    if (word.speaker_id) speakers.set(word.speaker_id, { id: word.speaker_id, name: word.speaker_id });
    // Provider token boundaries remain authoritative even when the language is absent or unknown.
    words.push({ id: `w-elevenlabs-${words.length + 1}`, text: word.text, start, end,
      ...(word.speaker_id ? { speaker: word.speaker_id } : {}),
      ...(words.length && !spacingSinceWord ? { glue: true as const } : {}),
    });
    spacingSinceWord = false;
  }
  if (!words.length) throw new ToolError('INVALID_ARGUMENTS', 'The ElevenLabs transcript has no timed speech words to import.');
  // i18n-ignore-end
  return {
    body: {
      schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1_000_000,
      engine: { provider: 'elevenlabs', imported: true },
      speakers: [...speakers.values()], words, sentences: null, chapters: [],
    },
    language: parsed.data.language_code ?? undefined,
    imported: { format: 'elevenlabs' as const, wordCount: words.length, skipped },
  };
}
