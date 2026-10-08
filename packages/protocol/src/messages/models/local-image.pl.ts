import type { ModelsLocalImageMessages } from './local-image.ts';

export const pl: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Generowanie na CPU tego komputera, liczba kroków: ${p.steps}; obraz 1024² zajmuje kilka godzin, a nawet 512² około godziny; na NVIDIA GPU (CUDA) znacznie szybciej`,
  slowLocal: (p: { steps: number }) => `Generowanie na tym komputerze, liczba kroków: ${p.steps}; każdy obraz zajmuje od kilku do ponad dziesięciu minut`,
};
