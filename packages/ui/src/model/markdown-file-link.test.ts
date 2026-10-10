import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import type { SpaceEntry } from '@baocut/protocol';
import { markdownFileOutsideScope, markdownFilePath, markdownFileTarget, markdownOpenAction } from './markdown-file-link.ts';

describe('Markdown 产物路径', () => {
  it.each([
    ['/Users/me/Downloads/春日慢慢玩-2010-04-03.mp4', '/Users/me/Downloads/春日慢慢玩-2010-04-03.mp4'],
    ['./out/clip%20one.mp4', './out/clip one.mp4'],
    ['clip.mp4', 'clip.mp4'],
    ['README', 'README'],
    ['说明.abc', '说明.abc'],
    ['../out/report.pdf', '../out/report.pdf'],
    ['file:///Users/me/%E6%88%90%E7%89%87.mp4', '/Users/me/成片.mp4'],
    ['file://localhost/C:/Exports/clip%20one.mp4', 'C:/Exports/clip one.mp4'],
    ['C:\\Exports\\clip.mp4', 'C:\\Exports\\clip.mp4'],
    ['src/main.ts:12:3', 'src/main.ts'],
    ['notes.md#chapter', 'notes.md'],
  ])('%s 保留文件定位语义', (href, expected) => {
    expect(markdownFilePath(href)).toBe(expected);
  });

  it.each(['', '#chapter', '?page=2', 'https://example.com/clip.mp4', '//example.com/clip.mp4',
    'mailto:me@example.com', 'javascript:alert(1)', 'data:text/plain,test.txt', 'file://server/share/clip.mp4',
    '/settings/models/image', '/settings', '/out/bad%ZZ.mp4', '/out/bad%00.mp4'])('不把 %s 当本地文件', (href) => {
    expect(markdownFilePath(href)).toBeNull();
  });

  it('Markdown 编码后的中文与空格路径仍能识别，file URL 只在链接上保留', () => {
    const paths: string[] = [];
    const html = renderToStaticMarkup(createElement(Markdown, {
      urlTransform: (url, key) => key === 'href' && markdownFilePath(url) ? url : defaultUrlTransform(url),
      components: { a: ({ href, children }) => {
        paths.push(markdownFilePath(href!)!);
        return createElement('span', null, children);
      } },
      children: '[下载 Vlog 成片](</Users/me/Downloads/春日 慢慢玩.mp4>) [文件](file:///tmp/clip.mp4) ![图片](file:///tmp/image.png)',
    }));
    expect(paths).toEqual(['/Users/me/Downloads/春日 慢慢玩.mp4', '/tmp/clip.mp4']);
    expect(html).not.toContain('file:');
  });
});

