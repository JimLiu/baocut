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
  imageName: (n: number) => `Image ${n}`,
  seed: (seed: number) => `Seed ${seed}`,
  decoding: 'Decoding',
  stepOf: (done: number, total: number) => `Step ${done}/${total}`,
};
export type ToolsImageMessages = typeof en;
export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
