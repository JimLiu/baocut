import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import { relativeImagePath, siblingMediaTarget } from './document-image.ts';

const dirs = { projects: [{ id: 'p1', name: '', path: '/projects/one' }], conversations: [{ id: 'c1', title: '', cwd: '/scratch/c1' }] };
const entry = (over: Partial<SpaceEntry>): SpaceEntry => ({
  id: 'e1', kind: 'document', name: 'post.md', fileName: 'post.md', relPath: 'post.md',
  source: { projectId: null, conversationId: null }, size: 1, lastActivityAt: '', status: null,
  user: { favorite: false, displayName: null, trashedAt: null }, ...over,
});

describe('Markdown 文章里的相对图片', () => {
  it.each([
    ['talk.blog.at-12500ms.png', 'talk.blog.at-12500ms.png'],
    ['./img/a%20b.png', 'img/a b.png'],
    ['../shared/c.png?x=1#y', '../shared/c.png'],
  ])('%s 是相对路径', (src, expected) => {
    expect(relativeImagePath(src)).toBe(expected);
  });

  it.each(['https://example.com/a.png', '//example.com/a.png', 'data:image/png;base64,AAAA', 'file:///tmp/a.png', '/etc/a.png',
    'C:\\img\\a.png', '\\\\server\\share\\a.png', '', 'bad%ZZ.png'])('不把 %s 当相对路径', (src) => {
    expect(relativeImagePath(src)).toBeNull();
  });

  const context = (entries: SpaceEntry[] = [], desktop = true) => ({ entries, dirs, desktop });

  it('会话、项目与本机文章：同一个定位方式下的相邻路径', () => {
    expect(siblingMediaTarget({ conversationId: 'c1', path: 'out/post.md' }, 'a.png', context())).toEqual({ conversationId: 'c1', path: 'out/a.png' });
    expect(siblingMediaTarget({ projectId: 'p1', path: 'post.md' }, './img/a.png', context())).toEqual({ projectId: 'p1', path: 'img/a.png' });
    expect(siblingMediaTarget({ localPath: '/Volumes/SSD/Downie/talk.blog.zh-CN.md' }, 'talk.blog.at-12500ms.png', context()))
      .toEqual({ localPath: '/Volumes/SSD/Downie/talk.blog.at-12500ms.png' });
    expect(siblingMediaTarget({ localPath: 'D:\\Downie\\talk.md' }, 'img/a.png', context())).toEqual({ localPath: 'D:\\Downie\\img\\a.png' });
    expect(siblingMediaTarget({ videoId: 'v', assetId: 'a' }, 'a.png', context())).toBeNull();
    expect(siblingMediaTarget({ conversationId: 'c1', attachmentId: 'att' }, 'a.png', context())).toBeNull();
  });

  it('Space 条目：按来源目录拼；来源目录之外的先找登记过的相邻条目，桌面端再退回本机路径，浏览器取不到', () => {
    const inProject = entry({ source: { projectId: 'p1', conversationId: null }, relPath: 'notes/post.md' });
    expect(siblingMediaTarget({ entryId: 'e1' }, 'a.png', context([inProject]))).toEqual({ projectId: 'p1', path: 'notes/a.png' });
    const inConversation = entry({ source: { projectId: null, conversationId: 'c1' } });
    expect(siblingMediaTarget({ entryId: 'e1' }, 'a.png', context([inConversation]))).toEqual({ conversationId: 'c1', path: 'a.png' });

    const delivered = entry({ file: { path: '/Volumes/SSD/Downie/talk.md' } });
    const image = entry({ id: 'img', kind: 'image', fileName: 'a.png', relPath: 'a.png', file: { path: '/Volumes/SSD/Downie/a.png' } });
    expect(siblingMediaTarget({ entryId: 'e1' }, 'a.png', context([delivered, image], false))).toEqual({ entryId: 'img' });
    expect(siblingMediaTarget({ entryId: 'e1' }, 'b.png', context([delivered, image], true))).toEqual({ localPath: '/Volumes/SSD/Downie/b.png' });
    expect(siblingMediaTarget({ entryId: 'e1' }, 'b.png', context([delivered, image], false))).toBeNull();
    expect(siblingMediaTarget({ entryId: 'missing' }, 'b.png', context([delivered]))).toBeNull();
  });
});
