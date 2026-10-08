import type { ModelsLocalImageMessages } from './local-image.ts';

export const tr: ModelsLocalImageMessages = {
  slowCpu: (p: { steps: number }) => `Bu bilgisayarın CPU biriminde ${p.steps} adımla oluşturur: 1024² görsel birkaç saat, 512² bile yaklaşık bir saat sürer; NVIDIA GPU (CUDA) ile çok daha hızlıdır`,
  slowLocal: (p: { steps: number }) => `Bu bilgisayarda ${p.steps} adımla oluşturur: her görsel birkaç dakikadan on dakikanın üzerine kadar sürer`,
};
