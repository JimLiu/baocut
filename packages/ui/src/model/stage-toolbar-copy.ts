import { defineMessages } from '@baocut/protocol';
import { zhHans } from './stage-toolbar-copy.zh-Hans.ts';
import { zhHant } from './stage-toolbar-copy.zh-Hant.ts';
import { ja } from './stage-toolbar-copy.ja.ts';
import { ko } from './stage-toolbar-copy.ko.ts';
import { es } from './stage-toolbar-copy.es.ts';
import { fr } from './stage-toolbar-copy.fr.ts';
import { de } from './stage-toolbar-copy.de.ts';
import { nl } from './stage-toolbar-copy.nl.ts';
import { ptBR } from './stage-toolbar-copy.pt-BR.ts';
import { it } from './stage-toolbar-copy.it.ts';
import { ru } from './stage-toolbar-copy.ru.ts';
import { pl } from './stage-toolbar-copy.pl.ts';
import { tr } from './stage-toolbar-copy.tr.ts';
import { vi } from './stage-toolbar-copy.vi.ts';

/** 画布浮动工具条的文案（英文是键与类型的来源，译文在 `stage-toolbar-copy.<语言>.ts`）。 */
const en = {
  /** 每一格的显示名；图标钮的名字是悬停提示。 */
  toolLabel: {
    color: 'Color',
    font: 'Font',
    size: 'Size',
    'text-styles': 'Styles',
    animation: 'Animation',
    transitions: 'Transitions',
    volume: 'Volume',
    speed: 'Speed',
    adjust: 'Adjust',
    border: 'Stroke',
    'fill-list': 'Fill colors',
    'progress-colors': 'Color',
    'progress-picker': 'Styles',
    'wave-colors': 'Color',
    'wave-picker': 'Styles',
    'counter-mode': 'Mode',
    'volume-levels': 'Volume levels',
    properties: 'Properties',
    copy: 'Duplicate',
    arrange: 'Order',
    'save-to-brand-kit': 'Save to brand kit',
    'adjust-timing': 'Adjust timing',
    delete: 'Delete',
    bold: 'Bold',
    italic: 'Italic',
    'align-left': 'Align left',
    'align-center': 'Center',
    'align-right': 'Align right',
    'line-height': 'Line height',
    'letter-spacing': 'Letter spacing',
    'flip-vertical': 'Flip vertical',
    'flip-horizontal': 'Flip horizontal',
    'fit-canvas': 'Fit to canvas',
    'fill-canvas': 'Fill canvas',
    opacity: 'Opacity',
    'round-corners': 'Corner radius',
    filters: 'Filters',
    effects: 'Effects',
    'crop-video': 'Smart crop',
    'replace-video': 'Replace video',
    'replace-image': 'Replace image',
    'detach-audio': 'Detach audio',
  },
  /** 协议里还没有对应操作的几格：为什么不能用。 */
  offReason: {
    animation: 'The video format has no animations yet: there is no field to write and no edit operation for it.',
    brand: 'The brand kit cannot store clips yet.',
    roundCorners: 'Corner radius for videos and images cannot be written yet (the appearance operation does not take a radius).',
    filters: 'Filters (LUT) are a reserved name in the video format and are rejected on write.',
    crop: 'Smart crop needs a model and has no entry point yet. Coming soon.',
    replace: 'There is no operation to swap the asset of a clip yet.',
    detach: 'Detach audio is not wired up yet: it needs to add an audio clip and mute the video in the same edit.',
    speed: 'This clip does not play at a constant rate, so its speed cannot be changed here.',
    sound: 'This clip has no sound.',
  },
  /** 「层级」下钻页的四行与这一笔的名字。 */
  arrange: {
    front: 'Bring to front',
    forward: 'Bring forward',
    backward: 'Send backward',
    back: 'Send to back',
    label: 'Change stacking order',
  },
  textStyleLocked: (schema: string) => `This text uses the ${schema} style format and cannot be edited here yet.`,
};

export type StageToolbarMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
