import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const de: ModelsSeparationSelfTestMessages = {
  vocals: "Stimmspur",
  background: "Hintergrundspur",
  vocalsUndecodable: (p: { problem: string }) => `Die Stimmspur kann nicht decodiert werden: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `Die Hintergrundspur kann nicht decodiert werden: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem} ist nicht stereo (${p.channels} Kanäle)`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `${p.stem} ist ${p.duration} Sekunden lang, die Probe jedoch ${p.sample} Sekunden`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `Die zwei Spuren haben unterschiedliche Abtastraten (${p.vocals} und ${p.background})`,
  vocalsSilent: "Die Stimmspur ist stumm",
  vocalsNotLouder: (p: { vocals: string; background: string }) => `Die Probe enthält nur Stimme, aber die Stimmspur ist nicht deutlich lauter als der Hintergrund (RMS ${p.vocals} und ${p.background})`,
};
