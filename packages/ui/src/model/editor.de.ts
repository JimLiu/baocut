import type { Track } from "@baocut/protocol";
type ElementName = 'sticker' | 'placeholder' | 'whiteboard' | 'progress' | 'visualizer' | 'confetti' | 'draw';
import type { EditorMessages } from './editor.ts';

export const de: EditorMessages = {
  trackKind: { visual: "Visuell", audio: "Audio", subtitle: "Untertitel" } as Record<Track['kind'], string>,
  counter: "Zähler",
  text: "Text",
  shape: "Form",
  composition: "Komposition",
  caption: "Untertitel",
  asset: "Material",
  elements: {
    sticker: "Sticker",
    placeholder: "Platzhalter",
    whiteboard: "Whiteboard",
    progress: "Fortschrittsbalken",
    visualizer: "Wellenform",
    confetti: "Konfetti",
    draw: "Wird erstellt",
  } as Record<ElementName, string>,
  seconds: (value: string) => `${value} s`,
};
