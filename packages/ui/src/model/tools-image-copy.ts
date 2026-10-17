import { defineMessages } from '@baocut/protocol';
import { zhHans } from './tools-image-copy.zh-Hans.ts';
import { zhHant } from './tools-image-copy.zh-Hant.ts';
import { ja } from './tools-image-copy.ja.ts';
import { ko } from './tools-image-copy.ko.ts';
import { es } from './tools-image-copy.es.ts';
import { fr } from './tools-image-copy.fr.ts';
import { de } from './tools-image-copy.de.ts';
import { nl } from './tools-image-copy.nl.ts';
import { ptBR } from './tools-image-copy.pt-BR.ts';
import { it } from './tools-image-copy.it.ts';
import { ru } from './tools-image-copy.ru.ts';
import { pl } from './tools-image-copy.pl.ts';
import { tr } from './tools-image-copy.tr.ts';
import { vi } from './tools-image-copy.vi.ts';

/** 生成图片工作台的文案（译文在 `tools-image-copy.<语言>.ts`）。 */
const en = {
  emptyPrompt: 'Describe the picture first',
  promptTooLong: (n: number, max: number) => `Prompt is ${n} characters · this model takes at most ${max}`,
  maxImages: (max: number) => `Up to ${max} ${max === 1 ? 'image' : 'images'} at a time`,
  seedInteger: 'Seed must be a whole number',
  pickModel: 'Choose a model first',
  downloadFirst: (label: string) => `Download ${label} first`,
  connectFirst: (provider: string) => `Connect ${provider} first`,
  local: 'On this computer',
  steps: (n: number) => `${n} ${n === 1 ? 'step' : 'steps'}`,
  deviceTime: 'Time depends on your device',
  offline: 'Works offline',
  images: (n: number) => `${n} ${n === 1 ? 'image' : 'images'}`,
  aspects: (n: number) => `${n} aspect ${n === 1 ? 'ratio' : 'ratios'}`,
  providerSize: 'Size set by the provider',
  takesSeed: 'Takes a seed',
  localChip: 'Generated on this computer · offline',
  cloudChip: (provider: string) => `Online · ${provider} · billed by usage`,
  agentChip: (provider: string) => `Online · ${provider} · uses your subscription`,
  agentPaidChip: (provider: string) => `Online · ${provider} · not a subscription sign-in · may not work`,
  imageName: (n: number) => `Image ${n}`,
  seed: (seed: number) => `Seed ${seed}`,
  loadingModel: 'Loading model',
  elapsed: (clock: string) => `${clock} elapsed`,
  timeLeft: (clock: string) => `${clock} left`,
  decoding: 'Decoding',
  stepOf: (done: number, total: number) => `Step ${done}/${total}`,
  refModeEdit: 'Edit with the prompt',
  refModeReference: 'Use as reference',
  refModeImg2img: 'Redraw from image',
  refsUnsupported: (model: string) => `${model} doesn’t take reference images`,
  refsIgnored: (model: string, n: number) => `${model} doesn’t take reference images · the ${n} selected won’t be used this time`,
  refsMax: (max: number) => `Up to ${max}`,
  refsGroup: (max: number) => `Every ${max} base images make one image`,
  refsEach: (n: number) => `Each of the ${n} base images is redrawn separately`,
  refsBase: 'Redraws from this image',
  refsEditLocal: 'The first image is the one to edit',
  refsEdit: 'Edits from the reference images',
  refsReference: 'Used as reference',
  refsLocal: 'Read on this computer only, not uploaded',
  refsUpload: 'Reference images are uploaded to the provider',
  refsOver: (n: number) => `${n} over the limit won’t be sent`,
  maxRefs: (max: number) => `Up to ${max} reference ${max === 1 ? 'image' : 'images'}`,
  img2imgNeedsBase: 'Choose a base image to redraw from first',
  strengthRange: (min: number, max: number) => `Change amount must be between ${min} and ${max}`,
  refsSent: (n: number) => `${n} reference ${n === 1 ? 'image' : 'images'}`,
  img2imgMeta: (strength: number) => `Redrawn from image · change ${strength}`,
  refsAddMore: 'Add another',
  refsFromFile: 'From file…',
  refsFromFileNote: 'PNG, JPEG or WebP · pick several at once',
  refsFromSpace: 'Images in Space',
  refsFromLibrary: 'Images in this video',
  refsNoSpaceImages: 'No other images in Space',
  refsNoLibraryImages: 'No other images in this video',
  refsWebNote: 'The browser can’t pick files from this computer',
  refsDrop: 'You can also paste or drag images here',
  refsAddFailed: (name: string, message: string) => `Couldn’t add ${name} · ${message}`,
  promptEditPlaceholder: 'Say what to change in the image, e.g. “make the background light blue” or “draw both people down to the waist”. Vague asks like “finish it” often return the image unchanged.',
  refsNotAdded: (max: number, n: number) => `Up to ${max} reference images · ${n} not added`,
  refsRemove: (name: string) => `Remove ${name}`,
  refsClear: 'Remove',
  refsMissing: (name: string) => `Can’t find ${name}`,
  refsAssetsDropped: (n: number) => `${n} reference ${n === 1 ? 'image' : 'images'} from video media can’t be used here and ${n === 1 ? 'was' : 'were'} left out`,
  refModeLabel: 'How to use the reference images',
  strength: 'Change amount',
  strengthNote: 'Lower stays closer to the base image · the base is cropped to the aspect ratio below',
  refAdded: (name: string) => `${name} set as a reference image`,
  refsFull: (max: number) => `Already ${max} reference images, the most this model takes`,
  refsSkipped: (n: number) => `${n} ${n === 1 ? 'file' : 'files'} skipped · only PNG, JPEG or WebP`,
};
export type ToolsImageMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
