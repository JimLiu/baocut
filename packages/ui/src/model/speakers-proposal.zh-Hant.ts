import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const zhHant: SpeakersProposalMessages = {
  stages: ['聲紋', '分群', '整理'],
  nameEmpty: '名稱不能空白',
  nameTooLong: (max: number) => `名稱最多 ${max} 個字`,
  receipt: (speakers: number, duration: string, engine: string) => `已套用 · 找到 ${speakers} 位說話者 · ${duration} · ${engine}`,
};
