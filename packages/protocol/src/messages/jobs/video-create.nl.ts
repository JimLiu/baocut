import type { JobsVideoCreateMessages } from './video-create.ts';

export const nl: JobsVideoCreateMessages = {
  videoClosed: "De video is gesloten, dus er is niets geïmporteerd: open de video en probeer het opnieuw",
  noAsset: "De import heeft geen media geretourneerd",
  notCompleted: (p: { state: string }) => `Transcriptie niet voltooid (${p.state})`,
};
