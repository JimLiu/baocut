import type { TransitionPanelMessages } from './transition-panel-copy.ts';

export const pl: TransitionPanelMessages = {
  slot: { in: "Wejście", out: "Wyjście" },
  choice: {
    none: "Żadne",
    dissolve: "Przenikanie",
    wipe: "Wycieranie",
    slide: "Wsunięcie",
    zoom: "Zoom",
    'dip-to-color': "Przejście przez kolor",
    push: "Wypychanie",
  },
  direction: { right: "Jasne", left: "W lewo", down: "Dół", up: "Góra" },
  easing: { linear: "Liniowo", 'ease-in': "Łagodny początek", 'ease-out': "Łagodny koniec", 'ease-in-out': "Łagodny początek i koniec" },
};
