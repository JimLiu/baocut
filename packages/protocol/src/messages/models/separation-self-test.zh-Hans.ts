import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const zhHans: ModelsSeparationSelfTestMessages = {
  vocals: '人声',
  background: '背景',
  vocalsUndecodable: (p: { problem: string }) => `人声不能解码：${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `背景不能解码：${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem}不是立体声（${p.channels} 声道）`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `${p.stem}长 ${p.duration} 秒，样本长 ${p.sample} 秒`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `两路的采样率不同（${p.vocals} 与 ${p.background}）`,
  vocalsSilent: '人声是静音',
  vocalsNotLouder: (p: { vocals: string; background: string }) => `样本只有人声，人声却不比背景明显更响（均方根 ${p.vocals} 与 ${p.background}）`,
};
