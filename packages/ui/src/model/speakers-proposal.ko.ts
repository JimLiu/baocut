import type { SpeakersProposalMessages } from './speakers-proposal.ts';

export const ko: SpeakersProposalMessages = {
  stages: ['성문 추출', '클러스터링', '정리'],
  nameEmpty: '이름을 비워 둘 수 없습니다',
  nameTooLong: (max: number) => `이름은 최대 ${max}자까지 입력할 수 있습니다`,
  receipt: (speakers: number, duration: string, engine: string) => `적용됨 · 화자 ${speakers}명 식별 · ${duration} · ${engine}`,
};
