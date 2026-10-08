import type { TimeMessages } from './time.ts';

export const ru: TimeMessages = {
  rateNotPositive: "Числитель и знаменатель частоты кадров должны быть положительными",
  rateNotReduced: "Дробь частоты кадров должна быть несократимой",
  timescaleNotPositive: "timescale должен быть больше 0",
  notInteger: (p) => `Не целое десятичное число: «${p.text}"`,
  leadingZero: "Целые числа не могут начинаться с нулей",
  notDecimalSeconds: (p) => `Не десятичное число секунд: «${p.text}"`,
  negativePosition: "Абсолютная позиция не может быть отрицательной",
};
