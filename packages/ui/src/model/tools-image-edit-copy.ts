import { defineMessages } from '@baocut/protocol';
import type { EditImageAnchor } from '@baocut/protocol';
import { zhHans } from './tools-image-edit-copy.zh-Hans.ts';
import { zhHant } from './tools-image-edit-copy.zh-Hant.ts';
import { ja } from './tools-image-edit-copy.ja.ts';
import { ko } from './tools-image-edit-copy.ko.ts';
import { es } from './tools-image-edit-copy.es.ts';
import { fr } from './tools-image-edit-copy.fr.ts';
import { de } from './tools-image-edit-copy.de.ts';
import { nl } from './tools-image-edit-copy.nl.ts';
import { ptBR } from './tools-image-edit-copy.pt-BR.ts';
import { it } from './tools-image-edit-copy.it.ts';
import { ru } from './tools-image-edit-copy.ru.ts';
import { pl } from './tools-image-edit-copy.pl.ts';
import { tr } from './tools-image-edit-copy.tr.ts';
import { vi } from './tools-image-edit-copy.vi.ts';

type Tool = 'upscale' | 'erase' | 'watermark' | 'repaint' | 'expand';
type Side = 'left' | 'top' | 'right' | 'bottom';

/** 图片处理工作台（放大、去除物体、去水印、重绘局部、扩展画面）的文案（译文在 `tools-image-edit-copy.<语言>.ts`）。 */
const en = {
  title: {
    upscale: 'Upscale image',
    erase: 'Remove object',
    watermark: 'Remove watermark',
    repaint: 'Repaint area',
    expand: 'Expand image',
  } satisfies Record<Tool, string>,
  switchItem: { upscale: 'Upscale', erase: 'Remove object', watermark: 'Watermark', repaint: 'Repaint', expand: 'Expand' } satisfies Record<Tool, string>,
  switchLabel: 'Image tool',
  verb: { upscale: 'Upscale', erase: 'Remove', watermark: 'Remove watermark', repaint: 'Repaint', expand: 'Expand' } satisfies Record<Tool, string>,
  lede: {
    upscale: 'Enlarge images 2–4× with Real-ESRGAN on this computer, filling in detail instead of just stretching.',
    erase: 'Paint over people or things you don’t want, and the area is filled in from its surroundings.',
    watermark: 'Box a watermark, logo or caption bar; images with it in the same place can be done in one go.',
    repaint: 'Paint an area and say what it should become; only that area changes.',
    expand: 'Extend the picture to a new aspect ratio; the added edges continue the original.',
  } satisfies Record<Tool, string>,
  unavailable: 'Not available right now',
  side: 'Results',
  sideFoot: 'Results are saved as new PNG files in the save location. The original images are never changed.',
  empty: 'No results yet',
  emptyBody: 'Each run shows up here when it finishes.',
  progress: 'Progress',
  saveNote: 'Results are new PNG files; the originals stay as they are',
  submitted: 'Started · the result appears on the right',
  submitFailed: (reason: string) => `Couldn’t start · ${reason}`,
  // 来源
  pickImages: 'Choose images first',
  pickImage: 'Choose an image first',
  imagesTitle: 'Images',
  imageTitle: 'Image',
  images: (n: number) => `${n} ${n === 1 ? 'image' : 'images'}`,
  moreImages: (n: number) => `+${n} more`,
  firstOnCanvas: 'shown on the canvas',
  clear: 'Clear',
  remove: 'Remove',
  spaceAdd: 'Add from Space',
  spaceDone: 'Done',
  notImages: 'Some files were skipped · only PNG, JPEG or WebP images',
  noPath: 'Couldn’t read where this file is · choose it with the button instead',
  pickTitle: 'Choose images',
  imageFilter: 'Images',
  dropMany: 'Drop images here',
  dropOne: 'Drop an image here',
  dropSub: 'PNG, JPEG or WebP · from this computer or Space',
  pick: 'Choose…',
  addMore: 'Add more…',
  replace: 'Replace…',
  // 画布与选区
  canvasLabel: 'Selection',
  brushLabel: 'Paint',
  boxLabel: 'Box',
  brush: 'Brush size',
  hintErase: 'Paint over what should go; a little past the edges works best',
  hintRepaint: 'Paint over the area to change',
  hintBox: 'Drag to box the watermark; add more boxes if needed',
  presetsLabel: 'Common places',
  preset: { br: 'Bottom right', bl: 'Bottom left', tr: 'Top right', tl: 'Top left', sub: 'Caption bar' },
  undoStroke: 'Undo stroke',
  undoBox: 'Undo box',
  clearSelection: 'Clear selection',
  coverage: (pct: number, roi: string | null) => `${pct}% of the image${roi ? ` · sends a ${roi} area` : ''}`,
  ratioDiffers: 'different shape, boxes may be off',
  added: (m: Record<Side, number>) =>
    (['left', 'top', 'right', 'bottom'] as const)
      .filter((k) => m[k] > 0)
      .map((k) => `${k} +${m[k]}`)
      .join(' · '),
  // 问题
  markWatermark: 'Box the watermark first',
  paintErase: 'Paint over what to remove first',
  paintRepaint: 'Paint over the area to change first',
  selectionTooLarge: 'The selection covers too much of the image · keep it under 60%',
  promptRequired: 'Say what the area should become',
  expandSame: 'The image already has this shape · pick another ratio or add margins',
  expandTooLarge: (max: number) => `The new canvas would be over ${max} px on a side`,
  upscaleTooLarge: (name: string, scale: number, max: number) => `${name} would be over ${max} px on a side at ${scale}×`,
  upscaleTooLargePeak: (name: string, max: number) => `${name} is too large · the photo model first enlarges 4×, which would be over ${max} px`,
  noEditModel: 'No image model that can edit pictures · add one in Models',
  modelUnusable: (label: string) => `${label} can’t be used right now`,
  // 隐私标签
  chipLocal: 'On this computer · offline',
  chipRegion: 'Online · only the area around the selection is sent',
  chipWhole: 'Online · the whole image is sent',
  // Real-ESRGAN
  esrganMissing: 'Download Real-ESRGAN first',
  esrganTitle: 'Real-ESRGAN is needed',
  esrganBody: 'Upscaling runs Real-ESRGAN on this computer’s GPU. It’s downloaded once and works offline after that.',
  esrganFacts: (version: string, license: string, size: string | null) => [version, license, size].filter(Boolean).join(' · '),
  esrganInstall: 'Download',
  esrganInstalling: 'Downloading Real-ESRGAN…',
  esrganInstallFailed: (reason: string) => `Couldn’t download Real-ESRGAN · ${reason}`,
  recheck: 'Check again',
  // 放大
  upscaleTitle: 'Upscale',
  upscaleKind: 'Picture type',
  photo: 'Photo',
  photoSub: 'Camera shots, screenshots, realistic images',
  anime: 'Anime and illustration',
  animeSub: 'Line art, flat colors, cleaner edges',
  scale: 'Scale',
  resizeNote: (scale: number) => `The photo model works at 4×; ${scale}× is made by enlarging 4× and scaling down`,
  nativeNote: 'Runs at this scale directly',
  upscaleCaveat: 'Upscaling adds plausible detail; it can’t recover text or faces that aren’t there',
  // 补法、提示词与模型
  methodTitle: 'Method',
  method: {
    fill: { name: 'Quick fill', sub: 'On this computer · no model · a few seconds · good for small text and logos' },
    model: { name: 'AI inpaint', sub: 'An image model redraws the selection from its surroundings · large objects and busy backgrounds' },
  },
  promptRepaint: 'Change it to',
  promptExpand: 'What’s in the new area',
  optional: 'Optional',
  promptRepaintPlaceholder: 'e.g. a red umbrella',
  promptExpandPlaceholder: 'e.g. more sky and sea; leave empty to continue the scene',
  modelNoun: 'image model',
  localModel: 'On this computer',
  cloudModel: 'Online',
  modelRegionNote: 'Only the area around the selection is sent, and only the selection is pasted back.',
  modelExpandNote: 'The whole image is sent; the original pixels are pasted back unchanged.',
  localNote: 'Nothing leaves this computer.',
  cloudNote: 'Billed by the provider per image.',
  // 扩图
  expandTitle: 'New shape',
  byMargins: 'By margins',
  side_: { left: 'Left %', top: 'Top %', right: 'Right %', bottom: 'Bottom %' } satisfies Record<Side, string>,
  anchorTitle: 'Original position',
  anchor: {
    'top-left': 'Top left',
    top: 'Top',
    'top-right': 'Top right',
    left: 'Left',
    center: 'Center',
    right: 'Right',
    'bottom-left': 'Bottom left',
    bottom: 'Bottom',
    'bottom-right': 'Bottom right',
  } satisfies Record<EditImageAnchor, string>,
  anchorNote: 'Where the original sits on the new canvas',
  staged: 'Expanding more than the image’s own size on a side works better in two passes',
};
export type ToolsImageEditMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
