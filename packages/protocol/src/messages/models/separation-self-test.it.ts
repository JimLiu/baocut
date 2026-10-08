import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';
import { pluralForm } from '../../i18n.ts';

export const it: ModelsSeparationSelfTestMessages = {
  vocals: "traccia vocale",
  background: "traccia di sottofondo",
  vocalsUndecodable: (p: { problem: string }) => `Impossibile decodificare la traccia vocale: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `Impossibile decodificare la traccia di sottofondo: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem} non è stereo (${pluralForm('it', p.channels, { one: `${p.channels} canale`, other: `${p.channels} canali` })})`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `${p.stem} dura ${p.duration} secondi, ma il campione dura ${p.sample} s`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `Le due tracce hanno frequenze di campionamento diverse (${p.vocals} e ${p.background})`,
  vocalsSilent: "La traccia vocale è silenziosa",
  vocalsNotLouder: (p: { vocals: string; background: string }) => `Il campione contiene solo voce, ma la traccia vocale non è chiaramente più forte del sottofondo (RMS ${p.vocals} e ${p.background})`,
};
