import { defineMessages } from '@baocut/protocol';
import { zhHans } from './stage-bar-copy.zh-Hans.ts';
import { zhHant } from './stage-bar-copy.zh-Hant.ts';
import { ja } from './stage-bar-copy.ja.ts';
import { ko } from './stage-bar-copy.ko.ts';
import { es } from './stage-bar-copy.es.ts';
import { fr } from './stage-bar-copy.fr.ts';
import { de } from './stage-bar-copy.de.ts';
import { nl } from './stage-bar-copy.nl.ts';
import { ptBR } from './stage-bar-copy.pt-BR.ts';
import { it } from './stage-bar-copy.it.ts';
import { ru } from './stage-bar-copy.ru.ts';
import { pl } from './stage-bar-copy.pl.ts';
import { tr } from './stage-bar-copy.tr.ts';
import { vi } from './stage-bar-copy.vi.ts';

/**
 * 舞台下沿工具条（stage-bar.tsx）的文案。静音、音量用媒体播放器的那份（player-copy），字幕、全屏用全屏播放器的那份。
 * 英文写在这里，译文在 `stage-bar-copy.zh-Hans.ts` 等。
 */
const en = {
  /** 工具条的读屏名。 */
  bar: 'Preview controls',
  ratio: 'Aspect ratio',
  ratioReadOnly: 'Aspect ratio · the video is read-only',
  /** 撤销记录里的名字。 */
  ratioChange: (ratio: string) => `Aspect ratio ${ratio}`,
  /** 自定义画幅应用之后的提示。 */
  ratioApplied: (ratio: string) => `Aspect ratio changed to ${ratio}`,
  original: 'Original',
  originalHint: (ratio: string) => `Matches the video file · ${ratio}`,
  originalNone: 'There’s no video file to match',
  custom: 'Custom…',
  customTitle: 'Custom aspect ratio',
  customWidth: 'Width',
  customHeight: 'Height',
  customSize: (width: number, height: number) => `The short side stays the same · new size ${width} × ${height}`,
  customInvalid: 'Enter two numbers greater than 0',
  customTooLong: (max: number) => `The long side would be over ${max} pixels · try a less extreme ratio`,
  apply: 'Apply',
  safeArea: 'Platform safe area',
  safeAreaHint: 'Marks where the platform’s buttons and text cover the picture',
  safeAreaPortraitOnly: 'Only portrait frames have platform buttons in the way',
  /** 安全区蒙层上三块遮挡区的标签。 */
  safeZones: { top: 'Status bar', right: 'Like · comment · share', bottom: 'Account · caption · comments' },
  showCaptions: 'Show subtitles',
  hideCaptions: 'Hide subtitles',
};

export type StageBarMessages = typeof en;

export const STAGE_BAR_COPY = defineMessages(en, {
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
  ko,
  es,
  fr,
  de,
  nl,
  'pt-BR': ptBR,
  it,
  ru,
  pl,
  tr,
  vi,
});
