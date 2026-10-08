import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const zhHant: ModelsSeparationSelfTestMessages = {
  vocals: '人聲軌',
  background: '背景軌',
  vocalsUndecodable: (p: { problem: string }) => `無法解碼人聲軌：${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `無法解碼背景軌：${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem}不是立體聲（${p.channels} 聲道）`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) => `${p.stem}長 ${p.duration} 秒，但樣本長 ${p.sample} 秒`,
  sampleRateMismatch: (p: { vocals: number; background: number }) => `兩軌的取樣率不同（${p.vocals} 與 ${p.background}）`,
  vocalsSilent: '人聲軌是靜音',
  vocalsNotLouder: (p: { vocals: string; background: string }) => `樣本只有人聲，人聲軌卻沒有明顯比背景響亮（均方根 ${p.vocals} 與 ${p.background}）`,
};
