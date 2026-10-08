import type { JobsVideoCreateMessages } from './video-create.ts';

export const fr: JobsVideoCreateMessages = {
  videoClosed: "La vidéo a été fermée ; rien n’a été importé. Ouvrez-la et réessayez",
  noAsset: "L’import n’a renvoyé aucun média",
  notCompleted: (p: { state: string }) => `La transcription n’a pas abouti (${p.state})`,
};
