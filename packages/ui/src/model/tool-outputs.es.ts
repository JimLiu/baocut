import type { ToolOutputsMessages } from './tool-outputs.ts';
export const es: ToolOutputsMessages = {
  actionLabel: { 'open-movie': 'Abrir en el editor', 'new-movie': 'Nuevo vídeo a partir de esto' },
  blockTextOnly: 'Las transcripciones y los subtítulos necesitan un archivo de vídeo o audio para crear un vídeo; aún no se puede hacer desde aquí',
  blockTrashed: 'Primero restaura este elemento de la Papelera',
  blockGenerating: 'Aún se está generando; estará disponible al terminar',
  blockMissing: 'No se encuentra el archivo de este resultado en este ordenador',
  handover: {
    subtitle: 'Traduce estos subtítulos a otro idioma sin cambiar los códigos de tiempo.',
    document: 'Escribe un resumen de esta transcripción.',
    audio: 'Crea un vídeo con este audio.', image: 'Crea un vídeo con esta imagen de portada.',
    'video-file': 'Añade subtítulos a este vídeo.', export: 'Añade subtítulos a este vídeo.',
    video: 'Sigue editando este vídeo.',
  },
  handoverDefault: 'Sigue trabajando en este resultado.',
};
