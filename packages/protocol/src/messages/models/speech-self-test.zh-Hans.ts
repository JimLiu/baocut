import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const zhHans: ModelsSpeechSelfTestMessages = {
  notWav: '不是 RIFF/WAVE 文件',
  missingFmt: '缺少 fmt 块',
  missingData: '缺少 data 块',
  unsupportedEncoding: (p: { format: number }) => `不支持的编码（${p.format}）`,
  badChannels: (p: { channels: number }) => `声道数不合理（${p.channels}）`,
  badSampleRate: (p: { sampleRate: number }) => `采样率不合理（${p.sampleRate}）`,
  unsupportedBitDepth: (p: { bits: number }) => `不支持的位深（${p.bits}）`,
  nonFinite: '样本里有非有限值',
  undecodable: (p: { problem: string }) => `输出不能解码：${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) => `时长 ${p.duration} 秒不在 ${p.min}–${p.max} 秒之间`,
  silent: '输出是静音',
  clipped: (p: { ratio: string; limit: number }) => `输出削波：${p.ratio}% 的样本到了满幅（上限 ${p.limit}%）`,
};
