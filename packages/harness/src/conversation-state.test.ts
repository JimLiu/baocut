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
