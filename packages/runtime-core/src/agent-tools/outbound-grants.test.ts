import { describe, expect, it } from 'vitest';
import type { GrantRequestItem } from '@baocut/protocol';
import { modelCallRisk, outboundGrantOf } from './outbound-grants.ts';

/** 模型工具的风险等级（架构设计 §3.12、§12.5）。 */

describe('modelCallRisk', () => {
  it('本机是 edit；有授权覆盖的外发是 command；没有授权覆盖是 high；没有启用、解析不到时按 command（提交时会被拒绝）', () => {
    expect(modelCallRisk({ kind: 'local', enabled: true, granted: true })).toBe('edit');
    expect(modelCallRisk({ kind: 'online', enabled: true, granted: true })).toBe('command');
    expect(modelCallRisk({ kind: 'node', enabled: true, granted: true })).toBe('command');
    expect(modelCallRisk({ kind: 'online', enabled: true, granted: false })).toBe('high');
    expect(modelCallRisk({ kind: 'agent', enabled: true, granted: false })).toBe('high');
    expect(modelCallRisk({ kind: 'online', enabled: false, granted: false })).toBe('command');
    expect(modelCallRisk({ kind: null, enabled: false, granted: false })).toBe('command');
  });
});

describe('outboundGrantOf', () => {
  it('授权判断的结果换成风险：本机 edit、节点 command、覆盖 command、要授权 high、没有启用 command', () => {
    const item = { recipient: 'openai' } as GrantRequestItem;
    expect(modelCallRisk(outboundGrantOf({ status: 'none', kind: 'local' }))).toBe('edit');
    expect(modelCallRisk(outboundGrantOf({ status: 'none', kind: 'node' }))).toBe('command');
    expect(modelCallRisk(outboundGrantOf({ status: 'none', kind: 'online' }))).toBe('command');
    expect(modelCallRisk(outboundGrantOf({ status: 'none', kind: null }))).toBe('command');
    expect(modelCallRisk(outboundGrantOf({ status: 'covered', kind: 'online', grant: {} as never }))).toBe('command');
    expect(modelCallRisk(outboundGrantOf({ status: 'approval', kind: 'agent', item }))).toBe('high');
  });
});
