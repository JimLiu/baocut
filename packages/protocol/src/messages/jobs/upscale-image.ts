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
  description: `Enlarge images 2–4× on this computer (Real-ESRGAN, Upscayl weights, waifu2x or Lanczos) or redraw them with an image model: file to file, output is PNG, and outputs don't overwrite existing files.`,
  stepProbe: 'Read images',
  stepUpscale: 'Upscale',
  stepVerify: 'Verify output',
  stepPublish: 'Publish',
  inputNotFound: (p: { file: string }) => `Can't find input image ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} isn't a readable PNG, JPEG, or WebP image`,
  outputTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} would come out at ${p.width}×${p.height}; each side can be at most ${p.max} pixels. Choose a smaller scale.`,
  upscaleFailed: (p: { tool: string; name: string; detail: string }) => `${p.tool} couldn't upscale ${p.name}: ${p.detail}`,
  outputMissing: (p: { name: string }) => `No output was written for ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `The output of ${p.name} is ${p.actual}; expected ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} has an EXIF orientation tag; the output is upscaled pixel for pixel and isn't rotated upright`,
  toolNotFound: (p: { tool: string; code: string }) => `Can't start ${p.tool} (${p.code})`,
  denoiseUnsupported: (p: { model: string }) => `The ${p.model} model can't denoise; only the waifu2x models take denoise`,
  generativeOnly: (p: { model: string }) => `Only the generative model takes this; ${p.model} doesn't`,
  generativeUnavailable: `Generative upscaling isn't available here`,
  modelNoReferences: (p: { modelId: string }) => `${p.modelId} doesn't take a reference image, so it can't upscale. Choose a model that accepts input images.`,
  modelNoSizes: (p: { modelId: string }) => `${p.modelId} doesn't list its output sizes, so the output can't be planned. Choose another model.`,
  modelTooSmall: (p: { name: string; modelId: string; size: string }) => `${p.modelId} can draw at most ${p.size}, which wouldn't enlarge ${p.name}. Choose a local engine or a model with larger sizes.`,
  generativeInterpolated: (p: { name: string; size: string }) => `${p.name}: the model drew it at ${p.size}; the rest of the enlargement is Lanczos interpolation`,
  generativeRedraws: 'Generative upscaling redraws the image: details, text and faces may differ from the original',
};

export type JobsUpscaleImageMessages = typeof en;

export const JobsUpscaleImage = defineCatalog('jobsUpscaleImage', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
