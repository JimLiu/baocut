import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTPUT_LIMIT, type ConversationEvent, type SequencedEvent, type TimelineItem } from '@baocut/protocol';
import type { ConversationRecord } from '@baocut/runtime-storage';
import { ConversationState } from './conversation-state.ts';

const WINDOW = 60;

function message(id: string, text = ''): TimelineItem {
  return { id, taskId: 't1', at: '2026-01-01T00:00:00.000Z', kind: 'agent-message', text, streaming: true } as unknown as TimelineItem;
}

function toolCall(id: string): TimelineItem {
  return {
    id,
    taskId: 't1',
    at: '2026-01-01T00:00:00.000Z',
    kind: 'tool-call',
    tool: 'shell',
    title: 'run',
    detail: null,
    output: '',
    status: 'running',
    exitCode: null,
    durationMs: null,
  } as unknown as TimelineItem;
}

function make(items: TimelineItem[] = []): {
  state: ConversationState;
  events: SequencedEvent<ConversationEvent>[];
  record: ConversationRecord;
} {
  const record = {
    schemaVersion: 1,
    conversation: { id: 'c1', title: 'x', updatedAt: '2026-01-01T00:00:00.000Z' },
    items,
    seq: '0',
    agent: { driverId: 'fake', persistence: null },
  } as unknown as ConversationRecord;
  const state = new ConversationState(
    record,
    { dirty: () => {}, conversationChanged: () => {}, taskChanged: () => {} },
    { appendWindowMs: WINDOW },
  );
  const events: SequencedEvent<ConversationEvent>[] = [];
  state.log.subscribe(undefined, (e) => events.push(e));
  return { state, events, record };
}

