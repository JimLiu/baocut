import { defineMessages } from '@baocut/protocol';
import { zhHans } from './fullscreen-player-copy.zh-Hans.ts';
import { zhHant } from './fullscreen-player-copy.zh-Hant.ts';
import { ja } from './fullscreen-player-copy.ja.ts';
import { ko } from './fullscreen-player-copy.ko.ts';
import { es } from './fullscreen-player-copy.es.ts';
import { fr } from './fullscreen-player-copy.fr.ts';
import { de } from './fullscreen-player-copy.de.ts';
import { nl } from './fullscreen-player-copy.nl.ts';
import { ptBR } from './fullscreen-player-copy.pt-BR.ts';
import { it } from './fullscreen-player-copy.it.ts';
import { ru } from './fullscreen-player-copy.ru.ts';
import { pl } from './fullscreen-player-copy.pl.ts';
import { tr } from './fullscreen-player-copy.tr.ts';
import { vi } from './fullscreen-player-copy.vi.ts';

/**
 * 编辑器全屏播放器（fullscreen-player.tsx）的文案。播放、静音、倍速、退出全屏等通用叫法用媒体播放器的那份（player-copy），
 * 上一章 / 下一章用 chapter-copy。英文写在这里，译文在 `fullscreen-player-copy.zh-Hans.ts` 等。
 */
const en = {
  /** 全屏播放器的读屏名。 */
  region: 'Full-screen player',
  /** 预览顶上的入口钮。 */
  enter: 'Full-screen playback',
  enterTip: 'Full-screen playback (F)',
  captions: 'Subtitles',
  captionsTip: (mode: string) => `Subtitles: ${mode} (C)`,
  captionMode: { off: 'Subtitles off', source: 'Original', trans: 'Translation', both: 'Bilingual' },
  keysTip: 'Keyboard shortcuts (?)',
  keysTitle: 'Keyboard shortcuts',
  /** 键表底下的一行：只在 Esc 归播放器时显示（浏览器给了键盘锁定）。 */
  keysFooter: 'Press Esc to close this sheet, then Esc again to leave full screen.',
  /** 键表各行（model/player 的 `PLAYER_KEYS`，按动作取）。 */
  keys: {
    play: 'Play / pause (same as a single click on the picture)',
    exit: 'Leave full screen (same as a double click on the picture)',
    back: 'Back / forward 5 seconds',
    back10: 'Back / forward 10 seconds',
    prevChapter: 'Previous / next chapter',
    volUp: 'Volume ±10 (unmutes automatically)',
    mute: 'Mute / unmute',
    captions: 'Cycle the subtitle mode',
    start: 'Jump to the start / end',
    percent: 'Jump to 0% – 90% of the video',
    keys: 'This sheet',
  },
};

export type FullscreenPlayerMessages = typeof en;

export const FULLSCREEN_PLAYER_COPY = defineMessages(en, {
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
