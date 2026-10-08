import type { ModelsLocalImageMessages } from './local-image.ts';

export const ptBR: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Gera na CPU deste computador com ${p.steps} etapas: uma imagem de 1024² leva várias horas, e até 512² leva cerca de uma hora; muito mais rápido com uma GPU NVIDIA (CUDA)`,
  slowLocal: (p: { steps: number }) => `Gera neste computador com ${p.steps} etapas: cada imagem leva de alguns minutos a mais de dez minutos`,
};
