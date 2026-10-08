import { describe, expect, it } from 'vitest';
import type { DuckingRule, Sequence, SequenceItem, Track } from '@baocut/protocol';
import {
  changeOperation,
  disableOperations,
  duckingRuleFor,
  enableOperations,
  isDefault,
  isOwnRule,
  resetOperation,
  ruleValues,
  singleTrigger,
  triggerOptions,
} from './ducking-panel.ts';

function track(id: string, order: number, kind: Track['kind']): Track {
  return { id, order, kind } as Track;
}

function audio(id: string, trackId: string, enabled = true): SequenceItem {
  return { id, trackId, type: 'audio', enabled } as SequenceItem;
}

const voice = audio('voice', 'a1');
const music = audio('music', 'a2');
const video = {
  id: 'clip',
  trackId: 'v1',
  type: 'video',
  enabled: true,
  embeddedAudio: { enabled: false, volume: 1 },
} as unknown as SequenceItem;
const ms = (n: number) => ({ ticks: String(n), timescale: 1000 });
const rule: DuckingRule = {
  id: 'd1',
  enabled: true,
  trigger: { kind: 'items', trackIds: ['a1'] },
  target: { itemIds: ['music'] },
  depth: 10,
  attack: ms(20),
  release: ms(350),
};

function sequence(ducking: DuckingRule[] = []): Sequence {
  return {
    id: 'seq',
    tracks: [track('v1', 0, 'visual'), track('a1', 1, 'audio'), track('a2', 2, 'audio')],
    items: [video, voice, music],
    ducking,
  } as unknown as Sequence;
}

describe('压低原声', () => {
  it('找规则：点名片段的优先，其次点名轨道的', () => {
    const byTrack = { ...rule, id: 'd2', target: { trackIds: ['a2'] } };
    expect(duckingRuleFor(sequence([byTrack, rule]), music)?.id).toBe('d1');
    expect(duckingRuleFor(sequence([byTrack]), music)?.id).toBe('d2');
    expect(duckingRuleFor(sequence([rule]), voice)).toBeUndefined();
    expect(isOwnRule(rule, music)).toBe(true);
    expect(isOwnRule(byTrack, music)).toBe(false);
  });

  it('「压在」的选项：别的、有发声片段的轨道', () => {
    // 视频自带的声音关着，画面轨道不算。
    expect(triggerOptions(sequence(), music).map((o) => o.key)).toEqual(['a1']);
    expect(triggerOptions(sequence(), video).map((o) => o.key)).toEqual(['a1', 'a2']);
  });

  it('打开：新建只点名这个片段的规则；停用的规则重新启用', () => {
    expect(enableOperations(sequence(), music, 'a1')).toEqual([
      { type: 'setDucking', sequenceId: 'seq', trigger: { kind: 'items', trackIds: ['a1'] }, target: { itemIds: ['music'] } },
    ]);
    expect(enableOperations(sequence([{ ...rule, enabled: false }]), music, 'a1')).toEqual([
      { type: 'setDucking', sequenceId: 'seq', ruleId: 'd1', enabled: true },
    ]);
    expect(enableOperations(sequence([rule]), music, 'a1')).toEqual([]);
  });

  it('关掉：自己的规则删掉，共用的停用', () => {
    expect(disableOperations(sequence([rule]), music)).toEqual([{ type: 'removeDucking', sequenceId: 'seq', ruleId: 'd1' }]);
    const shared = { ...rule, target: { itemIds: ['music', 'clip'] } };
    expect(disableOperations(sequence([shared]), music)).toEqual([{ type: 'setDucking', sequenceId: 'seq', ruleId: 'd1', enabled: false }]);
  });

  it('读数与改动：秒是十进制字符串，恢复缺省写回三项', () => {
    expect(ruleValues(rule)).toEqual({ depth: 10, attack: 0.02, release: 0.35 });
    expect(isDefault(rule)).toBe(true);
    expect(isDefault({ ...rule, depth: 18 })).toBe(false);
    expect(singleTrigger(rule)).toBe('a1');
    expect(singleTrigger({ ...rule, trigger: { kind: 'items', trackIds: ['a1'], itemIds: ['x'] } })).toBeNull();
    // 按说话触发的规则不对应任何一条轨道。
    expect(singleTrigger({ ...rule, trigger: { kind: 'speech' } })).toBeNull();
    expect(changeOperation(sequence([rule]), rule, { trigger: 'v1', release: 1.2 })).toEqual({
      type: 'setDucking',
      sequenceId: 'seq',
      ruleId: 'd1',
      trigger: { kind: 'items', trackIds: ['v1'] },
      release: '1.2',
    });
    expect(resetOperation(sequence([rule]), rule)).toEqual({
      type: 'setDucking',
      sequenceId: 'seq',
      ruleId: 'd1',
      depth: 10,
      attack: '0.02',
      release: '0.35',
    });
  });
});
