import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const zhHans: SpeakersProposalMessages = {
  stages: ['声纹', '聚类', '整理'],
  nameEmpty: '名字不能为空',
  nameTooLong: (max: number) => `名字最多 ${max} 个字`,
  receipt: (speakers: number, duration: string, engine: string) => `已应用 · 识别出 ${speakers} 位说话人 · ${duration} · ${engine}`,
};
