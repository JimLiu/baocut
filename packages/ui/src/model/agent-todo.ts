import type { TodoItem } from '@baocut/protocol';

/**
 * 智能体待办清单的数与「正在做的」（产品设计 §3.2.3「智能体的待办」，原型 model-agent-todo.js）。清单在任务条目的 `todo` 上，
 * 每次整份替换（架构设计 §11.3）。
 */

/** 已完成数与总数。 */
export function todoProgress(items: readonly TodoItem[]): { done: number; total: number } {
  return { done: items.filter((item) => item.status === 'completed').length, total: items.length };
}

/** 正在做的那一项：进行中的说法 → 进行中的原话 → 下一项待做；全做完时 null。 */
export function todoCurrent(items: readonly TodoItem[]): string | null {
  const doing = items.find((item) => item.status === 'inProgress');
  if (doing) return doing.activeForm ?? doing.text;
  return items.find((item) => item.status === 'pending')?.text ?? null;
}
