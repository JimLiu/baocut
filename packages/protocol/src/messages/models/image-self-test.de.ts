import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const de: ModelsImageSelfTestMessages = {
  notPng: "Keine PNG-Datei",
  chunkTruncated: (p: { type: string }) => `${p.type}-Block ist abgeschnitten`,
  missingIhdr: "Der IHDR-Block fehlt",
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Nicht unterstütztes Pixelformat (Bittiefe ${p.depth}, Farbtyp ${p.color}, Interlace ${p.interlace})`,
  zeroSize: "Breite oder Höhe ist 0",
  missingIdat: "Der IDAT-Block fehlt",
  inflateFailed: "Pixeldaten konnten nicht dekomprimiert werden",
  pixelDataShort: "Nicht genug Pixeldaten",
  unknownFilter: "Unbekannter Zeilenfiltertyp",
  undecodable: (p: { problem: string }) => `Das Ergebnis kann nicht decodiert werden: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `Die Größe ${p.width}×${p.height} ist nicht die angeforderte Größe ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `Das Bild ist fast einfarbig (nur ${p.distinct} Farben)`,
};
