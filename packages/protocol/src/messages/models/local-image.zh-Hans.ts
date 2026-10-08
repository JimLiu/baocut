import type { ModelsLocalImageMessages } from './local-image.ts';

export const zhHans: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `在本机的 CPU 上生成，${p.steps} 步，一张 1024² 要几个小时，512² 也要一小时左右；有 NVIDIA 显卡（CUDA）时快得多`,
  slowLocal: (p: { steps: number }) => `在本机生成，${p.steps} 步，一张要几分钟到十几分钟`,
};
