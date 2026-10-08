import type { JobsVideoCreateMessages } from './video-create.ts';

export const ptBR: JobsVideoCreateMessages = {
  videoClosed: "O vídeo foi fechado, então nada foi importado: abra o vídeo e tente novamente",
  noAsset: "A importação não retornou uma mídia",
  notCompleted: (p: { state: string }) => `A transcrição não foi concluída (${p.state})`,
};
