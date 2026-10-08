import type { JobsVideoCreateMessages } from './video-create.ts';

export const pl: JobsVideoCreateMessages = {
  videoClosed: 'Wideo zostało zamknięte, więc nic nie zaimportowano: otwórz wideo i spróbuj ponownie',
  noAsset: 'Import nie zwrócił materiału',
  notCompleted: (p: { state: string }) => `Transkrypcja nie została ukończona (${p.state})`,
};
