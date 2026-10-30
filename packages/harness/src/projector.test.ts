import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '@baocut/protocol';
import type { ConversationRecord } from '@baocut/runtime-storage';
import { ConversationState } from './conversation-state.ts';
import { projectAgentEvent, type RunContext } from './projector.ts';

/** ConversationProjector（架构设计 §11.3）：Driver 事件投影成的会话条目。 */

function make(): ConversationState {
  const record = {
    schemaVersion: 1,
    conversation: { id: 'c1', title: 'x', updatedAt: '2026-01-01T00:00:00.000Z' },
    items: [],
    seq: '0',
    agent: { driverId: 'fake', persistence: null },
  } as unknown as ConversationRecord;
  return new ConversationState(record, { dirty: () => {}, conversationChanged: () => {}, taskChanged: () => {} });
}

const notices = (state: ConversationState) =>
  state.items().filter((i): i is Extract<TimelineItem, { kind: 'notice' }> => i.kind === 'notice');

describe('context.compacted', () => {
  it('每次压缩记一条挂在当前任务上的提示，带消息引用；没有任务时不挂', () => {
    const state = make();
    const run: RunContext = { taskId: 'task_1', runGeneration: 1, turnId: 'turn-1', stopRequested: false };
    expect(projectAgentEvent(state, run, { type: 'context.compacted', turnId: 'turn-1' })).toEqual({ type: 'none' });
    projectAgentEvent(state, null, { type: 'context.compacted', turnId: null });
    const [first, second] = notices(state);
    expect(first).toMatchObject({
      taskId: 'task_1',
      level: 'info',
      compaction: true,
      textRef: { key: 'harnessRuns.contextCompacted' },
    });
    expect(first?.text).toBeTruthy();
    expect(second).toMatchObject({ taskId: null, compaction: true });
    expect(first?.id).not.toBe(second?.id);
  });
});

describe('todo.updated', () => {
  it('整份清单记在正在跑的任务上，后到的覆盖先到的，空表清掉；不动任务状态与会话未读；没有在跑的任务时不记', () => {
    const state = make();
    state.upsert({
      kind: 'task',
      id: 'task_1',
      createdAt: '2026-01-01T00:00:00.000Z',
      taskId: 'task_1',
      goal: 'g',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      error: null,
    });
    const run: RunContext = { taskId: 'task_1', runGeneration: 1, turnId: 'turn-1', stopRequested: false };
    const task = () => state.item('task_1') as Extract<TimelineItem, { kind: 'task' }>;
    const unread = state.conversation.unread;

    projectAgentEvent(state, run, {
      type: 'todo.updated',
      turnId: 'turn-1',
      items: [{ text: 'a', status: 'inProgress', activeForm: 'Doing a' }],
    });
    projectAgentEvent(state, run, {
      type: 'todo.updated',
      turnId: 'turn-1',
      items: [
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'pending' },
      ],
    });
    expect(task()).toMatchObject({
      status: 'running',
      todo: {
        items: [
          { text: 'a', status: 'completed' },
          { text: 'b', status: 'pending' },
        ],
      },
    });
    expect(state.conversation.unread).toBe(unread);

    projectAgentEvent(state, null, { type: 'todo.updated', turnId: null, items: [{ text: 'x', status: 'pending' }] });
    expect(task().todo?.items).toHaveLength(2);

    projectAgentEvent(state, run, { type: 'todo.updated', turnId: 'turn-1', items: [] });
    expect(task()).not.toHaveProperty('todo');
  });
});
