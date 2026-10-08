import type { ModelsLocalImageMessages } from './local-image.ts';

export const ru: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Генерация на CPU этого компьютера, число шагов: ${p.steps}; изображение 1024² занимает несколько часов, а даже 512² — около часа; на NVIDIA GPU (CUDA) гораздо быстрее`,
  slowLocal: (p: { steps: number }) => `Генерация на этом компьютере, число шагов: ${p.steps}; каждое изображение занимает от нескольких до более десяти минут`,
};
