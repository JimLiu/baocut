import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './image-self-test.zh-Hans.ts';
import { zhHant } from './image-self-test.zh-Hant.ts';
import { ja } from './image-self-test.ja.ts';
import { ko } from './image-self-test.ko.ts';
import { es } from './image-self-test.es.ts';
import { fr } from './image-self-test.fr.ts';
import { de } from './image-self-test.de.ts';
import { nl } from './image-self-test.nl.ts';
import { ptBR } from './image-self-test.pt-BR.ts';
import { it } from './image-self-test.it.ts';
import { ru } from './image-self-test.ru.ts';
import { pl } from './image-self-test.pl.ts';
import { tr } from './image-self-test.tr.ts';
import { vi } from './image-self-test.vi.ts';

/** `packages/models/src/image-self-test.ts` 文生图自检没通过的原因。 */
const en = {
  notPng: 'Not a PNG file',
  chunkTruncated: (p: { type: string }) => `The ${p.type} chunk is truncated`,
  missingIhdr: 'The IHDR chunk is missing',
  unsupportedPixelFormat: (p: { depth: number; color: number; interlace: number }) => `Unsupported pixel format (bit depth ${p.depth}, color type ${p.color}, interlace ${p.interlace})`,
  zeroSize: 'The width or height is 0',
  missingIdat: 'The IDAT chunk is missing',
  inflateFailed: "Couldn't decompress the pixel data",
  pixelDataShort: 'Not enough pixel data',
  unknownFilter: 'Unknown row filter type',
  undecodable: (p: { problem: string }) => `The output can't be decoded: ${p.problem}`,
  sizeMismatch: (p: { width: number; height: number; expectedWidth: number; expectedHeight: number }) => `The size ${p.width}×${p.height} is not the requested ${p.expectedWidth}×${p.expectedHeight}`,
  nearlySolid: (p: { distinct: number }) => `The image is almost a single solid color (only ${p.distinct} colors)`,
};

export type ModelsImageSelfTestMessages = typeof en;

export const ModelsImageSelfTest = defineCatalog('modelsImageSelfTest', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
