import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './speech-worker.zh-Hans.ts';
import { zhHant } from './speech-worker.zh-Hant.ts';
import { ja } from './speech-worker.ja.ts';
import { ko } from './speech-worker.ko.ts';
import { es } from './speech-worker.es.ts';
import { fr } from './speech-worker.fr.ts';
import { de } from './speech-worker.de.ts';
import { nl } from './speech-worker.nl.ts';
import { ptBR } from './speech-worker.pt-BR.ts';
import { it } from './speech-worker.it.ts';
import { ru } from './speech-worker.ru.ts';
import { pl } from './speech-worker.pl.ts';
import { tr } from './speech-worker.tr.ts';
import { vi } from './speech-worker.vi.ts';

/** `packages/jobs/src/pipelines/speech-worker.ts` 给人看的文字：错误与产出检查（`details.problems`）。 */
const en = {
  incompatible: (p: { protocol: string }) => `Speech Worker's protocol isn't ${p.protocol}`,
  exited: 'Speech Worker exited unexpectedly',
  translationLanguage: "The translation's language doesn't match the target language",
  outputInvalid: "Speech Worker's output doesn't match the contract",
  outputTruncated: "The model's output hit the limit and was truncated",
  resultMissing: (p: { field: string }) => `Speech Worker's result is missing ${p.field}`,
  unreadableFile: (p: { name: string }) => `Can't read ${p.name} written by Speech Worker`,
  cuesNotObject: "The cues aren't an object",
  cuesSchema: (p: { schema: string }) => `The cues schema must be ${p.schema}`,
  cuesLanguage: "The cues' language doesn't match the target language",
  cuesTimescale: "The cues' timescale must match the source transcript's",
  cuesMissing: 'cues is missing',
  cueNotObject: (p: { n: number }) => `Cue ${p.n} isn't an object`,
  cueNoText: (p: { n: number }) => `Cue ${p.n} has no text`,
  cueNoSentence: (p: { n: number }) => `Cue ${p.n} is missing its sentence or unit`,
  cueFallback: (p: { n: number }) => `Cue ${p.n}'s fallback isn't a boolean`,
  cueTicks: (p: { n: number }) => `Cue ${p.n}'s times aren't integer ticks`,
  cueRange: (p: { n: number }) => `Cue ${p.n} has an invalid time range`,
  cueOverlap: (p: { n: number }) => `Cue ${p.n} overlaps the previous one or is out of order`,
  cueBeyond: (p: { n: number }) => `Cue ${p.n} runs past the media duration`,
};

export type JobsSpeechWorkerMessages = typeof en;

export const JobsSpeechWorker = defineCatalog('jobsSpeechWorker', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
