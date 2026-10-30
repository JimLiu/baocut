import { defineMessages } from '@baocut/protocol';
import { zhHans } from './todo-copy.zh-Hans.ts';
import { zhHant } from './todo-copy.zh-Hant.ts';
import { ja } from './todo-copy.ja.ts';
import { ko } from './todo-copy.ko.ts';
import { es } from './todo-copy.es.ts';
import { fr } from './todo-copy.fr.ts';
import { de } from './todo-copy.de.ts';
import { nl } from './todo-copy.nl.ts';
import { ptBR } from './todo-copy.pt-BR.ts';
import { it } from './todo-copy.it.ts';
import { ru } from './todo-copy.ru.ts';
import { pl } from './todo-copy.pl.ts';
import { tr } from './todo-copy.tr.ts';
import { vi } from './todo-copy.vi.ts';

/**
 * 输入框上方智能体待办条的文案（产品设计 §3.2.3「智能体的待办」，原型 agent-todo.jsx `AgentTodoDock`）。英文是键与类型的来源，
 * 译文在 `todo-copy.<语言>.ts`。清单里每一项的文字是智能体写的原话，不翻译。
 */
const en = {
  /** 待办条的无障碍标签。 */
  label: 'Agent’s to-do list',
  /** 收起时的一行：已完成数 / 总数，加正在做的那一项（全做完时没有）。 */
  summary: (done: number, total: number, current: string | null) => (current ? `${done}/${total} · ${current}` : `${done}/${total}`),
  /** 每一项状态的读屏说法。 */
  status: { completed: 'Done', inProgress: 'In progress', pending: 'To do' },
};

export type TodoMessages = typeof en;

export const TODO_COPY = defineMessages(en, {
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
