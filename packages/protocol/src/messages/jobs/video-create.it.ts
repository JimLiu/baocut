import type { JobsVideoCreateMessages } from './video-create.ts';

export const it: JobsVideoCreateMessages = {
  videoClosed: "Il video è stato chiuso, quindi non è stato importato nulla: apri il video e riprova",
  noAsset: "L’importazione non ha restituito un materiale",
  notCompleted: (p: { state: string }) => `La trascrizione non è stata completata (${p.state})`,
};
