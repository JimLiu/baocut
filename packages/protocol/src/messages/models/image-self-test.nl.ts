import type { ModelsImageSelfTestMessages } from './image-self-test.ts';

export const nl: ModelsImageSelfTestMessages = {
  notPng: "Geen PNG-bestand",
  chunkTruncated: (p: { type: string }) => `${p.type}-blok is afgekapt`,
  missingIhdr: "Het IHDR-blok ontbreekt",
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Niet-ondersteund pixelformaat (bitdiepte ${p.depth}, kleurtype ${p.color}, interlace ${p.interlace})`,
  zeroSize: "De breedte of hoogte is 0",
  missingIdat: "Het IDAT-blok ontbreekt",
  inflateFailed: "Kan de pixelgegevens niet uitpakken",
  pixelDataShort: "Onvoldoende pixelgegevens",
  unknownFilter: "Onbekend rijfiltertype",
  undecodable: (p: { problem: string }) => `De uitvoer kan niet worden gedecodeerd: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `De grootte ${p.width}×${p.height} is niet de gevraagde grootte ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `De afbeelding heeft bijna één effen kleur (slechts ${p.distinct} kleuren)`,
};
