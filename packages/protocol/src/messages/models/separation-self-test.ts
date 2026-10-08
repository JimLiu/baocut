import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './separation-self-test.zh-Hans.ts';
import { zhHant } from './separation-self-test.zh-Hant.ts';
import { ja } from './separation-self-test.ja.ts';
import { ko } from './separation-self-test.ko.ts';
import { es } from './separation-self-test.es.ts';
import { fr } from './separation-self-test.fr.ts';
import { de } from './separation-self-test.de.ts';
import { nl } from './separation-self-test.nl.ts';
import { ptBR } from './separation-self-test.pt-BR.ts';
import { it } from './separation-self-test.it.ts';
import { ru } from './separation-self-test.ru.ts';
import { pl } from './separation-self-test.pl.ts';
import { tr } from './separation-self-test.tr.ts';
import { vi } from './separation-self-test.vi.ts';

/** `packages/models/src/separation-self-test.ts` 人声分离自检没通过的原因。 */
const en = {
  vocals: 'vocal track',
  background: 'background track',
  vocalsUndecodable: (p: { problem: string }) => `The vocal track can't be decoded: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `The background track can't be decoded: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `The ${p.stem} is not stereo (${p.channels} channels)`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `The ${p.stem} is ${p.duration} seconds long, but the sample is ${p.sample} seconds`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `The two tracks have different sample rates (${p.vocals} and ${p.background})`,
  vocalsSilent: 'The vocal track is silent',
  vocalsNotLouder: (p: { vocals: string; background: string }) => `The sample is voice only, yet the vocal track is not clearly louder than the background (RMS ${p.vocals} and ${p.background})`,
};

export type ModelsSeparationSelfTestMessages = typeof en;

export const ModelsSeparationSelfTest = defineCatalog('modelsSeparationSelfTest', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
