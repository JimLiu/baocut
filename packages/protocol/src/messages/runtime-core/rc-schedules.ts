import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-schedules.zh-Hans.ts';
import { zhHant } from './rc-schedules.zh-Hant.ts';
import { ja } from './rc-schedules.ja.ts';
import { ko } from './rc-schedules.ko.ts';
import { es } from './rc-schedules.es.ts';
import { fr } from './rc-schedules.fr.ts';
import { de } from './rc-schedules.de.ts';
import { nl } from './rc-schedules.nl.ts';
import { ptBR } from './rc-schedules.pt-BR.ts';
import { it } from './rc-schedules.it.ts';
import { ru } from './rc-schedules.ru.ts';
import { pl } from './rc-schedules.pl.ts';
import { tr } from './rc-schedules.tr.ts';
import { vi } from './rc-schedules.vi.ts';

/** 定时任务（schedules/，产品设计 §6.1「定时任务」）的错误与运行记录里的说明。英文是键与类型的来源，译文在 `rc-schedules.<语言>.ts`。 */
const en = {
  notFound: (p: { id: string }) => `Scheduled task not found: ${p.id}`,
  conversationNotFound: (p: { id: string }) => `Session not found: ${p.id}`,
  /** 建立时：会话已归档。 */
  conversationArchived: 'This session is archived. Restore it from Archived sessions before scheduling it.',
  /** 「每次新开一条会话」要会话在项目里。 */
  noProject: "This session isn't in a project, so it can't open a new session in a project each time.",
  /** 频率等不对（`details` 是 `ScheduleProblem`，界面按自己的语言说）。 */
  invalid: 'Check the scheduled task: the message, the frequency and the run limit must be valid.',
  notActive: 'Only an active scheduled task can run now.',
  /** 继续不了的原因。 */
  resumeArchived:
    'The target session is archived. Restore it from Archived sessions, or edit the scheduled task to open a new session each time.',
  resumeDeleted: 'The target session was deleted. Edit the scheduled task to open a new session each time.',
  resumeProjectRemoved: "The project was removed from BaoCut, so a new session can't be opened in it.",
  resumeCompleted: 'It already ran the maximum number of times. Raise the limit before continuing.',
  /** 运行记录：任务被停下（算一次失败）。 */
  runStopped: 'Stopped before it finished',
};

export type RcSchedulesMessages = typeof en;

export const RcSchedules = defineCatalog('rcSchedules', en, {
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
