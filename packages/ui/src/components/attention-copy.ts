import { defineMessages } from '@baocut/protocol';
import { zhHans } from './attention-copy.zh-Hans.ts';
import { zhHant } from './attention-copy.zh-Hant.ts';
import { ja } from './attention-copy.ja.ts';
import { ko } from './attention-copy.ko.ts';
import { es } from './attention-copy.es.ts';
import { fr } from './attention-copy.fr.ts';
import { de } from './attention-copy.de.ts';
import { nl } from './attention-copy.nl.ts';
import { ptBR } from './attention-copy.pt-BR.ts';
import { it } from './attention-copy.it.ts';
import { ru } from './attention-copy.ru.ts';
import { pl } from './attention-copy.pl.ts';
import { tr } from './attention-copy.tr.ts';
import { vi } from './attention-copy.vi.ts';

/**
 * 提醒的文案（产品设计 §3.1「提醒」）：系统通知的标题是会话标题，正文是下面一句；应用内提示带「查看」。英文是键与类型的来源，
 * 译文在 `attention-copy.<语言>.ts`。
 */
const en = {
  approval: 'Needs your approval',
  question: 'Has a question for you',
  finished: 'Task finished',
  failed: 'Task failed',
  /** 应用内提示上的按钮：打开那条会话。 */
  view: 'View',
};

export type AttentionMessages = typeof en;

export const ATTENTION_COPY = defineMessages(en, {
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
