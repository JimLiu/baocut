import type { GeometryPanelMessages } from './geometry-panel.ts';

export const it: GeometryPanelMessages = {
  x: { left: "Da sinistra", center: "Scostamento orizzontale", right: "Da destra" },
  y: { top: "Dall’alto", middle: "Scostamento verticale", bottom: "Dal basso" },
  pins: {
    'left top': "Angolo superiore sinistro",
    'center top': "Centro del bordo superiore",
    'right top': "Angolo superiore destro",
    'left middle': "Centro del bordo sinistro",
    'center middle': "Centro",
    'right middle': "Centro del bordo destro",
    'left bottom': "Angolo inferiore sinistro",
    'center bottom': "Centro del bordo inferiore",
    'right bottom': "Angolo inferiore destro",
  },
};
