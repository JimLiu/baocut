import type { EditorMessages } from './editor.ts';

export const pl: EditorMessages = {
  trackKind: { visual: "Wizualna", audio: "Dźwięk", subtitle: "Napisy" },
  counter: "Licznik",
  text: "Tekst",
  shape: "Kształt",
  composition: "Kompozycja",
  caption: "Napisy",
  asset: "Materiał",

  elements: {
    sticker: "Naklejka",
    placeholder: "Symbol zastępczy",
    whiteboard: "Tablica",
    progress: "Pasek postępu",
    visualizer: "Przebieg fali",
    confetti: "Konfetti",
    draw: "W toku",
  },
  seconds: (value: string) => `${value} s`,
};
