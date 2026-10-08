import { describe, expect, it } from 'vitest';
import type { DocumentRecord, Sequence } from '@baocut/protocol';
import { fallbackUndoOperations, inDubGroup, mutedItemsOf, planTransaction } from './dub-undo.ts';

const sequence = (extra: Partial<Sequence> = {}): Sequence =>
  ({
    id: 'seq',
    items: [
      { id: 'v1', type: 'video', embeddedAudio: { enabled: false, volume: 1 } },
      { id: 'a1', type: 'audio', mix: { volume: 1, muted: true } },
      { id: 'a2', type: 'audio', mix: { volume: 1 } },
      {
        id: 'd1',
        type: 'audio',
        mix: { volume: 1 },
        role: 'dub',
        extensions: { 'baocut.dub': { groupId: 'dub_p1', language: 'en', unitId: 'u1' } },
      },
      {
        id: 'd2',
        type: 'audio',
        mix: { volume: 1 },
        role: 'dub',
        extensions: { 'baocut.dub': { groupId: 'dub_p1', language: 'en', unitId: 'u2' } },
      },
      {
        id: 'bg',
        type: 'audio',
        mix: { volume: 1 },
        role: 'music',
        extensions: { 'baocut.dub': { groupId: 'dub_p1', stem: 'background' } },
      },
      { id: 'other', type: 'audio', mix: { volume: 1 }, role: 'dub', extensions: { 'baocut.dub': { groupId: 'dub_p0' } } },
    ],
    ducking: [
      { id: 'r1', enabled: true, trigger: { kind: 'items', trackIds: ['trk-dub'] }, target: { itemIds: ['v1'] }, depth: 12 },
      { id: 'r2', enabled: true, trigger: { kind: 'items', trackIds: ['trk-music'] }, target: { itemIds: ['v1'] }, depth: 6 },
    ],
    ...extra,
  }) as unknown as Sequence;

describe('撤销这组配音', () => {
  it('应用配音那一笔：配音计划最早一个版本的 createdBy', () => {
    const record = {
      revisions: {
        r2: { revision: 'r2', createdAt: '2026-10-03T10:05:00Z', createdBy: 'tx-edit', contentHash: '', byteLength: 0 },
        r1: { revision: 'r1', createdAt: '2026-10-03T10:00:00Z', createdBy: 'tx-apply', contentHash: '', byteLength: 0 },
      },
    } as unknown as DocumentRecord;
    expect(planTransaction(record)).toBe('tx-apply');
    expect(planTransaction(undefined)).toBeNull();
  });

  it('读配音计划里这次静音的实例', () => {
    expect(mutedItemsOf({ extensions: { 'baocut.dub': { mutedItemIds: ['v1', 'a1', 3] } } })).toEqual(['v1', 'a1']);
    expect(mutedItemsOf({ extensions: {} })).toEqual([]);
    expect(mutedItemsOf(null)).toEqual([]);
  });

  it('部分撤销：删掉这一组的实例（含背景）、恢复还静音着的、去掉以配音轨触发的闪避', () => {
    expect(inDubGroup({ extensions: { 'baocut.dub': { groupId: 'dub_p1' } } }, 'dub_p1')).toBe(true);
    const fallback = fallbackUndoOperations(sequence(), { groupId: 'dub_p1', trackId: 'trk-dub' }, ['v1', 'a1', 'a2', 'gone']);
    expect(fallback.operations).toEqual([
      { type: 'deleteItems', sequenceId: 'seq', itemIds: ['d1', 'd2', 'bg'] },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'v1', muted: false },
      { type: 'setAudioMix', sequenceId: 'seq', itemId: 'a1', muted: false },
      { type: 'removeDucking', sequenceId: 'seq', ruleId: 'r1' },
    ]);
    expect(fallback).toMatchObject({ removed: 3, unmuted: 2, ducking: 1 });
  });

  it('什么都不剩（实例删过、闪避去过、声音恢复过）时没有操作', () => {
    const bare = sequence({ items: [{ id: 'a2', type: 'audio', mix: { volume: 1 } }] as unknown as Sequence['items'], ducking: undefined });
    expect(fallbackUndoOperations(bare, { groupId: 'dub_p1', trackId: 'trk-dub' }, ['a2']).operations).toEqual([]);
  });
});
