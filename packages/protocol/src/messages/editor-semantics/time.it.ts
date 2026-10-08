import type { TimeMessages } from './time.ts';

export const it: TimeMessages = {
  rateNotPositive: "Il numeratore e il denominatore della frequenza dei fotogrammi devono essere positivi",
  rateNotReduced: "La frequenza dei fotogrammi deve essere ridotta ai minimi termini",
  timescaleNotPositive: "timescale deve essere maggiore di 0",
  notInteger: (p) => `Non è un intero decimale: «${p.text}»`,
  leadingZero: "Gli interi non possono avere zeri iniziali",
  notDecimalSeconds: (p) => `Non sono secondi decimali: «${p.text}»`,
  negativePosition: "Una posizione assoluta non può essere negativa",
};
