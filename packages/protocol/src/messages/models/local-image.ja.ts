import type { ModelsLocalImageMessages } from './local-image.ts';

export const ja: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) =>
    `このコンピュータの CPU で ${p.steps} ステップで生成します。1024² の画像は数時間、512² でも 1 時間ほどかかります。NVIDIA GPU（CUDA）があればはるかに速くなります`,
  slowLocal: (p: { steps: number }) => `このコンピュータで ${p.steps} ステップで生成します。1 枚あたり数分から十数分かかります`,
};
