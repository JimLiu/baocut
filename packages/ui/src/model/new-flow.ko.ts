import type { NewFlowMessages } from './new-flow.ts';

export const ko: NewFlowMessages = {
  bilibili: 'Bilibili',
  directLink: '직접 링크',
  webPage: '웹페이지',
  videoLink: (site: string) => `${site} 영상 링크`,
  into: (name: string) => `${name}(으)로 번역`,
  translated: (language: string) => `번역 완료 · ${language} 자막을 영상에 넣었습니다`,
};
