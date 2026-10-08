import { defineMessages } from '@baocut/protocol';
import { zhHans } from './elements-copy.zh-Hans.ts';
import { zhHant } from './elements-copy.zh-Hant.ts';
import { ja } from './elements-copy.ja.ts';
import { ko } from './elements-copy.ko.ts';
import { es } from './elements-copy.es.ts';
import { fr } from './elements-copy.fr.ts';
import { de } from './elements-copy.de.ts';
import { nl } from './elements-copy.nl.ts';
import { ptBR } from './elements-copy.pt-BR.ts';
import { it } from './elements-copy.it.ts';
import { ru } from './elements-copy.ru.ts';
import { pl } from './elements-copy.pl.ts';
import { tr } from './elements-copy.tr.ts';
import { vi } from './elements-copy.vi.ts';

/** 元素、文字面板与侧栏工具条的文案。译文在 `elements-copy.zh-Hans.ts`。 */
const en = {
  all: 'All',
  sticker: 'Stickers',
  shape: 'Shapes',
  visualizer: 'Visualizers',
  progress: 'Progress',
  wave: 'Waveforms',
  myStickers: 'My stickers',
  builtin: 'Built-in',
  confetti: 'Confetti',
  elementsTrack: 'Elements',
  searchElements: 'Search elements',
  backToCatalog: 'Back to elements',
  elements: 'Elements',
  searchPlaceholder: 'Search stickers, shapes, visualizers',
  elementCategories: 'Element categories',
  stickerCategories: 'Sticker categories',
  visualizerCategories: 'Visualizer categories',
  dynamicCategories: 'Animated sticker categories',
  notFound: (query: string) => `Nothing found for “${query}”`,
  clickHint: 'Click to create an element at the playhead and select it; then drag it into place on the canvas.',
  viewAll: 'View all',
  progressBars: 'Progress bars',
  builtinCount: (count: number) => `${count} styles`,
  confettiNote: '10 algorithmic particle styles · any length',
  dynamicHint: 'Lottie from the brand kit follows the playhead on the canvas; tiles hold one frame and play on hover. Confetti isn’t an animated image: the ten recipes are computed frame by frame, and their length follows the clip on the timeline; the same seed gives the same picture.',
  stickerCount: (count: number) => `${count}`,
  fromBrand: 'From the brand kit',
  uploadToBrand: 'Upload in Brand kit',
  noMine: (query: string) => `No “${query}” in My stickers`,
  readingBrand: 'Loading brand kit…',
  noOwnDynamic: 'You don’t have any animated stickers of your own yet',
  noOwnStatic: 'You don’t have any stickers of your own yet',
  dynamicAccepts: 'The brand kit accepts Lottie animations (.json); image stickers go on the “Stickers” page.',
  staticAccepts: 'The brand kit accepts images (PNG, WebP, GIF, JPG); Lottie animations (.json) go on the “Animated stickers” page.',
  signpost: 'Stickers live in the brand kit, so any video can use them; placing one copies it, and later changes in the kit don’t affect this video.',
  addNamed: (name: string) => `Add ${name}`,
  text: 'Text',
  addTextFailed: (message: string) => `Couldn’t add text: ${message}`,
  textBox: 'Text box',
  textPresetLabel: (name: string) => `Text · ${name}`,
  textCategories: 'Text preset categories',
  addTextBox: 'Add text box',
  presetCount: (count: number) => `${count}`,
  addPreset: (name: string) => `Add text preset “${name}”`,
  layers: (count: number) => `${count} layers`,
  layersInTurn: (name: string, count: number) => `${name} · ${count} layers, appearing in turn`,
  tabTranscript: 'Transcript',
  tabSubtitle: 'Subtitles',
  tabImage: 'Images',
  tabVideo: 'Video',
  tabAudio: 'Audio',
  tabBrand: 'Brand',
  tabProps: 'Properties',
  currentTool: 'Current editing tool',
  videoTools: 'Video editing tools',
  resizePanel: 'Resize panel',
  added: (label: string, start: string, end: string) => `Added ${label} · ${start} → ${end}`,
  undo: 'Undo',
  lottieFetchFailed: (status: number) => `Couldn’t load the Lottie file (${status})`,
};

export type ElementsMessages = typeof en;
export const ELEMENTS_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
