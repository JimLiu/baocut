import type { EditorMessages } from './editor.ts';

export const ptBR: EditorMessages = {
  trackKind: { visual: "Visual", audio: "Áudio", subtitle: "Legendas" },
  counter: "Contador",
  text: "Texto",
  shape: "Forma",
  composition: "Composição",
  caption: "Legendas",
  asset: "Mídia",
  elements: {
    sticker: "Adesivo",
    placeholder: "Espaço reservado",
    whiteboard: "Quadro branco",
    progress: "Barra de progresso",
    visualizer: "Forma de onda",
    confetti: "Confete",
    draw: "Desenho",
  },
  seconds: (value: string) => `${value} s`,
};
