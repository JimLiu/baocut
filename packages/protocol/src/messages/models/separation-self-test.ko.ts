import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const ko: ModelsSeparationSelfTestMessages = {
  vocals: '보컬 트랙',
  background: '배경음 트랙',
  vocalsUndecodable: (p: { problem: string }) => `보컬 트랙을 디코딩할 수 없습니다: ${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `배경음 트랙을 디코딩할 수 없습니다: ${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem}이(가) 스테레오가 아닙니다(${p.channels}채널)`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) =>
    `${p.stem}의 길이는 ${p.duration}초인데 샘플은 ${p.sample}초입니다`,
  sampleRateMismatch: (p: { vocals: number; background: number }) =>
    `두 트랙의 샘플 레이트가 다릅니다(${p.vocals}, ${p.background})`,
  vocalsSilent: '보컬 트랙이 무음입니다',
  vocalsNotLouder: (p: { vocals: string; background: string }) =>
    `샘플은 목소리만 있는데 보컬 트랙이 배경음보다 뚜렷하게 크지 않습니다(RMS ${p.vocals}, ${p.background})`,
};
