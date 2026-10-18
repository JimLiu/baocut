import { describe, expect, it } from 'vitest';
import type { Project } from '@baocut/protocol';
import { afterFolderOpened, createProjectError, folderLabel, matchProjects } from './project-folder.ts';

const project = (id: string, name: string, path: string, archived = false): Project => ({
  id,
  name,
  path,
  createdAt: '2026-10-01T00:00:00Z',
  lastActiveAt: '2026-10-01T00:00:00Z',
  pinned: false,
  archived,
});

describe('文件夹名', () => {
  it('取路径最后一段，两种分隔符都认', () => {
    expect(folderLabel('/Users/a/GitHub/baoyu-video')).toBe('baoyu-video');
    expect(folderLabel('/Users/a/GitHub/baoyu-video/')).toBe('baoyu-video');
    expect(folderLabel('C:\\Users\\a\\Videos\\旅行')).toBe('旅行');
  });
});

describe('项目选择器的搜索', () => {
  const list = [project('p1', 'baocut', '/Users/a/GitHub/baocut'), project('p2', '旅行素材', '/Users/a/Movies/trip')];
  it('按名字或路径匹配，不分大小写；空查询原样返回', () => {
    expect(matchProjects(list, '')).toBe(list);
    expect(matchProjects(list, ' BAO ').map((p) => p.id)).toEqual(['p1']);
    expect(matchProjects(list, 'movies').map((p) => p.id)).toEqual(['p2']);
    expect(matchProjects(list, '旅行').map((p) => p.id)).toEqual(['p2']);
    expect(matchProjects(list, 'nothing')).toEqual([]);
  });
});

describe('创建项目的名称', () => {
  it('没选文件夹时必须有名字；选了已有文件夹可以留空', () => {
    expect(createProjectError('', null)).toBe('请输入项目名称');
    expect(createProjectError('', '/Users/a/GitHub/baoyu-video')).toBeNull();
    expect(createProjectError('新片', '/Users/a/GitHub/baoyu-video')).toBeNull();
    expect(createProjectError('a/b', '/Users/a/GitHub/baoyu-video')).toBe('项目名称不能包含斜杠或控制字符');
  });
});

describe('打开已有文件夹之后', () => {
  const opened = project('p9', 'baoyu-video', '/Users/a/GitHub/baoyu-video');
  it('新加的项目：名字与文件夹名不同才改显示名', () => {
    expect(afterFolderOpened([], opened, '宝玉视频')).toEqual({ existing: false, rename: '宝玉视频' });
    expect(afterFolderOpened([], opened, ' baoyu-video ')).toEqual({ existing: false, rename: null });
    expect(afterFolderOpened([], opened, '')).toEqual({ existing: false, rename: null });
  });
  it('本来就在列表里的项目只选中，不改名；归档的算重新加回来', () => {
    expect(afterFolderOpened([opened], opened, '宝玉视频')).toEqual({ existing: true, rename: null });
    expect(afterFolderOpened([{ ...opened, archived: true }], opened, '宝玉视频')).toEqual({ existing: false, rename: '宝玉视频' });
  });
});
