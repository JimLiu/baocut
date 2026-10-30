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