describe('产物链接目标', () => {
  it('目录外的未登记副本走系统应用，目录内文件仍在右侧打开', () => {
    expect(markdownFileOutsideScope('/Downloads/成片.mp4', '/scratch/c1')).toBe(true);
    expect(markdownFileOutsideScope('../c10/成片.mp4', '/scratch/c1')).toBe(true);
    expect(markdownFileOutsideScope('./exports/成片.mp4', '/scratch/c1')).toBe(false);
    expect(markdownFileOutsideScope('C:\\work\\clip.mp4', 'C:\\work')).toBe(false);
  });
  const scope = { conversationId: 'c1', cwd: '/scratch/c1' };
  const dirs = { projects: [{ id: 'p1', name: '', path: '/projects/one' }], conversations: [{ id: 'c1', title: '', cwd: scope.cwd }] };
  const exported: SpaceEntry = {
    id: 'export1', kind: 'export', name: '成片', fileName: '成片.mp4', relPath: '成片.mp4',
    source: { projectId: null, conversationId: null }, file: { path: '/Downloads/成片.mp4' },
    size: 100, lastActivityAt: '', status: null,
    user: { favorite: false, displayName: null, trashedAt: null },
  };
  it('工作目录外的成片使用已登记 entry，避免会话目录的 forbidden', () => {
    expect(markdownFileTarget('/Downloads/成片.mp4', scope, [exported], dirs)).toEqual({ entryId: 'export1' });
    expect(markdownFileTarget('../../Downloads/成片.mp4', scope, [exported], dirs)).toEqual({ entryId: 'export1' });
  });
  it('项目和会话文件都能匹配；不能只按同名文件猜测', () => {
    const entry = { ...exported, source: { projectId: null, conversationId: 'c1' } };
    expect(markdownFileTarget('./成片.mp4', scope, [entry], dirs)).toEqual({ entryId: 'export1' });
    expect(markdownFileTarget('/projects/one/成片.mp4', scope, [{ ...entry, source: { projectId: 'p1', conversationId: null } }], dirs)).toEqual({ entryId: 'export1' });
    expect(markdownFileTarget('成片.mp4', scope, [exported], dirs)).toEqual({ conversationId: 'c1', path: '成片.mp4' });
  });
  it('未登记和已删除文件仍交 Runtime 检查权限，不放宽媒体通道', () => {
    expect(markdownFileTarget('/Downloads/成片.mp4', scope, [{ ...exported, user: { ...exported.user, trashedAt: 'now' } }], dirs))
      .toEqual({ conversationId: 'c1', path: '/Downloads/成片.mp4' });
  });
  it('Windows file URL 与磁盘路径使用相同的匹配方式', () => {
    const file = { ...exported, file: { path: 'C:\\Exports\\成片.mp4' } };
    expect(markdownFileTarget(markdownFilePath('file:///C:/Exports/%E6%88%90%E7%89%87.mp4')!, scope, [file], dirs)).toEqual({ entryId: 'export1' });
  });

  describe('点了之后怎么打开', () => {
    const desktop = { desktop: true };
    const web = { desktop: false };
    it('登记过的交付物（含下载目录里的）按条目在文件标签里打开，桌面与浏览器一样', () => {
      const delivered = { ...exported, id: 'sha256:md', kind: 'document' as const, fileName: 'talk.blog.zh-CN.md', file: { path: '/Volumes/SSD/Downie/talk.blog.zh-CN.md' } };
      for (const host of [desktop, web]) {
        expect(markdownOpenAction('/Volumes/SSD/Downie/talk.blog.zh-CN.md', scope, [delivered], dirs, host))
          .toEqual({ kind: 'pane', target: { entryId: 'sha256:md' } });
      }
    });
    it('工作目录里的文件按会话路径打开，不论宿主', () => {
      for (const host of [desktop, web]) {
        expect(markdownOpenAction('./out/notes.md', scope, [], dirs, host)).toEqual({ kind: 'pane', target: { conversationId: 'c1', path: './out/notes.md' } });
      }
    });
    it('桌面端：工作目录外、没有条目的文档与媒体在文件标签里按本机路径预览；相对路径补全成绝对路径', () => {
      expect(markdownOpenAction('/Volumes/SSD/Downie/talk.blog.zh-CN.md', scope, [], dirs, desktop))
        .toEqual({ kind: 'pane', target: { localPath: '/Volumes/SSD/Downie/talk.blog.zh-CN.md' } });
      expect(markdownOpenAction('../c2/clip.mp4', scope, [], dirs, desktop)).toEqual({ kind: 'pane', target: { localPath: '/scratch/c2/clip.mp4' } });
      expect(markdownOpenAction('C:\\Exports\\成片.mp4', { conversationId: 'c1', cwd: 'C:\\work' }, [], dirs, desktop))
        .toEqual({ kind: 'pane', target: { localPath: 'C:\\Exports\\成片.mp4' } });
      // 回收站里的条目不算登记：同样按本机路径只读预览。
      expect(markdownOpenAction('/Downloads/成片.mp4', scope, [{ ...exported, user: { ...exported.user, trashedAt: 'now' } }], dirs, desktop))
        .toEqual({ kind: 'pane', target: { localPath: '/Downloads/成片.mp4' } });
    });
    it('桌面端：查看器不支持的类型才交给系统默认应用', () => {
      expect(markdownOpenAction('/Downloads/raw.mkv', scope, [], dirs, desktop)).toEqual({ kind: 'system', path: '/Downloads/raw.mkv' });
      expect(markdownOpenAction('/Downloads/slides.key', scope, [], dirs, desktop)).toEqual({ kind: 'system', path: '/Downloads/slides.key' });
    });
    it('浏览器：工作目录外仍按会话路径请求，由 Runtime 报告不可用，不发本机路径', () => {
      expect(markdownOpenAction('/Volumes/SSD/Downie/talk.blog.zh-CN.md', scope, [], dirs, web))
        .toEqual({ kind: 'pane', target: { conversationId: 'c1', path: '/Volumes/SSD/Downie/talk.blog.zh-CN.md' } });
      expect(markdownOpenAction('/Downloads/raw.mkv', scope, [], dirs, web)).toEqual({ kind: 'pane', target: { conversationId: 'c1', path: '/Downloads/raw.mkv' } });
    });
  });
});
