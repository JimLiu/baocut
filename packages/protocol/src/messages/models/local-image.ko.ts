import type { ModelsLocalImageMessages } from './local-image.ts';

export const ko: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) =>
    `이 컴퓨터의 CPU로 ${p.steps}단계 생성합니다: 1024² 이미지는 몇 시간, 512²도 1시간 정도 걸립니다. NVIDIA GPU(CUDA)가 있으면 훨씬 빠릅니다`,
  slowLocal: (p: { steps: number }) => `이 컴퓨터에서 ${p.steps}단계로 생성합니다: 이미지 한 장에 몇 분에서 10분 넘게 걸립니다`,
};
