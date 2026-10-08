import type { ModelsLocalImageMessages } from './local-image.ts';

export const nl: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Genereert op de CPU van deze computer met ${p.steps} stappen: een afbeelding van 1024² duurt meerdere uren en zelfs 512² duurt ongeveer een uur; veel sneller met een NVIDIA-GPU (CUDA)`,
  slowLocal: (p: { steps: number }) => `Genereert op deze computer met ${p.steps} stappen: elke afbeelding duurt enkele tot meer dan tien minuten`,
};
