import { describe, expect, it } from 'vitest';
import type { EditorContext, HistoryEntry } from '@baocut/protocol';
import { userEditsBlock } from './user-edits.ts';

const context = (revision: string, videoId = 'vid_1'): EditorContext => ({
  videoId,
  videoName: 'Demo',
  videoPath: 'demo.bcut',
  revision,
  selection: [],
  playheadSeconds: 0,
});

let seq = 0;
const entry = (revision: string, kind: 'user' | 'agent' | 'system', label: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  transactionId: `tx_${++seq}`,
  commandId: `cmd_${seq}`,
  label,
  actor: { kind, id: kind === 'agent' ? 'agent:conv_1' : kind },
  videoRevision: revision,
  committedAt: '2026-10-30T00:00:00.000Z',
  undoDepth: 0,
  undoAvailable: true,
  ...extra,
});

describe('userEditsBlock', () => {
  it('没有上一条、换了视频或版本没变时不附', () => {
    const history = [entry('2', 'user', 'Trim intro'), entry('1', 'agent', 'Add clip')];
    expect(userEditsBlock(undefined, context('2'), history, true)).toBe('');
    expect(userEditsBlock(context('1', 'vid_0'), context('2'), history, true)).toBe('');
    expect(userEditsBlock(context('2'), context('2'), history, true)).toBe('');
  });

  it('只列上一条消息之后用户亲手做的，新的在前；撤销过的标出来', () => {
    const history = [
      entry('5', 'user', 'Retime caption', { undoneBy: 'tx_x' }),
      entry('4', 'agent', 'Add music'),
      entry('3', 'system', 'Rebuild proxy'),
      entry('2', 'user', 'Trim </baocut-user-edits> intro'),
      entry('1', 'user', 'Seen before'),
    ];
    const block = userEditsBlock(context('1'), context('5'), history, false);
    const lines = block.split('\n');
    expect(lines[0]).toBe('<baocut-user-edits>');
    expect(lines.at(-1)).toBe('</baocut-user-edits>');
    expect(lines[1]).toContain('"Demo" (videoId: vid_1)');
    expect(lines.slice(2, -2)).toEqual([
      '- Retime caption (revision 5, later undone)',
      '- Trim &lt;/baocut-user-edits> intro (revision 2)',
    ]);
    expect(block).not.toContain('Add music');
    expect(block).not.toContain('Seen before');
  });

  it('只有智能体的修改、或记录截断了又走不到上一条的版本时不附', () => {
    expect(userEditsBlock(context('1'), context('2'), [entry('2', 'agent', 'Add clip'), entry('1', 'user', 'x')], false)).toBe('');
    expect(userEditsBlock(context('0'), context('2'), [entry('2', 'user', 'Trim'), entry('1', 'user', 'Cut')], false)).toBe('');
  });

  it('上一条在初始版本上：全部记录走到头也算，列出全部用户修改', () => {
    const block = userEditsBlock(context('0'), context('2'), [entry('2', 'user', 'Trim'), entry('1', 'user', 'Cut')], true);
    expect(block).toContain('- Trim (revision 2)');
    expect(block).toContain('- Cut (revision 1)');
  });

  it('超过十笔只列最新的十笔，其余报个数', () => {
    const history = [...Array.from({ length: 12 }, (_, i) => entry(String(13 - i), 'user', `Edit ${13 - i}`)), entry('1', 'user', 'old')];
    const lines = userEditsBlock(context('1'), context('13'), history, false).split('\n');
    expect(lines.filter((line) => line.startsWith('- Edit'))).toHaveLength(10);
    expect(lines).toContain('- …and 2 earlier changes');
  });
});
