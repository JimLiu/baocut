import type { ModelsLocalImageMessages } from './local-image.ts';
export const es: ModelsLocalImageMessages = {
 slowCpu: (p) => `Genera en la CPU de este ordenador con ${p.steps} pasos: una imagen de 1024² tarda varias horas e incluso 512² tarda alrededor de una hora; mucho más rápido con una GPU NVIDIA (CUDA)`,
 slowLocal: (p) => `Genera en este ordenador con ${p.steps} pasos: cada imagen tarda desde unos minutos hasta más de diez minutos`,
};
