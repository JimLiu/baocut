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
    disable: 'Disable clip',
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
    'sub-scope': 'Line to edit',
    'sub-edit': 'Edit',
    'sub-style': 'Styles',
    'sub-animation': 'Animation',
    case: 'Case',
    'hide-subs': 'Hide subtitles',
  },
  /** 不能用的几格为什么不能用：协议里还没有对应操作、素材取不到原文件、浏览器里没有品牌库等。 */
  offReason: {
    animation: "Animations can't be picked in the editor yet.",
    brand: "This clip's media can't be stored in the brand kit.",
    roundCorners: "The preview can't draw rounded corners yet, so they can't be set here.",
    filters: 'Filters (LUT) are a reserved name in the video format and are rejected on write.',
    crop: 'Smart crop needs a model and has no entry point yet. Coming soon.',
    replace: 'There is no operation to swap the asset of a clip yet.',
    detach: 'Detach audio is not wired up yet: it needs to add an audio clip and mute the video in the same edit.',
    speed: 'This clip does not play at a constant rate, so its speed cannot be changed here.',
    sound: 'This clip has no sound.',
    captionAnimation: "Subtitle animations can't be picked in the editor yet.",
    captionDefaultStyle: 'These subtitles still use the default style. Change any setting first, then save it to the brand kit.',
    brandText: 'The brand kit has no section for text styles yet.',
    brandWeb: 'The brand kit is only available in the desktop app and the CLI.',
  },
  /** 「层级」下钻页的四行与这一笔的名字。 */
  arrange: {
    front: 'Bring to front',
    forward: 'Bring forward',
    backward: 'Send backward',
    back: 'Send to back',
    label: 'Change stacking order',
  },
  /** 字幕工具条的名字（读屏）。 */
  subtitleBar: 'Subtitle toolbar',
  /** 从画布工具条停用片段之后的提示（带撤销）：片段从画面上消失，说清楚去哪重新启用。 */
  disabledNotice: 'Clip disabled. Right-click it on the timeline to enable it again.',
  textStyleLocked: (schema: string) => `This text uses the ${schema} style format and cannot be edited here yet.`,
};

export type StageToolbarMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
