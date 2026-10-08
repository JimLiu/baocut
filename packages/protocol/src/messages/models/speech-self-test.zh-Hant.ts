import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const zhHant: ModelsSpeechSelfTestMessages = {
  notWav: '不是 RIFF/WAVE 檔案',
  missingFmt: '缺少 fmt 區塊',
  missingData: '缺少 data 區塊',
  unsupportedEncoding: (p: { format: number }) => `不支援的編碼（${p.format}）`,
  badChannels: (p: { channels: number }) => `聲道數不合理（${p.channels}）`,
  badSampleRate: (p: { sampleRate: number }) => `取樣率不合理（${p.sampleRate}）`,
  unsupportedBitDepth: (p: { bits: number }) => `不支援的位元深度（${p.bits}）`,
  nonFinite: '樣本中有非有限值',
  undecodable: (p: { problem: string }) => `無法解碼輸出：${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `時長 ${p.duration} 秒不在 ${p.min}–${p.max} 秒之間`,
  silent: '輸出是靜音',
  clipped: (p: { ratio: string; limit: number }) => `輸出削波：${p.ratio}% 的樣本達到滿幅（上限 ${p.limit}%）`,
};
