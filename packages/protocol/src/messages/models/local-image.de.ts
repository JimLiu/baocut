import type { ModelsLocalImageMessages } from './local-image.ts';

export const de: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Erzeugt auf der CPU dieses Computers mit ${p.steps} Schritten: Ein 1024²-Bild dauert mehrere Stunden, selbst 512² etwa eine Stunde; mit einer NVIDIA-GPU (CUDA) deutlich schneller`,
  slowLocal: (p: { steps: number }) => `Erzeugt auf diesem Computer mit ${p.steps} Schritten: Jedes Bild dauert einige bis über zehn Minuten`,
};
