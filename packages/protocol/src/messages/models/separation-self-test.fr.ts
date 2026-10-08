import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const fr: ModelsSeparationSelfTestMessages = {
  vocals: "piste vocale",
  background: "piste de fond sonore",
  vocalsUndecodable: (p: { problem: string }) => `La piste vocale ne peut pas être décodée : ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `La piste de fond sonore ne peut pas être décodée : ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `La version de ${p.stem} n’est pas stéréo (${p.channels} canaux)`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `La version de ${p.stem} est ${p.duration} secondes, mais l’échantillon dure ${p.sample} secondes`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `Les deux pistes ont des fréquences d’échantillonnage différentes (${p.vocals} et ${p.background})`,
  vocalsSilent: "La piste vocale est silencieuse",
  vocalsNotLouder: (p: { vocals: string; background: string }) => `L’échantillon contient seulement de la voix, mais la piste vocale n’est pas nettement plus forte que le fond (RMS ${p.vocals} et ${p.background})`,
};
