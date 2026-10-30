import { defineMessages } from '@baocut/protocol';
import { zhHans } from './plan-copy.zh-Hans.ts';
import { zhHant } from './plan-copy.zh-Hant.ts';
import { ja } from './plan-copy.ja.ts';
import { ko } from './plan-copy.ko.ts';
import { es } from './plan-copy.es.ts';
import { fr } from './plan-copy.fr.ts';
import { de } from './plan-copy.de.ts';
import { nl } from './plan-copy.nl.ts';
import { ptBR } from './plan-copy.pt-BR.ts';
import { it } from './plan-copy.it.ts';
import { ru } from './plan-copy.ru.ts';
import { pl } from './plan-copy.pl.ts';
import { tr } from './plan-copy.tr.ts';
import { vi } from './plan-copy.vi.ts';

/**
 * 方案审批卡与「按方案实施」那一行的文案（产品设计 §6.6「批准方案」，原型 agent-plan.jsx `AgentPlanMsg`）。英文是键与类型的来源，
 * 译文在 `plan-copy.<语言>.ts`。
 */
const en = {
  /** 待批准卡的标题。 */
  title: 'The agent has a plan for you to approve',
  /** 批准时切到的访问模式（下拉框的无障碍标签）；默认「自动接受修改」。 */
  modeLabel: 'Access mode for implementing',
  implement: 'Implement the plan',
  keepPlanning: 'Keep planning',
  /** 按钮下面的提示：直接发消息也算回复（方案按未批准结束，消息交给智能体）。 */
  hint: 'Or tell the agent what to change in the message box.',
  kind: 'Plan',
  /** 收起后的一行：批准时选的访问模式名。 */
  approved: (mode: string) => `Approved · implementing in ${mode}`,
  declined: 'Not approved',
  byMessage: 'Replied in a message',
  cancelled: 'Stopped',
  /** 回合结束、会话还在「先给方案」时页脚下面那一行（没有方案审批的 Agent 也能接着实施）。 */
  rowLead: 'Plan look right?',
  /** 那一行点「按方案实施」时替用户发的消息。 */
  followUp: 'Implement the plan above.',
  failed: (message: string) => `Couldn’t send: ${message}`,
};

export type PlanMessages = typeof en;

export const PLAN_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
