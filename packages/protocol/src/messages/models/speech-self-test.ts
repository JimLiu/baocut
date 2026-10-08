import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './speech-self-test.zh-Hans.ts';
import { zhHant } from './speech-self-test.zh-Hant.ts';
import { ja } from './speech-self-test.ja.ts';
import { ko } from './speech-self-test.ko.ts';
import { es } from './speech-self-test.es.ts';
import { fr } from './speech-self-test.fr.ts';
import { de } from './speech-self-test.de.ts';
import { nl } from './speech-self-test.nl.ts';
import { ptBR } from './speech-self-test.pt-BR.ts';
import { it } from './speech-self-test.it.ts';
import { ru } from './speech-self-test.ru.ts';
import { pl } from './speech-self-test.pl.ts';
import { tr } from './speech-self-test.tr.ts';
import { vi } from './speech-self-test.vi.ts';

/** `packages/models/src/speech-self-test.ts` 语音合成自检没通过的原因（含 WAV 解析的问题，人声分离自检也用）。 */
const en = {
  notWav: 'Not a RIFF/WAVE file',
  missingFmt: 'The fmt chunk is missing',
  missingData: 'The data chunk is missing',
  unsupportedEncoding: (p: { format: number }) => `Unsupported encoding (${p.format})`,
  badChannels: (p: { channels: number }) => `Unreasonable channel count (${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `Unreasonable sample rate (${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `Unsupported bit depth (${p.bits})`,
  nonFinite: 'The samples contain non-finite values',
  undecodable: (p: { problem: string }) => `The output can't be decoded: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `The duration of ${p.duration} seconds is not between ${p.min} and ${p.max} seconds`,
  silent: 'The output is silent',
  clipped: (p: { ratio: string; limit: number }) => `The output clips: ${p.ratio}% of samples reach full scale (limit ${p.limit}%)`,
};

export type ModelsSpeechSelfTestMessages = typeof en;

export const ModelsSpeechSelfTest = defineCatalog('modelsSpeechSelfTest', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
