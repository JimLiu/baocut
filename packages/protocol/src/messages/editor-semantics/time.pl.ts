import type { TimeMessages } from './time.ts';

export const pl: TimeMessages = {
  rateNotPositive: "Licznik i mianownik częstotliwości klatek muszą być dodatnie",
  rateNotReduced: "Ułamek częstotliwości klatek musi być nieskracalny",
  timescaleNotPositive: "timescale musi być większy niż 0",
  notInteger: (p) => `To nie całkowita liczba dziesiętna: „${p.text}"`,
  leadingZero: "Liczby całkowite nie mogą mieć zer wiodących",
  notDecimalSeconds: (p) => `To nie dziesiętna liczba sekund: „${p.text}"`,
  negativePosition: "Pozycja bezwzględna nie może być ujemna",
};
