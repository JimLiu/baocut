import { newId, refOf, type DriverId, type ImportNote, type Localized, type TimelineItem } from '@baocut/protocol';
import type { NativeSessionHistory } from './driver.ts';

/** 导入时最多复制最近的多少轮（架构设计 §3.4「导入的记录」）：更早的不复制，只在末尾的提示里记下略去了几轮。 */
export const IMPORT_TURN_LIMIT = 200;
/** 一条消息最多复制多少字：超出的从中间截掉，留头尾。 */
export const IMPORT_TEXT_LIMIT = 20_000;

const CUT = '\n[…]\n';

function clipText(text: string): string {
  if (text.length <= IMPORT_TEXT_LIMIT) return text;
  const half = Math.floor((IMPORT_TEXT_LIMIT - CUT.length) / 2);
  return `${text.slice(0, half)}${CUT}${text.slice(-half)}`;
}

/**
 * 把外部会话的记录换成会话条目（产品设计 §3.1「导入外部会话」）：每一轮是用户消息、一个已完成的任务、回复与工具步骤（只有标题，
 * 没有输出）；末尾一条 `imported` 提示。只复制最近的 `IMPORT_TURN_LIMIT` 轮。没有时刻的轮按导入的时刻记。
 */
export function importedItems(
  history: NativeSessionHistory,
  options: { driverId: DriverId; at: string; notice: Localized },
): { items: TimelineItem[]; note: ImportNote } {
  const omitted = Math.max(0, history.turns.length - IMPORT_TURN_LIMIT);
  const turns = history.turns.slice(omitted);
  const items: TimelineItem[] = [];
  for (const turn of turns) {
    const taskId = newId('task');
    const startedAt = turn.startedAt ?? options.at;
    const endedAt = turn.endedAt ?? startedAt;
    const text = clipText(turn.user);
    items.push({ kind: 'user-message', id: newId('msg'), createdAt: startedAt, taskId, text });
    items.push({
      kind: 'task',
      id: taskId,
      createdAt: startedAt,
      taskId,
      goal: text,
      status: 'completed',
      startedAt,
      endedAt,
      error: null,
    });
    for (const step of turn.steps) {
      if (step.kind === 'message') {
        items.push({ kind: 'agent-message', id: newId('msg'), createdAt: endedAt, taskId, text: clipText(step.text), streaming: false });
      } else {
        items.push({
          kind: 'tool-call',
          id: newId('tool'),
          createdAt: endedAt,
          taskId,
          tool: step.tool,
          title: step.title,
          detail: step.detail,
          output: '',
          status: step.status,
          exitCode: null,
          durationMs: null,
        });
      }
    }
  }
  const note: ImportNote = { driverId: options.driverId, nativeId: history.nativeId, at: options.at, turns: turns.length, omitted };
  items.push({
    kind: 'notice',
    id: newId('note'),
    createdAt: options.at,
    taskId: null,
    level: 'info',
    text: String(options.notice),
    textRef: refOf(options.notice),
    imported: note,
  });
  return { items, note };
}
