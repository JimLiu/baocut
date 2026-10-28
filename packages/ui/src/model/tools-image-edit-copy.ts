import { defineMessages } from '@baocut/protocol';
import type { EditImageAnchor, UpscaleImageDenoise, UpscaleImageModel } from '@baocut/protocol';
import type { UpscaleGroup } from './tools-image-edit.ts';
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
  verb: { upscale: 'Upscale', erase: 'Remove', watermark: 'Remove watermark', repaint: 'Repaint', expand: 'Expand' } satisfies Record<Tool, string>,
  lede: {
    upscale: 'Enlarge images 2–4× on this computer with Real-ESRGAN or waifu2x, or have an image model redraw them larger.',
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
  upscaleTooLargePeak: (name: string, peak: number, max: number) => `${name} is too large · this model first enlarges ${peak}×, which would be over ${max} px`,
  noEditModel: 'No image model that can edit pictures · add one in Models',
  noUpscaleModel: 'No image model that takes reference images · add one in Models',
  guidanceTooLong: (max: number) => `Keep the extra guidance to ${max} characters or fewer`,
  modelUnusable: (label: string) => `${label} can’t be used right now`,
  // 隐私标签
  chipLocal: 'On this computer · offline',
  chipRegion: 'Online · only the area around the selection is sent',
  chipWhole: 'Online · the whole image is sent',
  // 放大要用的受管工具（执行的程序与权重包；名字用 Runtime 给的 `label`）
  toolMissing: (label: string) => `Download ${label} first`,
  toolTitle: (label: string) => `This model needs ${label}`,
  toolBody: {
    'realesrgan-ncnn-vulkan': 'An open-source upscaler that runs on this computer’s GPU. It works offline and never uploads images.',
    'waifu2x-ncnn-vulkan': 'An open-source upscaler for anime-style pictures that can also remove noise. It runs on this computer’s GPU, offline.',
    'upscayl-models': 'Five sets of weights collected by the open-source Upscayl project. They’re only model files, run by Real-ESRGAN.',
  } as Record<string, string>,
  toolKeep: 'It’s downloaded once into BaoCut’s own tools folder and works offline after that; nothing else on this computer changes.',
  toolFacts: (version: string, license: string, size: string | null) => [version, license, size].filter(Boolean).join(' · '),
  toolInstall: 'Download',
  toolInstalling: (label: string) => `Downloading ${label}…`,
  toolInstallFailed: (label: string, reason: string) => `Couldn’t download ${label} · ${reason}`,
  recheck: 'Check again',
  // 放大
  upscaleTitle: 'Upscale',
  upscaleModelTitle: 'Model',
  upscaleGroup: { realesrgan: 'Real-ESRGAN', upscayl: 'Upscayl weights · run by Real-ESRGAN', waifu2x: 'waifu2x', other: 'Other ways' } satisfies Record<UpscaleGroup, string>,
  upscaleModel: {
    photo: { name: 'Photo', sub: 'Camera shots, screenshots, realistic images' },
    anime: { name: 'Anime (fast)', sub: 'Anime frames and flat colors; native 2, 3 and 4×, the fastest' },
    illustration: { name: 'Anime illustration', sub: 'Anime-style illustrations and line art; sharper than Anime (fast)' },
    'upscayl-lite': { name: 'Upscayl Lite', sub: 'General and light; runs on computers with little GPU memory' },
    'high-fidelity': { name: 'High Fidelity', sub: 'Keeps texture and detail; good for photos' },
    remacri: { name: 'Remacri', sub: 'Natural detail without over-smoothing; good for photos' },
    'ultramix-balanced': { name: 'UltraMix Balanced', sub: 'Between sharp and smooth' },
    ultrasharp: { name: 'UltraSharp', sub: 'Very sharp; noise in the image gets sharpened too' },
    waifu2x: { name: 'waifu2x', sub: 'Anime illustrations; the best of the three, and the slowest' },
    'waifu2x-anime': { name: 'waifu2x anime style', sub: 'Anime illustrations; faster than the one above' },
    'waifu2x-photo': { name: 'waifu2x photo', sub: 'Photos; also removes noise and JPEG blocks' },
    lanczos: { name: 'Smooth (Lanczos)', sub: 'Interpolation only, no added detail; nothing to download, a few seconds' },
    generative: { name: 'AI redraw', sub: 'An image model redraws a larger copy; details and text may change' },
  } satisfies Record<UpscaleImageModel, { name: string; sub: string }>,
  licenseTag: { nc: 'Not for commercial use', unstated: 'License not stated' },
  licenseNc: (spdx: string) => `These weights are licensed ${spdx}: upscaled results can’t be used commercially`,
  licenseUnstated: 'The authors of these weights haven’t stated a license: check before using the results commercially',
  scale: 'Scale',
  denoise: 'Noise reduction',
  denoiseLevel: { '-1': 'Off', 0: 'Light', 1: 'Medium', 2: 'Strong', 3: 'Strongest' } satisfies Record<UpscaleImageDenoise, string>,
  denoiseNote: 'Noise reduction also removes JPEG blocks; higher levels are cleaner but can smooth away detail too.',
  resizeNote: (peak: number, scale: number) => `This model works at ${peak}×: it enlarges ${peak}× and then scales down to ${scale}× (Lanczos), keeping more detail than stretching.`,
  nativeNote: 'The model works at this scale directly.',
  upscaleCaveat: 'Upscaling guesses at detail: text and screenshots can get strokes that weren’t there.',
  lanczosNote: 'ffmpeg enlarges with Lanczos interpolation: no detail is added; it’s only smoother than stretching.',
  generativeNote: 'The whole image goes to the image model, redrawn at the closest size it offers and scaled to the target size. Text, faces and small details may differ from the original.',
  generativeModelNote: 'Only models that take reference images and output set pixel sizes are listed.',
  generativeCloudNote: 'Online models get the whole image, billed at the provider’s price; the provider may keep a copy.',
  guidanceTitle: 'Extra guidance',
  guidancePlaceholder: 'e.g. a watercolor; keep the paper texture and leave any text as it is',
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
