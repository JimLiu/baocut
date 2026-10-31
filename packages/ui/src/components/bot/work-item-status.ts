import type { ComponentType } from 'react';
import Calendar from '@react-spectrum/s2/icons/Calendar';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import Circle from '@react-spectrum/s2/icons/Circle';
import Clock from '@react-spectrum/s2/icons/Clock';
import HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import RemoveCircle from '@react-spectrum/s2/icons/RemoveCircle';
import StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import Visibility from '@react-spectrum/s2/icons/Visibility';
import type { WorkItem } from '@baocut/protocol';
import { statusKey, type WorkItemStatusKey } from '../../model/bot.ts';
import { BOT_COPY as C } from './bot-copy.ts';

/**
 * 任务状态的唯一对照表（需求 §11.5、技术方案 §17.3）：图标、颜色与文字。列表行、线程卡、任务详情、收件箱共用；
 * 状态从不只靠颜色——图标与文字同时出现（产品设计 §2.6）。「工作中」用转圈，减少动态效果时由系统设置让它停下。
 */
export type StatusTone = 'neutral' | 'attention' | 'negative' | 'positive';

interface StatusRow {
  Icon: ComponentType | null;
  tone: StatusTone;
  /** 计入 Rail 徽标（待你审阅、需要你输入）。 */
  badge: boolean;
  /** 标题加删除线（放弃、已合并）。 */
  strike: boolean;
}

export const WORK_ITEM_STATUS: Record<WorkItemStatusKey, StatusRow> = {
  suggested: { Icon: Lightbulb, tone: 'neutral', badge: false, strike: false },
  upNext: { Icon: Circle, tone: 'neutral', badge: false, strike: false },
  scheduled: { Icon: Calendar, tone: 'neutral', badge: false, strike: false },
  // 工作中：进行中的圈（ProgressCircle），见 status-badge.tsx。
  working: { Icon: null, tone: 'neutral', badge: false, strike: false },
  needsReview: { Icon: Visibility, tone: 'attention', badge: true, strike: false },
  needsInput: { Icon: HelpCircle, tone: 'attention', badge: true, strike: false },
  blocked: { Icon: StopProcessing, tone: 'negative', badge: false, strike: false },
  waitingOnOthers: { Icon: Clock, tone: 'neutral', badge: false, strike: false },
  done: { Icon: CheckmarkCircle, tone: 'positive', badge: false, strike: false },
  dismissed: { Icon: RemoveCircle, tone: 'neutral', badge: false, strike: true },
  merged: { Icon: RemoveCircle, tone: 'neutral', badge: false, strike: true },
};

export function statusLabel(key: WorkItemStatusKey): string {
  return C.status[key];
}

export function workItemStatus(item: Pick<WorkItem, 'status' | 'active' | 'resolution'>) {
  const key = statusKey(item);
  return { key, label: statusLabel(key), ...WORK_ITEM_STATUS[key] };
}
