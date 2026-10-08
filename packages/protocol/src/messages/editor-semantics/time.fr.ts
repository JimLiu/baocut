import type { TimeMessages } from './time.ts';

export const fr: TimeMessages = {
  rateNotPositive: "Le numérateur et le dénominateur de la fréquence d’images doivent être positifs",
  rateNotReduced: "La fréquence d’images doit être sous forme irréductible",
  timescaleNotPositive: "timescale doit être supérieur à 0",
  notInteger: (p) => `Pas un entier décimal : « ${p.text} »`,
  leadingZero: "Les entiers ne peuvent pas commencer par zéro",
  notDecimalSeconds: (p) => `Pas des secondes décimales : « ${p.text} »`,
  negativePosition: "Une position absolue ne peut pas être négative",
};
