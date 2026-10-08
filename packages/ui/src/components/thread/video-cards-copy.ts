import { defineMessages } from '@baocut/protocol';
import { zhHans } from './video-cards-copy.zh-Hans.ts';
import { zhHant } from './video-cards-copy.zh-Hant.ts';
import { ja } from './video-cards-copy.ja.ts';
import { ko } from './video-cards-copy.ko.ts';
import { es } from './video-cards-copy.es.ts';
import { fr } from './video-cards-copy.fr.ts';
import { de } from './video-cards-copy.de.ts';
import { nl } from './video-cards-copy.nl.ts';
import { ptBR } from './video-cards-copy.pt-BR.ts';
import { it } from './video-cards-copy.it.ts';
import { ru } from './video-cards-copy.ru.ts';
import { pl } from './video-cards-copy.pl.ts';
import { tr } from './video-cards-copy.tr.ts';
import { vi } from './video-cards-copy.vi.ts';

/**
 * 视频卡上收起的「之前的 N 项」（产品设计 §3.2.2；原型 agent-cards.jsx `MovieJobRows`）。英文是键与类型的来源，
 * 译文在 `video-cards-copy.<语言>.ts`。卡上其余的字还在 `copy.ts` 的 `VIDEO_CARD_COPY`。
 */
const en = {
  /** 收起那一行的文字。 */
  earlier: (count: number) => `${count} earlier`,
  /** 收起的里有失败且带补救或重试的：右侧警示图标后的字。 */
  pending: (count: number) => (count === 1 ? '1 needs attention' : `${count} need attention`),
  /** 有待处理时按钮的读屏名：两段字分开念会连成一串，合成一句。 */
  earlierWithPending: (count: number, pending: number) =>
    `${count} earlier, ${pending === 1 ? '1 needs attention' : `${pending} need attention`}`,
  /** 展开后的列表。 */
  earlierList: 'Earlier items',
};

export type VideoCardsMessages = typeof en;

export const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
