import type { ModelsLocalImageMessages } from './local-image.ts';

export const it: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Genera sulla CPU di questo computer con ${p.steps} passaggi: un’immagine 1024² richiede diverse ore e anche 512² richiede circa un’ora; molto più veloce con una GPU NVIDIA (CUDA)`,
  slowLocal: (p: { steps: number }) => `Genera su questo computer con ${p.steps} passaggi: ogni immagine richiede da pochi minuti a oltre dieci minuti`,
};
