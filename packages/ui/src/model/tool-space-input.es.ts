import type { ToolSpaceInputMessages } from './tool-space-input.ts';
export const es: ToolSpaceInputMessages = {
  reasons: {
    trashed: 'En la Papelera', generating: 'Aún se está generando; podrás elegirlo al terminar',
    missing: 'Falta el archivo; vuelve a conectarlo antes de elegirlo', failed: 'La última generación falló',
    textOnly: 'Solo se puede leer texto de documentos .txt y .md',
    subtitleOnly: 'Solo se admiten subtítulos .srt y .vtt',
    noPath: 'Este elemento no tiene un archivo en este ordenador; un vídeo nuevo debe empezar con un archivo local',
  },
  joinKinds: (labels: readonly string[]) => labels.join(', '),
};
