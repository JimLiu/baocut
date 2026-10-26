import { defineMessages, type CaptionSummaryColorUse, type CaptionSummaryLayerKind, type CaptionSummaryTier } from '@baocut/protocol';
import { zhHans } from './caption-scene-copy.zh-Hans.ts';
import { zhHant } from './caption-scene-copy.zh-Hant.ts';
import { ja } from './caption-scene-copy.ja.ts';
import { ko } from './caption-scene-copy.ko.ts';
import { es } from './caption-scene-copy.es.ts';
import { fr } from './caption-scene-copy.fr.ts';
import { de } from './caption-scene-copy.de.ts';
import { nl } from './caption-scene-copy.nl.ts';
import { ptBR } from './caption-scene-copy.pt-BR.ts';
import { it } from './caption-scene-copy.it.ts';
import { ru } from './caption-scene-copy.ru.ts';
import { pl } from './caption-scene-copy.pl.ts';
import { tr } from './caption-scene-copy.tr.ts';
import { vi } from './caption-scene-copy.vi.ts';

/** 模板字幕样式的调整页（原型 panel-subadjust.jsx，字幕编辑器重设计 §9.3）。译文在 `caption-scene-copy.zh-Hans.ts`。 */
const en = {
  heading: 'Template style',
  note: 'A template is one whole scene, so only the settings below can be adjusted. To edit every setting, switch to a built-in style.',

  colors: 'Colors',
  colorsAside: 'A swatch changes that color throughout',
  uses: {
    text: 'Text',
    stroke: 'Stroke',
    shadow: 'Shadow',
    glow: 'Glow',
    active: 'Active word',
    read: 'Spoken',
    unread: 'Upcoming',
    keyword: 'Keyword',
    plate: 'Background',
    'word-box': 'Word box',
    material: 'Material',
  } as Record<CaptionSummaryColorUse, string>,
  animated: 'Animated',
  colorAria: (uses: string) => `Template color · ${uses}`,

  fonts: 'Fonts',
  fontsAside: 'Changing a font re-lays out the text',
  fontRow: (n: number) => (n === 1 ? 'Main font' : `Font ${n}`),
  tunedSpacing: 'The template tuned its letter spacing for the original font. The spacing stays when the font changes, so text may look tight or loose.',

  size: 'Size',
  sizeAside: 'Text and decorations scale together',
  fontScale: 'Scale',

  position: 'Position',
  positionAside: 'Share of the frame',
  places: { y: 'Vertical', x: 'Horizontal', width: 'Width' } as Record<'x' | 'y' | 'width', string>,
  computed: 'Set by the template; can’t be changed here',

  keywords: 'Keywords',
  keywordsAside: 'Pick words; applies to this subtitle layer',
  keywordsAria: 'Keywords in this subtitle',
  noCue: 'Move the playhead onto a subtitle first.',
  noWords: 'This subtitle has no word data, so its keywords can’t be marked.',
  keywordsNote: 'The template reads the keyword tag on these words and decides how to emphasize them. Words are never picked automatically.',

  variant: 'Variant',
  variantAside: 'Reshuffles the template’s random parts',
  nextVariant: 'New variant',
  variantN: (n: number) => `Variant ${n}`,

  makeup: 'Makeup',
  makeupAside: 'Read-only',
  layers: 'Layers',
  layerKinds: {
    fill: 'Fill',
    stroke: 'Stroke',
    shadow: 'Shadow',
    'inner-shadow': 'Inner shadow',
    glow: 'Glow',
    plate: 'Background',
    box: 'Word box',
    image: 'Texture',
    material: 'Material',
  } as Record<CaptionSummaryLayerKind, string>,
  tiers: 'Tiers',
  tierKinds: {
    'glyph-motion': 'Glyph motion',
    'text-paint': 'Text paint',
    'texture-effects': 'Textures and effects',
    'derived-decoration': 'Decorations',
  } as Record<CaptionSummaryTier, string>,
  wordTiming: 'Word timing',
  needed: 'Needed',
  notNeeded: 'Not needed',
  listSeparator: ' · ',

  adjusted: 'Adjusted',
  asTemplate: 'As the template',
  restore: 'Restore',
  restored: 'Restored the template as it was',
  unavailable: 'Template controls aren’t available right now.',
  /** 样式画廊顶上：字幕用的是模板时。 */
  galleryReplaces: 'This subtitle uses a template style. Picking a built-in style replaces the template and its adjustments.',
};

export type CaptionSceneMessages = typeof en;
export const CAPTION_SCENE_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
