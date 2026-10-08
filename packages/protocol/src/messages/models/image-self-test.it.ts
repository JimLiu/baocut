import type { ModelsImageSelfTestMessages } from './image-self-test.ts';
import { pluralForm } from '../../i18n.ts';

export const it: ModelsImageSelfTestMessages = {
  notPng: "Non è un file PNG",
  chunkTruncated: (p: { type: string }) => `${p.type} ha un blocco troncato`,
  missingIhdr: "Il blocco IHDR manca",
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Formato pixel non supportato (profondità di bit ${p.depth}, tipo di colore ${p.color}, interlacciamento ${p.interlace})`,
  zeroSize: "La larghezza o l’altezza è 0",
  missingIdat: "Il blocco IDAT manca",
  inflateFailed: "Impossibile decomprimere i dati dei pixel",
  pixelDataShort: "Dati dei pixel insufficienti",
  unknownFilter: "Tipo di filtro di riga sconosciuto",
  undecodable: (p: { problem: string }) => `Impossibile decodificare l’output: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `La dimensione ${p.width}×${p.height} non corrisponde a quella richiesta ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `L’immagine è quasi di un unico colore uniforme (solo ${pluralForm('it', p.distinct, { one: `${p.distinct} colore`, other: `${p.distinct} colori` })})`,
};
