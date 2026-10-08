import type { ModelsLocalImageMessages } from './local-image.ts';

export const fr: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Génère sur le CPU de cet ordinateur avec ${p.steps} étapes : une image 1024² prend plusieurs heures, et même 512² environ une heure ; bien plus rapide avec un GPU NVIDIA (CUDA)`,
  slowLocal: (p: { steps: number }) => `Génère sur cet ordinateur avec ${p.steps} étapes : chaque image prend de quelques minutes à plus de dix minutes`,
};
