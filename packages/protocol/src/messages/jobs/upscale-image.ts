import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './upscale-image.zh-Hans.ts';
import { zhHant } from './upscale-image.zh-Hant.ts';
import { ja } from './upscale-image.ja.ts';
import { ko } from './upscale-image.ko.ts';
import { es } from './upscale-image.es.ts';
import { fr } from './upscale-image.fr.ts';
import { de } from './upscale-image.de.ts';
import { nl } from './upscale-image.nl.ts';
import { ptBR } from './upscale-image.pt-BR.ts';
import { it } from './upscale-image.it.ts';
import { ru } from './upscale-image.ru.ts';
import { pl } from './upscale-image.pl.ts';
import { tr } from './upscale-image.tr.ts';
import { vi } from './upscale-image.vi.ts';

/** `packages/jobs/src/pipelines/upscale-image.ts` 给人看的文字。 */
const en = {
  label: 'Upscale image',
  description: "Enlarge images 2–4× with Real-ESRGAN on this computer: file to file, output is PNG, and outputs don't overwrite existing files.",
  stepProbe: 'Read images',
  stepUpscale: 'Upscale',
  stepVerify: 'Verify output',
  stepPublish: 'Publish',
  inputNotFound: (p: { file: string }) => `Can't find input image ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} isn't a readable PNG, JPEG, or WebP image`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} would come out at ${p.width}×${p.height}; each side can be at most ${p.max} pixels. Choose a smaller scale.`,
  upscaleFailed: (p: { name: string; detail: string }) => `Real-ESRGAN couldn't upscale ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `No output was written for ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `The output of ${p.name} is ${p.actual}; expected ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} has an EXIF orientation tag; the output is upscaled pixel for pixel and isn't rotated upright`,
  toolNotFound: (p: { code: string }) => `Can't start Real-ESRGAN (${p.code})`,
};

export type JobsUpscaleImageMessages = typeof en;

export const JobsUpscaleImage = defineCatalog('jobsUpscaleImage', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
