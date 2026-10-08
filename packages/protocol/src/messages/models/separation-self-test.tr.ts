import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const tr: ModelsSeparationSelfTestMessages = {
vocals: 'vokal izi', background: 'arka plan izi', vocalsUndecodable: (p) => `Vokal izi çözümlenemiyor: ${p.problem}`, backgroundUndecodable: (p) => `Arka plan izi çözümlenemiyor: ${p.problem}`, notStereo: (p) => `${p.stem} stereo değil (${p.channels} kanal)`, durationMismatch: (p) => `${p.stem} ${p.duration} saniye, ancak örnek ${p.sample} saniye uzunluğunda`, sampleRateMismatch: (p) => `İki izin örnekleme hızları farklı (${p.vocals} ve ${p.background})`, vocalsSilent: 'Vokal izi sessiz', vocalsNotLouder: (p) => `Örnek yalnızca konuşma içeriyor, ancak vokal izi arka plandan belirgin şekilde daha yüksek değil (RMS ${p.vocals} ve ${p.background})`,
};
