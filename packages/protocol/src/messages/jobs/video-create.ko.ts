import type { JobsVideoCreateMessages } from './video-create.ts';

export const ko: JobsVideoCreateMessages = {
  videoClosed: '영상이 닫혀 아무것도 가져오지 않았습니다: 영상을 연 뒤 다시 시도하세요',
  noAsset: '가져오기에서 소재가 반환되지 않았습니다',
  notCompleted: (p: { state: string }) => `전사가 완료되지 않았습니다(${p.state})`,
};
