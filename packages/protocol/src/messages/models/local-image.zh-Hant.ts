import type { ModelsLocalImageMessages } from './local-image.ts';

export const zhHant: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `在這台電腦的 CPU 上生成，${p.steps} 步：一張 1024² 圖片要好幾個小時，512² 也要一小時左右；有 NVIDIA 顯示卡（CUDA）時會快很多`,
  slowLocal: (p: { steps: number }) => `在這台電腦上生成，${p.steps} 步：每張圖片需要幾分鐘到十幾分鐘`,
};
