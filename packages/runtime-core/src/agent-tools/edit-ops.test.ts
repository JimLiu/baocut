import { describe, expect, it } from 'vitest';
import { compileJsonSchema } from '@baocut/protocol/json-schema';
import { EDIT_OPERATIONS, OPERATION_FAMILIES, OPERATION_TYPES, describeOperation } from './edit-ops.ts';
import { normalizeOperations } from './video-digest.ts';

/** `edits_ops` 的操作表（`edit-ops.ts`）：每个操作写全，示例通过自己的 schema，JSON Schema 能编译，示例能补成引擎的形态。 */

describe('edits_apply 的操作表', () => {
  it('操作不重名，每个都归到一个操作族，说明行以操作的形态开头', () => {
    expect(new Set(OPERATION_TYPES).size).toBe(OPERATION_TYPES.length);
    for (const spec of EDIT_OPERATIONS) {
      expect(OPERATION_FAMILIES).toContain(spec.family);
      expect(spec.doc.length).toBeGreaterThan(0);
      for (const line of spec.doc) expect(line.startsWith(`- {"type":"${spec.type}"`), line.slice(0, 40)).toBe(true);
    }
    for (const family of OPERATION_FAMILIES) expect(EDIT_OPERATIONS.some((s) => s.family === family)).toBe(true);
  });

  it('联动组的操作：登记、解组、同步校正与复制都在表里，补成引擎的形态', () => {
    for (const type of ['linkItems', 'unlinkItems', 'syncLinkedItem', 'duplicateLinkGroup']) expect(OPERATION_TYPES).toContain(type);
    const [sync, duplicate] = normalizeOperations(
      [
        { type: 'syncLinkedItem', itemId: 'item_mic', offset: -0.04 },
        { type: 'duplicateLinkGroup', groupId: 'lg_1', at: 60 },
      ],
      'seq_root',
      '/tmp',
    );
    // 同步校正的 offset 是源时钟上的十进制秒，不换成序列时间。
    expect(sync).toEqual({ type: 'syncLinkedItem', itemId: 'item_mic', offset: '-0.04' });
    expect(duplicate).toEqual({
      type: 'duplicateLinkGroup',
      groupId: 'lg_1',
      at: { unit: 'seconds', value: '60' },
      sequenceId: 'seq_root',
      alignment: 'nearest-frame',
    });
    const style = EDIT_OPERATIONS.find((s) => s.type === 'setStyle')!;
    expect(style.schema.safeParse({ type: 'setStyle', itemId: 'item_1', screenView: { documentId: 'doc_view' } }).success).toBe(true);
    expect(style.schema.safeParse({ type: 'setStyle', itemId: 'item_1', screenView: null }).success).toBe(true);
  });

  it('屏幕取景的自动缩放：regenerateAutoZooms 在表里，只带 documentId，原样交给引擎', () => {
    expect(OPERATION_TYPES).toContain('regenerateAutoZooms');
    const spec = EDIT_OPERATIONS.find((s) => s.type === 'regenerateAutoZooms')!;
    expect(spec.family).toBe('documents-and-versions');
    expect(spec.schema.safeParse({ type: 'regenerateAutoZooms' }).success).toBe(false);
    const [normalized] = normalizeOperations([{ type: 'regenerateAutoZooms', documentId: 'doc_view' }], 'seq_root', '/tmp');
    expect(normalized).toEqual({ type: 'regenerateAutoZooms', documentId: 'doc_view' });
  });

  for (const spec of EDIT_OPERATIONS) {
    it(`${spec.type}：示例通过 schema 与编译后的 JSON Schema，能补成引擎的形态`, () => {
      expect(spec.example.type).toBe(spec.type);
      const parsed = spec.schema.safeParse(spec.example);
      expect(parsed.success, parsed.error?.message).toBe(true);
      const described = describeOperation(spec);
      expect(described).toMatchObject({ type: spec.type, family: spec.family, example: spec.example });
      expect(described.description.startsWith('{"type"')).toBe(true);
      expect(compileJsonSchema(described.schema).validate(spec.example)).toEqual([]);
      expect(() => normalizeOperations([spec.example], 'seq_root', '/tmp')).not.toThrow();
    });
  }
});
