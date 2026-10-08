type PinX = 'left' | 'center' | 'right';
type PinY = 'top' | 'middle' | 'bottom';
import type { GeometryPanelMessages } from './geometry-panel.ts';

export const de: GeometryPanelMessages = {
  x: { left: "Von links", center: "Horizontaler Versatz", right: "Von rechts" } as Record<PinX, string>,
  y: { top: "Von oben", middle: "Vertikaler Versatz", bottom: "Von unten" } as Record<PinY, string>,
  pins: {
    'left top': "Obere linke Ecke",
    'center top': "Mitte der Oberkante",
    'right top': "Obere rechte Ecke",
    'left middle': "Mitte der linken Kante",
    'center middle': "Zentrieren",
    'right middle': "Mitte der rechten Kante",
    'left bottom': "Untere linke Ecke",
    'center bottom': "Mitte der Unterkante",
    'right bottom': "Untere rechte Ecke",
  } as Record<`${PinX} ${PinY}`, string>,
};
