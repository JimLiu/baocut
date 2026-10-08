import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const nl: TransitionPanelMessages = {
  slot: { in: "In", out: "Uit" },
  choice: {
    none: "Geen",
    dissolve: "Overvloeien",
    wipe: "Vegen",
    slide: "Inschuiven",
    zoom: "Zoom",
    'dip-to-color': "Vervagen naar kleur",
    push: "Duwen",
  },
  direction: { right: "Rechts", left: "Links", down: "Omlaag", up: "Omhoog" },
  easing: { linear: "Lineair", 'ease-in': "Rustig beginnen", 'ease-out': "Rustig eindigen", 'ease-in-out': "Rustig beginnen en eindigen" },
};
