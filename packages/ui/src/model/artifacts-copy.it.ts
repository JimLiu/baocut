import type { ArtifactsMessages } from './artifacts-copy.ts';

export const it: ArtifactsMessages = {
  kind: 'Artefatto',
  opening: 'Apertura dell’artefatto…',
  unavailable: 'Gli artefatti non sono disponibili al momento.',
  openFailed: 'Impossibile aprire questo artefatto.',
  retry: 'Riprova',
  openInBrowser: 'Apri nel browser',
  types: {
    slides: 'Diapositive',
    docs: 'Documento',
    design: 'Design',
    designSystem: 'Design system',
    sheets: 'Foglio',
    data: 'Dati',
    whiteboard: 'Lavagna',
    motion: 'Animazione',
  },
};
