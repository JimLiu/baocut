import type { TimeMessages } from './time.ts';

export const tr: TimeMessages = {
  rateNotPositive: 'Kare hızının pay ve paydası pozitif olmalı',
  rateNotReduced: 'Kare hızı sadeleştirilmiş olmalı',
  timescaleNotPositive: 'timescale 0’dan büyük olmalı',
  notInteger: (p) => `Ondalık tam sayı değil: “${p.text}”`,
  leadingZero: 'Tam sayılarda başta sıfır olamaz',
  notDecimalSeconds: (p) => `Ondalık saniye değil: “${p.text}”`,
  negativePosition: 'Mutlak konum negatif olamaz',
};
