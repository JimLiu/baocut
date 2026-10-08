import { describe, expect, it } from 'vitest';
import { TopicLog } from './topic-log.ts';

describe('TopicLog', () => {
  const make = (capacity?: number) => {
    let state = 0;
    const log = new TopicLog<number, string>(() => state, '0', capacity);
    const publish = (event: string) => {
      state++;
      return log.publish(event);
    };
    return { log, publish };
  };

  it('没有游标时给快照，序号与快照同一水位', () => {
    const { log, publish } = make();
    publish('a');
    publish('b');
    const { result } = log.subscribe(undefined, () => {});
    expect(result).toEqual({ mode: 'snapshot', seq: '2', snapshot: 2 });
  });

  it('游标在缓冲区里时补发其后的事件', () => {
    const { log, publish } = make();
    publish('a');
    publish('b');
    publish('c');
    const { result } = log.subscribe('1', () => {});
    expect(result).toEqual({
      mode: 'replay',
      seq: '3',
      events: [
        { seq: '2', event: 'b' },
        { seq: '3', event: 'c' },
      ],
    });
  });

  it('游标已是最新时补发为空', () => {
    const { log, publish } = make();
    publish('a');
    expect(log.subscribe('1', () => {}).result).toEqual({ mode: 'replay', seq: '1', events: [] });
  });

  it('补不齐（被挤出缓冲区或来自未来）时回到快照', () => {
    const { log, publish } = make(2);
    for (const e of ['a', 'b', 'c', 'd']) publish(e);
    expect(log.subscribe('1', () => {}).result.mode).toBe('snapshot');
    expect(log.subscribe('2', () => {}).result.mode).toBe('replay');
    expect(log.subscribe('9', () => {}).result.mode).toBe('snapshot');
  });

  it('订阅之后发布的事件推给监听者，退订后不再推', () => {
    const { log, publish } = make();
    const seen: string[] = [];
    const sub = log.subscribe(undefined, (e) => seen.push(`${e.seq}:${e.event}`));
    publish('a');
    sub.unsubscribe();
    publish('b');
    expect(seen).toEqual(['1:a']);
  });
});
