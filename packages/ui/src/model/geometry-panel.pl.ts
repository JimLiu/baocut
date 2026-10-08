import type { GeometryPanelMessages } from './geometry-panel.ts';

export const pl: GeometryPanelMessages = {
  x: { left: "Od lewej", center: "Przesunięcie poziome", right: "Od prawej" },
  y: { top: "Od góry", middle: "Przesunięcie pionowe", bottom: "Od dołu" },
  pins: {
    'left top': "Lewy górny róg",
    'center top': "Środek górnej krawędzi",
    'right top': "Prawy górny róg",
    'left middle': "Środek lewej krawędzi",
    'center middle': "Środek",
    'right middle': "Środek prawej krawędzi",
    'left bottom': "Lewy dolny róg",
    'center bottom': "Środek dolnej krawędzi",
    'right bottom': "Prawy dolny róg",
  },
};
