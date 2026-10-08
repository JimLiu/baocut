import { describe, expect, it } from 'vitest';
import type { ProjectFileEntry } from '@baocut/protocol';
import { breadcrumbs, entryAction, entryFolder, entryMeta, parentDir, projectFileTarget } from './project-files.ts';

const entry = (over: Partial<ProjectFileEntry>): ProjectFileEntry => ({
  path: 'a.mp4',
  name: 'a.mp4',
  isDir: false,
  size: null,
  modifiedAt: null,
  kind: null,
  ...over,
});

describe('项目文件浏览', () => {
  it('面包屑与上一级', () => {
    expect(breadcrumbs('', '我的项目')).toEqual([{ label: '我的项目', dir: '' }]);
    expect(breadcrumbs('a/b', '我的项目')).toEqual([
      { label: '我的项目', dir: '' },
      { label: 'a', dir: 'a' },
      { label: 'b', dir: 'a/b' },
    ]);
    expect(parentDir('')).toBeNull();
    expect(parentDir('a')).toBe('');
    expect(parentDir('a/b')).toBe('a');
  });

  it('所在目录', () => {
    expect(entryFolder('a.mp4')).toBe('');
    expect(entryFolder('scenes/day 1/a.mp4')).toBe('scenes/day 1');
  });

  it('每行的说明：类型 · 大小 · 时间', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(entryMeta(entry({ kind: 'video-file', size: 2048, modifiedAt: '2026-10-03T11:55:00Z' }), now)).toBe('视频素材 · 2.0 KB · 5 分钟前');
    expect(entryMeta(entry({ isDir: true }), now)).toBe('文件夹');
    expect(entryMeta(entry({ isDir: true, kind: 'video' }), now)).toBe('视频');
    expect(entryMeta(entry({ size: 10 }), now)).toBe('文件 · 10 B');
  });

  it('打开：视频目录交给视频，普通目录进入，其余是文件；定位是会话里的相对路径', () => {
    expect(entryAction({ isDir: true, kind: 'video' })).toBe('video');
    expect(entryAction({ isDir: true, kind: null })).toBe('enter');
    expect(entryAction({ isDir: false, kind: 'image' })).toBe('file');
    expect(projectFileTarget('conv_1', { path: 'scenes/a.mp4' })).toEqual({ conversationId: 'conv_1', path: 'scenes/a.mp4' });
  });
});
