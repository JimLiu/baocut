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
};
