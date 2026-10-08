import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const ja: SpeakersProposalMessages = {
  stages: ['声紋', 'クラスタリング', '整理'],
  nameEmpty: '名前は空にできません',
  nameTooLong: (max: number) => `名前は ${max} 文字以内にしてください`,
  receipt: (speakers: number, duration: string, engine: string) => `適用済み · 話者 ${speakers} 人を検出 · ${duration} · ${engine}`,
};
