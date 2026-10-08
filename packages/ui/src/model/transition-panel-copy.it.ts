import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const it: TransitionPanelMessages = {
  slot: { in: "Entrata", out: "Uscita" },
  choice: {
    none: "Nessuna",
    dissolve: "Dissolvenza",
    wipe: "Tendina",
    slide: "Scorrimento in entrata",
    zoom: "Zoom",
    'dip-to-color': "Dissolvenza su colore",
    push: "Spinta",
  },
  direction: { right: "Destra", left: "Sinistra", down: "Giù", up: "Su" },
  easing: { linear: "Lineare", 'ease-in': "Accelerazione graduale", 'ease-out': "Decelerazione graduale", 'ease-in-out': "Accelerazione e decelerazione graduali" },
};