const appends = (events: SequencedEvent<ConversationEvent>[]) =>
  events.flatMap((e) => (e.event.type === 'item.append' ? [{ id: e.event.itemId, field: e.event.field, delta: e.event.delta }] : []));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ConversationState 流式增量合并', () => {
  it('首个 delta 立即发布，窗口内的后续 delta 合成一条，窗口后再来又是立即发', () => {
    const { state, events, record } = make([message('m1')]);
    state.append('m1', 'text', 'a');
    expect(appends(events)).toEqual([{ id: 'm1', field: 'text', delta: 'a' }]);

    vi.advanceTimersByTime(10);
    state.append('m1', 'text', 'b');
    vi.advanceTimersByTime(10);
    state.append('m1', 'text', 'c');
    // 记录里同步追加，事件还没发。
    expect((record.items[0] as { text: string }).text).toBe('abc');
    expect(appends(events)).toHaveLength(1);

    vi.advanceTimersByTime(WINDOW);
    expect(appends(events)).toEqual([
      { id: 'm1', field: 'text', delta: 'a' },
      { id: 'm1', field: 'text', delta: 'bc' },
    ]);

    // 合并发布之后又进入一个窗口：紧接着的 delta 继续被合并，不是立即发。
    state.append('m1', 'text', 'd');
    expect(appends(events)).toHaveLength(2);
    vi.advanceTimersByTime(WINDOW * 3);
    expect(appends(events).at(-1)).toEqual({ id: 'm1', field: 'text', delta: 'd' });
    expect(appends(events)).toHaveLength(3);

    // 安静超过窗口后第一个 delta 立即发。
    state.append('m1', 'text', 'e');
    expect(appends(events)).toHaveLength(4);
    expect(events.map((e) => e.seq)).toEqual(['1', '2', '3', '4']);
  });

  it('upsert 之前待发的 append 先发布', () => {
    const { state, events } = make([message('m1')]);
    state.append('m1', 'text', 'a');
    state.append('m1', 'text', 'b');
    state.append('m1', 'text', 'c');
    state.upsert({ ...message('m1', 'abc'), streaming: false } as TimelineItem);
    expect(events.map((e) => e.event.type)).toEqual(['item.append', 'item.append', 'item.upsert']);
    expect(appends(events).map((a) => a.delta)).toEqual(['a', 'bc']);
    // 定时器已清，不会再补发。
    vi.advanceTimersByTime(WINDOW * 3);
    expect(events).toHaveLength(3);
  });

  it('updateConversation 之前也先 flush', () => {
    const { state, events } = make([message('m1')]);
    state.append('m1', 'text', 'a');
    state.append('m1', 'text', 'b');
    state.updateConversation({ activity: 'idle' });
    expect(events.map((e) => e.event.type)).toEqual(['item.append', 'item.append', 'conversation.updated']);
  });

  it('不同 item 或不同 field 的 delta 不混合', () => {
    const { state, events } = make([message('m1'), message('m2'), toolCall('k1')]);
    state.append('m1', 'text', 'a');
    state.append('m2', 'text', 'x');
    state.append('k1', 'output', 'o');
    state.append('m1', 'text', 'b');
    state.append('m2', 'text', 'y');
    state.append('k1', 'output', 'p');
    state.flush();
    expect(appends(events)).toEqual([
      { id: 'm1', field: 'text', delta: 'a' },
      { id: 'm2', field: 'text', delta: 'x' },
      { id: 'k1', field: 'output', delta: 'o' },
      { id: 'm1', field: 'text', delta: 'b' },
      { id: 'm2', field: 'text', delta: 'y' },
      { id: 'k1', field: 'output', delta: 'p' },
    ]);
  });

  it('output 超限时记录里只保留末尾', () => {
    const { state, events, record } = make([toolCall('k1')]);
    state.append('k1', 'output', 'a'.repeat(OUTPUT_LIMIT));
    state.append('k1', 'output', 'b'.repeat(10));
    state.append('k1', 'output', 'c'.repeat(10));
    const output = (record.items[0] as { output: string }).output;
    expect(output.startsWith('…\n')).toBe(true);
    expect(output.endsWith('b'.repeat(10) + 'c'.repeat(10))).toBe(true);
    expect(output.length).toBe(OUTPUT_LIMIT + 2);
    state.flush();
    expect(appends(events).map((a) => a.delta.length)).toEqual([OUTPUT_LIMIT, 20]);
  });

  it('新订阅者的快照与其后事件不重复文本', () => {
    const { state, record } = make([message('m1')]);
    state.append('m1', 'text', 'a');
    state.append('m1', 'text', 'b');
    state.append('m1', 'text', 'c');

    const late: SequencedEvent<ConversationEvent>[] = [];
    const sub = state.subscribe(undefined, (e) => late.push(e));
    expect(sub.result.mode).toBe('snapshot');
    if (sub.result.mode !== 'snapshot') return;
    expect((sub.result.snapshot.items[0] as { text: string }).text).toBe('abc');
    expect(sub.result.seq).toBe(record.seq);

    vi.advanceTimersByTime(WINDOW * 3);
    expect(late).toEqual([]);

    state.append('m1', 'text', 'd');
    vi.advanceTimersByTime(WINDOW * 3);
    expect(
      appends(late)
        .map((a) => a.delta)
        .join(''),
    ).toBe('d');
  });

  it('补发订阅在待发缓冲之后也能拿到全部增量', () => {
    const { state } = make([message('m1')]);
    state.append('m1', 'text', 'a');
    state.append('m1', 'text', 'b');
    const sub = state.subscribe('0', () => {});
    expect(sub.result.mode).toBe('replay');
    if (sub.result.mode !== 'replay') return;
    expect(appends(sub.result.events).map((a) => a.delta)).toEqual(['a', 'b']);
  });

  it('dispose 清掉定时器，不再发布', () => {
    const { state, events } = make([message('m1')]);
    state.append('m1', 'text', 'a');
    state.append('m1', 'text', 'b');
    state.dispose();
    vi.advanceTimersByTime(WINDOW * 3);
    expect(appends(events)).toEqual([{ id: 'm1', field: 'text', delta: 'a' }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ConversationState 任务的会话外作用', () => {
  const taskItem = (id: string) => ({ id, taskId: id, kind: 'task', goal: id, status: 'running' }) as unknown as TimelineItem;
  const item = (id: string, taskId: string, patch: Record<string, unknown>) => ({ id, taskId, ...patch }) as unknown as TimelineItem;

  it('只读的步骤不算；第一次有作用时补发一次任务变化，之后不再重复', () => {
    const changed: string[] = [];
    const record = {
      schemaVersion: 1,
      conversation: { id: 'c1', title: 'x', updatedAt: '2026-01-01T00:00:00.000Z' },
      items: [],
      seq: '0',
      agent: { driverId: 'fake', persistence: null },
    } as unknown as ConversationRecord;
    const state = new ConversationState(record, {
      dirty: () => {},
      conversationChanged: () => {},
      taskChanged: (task) => changed.push(task.id),
    });
    state.upsert(taskItem('t1'));
    state.upsert(item('s1', 't1', { kind: 'tool-call', tool: 'web-search' }));
    state.upsert(item('s2', 't1', { kind: 'tool-call', tool: 'mcp' }));
    state.upsert(item('s3', 't1', { kind: 'tool-call', tool: 'command' }));
    state.upsert(item('s4', 't1', { kind: 'approval', status: 'accepted', decidedBy: 'auto' }));
    state.upsert(item('s5', 't1', { kind: 'approval', status: 'cancelled' }));
    expect(state.hasSideEffects('t1')).toBe(false);
    expect(changed).toEqual(['t1']);
    state.upsert(item('e1', 't1', { kind: 'video-change' }));
    state.upsert(item('e2', 't1', { kind: 'tool-call', tool: 'file-change' }));
    expect(state.hasSideEffects('t1')).toBe(true);
    expect(changed).toEqual(['t1', 't1']);
  });

  it('读入的记录里已有作用的任务直接算上', () => {
    const { state } = make([taskItem('t1'), item('a1', 't1', { kind: 'approval', status: 'pending' }), taskItem('t2')]);
    expect(state.hasSideEffects('t1')).toBe(true);
    expect(state.hasSideEffects('t2')).toBe(false);
  });
});

describe('ConversationState 分页', () => {
  const at = '2026-01-01T00:00:00.000Z';
  const user = (taskId: string) => ({ id: `u_${taskId}`, taskId, at, kind: 'user-message', text: taskId }) as unknown as TimelineItem;
  const task = (taskId: string) => ({ id: taskId, taskId, at, kind: 'task', goal: taskId, status: 'completed' }) as unknown as TimelineItem;
  const reply = (taskId: string, n = 1) =>
    ({ id: `m${n}_${taskId}`, taskId, at, kind: 'agent-message', text: '', streaming: false }) as unknown as TimelineItem;
  const turn = (taskId: string) => [user(taskId), task(taskId), reply(taskId)];
  const ids = (items: readonly TimelineItem[]) => items.map((i) => i.id);

  it('不带 tail 给全部条目、不带 offset；tail 不少于回合数时同样', () => {
    const { state } = make([...turn('t1'), ...turn('t2')]);
    expect(state.snapshot()).not.toHaveProperty('offset');
    expect(state.snapshot(2)).not.toHaveProperty('offset');
    expect(ids(state.snapshot(5).items)).toHaveLength(6);
  });

  it('tail 按回合开头切，offset 是这一段在记录里的起点', () => {
    const { state } = make([...turn('t1'), ...turn('t2'), ...turn('t3')]);
    const snapshot = state.snapshot(2);
    expect(snapshot.offset).toBe(3);
    expect(ids(snapshot.items)).toEqual(['u_t2', 't2', 'm1_t2', 'u_t3', 't3', 'm1_t3']);
  });

  it('这一段引用的更早任务条目钉在最前面，不算进 offset', () => {
    // t1 被唤醒，在 t2 之后又写了一条回复。
    const { state } = make([...turn('t1'), ...turn('t2'), reply('t1', 2)]);
    const snapshot = state.snapshot(1);
    expect(snapshot.offset).toBe(3);
    expect(ids(snapshot.items)).toEqual(['t1', 'u_t2', 't2', 'm1_t2', 'm2_t1']);
  });

  it('page 取 before 之前最近的几个回合；从头取完时 offset 为 0，before 超出时按末尾算', () => {
    const { state } = make([...turn('t1'), ...turn('t2'), ...turn('t3')]);
    expect(state.page(6, 1)).toEqual({ items: state.items().slice(3, 6), offset: 3 });
    expect(state.page(3, 5)).toEqual({ items: state.items().slice(0, 3), offset: 0 });
    expect(state.page(100, 1).offset).toBe(6);
    expect(state.page(0, 1)).toEqual({ items: [], offset: 0 });
  });

  it('item.upsert 带条目在记录里的位置：新条目接在末尾，替换不变', () => {
    const { state, events } = make([...turn('t1')]);
    state.upsert(reply('t1', 2));
    state.upsert({ ...(task('t1') as object), status: 'failed' } as TimelineItem);
    const upserts = events.flatMap((e) => (e.event.type === 'item.upsert' ? [[e.event.item.id, e.event.index]] : []));
    expect(upserts).toEqual([
      ['m2_t1', 3],
      ['t1', 1],
    ]);
  });

  it('带 tail 订阅拿到的是尾部窗口', () => {
    const { state } = make([...turn('t1'), ...turn('t2')]);
    const sub = state.subscribe(undefined, () => {}, 1);
    expect(sub.result.mode).toBe('snapshot');
    if (sub.result.mode !== 'snapshot') return;
    expect(sub.result.snapshot.offset).toBe(3);
    expect(ids(sub.result.snapshot.items)).toEqual(['u_t2', 't2', 'm1_t2']);
  });
});
