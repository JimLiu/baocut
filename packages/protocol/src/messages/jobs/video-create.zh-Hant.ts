import type { JobsVideoCreateMessages } from './video-create.ts';

export const zhHant: JobsVideoCreateMessages = {
  videoClosed: '影片已關閉，因此沒有匯入：請開啟影片後重試',
  noAsset: '匯入沒有傳回素材',
  notCompleted: (p: { state: string }) => `轉錄未完成（${p.state}）`,
};
