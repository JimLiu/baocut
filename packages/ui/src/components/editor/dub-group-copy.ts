import { defineMessages } from '@baocut/protocol';
import { zhHans } from './dub-group-copy.zh-Hans.ts';
import { zhHant } from './dub-group-copy.zh-Hant.ts';
import { ja } from './dub-group-copy.ja.ts';
import { ko } from './dub-group-copy.ko.ts';
import { es } from './dub-group-copy.es.ts';
import { fr } from './dub-group-copy.fr.ts';
import { de } from './dub-group-copy.de.ts';
import { nl } from './dub-group-copy.nl.ts';
import { ptBR } from './dub-group-copy.pt-BR.ts';
import { it } from './dub-group-copy.it.ts';
import { ru } from './dub-group-copy.ru.ts';
import { pl } from './dub-group-copy.pl.ts';
import { tr } from './dub-group-copy.tr.ts';
import { vi } from './dub-group-copy.vi.ts';

/** 素材面板里配音组卡片（菜单、状态、提示）的文案。译文在 `dub-group-copy.zh-Hans.ts`。 */
const en = {
  track: 'Show this track on the timeline',
  trackGone: 'This voice-over group is no longer on the timeline',
  regen: (n: number) => `Regenerate ${n} ${n === 1 ? 'sentence' : 'sentences'}…`,
  regenNote: 'Sentences that weren’t synthesized or don’t fit · review them, edit the translation if needed, then redo only these',
  download: 'Download group',
  downloadNote: 'Whole groups can’t be downloaded yet; to get this group’s mix, choose “Only this voice-over group” when exporting audio',
  redub: 'Redo this language',
  redubNote: 'Opens Translated voice-over',
  remove: 'Remove this voice-over group',
  removeNote: 'Removes this group’s clips from the timeline and restores the original audio; you can undo. The empty voice-over track and plan are kept',
  removeLoading: 'Loading the voice-over plan…',
  readOnly: 'The video is read-only',
  removed: (title: string) => `Removed “${title}”`,
  rowOnTimeline: (label: string) => `Row “${label}” on the timeline`,
  undo: 'Undo',
  stateOn: 'On timeline',
  stateOff: 'Track off',
  stateGone: 'Not on timeline',
  groupMenu: 'This voice-over group',
  actionsOf: (title: string) => `Actions for “${title}”`,
  clickToSelect: (text: string) => `${text} · click to select it on the timeline`,
};

export type DubGroupMessages = typeof en;
export const DUB_GROUP_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
