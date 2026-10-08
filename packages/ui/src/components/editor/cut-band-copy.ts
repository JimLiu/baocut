import { defineMessages } from '@baocut/protocol';
import { secondsLabel } from './transcript-copy.ts';
import { zhHans } from './cut-band-copy.zh-Hans.ts';
import { zhHant } from './cut-band-copy.zh-Hant.ts';
import { ja } from './cut-band-copy.ja.ts';
import { ko } from './cut-band-copy.ko.ts';
import { es } from './cut-band-copy.es.ts';
import { fr } from './cut-band-copy.fr.ts';
import { de } from './cut-band-copy.de.ts';
import { nl } from './cut-band-copy.nl.ts';
import { ptBR } from './cut-band-copy.pt-BR.ts';
import { it } from './cut-band-copy.it.ts';
import { ru } from './cut-band-copy.ru.ts';
import { pl } from './cut-band-copy.pl.ts';
import { tr } from './cut-band-copy.tr.ts';
import { vi } from './cut-band-copy.vi.ts';

/** 被剪文字太长时只引前面这么多字。 */
const QUOTE_MAX = 40;

const quote = (text: string) => `“${text.length > QUOTE_MAX ? `${text.slice(0, QUOTE_MAX - 1)}…` : text}”`;

const cut = (seconds: number, text: string) => (text ? `Cut ${secondsLabel(seconds)}: ${quote(text)}` : `Cut ${secondsLabel(seconds)}`);

/** 时间线剪口带的文案（原型 timeline-cutbands.jsx、editor-cuts.jsx 的 `retime`）。译文在 `cut-band-copy.zh-Hans.ts`。 */
const en = {
  /** 悬停第一行：剪掉了多长、剪掉的是哪些字。 */
  cut,
  /** 悬停第二行：怎么操作。按住 Alt（macOS 上是 Option）不吸附。 */
  hint: (mac: boolean) => `Click to restore · drag the edges to change the range (hold ${mac ? 'Option' : 'Alt'} to turn off snapping)`,
  /** 读屏名。 */
  label: (seconds: number, text: string) => `Cut, ${cut(seconds, text)}, click to restore`,
  /** 拖动中浮在带上的读数：新的剪切长度，吸到的词；拖到零宽是恢复。 */
  tag: (seconds: number, edge: 'start' | 'end', word: string | null) =>
    `−${secondsLabel(seconds)}${word ? (edge === 'start' ? ` · from “${word.trim()}”` : ` · to “${word.trim()}”`) : ''}`,
  tagRestore: 'Release to restore',
  /** 编辑事务的名字。 */
  retimeLabel: 'Change cut range',
  retimed: (before: number, after: number) => `Changed cut range · ${secondsLabel(before)} → ${secondsLabel(after)}`,
};

export type CutBandMessages = typeof en;
export const CUT_BAND_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
