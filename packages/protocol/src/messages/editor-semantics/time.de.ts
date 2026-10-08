type P<K extends string> = Record<K, string | number>;
import type { TimeMessages } from './time.ts';

export const de: TimeMessages = {
  rateNotPositive: "Zähler und Nenner der Bildrate müssen positiv sein",
  rateNotReduced: "Die Bildrate muss vollständig gekürzt sein",
  timescaleNotPositive: "timescale muss größer als 0 sein",
  notInteger: (p: P<'text'>) => `Keine Dezimalzahl: „${p.text}“`,
  leadingZero: "Ganze Zahlen dürfen keine führenden Nullen haben",
  notDecimalSeconds: (p: P<'text'>) => `Keine Sekunden als Dezimalzahl: „${p.text}“`,
  negativePosition: "Eine absolute Position darf nicht negativ sein",
};
