import type { JobsVideoCreateMessages } from './video-create.ts';

export const de: JobsVideoCreateMessages = {
  videoClosed: "Das Video wurde geschlossen; nichts wurde importiert. Video öffnen und erneut versuchen",
  noAsset: "Der Import hat kein Material zurückgegeben",
  notCompleted: (p: { state: string }) => `Transkription nicht abgeschlossen (${p.state})`,
};
