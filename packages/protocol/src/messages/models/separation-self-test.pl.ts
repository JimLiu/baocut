import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const pl: ModelsSeparationSelfTestMessages = {
  vocals: "ścieżka głosu",
  background: "ścieżka tła",
  vocalsUndecodable: (p: { problem: string }) => `Nie można zdekodować ścieżki głosu: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `Nie można zdekodować ścieżki tła: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `Element ${p.stem} nie jest stereo (${p.channels} kanałów)`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `Element ${p.stem} ma długość ${p.duration} s, a próbka ${p.sample} s`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `Ścieżki mają różne częstotliwości próbkowania (${p.vocals} i ${p.background})`,
  vocalsSilent: "Ścieżka głosu jest cicha",
  vocalsNotLouder: (p: { vocals: string; background: string }) => `Próbka zawiera tylko głos, ale ścieżka głosu nie jest wyraźnie głośniejsza od tła (RMS ${p.vocals} i ${p.background})`,
};
