import { defineMessages } from '@baocut/protocol';
import { zhHans } from './question-copy.zh-Hans.ts';
import { zhHant } from './question-copy.zh-Hant.ts';
import { ja } from './question-copy.ja.ts';
import { ko } from './question-copy.ko.ts';
import { es } from './question-copy.es.ts';
import { fr } from './question-copy.fr.ts';
import { de } from './question-copy.de.ts';
import { nl } from './question-copy.nl.ts';
import { ptBR } from './question-copy.pt-BR.ts';
import { it } from './question-copy.it.ts';
import { ru } from './question-copy.ru.ts';
import { pl } from './question-copy.pl.ts';
import { tr } from './question-copy.tr.ts';
import { vi } from './question-copy.vi.ts';

/**
 * 智能体提问卡的文案（产品设计 §6.6「提问」，原型 agent-thread.jsx `QuestionMsg`）。英文是键与类型的来源，
 * 译文在 `question-copy.<语言>.ts`。
 */
const en = {
  /** 待回答卡的标题：一道题与几道题。 */
  title: 'The agent has a question',
  titleMany: (n: number) => `The agent has ${n} questions`,
  /** 题目下面的一行说明：单选与多选。 */
  pickOne: 'Pick one',
  pickMany: 'Pick any that apply',
  /** 自己写答案的那一项与它的输入框。 */
  other: 'Other',
  otherPlaceholder: 'Type your answer',
  submit: 'Send answer',
  skip: 'Skip',
  /** 按钮下面的提示：直接发消息也算回答（问题按跳过结束，消息交给智能体）。 */
  hint: 'Or just reply in the message box.',
  kind: 'Question',
  answered: 'Answered',
  skipped: 'Skipped',
  byMessage: 'Answered in a message',
  cancelled: 'Stopped',
  noAnswer: 'No answer',
  failed: (message: string) => `Couldn’t send: ${message}`,
};

export type QuestionMessages = typeof en;

export const QUESTION_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
