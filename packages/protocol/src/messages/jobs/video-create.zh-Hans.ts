import type { JobsVideoCreateMessages } from './video-create.ts';

export const zhHans: JobsVideoCreateMessages = {
  videoClosed: '视频已经关闭，没有导入：打开视频之后重试',
  noAsset: '导入没有返回素材',
  notCompleted: (p: { state: string }) => `转写没有完成（${p.state}）`,
};
