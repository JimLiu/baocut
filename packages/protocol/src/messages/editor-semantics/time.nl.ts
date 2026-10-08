type P<K extends string> = Record<K, string | number>;
import type { TimeMessages } from './time.ts';

export const nl: TimeMessages = {
  rateNotPositive: "De teller en noemer van de framesnelheid moeten positief zijn",
  rateNotReduced: "De framesnelheid moet volledig vereenvoudigd zijn",
  timescaleNotPositive: "timescale moet groter zijn dan 0",
  notInteger: (p: P<'text'>) => `Geen decimaal geheel getal: ‘${p.text}’`,
  leadingZero: "Gehele getallen mogen geen voorloopnullen hebben",
  notDecimalSeconds: (p: P<'text'>) => `Geen decimale seconden: ‘${p.text}’`,
  negativePosition: "Een absolute positie mag niet negatief zijn",
};
