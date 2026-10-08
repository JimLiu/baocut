import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const nl: ModelsSeparationSelfTestMessages = {
  vocals: "stemspoor",
  background: "achtergrondspoor",
  vocalsUndecodable: (p: { problem: string }) => `Het stemspoor kan niet worden gedecodeerd: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `Het achtergrondspoor kan niet worden gedecodeerd: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem} is niet stereo (${p.channels} kanalen)`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `${p.stem} is ${p.duration} seconden lang, maar het voorbeeld is ${p.sample} seconden`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `De twee sporen hebben verschillende samplefrequenties (${p.vocals} en ${p.background})`,
  vocalsSilent: "Het stemspoor is stil",
  vocalsNotLouder: (p: { vocals: string; background: string }) => `Het voorbeeld bevat alleen stem, maar het stemspoor is niet duidelijk luider dan de achtergrond (RMS ${p.vocals} en ${p.background})`,
};
