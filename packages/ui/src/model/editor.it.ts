import type { EditorMessages } from './editor.ts';

export const it: EditorMessages = {
  trackKind: { visual: "Visivo", audio: "Audio", subtitle: "Sottotitoli" },
  counter: "Contatore",
  text: "Testo",
  shape: "Forma",
  composition: "Composizione",
  caption: "Sottotitoli",
  asset: "Materiale",
  elements: {
    sticker: "Adesivo",
    placeholder: "Segnaposto",
    whiteboard: "Lavagna",
    progress: "Barra di avanzamento",
    visualizer: "Forma d’onda",
    confetti: "Coriandoli",
    draw: "Disegno",
  },
  seconds: (value: string) => `${value} s`,
};
