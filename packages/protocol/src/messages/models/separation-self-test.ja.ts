import type { ModelsSeparationSelfTestMessages } from './separation-self-test.ts';

export const ja: ModelsSeparationSelfTestMessages = {
  vocals: 'ボーカルトラック',
  background: '背景音トラック',
  vocalsUndecodable: (p: { problem: string }) => `ボーカルトラックをデコードできません：${p.problem}`,
  backgroundUndecodable: (p: { problem: string }) => `背景音トラックをデコードできません：${p.problem}`,
  notStereo: (p: { stem: string; channels: number }) => `${p.stem} がステレオではありません（${p.channels} チャンネル）`,
  durationMismatch: (p: { stem: string; duration: string; sample: string }) =>
    `${p.stem} の長さは ${p.duration} 秒ですが、サンプルは ${p.sample} 秒です`,
  sampleRateMismatch: (p: { vocals: number; background: number }) =>
    `2 つのトラックのサンプルレートが異なります（${p.vocals} と ${p.background}）`,
  vocalsSilent: 'ボーカルトラックが無音です',
  vocalsNotLouder: (p: { vocals: string; background: string }) =>
    `サンプルは声だけなのに、ボーカルトラックが背景音より明らかに大きくなっていません（RMS ${p.vocals} と ${p.background}）`,
};
