import { defineMessages } from '@baocut/protocol';
import { secondsLabel } from './transcript-copy.ts';
import { zhHans } from './timeline-ripple-copy.zh-Hans.ts';
import { zhHant } from './timeline-ripple-copy.zh-Hant.ts';
import { ja } from './timeline-ripple-copy.ja.ts';
import { ko } from './timeline-ripple-copy.ko.ts';
import { es } from './timeline-ripple-copy.es.ts';
import { fr } from './timeline-ripple-copy.fr.ts';
import { de } from './timeline-ripple-copy.de.ts';
import { nl } from './timeline-ripple-copy.nl.ts';
import { ptBR } from './timeline-ripple-copy.pt-BR.ts';
import { it } from './timeline-ripple-copy.it.ts';
import { ru } from './timeline-ripple-copy.ru.ts';
import { pl } from './timeline-ripple-copy.pl.ts';
import { tr } from './timeline-ripple-copy.tr.ts';
import { vi } from './timeline-ripple-copy.vi.ts';

/**
 * 时间线「删掉一段并前移」的文案（原型 editor-keys.jsx 的 `del` / `removeRange`、timeline-menu.jsx 的那一项）：
 * 删除后合拢空隙的提示，右键菜单与 ⇧Delete 的「从所有轨道删除这一段」。译文在 `timeline-ripple-copy.zh-Hans.ts`。
 */
const en = {
  /** 右键菜单的一项。 */
  removeSpan: 'Delete span from all tracks',
  removeSpanHint: 'Later content moves up · total gets shorter',
  /** 选中的只有字幕时：字幕铺满整条轨，不拿它的区间。 */
  removeSpanCaptions: 'Subtitles span the whole video · Select a clip',
  /** 编辑事务的名字。 */
  labelRemoveSpan: 'Delete span from all tracks',
  /** 删除后合拢了空隙；`deleted` 是「已删除 N 个片段」那一句。 */
  closed: (deleted: string, seconds: number) => `${deleted} · Closed the ${secondsLabel(seconds)} gap`,
  /** 删除了，但空隙后面有锁住的轨道或片段，没有合拢。 */
  gapKept: (deleted: string) => `${deleted} · Gap kept: a track or clip after it is locked`,
  removed: (seconds: number) => `Deleted ${secondsLabel(seconds)} from all tracks · Later content moved up`,
  pickSpan: 'Select a clip on the timeline first, then delete its span from all tracks',
  locked: 'A track or clip after this span is locked · Unlock it first',
};

export type TimelineRippleMessages = typeof en;
export const TIMELINE_RIPPLE_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
