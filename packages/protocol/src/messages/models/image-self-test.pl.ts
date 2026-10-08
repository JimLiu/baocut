import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const pl: ModelsImageSelfTestMessages = {
  notPng: "To nie plik PNG",
  chunkTruncated: (p: { type: string }) => `Element ${p.type} – blok jest ucięty`,
  missingIhdr: "Brak bloku IHDR",
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Nieobsługiwany format pikseli (głębia bitowa ${p.depth}, typ koloru ${p.color}, przeplot ${p.interlace})`,
  zeroSize: "Szerokość lub wysokość wynosi 0",
  missingIdat: "Brak bloku IDAT",
  inflateFailed: "Nie udało się rozpakować danych pikseli",
  pixelDataShort: "Za mało danych pikseli",
  unknownFilter: "Nieznany typ filtra wiersza",
  undecodable: (p: { problem: string }) => `Nie można zdekodować wyniku: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `Rozmiar ${p.width}×${p.height} nie jest zgodny z żądanym ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `Obraz jest prawie jednolity (tylko ${p.distinct} kolorów)`,
};
