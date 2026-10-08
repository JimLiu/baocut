import type { JobsVideoCreateMessages } from './video-create.ts';

export const ja: JobsVideoCreateMessages = {
  videoClosed: '動画が閉じられたため、何も読み込まれませんでした：動画を開いてから再試行してください',
  noAsset: '読み込みで素材が返されませんでした',
  notCompleted: (p: { state: string }) => `文字起こしが完了しませんでした（${p.state}）`,
};
