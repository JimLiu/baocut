import type { JobsVideoCreateMessages } from './video-create.ts';
export const es: JobsVideoCreateMessages = { videoClosed: 'El vídeo se cerró, por lo que no se importó nada: abre el vídeo y vuelve a intentarlo', noAsset: 'La importación no devolvió un material', notCompleted: (p) => `La transcripción no terminó (${p.state})` };
