import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './edit-image.zh-Hans.ts';
import { zhHant } from './edit-image.zh-Hant.ts';
import { ja } from './edit-image.ja.ts';
import { ko } from './edit-image.ko.ts';
import { es } from './edit-image.es.ts';
import { fr } from './edit-image.fr.ts';
import { de } from './edit-image.de.ts';
import { nl } from './edit-image.nl.ts';
import { ptBR } from './edit-image.pt-BR.ts';
import { it } from './edit-image.it.ts';
import { ru } from './edit-image.ru.ts';
import { pl } from './edit-image.pl.ts';
import { tr } from './edit-image.tr.ts';
import { vi } from './edit-image.vi.ts';

/** `packages/jobs/src/pipelines/edit-image.ts` 与 Runtime 里改图的接线给人看的文字。 */
const en = {
  eraseLabel: 'Remove object',
  eraseDescription: 'Paint over people or things you don’t want and fill the area from its surroundings, with ffmpeg on this computer or an image model. Output is a new PNG.',
  watermarkLabel: 'Remove watermark',
  watermarkDescription: 'Box watermarks, logos, or subtitle bars and fill them in; the same boxes can be used on many images. Output is a new PNG per image.',
  repaintLabel: 'Repaint area',
  repaintDescription: 'Paint an area and say what it should become; an image model redraws only that area. Output is a new PNG.',
  expandLabel: 'Expand image',
  expandDescription: 'Extend the picture to a new aspect ratio or by margins; an image model draws the new parts and the original pixels are kept. Output is a new PNG.',
  stepProbe: 'Read images',
  stepMask: 'Prepare selection',
  stepEdit: 'Edit',
  stepVerify: 'Verify output',
  stepPublish: 'Publish',
  inputNotFound: (p: { file: string }) => `Can't find input image ${p.file}`,
  inputUnsupported: (p: { name: string }) => `${p.name} isn't a readable PNG, JPEG, or WebP image`,
  singleInput: 'This tool edits one image at a time',
  maskRequired: 'Mark the area to change: give mask.boxes or mask.strokes',
  maskShape: 'must be { boxes: [{ x, y, width, height }], strokes: [{ radius, points: [[x, y], …] }] } in pixels, no negative numbers',
  maskNotAccepted: 'Expanding an image takes no mask',
  maskEmpty: (p: { name: string }) => `The selection doesn't cover any part of ${p.name}`,
  maskTooLarge: (p: { name: string; percent: number; max: number }) => `The selection covers ${p.percent}% of ${p.name}; above ${p.max}% generate a new image instead`,
  promptRequired: 'Say what the painted area should become',
  promptNotAccepted: 'This tool takes no prompt',
  methodUnsupported: (p: { method: string }) => `This tool can't use the ${p.method} method`,
  expandRequired: 'Give the new canvas: expand.ratio or expand.margins',
  expandShape: 'must be { ratio, anchor } or { margins: { left, top, right, bottom } } with whole pixels, no negative numbers',
  expandBoth: 'Give expand.ratio or expand.margins, not both',
  ratioInvalid: (p: { ratio: string }) => `${p.ratio} isn't an aspect ratio like 16:9`,
  expandSame: (p: { name: string }) => `${p.name} already has this shape; there is nothing to add`,
  expandTooLarge: (p: { name: string; width: number; height: number; max: number }) => `${p.name} would become ${p.width}×${p.height}; each side can be at most ${p.max} pixels`,
  editUnsupported: (p: { modelId: string }) => `${p.modelId} can't edit an image by prompt. Choose an image model that can, in Settings › Models or with provider and model.`,
  modelOutputCount: (p: { count: number }) => `The image model returned ${p.count} images; expected 1`,
  modelOutputOutsideStaging: 'The image model wrote its output outside the job folder',
  modelOutputUnreadable: (p: { name: string }) => `The image model's result for ${p.name} isn't a readable image`,
  outputMissing: (p: { name: string }) => `No output was written for ${p.name}`,
  outputSizeMismatch: (p: { name: string; actual: string; expected: string }) => `The output of ${p.name} is ${p.actual}; expected ${p.expected}`,
  exifOrientation: (p: { name: string }) => `${p.name} has an EXIF orientation tag; the selection is read on the stored pixels, which aren't rotated upright`,
  expandStaged: (p: { name: string }) => `${p.name} was extended by more than its own size on one side; lines and horizons may not line up. Expanding in two smaller steps usually looks better.`,
};

export type JobsEditImageMessages = typeof en;

export const JobsEditImage = defineCatalog('jobsEditImage', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
