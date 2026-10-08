import { describe, expect, it } from 'vitest';
import { formatSpaceContinue, formatSpacePurge, formatVideoDelete, parseSpaceArgs } from './space-output.ts';

describe('baocut space 的参数', () => {
  it('rescan、rebuild 与按条目的操作', () => {
    expect(parseSpaceArgs(['rescan'], {})).toEqual({ kind: 'rescan' });
    expect(parseSpaceArgs(['rebuild'], {})).toEqual({ kind: 'rebuild' });
    expect(parseSpaceArgs(['purge', 'sp_1'], {})).toEqual({ kind: 'purge', entryId: 'sp_1' });
    expect(parseSpaceArgs(['trash', 'sp_1'], {})).toEqual({ kind: 'trash', entryId: 'sp_1' });
    expect(() => parseSpaceArgs(['restore'], {})).toThrow(/restore <条目 id>/);
    expect(() => parseSpaceArgs(['rebuild'], { conversation: 'cnv_1' })).toThrow(/不接受 --conversation/);
    expect(() => parseSpaceArgs(['delete', 'sp_1'], {})).toThrow(/用法/);
  });

  it('删除视频与从条目继续会话', () => {
    expect(parseSpaceArgs(['delete-video', 'sp_1'], {})).toEqual({ kind: 'delete-video', entryId: 'sp_1' });
    expect(() => parseSpaceArgs(['delete-video'], {})).toThrow(/delete-video <条目 id>/);
    expect(() => parseSpaceArgs(['delete-video', 'sp_1'], { conversation: 'cnv_1' })).toThrow(/不接受 --conversation/);
    expect(parseSpaceArgs(['continue', 'sp_1'], {})).toEqual({ kind: 'continue', entryId: 'sp_1' });
    expect(parseSpaceArgs(['continue', 'sp_1'], { conversation: 'cnv_1' })).toEqual({
      kind: 'continue',
      entryId: 'sp_1',
      conversationId: 'cnv_1',
    });
    expect(() => parseSpaceArgs(['continue'], {})).toThrow(/continue <条目 id>/);
  });
});

describe('baocut space 的输出', () => {
  it('彻底删除：删了，或列出挡住它的引用', () => {
    expect(formatSpacePurge({ status: 'purged', entryId: 'sp_1' })).toEqual(['已彻底删除 sp_1']);
    expect(
      formatSpacePurge({
        status: 'blocked',
        entryId: 'sp_1',
        references: [{ kind: 'video-asset', videoId: 'vid_1', detail: '视频「访谈」的素材引用着它' }],
      }),
    ).toEqual(['没有删除 sp_1：还有引用', '  视频「访谈」的素材引用着它']);
  });

  it('删除视频：回收站里的条目与可以恢复的命令；继续会话：会话与下一步', () => {
    const deleted = {
      status: 'trashed' as const,
      entryId: 'sp_t',
      videoId: 'vid_1',
      name: '访谈',
      trashedAt: '2026-10-01T08:00:00.000Z',
      related: ['sp_e'],
    };
    expect(formatVideoDelete(deleted, 30)).toEqual([
      '已把视频「访谈」移进回收站：sp_t（baocut space restore sp_t 可以恢复，30 天后物理删除）',
      '由它导出、生成的 1 个条目留在原处',
    ]);
    expect(formatVideoDelete({ ...deleted, related: [] }, null)).toEqual([
      '已把视频「访谈」移进回收站：sp_t（baocut space restore sp_t 可以恢复）',
    ]);
    const lines = formatSpaceContinue({
      conversation: { id: 'cnv_1', cwd: '/tmp/p' } as never,
      created: true,
      reference: { name: '封面.png' } as never,
    });
    expect(lines[0]).toBe('新建了会话 cnv_1  工作目录 /tmp/p');
    expect(lines[1]).toContain('--conversation cnv_1');
  });
});
