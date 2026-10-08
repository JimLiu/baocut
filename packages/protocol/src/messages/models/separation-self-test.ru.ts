import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const ru: ModelsSeparationSelfTestMessages = {
  vocals: "голосовая дорожка",
  background: "фоновая дорожка",
  vocalsUndecodable: (p: { problem: string }) => `Не удалось декодировать голосовую дорожку: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `Не удалось декодировать фоновую дорожку: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `Компонент ${p.stem} — не стерео (${p.channels} каналов)`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `Компонент ${p.stem} — длительность ${p.duration} с, а образец — ${p.sample} с`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `У дорожек разная частота дискретизации (${p.vocals} и ${p.background})`,
  vocalsSilent: "Голосовая дорожка не содержит звука",
  vocalsNotLouder: (p: { vocals: string; background: string }) => `Образец содержит только голос, но голосовая дорожка не заметно громче фоновой (RMS ${p.vocals} и ${p.background})`,
};
