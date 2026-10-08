import { describe, expect, it } from 'vitest';
import type { SpaceEntry } from '@baocut/protocol';
import type { Route } from '../state/shell-store.ts';
import {
  PEEK_DELAY_MS,
  TAB_PREVIEW_DELAY_MS,
  closesPeekOnPointerDown,
  closingFirst,
  isCurrentPeek,
  peekBox,
  peekKindOf,
  peekRoute,
  peekStaysOpen,
  tabPreviewPosition,
  tabPreviewSubtitle,
} from './shell-peek.ts';

const home: Route = { tab: 'home', conversationId: null, projectId: null };
const space: Route = { tab: 'space', category: 'video', projectId: 'p1' };

describe('侧栏浮出', () => {
  it('停留 100 ms 浮出、页签停留 500 ms 出缩略卡', () => {
    expect(PEEK_DELAY_MS).toBe(100);
    expect(TAB_PREVIEW_DELAY_MS).toBe(500);
  });

  it('设置与模型页没有页面侧栏，不浮出；其余入口浮出各自的侧栏', () => {
    expect(peekKindOf('settings')).toBeNull();
    expect(peekKindOf('models')).toBeNull();
    expect(['home', 'space', 'tools', 'services', 'tasks'].map((t) => peekKindOf(t as never))).toEqual([
      'home',
      'space',
      'tools',
      'services',
      'tasks',
    ]);
  });

  it('浮出当前区域时用当前路由，别的区域用该入口的目标路由', () => {
    expect(isCurrentPeek('home', home)).toBe(true);
    expect(isCurrentPeek('space', home)).toBe(false);
    expect(peekRoute('home', home, space)).toBe(home);
    expect(peekRoute('space', home, space)).toBe(space);
  });

  it('浮层距应用面板上、下、左各内缩 6', () => {
    expect(peekBox({ left: 56, top: 44, bottom: 796 }, 800)).toEqual({ left: 62, top: 50, bottom: 10 });
  });

  it('按在浮层、Rail、标题栏导航区或菜单对话框里不关，别处关', () => {
    const at = (inside: boolean) => ({ closest: () => (inside ? {} : null) });
    expect(closesPeekOnPointerDown(at(true))).toBe(false);
    expect(closesPeekOnPointerDown(at(false))).toBe(true);
    expect(closesPeekOnPointerDown(null)).toBe(true);
  });

  it('指针离开后：浮层里有焦点或开着菜单、对话框时不关', () => {
    expect(peekStaysOpen({ focusInside: false, overlayOpen: false })).toBe(false);
    expect(peekStaysOpen({ focusInside: true, overlayOpen: false })).toBe(true);
    expect(peekStaysOpen({ focusInside: false, overlayOpen: true })).toBe(true);
  });

  it('浮层里的跳转先关浮层再跳；去的就是当前路由（跳转什么也不改）时也关', () => {
    const calls: string[] = [];
    let current: Route = home;
    // 同 shell store 的 go：路由相同直接返回。
    const go = (route: Route) => {
      if (JSON.stringify(route) === JSON.stringify(current)) return;
      calls.push('go');
      current = route;
    };
    const peekGo = closingFirst(() => calls.push('close'), go);
    peekGo(home);
    expect(calls).toEqual(['close']);
    peekGo(space);
    expect(calls).toEqual(['close', 'close', 'go']);
    expect(current).toEqual(space);
  });
});

describe('页签悬停缩略卡', () => {
  it('左缘对齐页签并夹在视口里，顶在页签下方 8', () => {
    expect(tabPreviewPosition({ left: 300, bottom: 80 }, 1280)).toEqual({ left: 300, top: 88 });
    expect(tabPreviewPosition({ left: 2, bottom: 80 }, 1280)).toEqual({ left: 8, top: 88 });
    expect(tabPreviewPosition({ left: 1200, bottom: 80 }, 1280)).toEqual({ left: 992, top: 88 });
  });

  const words = { title: '标题', conversation: '会话', newTab: '新标签页', entries: [] as SpaceEntry[] };

  it('副标题：网页写地址或新标签页，会话写「会话」', () => {
    expect(tabPreviewSubtitle('conversation', words)).toBe('会话');
    expect(tabPreviewSubtitle({ kind: 'web', id: 'w', url: 'https://example.com/a' }, words)).toBe('https://example.com/a');
    expect(tabPreviewSubtitle({ kind: 'web', id: 'w', url: '' }, words)).toBe('新标签页');
  });

  it('副标题：文件与视频写项目内路径，按条目打开的用条目的相对路径，找不到用标题', () => {
    expect(tabPreviewSubtitle({ kind: 'file', target: { projectId: 'p', path: 'docs/a.md' } }, words)).toBe('docs/a.md');
    expect(tabPreviewSubtitle({ kind: 'video', target: { conversationId: 'c', path: 'out/v.mp4' } }, words)).toBe('out/v.mp4');
    const entries = [{ id: 'e1', relPath: 'media/clip.mp4' } as SpaceEntry];
    expect(tabPreviewSubtitle({ kind: 'video', target: { entryId: 'e1' } }, { ...words, entries })).toBe('media/clip.mp4');
    expect(tabPreviewSubtitle({ kind: 'video', target: { entryId: 'missing' } }, words)).toBe('标题');
    expect(tabPreviewSubtitle({ kind: 'files' }, words)).toBe('标题');
  });
});
