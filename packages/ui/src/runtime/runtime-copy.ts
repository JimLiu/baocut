import { defineMessages } from '@baocut/protocol';
import { zhHans } from './runtime-copy.zh-Hans.ts';
import { zhHant } from './runtime-copy.zh-Hant.ts';
import { ja } from './runtime-copy.ja.ts';
import { ko } from './runtime-copy.ko.ts';
import { es } from './runtime-copy.es.ts';
import { fr } from './runtime-copy.fr.ts';
import { de } from './runtime-copy.de.ts';
import { nl } from './runtime-copy.nl.ts';
import { ptBR } from './runtime-copy.pt-BR.ts';
import { it } from './runtime-copy.it.ts';
import { ru } from './runtime-copy.ru.ts';
import { pl } from './runtime-copy.pl.ts';
import { tr } from './runtime-copy.tr.ts';
import { vi } from './runtime-copy.vi.ts';

/** 界面与 Runtime 的连接层（建视频、打开的视频、媒体缓存）的文案。英文写在这里，译文在 `runtime-copy.zh-Hans.ts`。 */
const en = {
  missingContext: 'RuntimeContext is missing',
  mediaStatus: (status: number) => `The media service returned ${status}`,
  noRootSequence: 'The new video has no main sequence',
  /** 写进视频改动历史的步骤名。 */
  edit: {
    importAssets: 'Import assets',
    setBackground: 'Set background',
    addWaveform: 'Add waveform',
  },
  /** 新建声波实例的名字。 */
  waveformName: 'Waveform',
  noDuration: 'The video has no length yet, so the waveform wasn’t added',
  noOpenVideo: 'No video is open',
  notCaughtUp: 'The video hasn’t caught up yet and can’t be changed right now',
};

export type RuntimeMessages = typeof en;

export const RT = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
