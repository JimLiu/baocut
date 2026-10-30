import { describe, expect, it } from 'vitest';
import { findCountLabel, findTotal, keepPlace, locateFind, needsEarlier } from './conversation-find.ts';

const hits = [
  { itemId: 'msg_a', index: 3, count: 2 },
  { itemId: 'msg_b', index: 40, count: 1 },
  { itemId: 'msg_c', index: 41, count: 3 },
];

describe('在会话中查找', () => {
  it('第几处落在哪条消息的第几处', () => {
    expect(findTotal(hits)).toBe(6);
    expect(locateFind(hits, 0)).toEqual({ hit: hits[0], nth: 0 });
    expect(locateFind(hits, 1)).toEqual({ hit: hits[0], nth: 1 });
    expect(locateFind(hits, 2)).toEqual({ hit: hits[1], nth: 0 });
    expect(locateFind(hits, 5)).toEqual({ hit: hits[2], nth: 2 });
    expect(locateFind(hits, 6)).toBeNull();
    expect(locateFind(hits, -1)).toBeNull();
    expect(locateFind([], 0)).toBeNull();
  });

  it('计数被截断时加「+」', () => {
    expect(findCountLabel(5, 6, false)).toBe('6 / 6');
    expect(findCountLabel(0, 1000, true)).toBe('1 / 1000+');
  });

  it('重查后原处还在就停在原处，否则停在最近一处', () => {
    expect(keepPlace(null, hits)).toBe(5);
    expect(keepPlace({ itemId: 'msg_b', nth: 0 }, hits)).toBe(2);
    expect(keepPlace({ itemId: 'msg_a', nth: 1 }, hits)).toBe(1);
    // 那条消息里的命中变少了：停在它的最后一处。
    expect(keepPlace({ itemId: 'msg_c', nth: 7 }, hits)).toBe(5);
    expect(keepPlace({ itemId: 'msg_gone', nth: 0 }, hits)).toBe(5);
    expect(keepPlace({ itemId: 'msg_a', nth: 0 }, [])).toBe(-1);
  });

  it('命中在已载入那一段之前才往前翻', () => {
    expect(needsEarlier(hits[0]!, 10)).toBe(true);
    expect(needsEarlier(hits[1]!, 40)).toBe(false);
    expect(needsEarlier(hits[1]!, 0)).toBe(false);
  });
});
