import { pluralForm } from '@baocut/protocol';
import type { AssetReplaceMessages } from './asset-replace.ts';

const KIND_TEXT = { video: 'Wideo', image: 'Obraz', audio: 'Audio' } as const;

export const pl: AssetReplaceMessages = {
  cantReplaceKind: "Nie można jeszcze zastąpić materiału tego rodzaju.",
  sameKind: (kind) => `Można zastąpić tylko materiałem tego samego rodzaju: wymagany jest ${{ video: "materiał wideo", image: "materiał obrazu", audio: "materiał audio" }[kind]}.`,
  sameAsset: "To obecny materiał. Wybierz inny.",
  unused: "Ten materiał nie jest używany na osi czasu, więc nie ma czego zastąpić.",
  tooShort: "Nowy materiał jest zbyt krótki nawet na jedną klatkę.",
  allLocked: "Wszystkie używające go klipy są zablokowane (lub są wyrenderowanym zastępnikiem kompozycji). Najpierw je odblokuj.",
  clipLocked: 'Ten klip jest zablokowany. Najpierw go odblokuj.',
  durationUnknown: "Długość materiału jest nieznana, więc klipy na razie zachowają obecną długość.",
  longEnoughMany: "Nowy materiał jest wystarczająco długi. Długość klipów i oś czasu pozostają bez zmian.",
  longEnoughOne: "Nowy materiał jest wystarczająco długi. Klip zachowuje długość, a oś czasu pozostaje bez zmian.",
  shortenMany: (n: number, seconds: string) => pluralForm('pl', n, { one: `${n} klip skróci się, łącznie o ${seconds} s`, few: `${n} klipy skrócą się, łącznie o ${seconds} s`, many: `${n} klipów skróci się, łącznie o ${seconds} s`, other: `${n} klipu skróci się, łącznie o ${seconds} s` }),
  shortenOne: (seconds: string) => `Klip skróci się o ${seconds} s`,
  moved: (head: string, n: number) => pluralForm('pl', n, { one: `${head}, następny ${n} klip na ścieżce przesunie się wcześniej.`, few: `${head}, następne ${n} klipy na ścieżce przesuną się wcześniej.`, many: `${head}, następne ${n} klipów na ścieżce przesunie się wcześniej.`, other: `${head}, następne ${n} klipu na ścieżce przesunie się wcześniej.` }),
  trackShorter: (head: string) => `${head}, a ścieżka się skróci.`,
  transitions: (n: number) => pluralForm('pl', n, { one: `${n} przejście na tych klipach zostanie usunięte.`, few: `${n} przejścia na tych klipach zostaną usunięte.`, many: `${n} przejść na tych klipach zostanie usuniętych.`, other: `${n} przejścia na tych klipach zostanie usunięte.` }),
  captions: (n: number) => pluralForm('pl', n, { one: `${n} napis jest dopasowany do czasu tych klipów i wymaga ponownego dopasowania po zastąpieniu.`, few: `${n} napisy są dopasowane do czasu tych klipów i wymagają ponownego dopasowania po zastąpieniu.`, many: `${n} napisów jest dopasowanych do czasu tych klipów i wymaga ponownego dopasowania po zastąpieniu.`, other: `${n} napisu jest dopasowane do czasu tych klipów i wymaga ponownego dopasowania po zastąpieniu.` }),
  ducking: (n: number) => pluralForm('pl', n, { one: `${n} reguła przyciszania wskazuje te klipy i nie będzie pasować po zastąpieniu.`, few: `${n} reguły przyciszania wskazują te klipy i nie będą pasować po zastąpieniu.`, many: `${n} reguł przyciszania wskazuje te klipy i nie będzie pasować po zastąpieniu.`, other: `${n} reguły przyciszania wskazuje te klipy i nie będzie pasować po zastąpieniu.` }),
};
