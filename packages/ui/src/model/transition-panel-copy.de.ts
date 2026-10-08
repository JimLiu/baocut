import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const de: TransitionPanelMessages = {
  slot: { in: "Anfang", out: "Ende" },
  choice: {
    none: "Keine",
    dissolve: "Überblenden",
    wipe: "Wischen",
    slide: "Hineingleiten",
    zoom: "Zoom",
    'dip-to-color': "Farbblende",
    push: "Schieben",
  },
  direction: { right: "Rechts", left: "Links", down: "Unten", up: "Oben" },
  easing: { linear: "Linear", 'ease-in': "Sanft beginnen", 'ease-out': "Sanft enden", 'ease-in-out': "Sanft beginnen und enden" },
};
