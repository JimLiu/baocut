import type { ModelsSpeechSelfTestMessages } from './speech-self-test.ts';

export const ko: ModelsSpeechSelfTestMessages = {
  notWav: 'RIFF/WAVE 파일이 아닙니다',
  missingFmt: 'fmt 청크가 없습니다',
  missingData: 'data 청크가 없습니다',
  unsupportedEncoding: (p: { format: number }) => `지원하지 않는 인코딩입니다(${p.format})`,
  badChannels: (p: { channels: number }) => `채널 수가 비정상적입니다(${p.channels})`,
  badSampleRate: (p: { sampleRate: number }) => `샘플 레이트가 비정상적입니다(${p.sampleRate})`,
  unsupportedBitDepth: (p: { bits: number }) => `지원하지 않는 비트 심도입니다(${p.bits})`,
  nonFinite: '샘플에 유한하지 않은 값이 있습니다',
  undecodable: (p: { problem: string }) => `결과물을 디코딩할 수 없습니다: ${p.problem}`,
  durationOutOfRange: (p: { duration: string; min: number; max: number }) =>
    `길이 ${p.duration}초가 ${p.min}~${p.max}초 범위를 벗어났습니다`,
  silent: '결과물이 무음입니다',
  clipped: (p: { ratio: string; limit: number }) =>
    `결과물에 클리핑이 있습니다: 샘플의 ${p.ratio}%가 최대 레벨에 도달했습니다(한도 ${p.limit}%)`,
};
