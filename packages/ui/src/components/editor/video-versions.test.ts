// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useVideo, type OpenVideo } from '../../state/video-store.ts';
import { EditorContext, type EditorActions } from './editor-context.tsx';
import { useVersionsDialog } from './video-versions-conflict.tsx';
import { VersionsControl, type VersionsEntry } from './video-versions.tsx';

let container: HTMLDivElement;
let root: Root;
let history: ReturnType<typeof vi.fn>;
let undo: ReturnType<typeof vi.fn>;

/** 不在项目里的视频：没有版本，入口仍在（说明里有当前修订），打开说明为什么没有版本。 */
function video(status: OpenVideo['status']): OpenVideo {
  return {
    target: {} as OpenVideo['target'],
    videoId: 'v1',
    ref: { name: 'Clip', source: { projectId: null } } as unknown as OpenVideo['ref'],
    state: { video: { revision: '12', name: 'Clip', documents: {} } } as unknown as OpenVideo['state'],
    status,
    error: null,
    inFlight: 0,
    lastReceipt: null,
    lastChange: null,
    commandError: null,
    undo: {} as OpenVideo['undo'],
  };
}

async function mount(status: OpenVideo['status'] = 'ready') {
  const open = video(status);
  useVideo.setState({ video: open });
  const runtime = { videos: { history, versionStatus: vi.fn(() => new Promise(() => {})) } } as unknown as RuntimeSession;
  const actions = { seek: vi.fn(), apply: vi.fn(), undo } as unknown as EditorActions;
  await act(() =>
    root.render(
      createElement(RuntimeContext.Provider, { value: runtime }, createElement(EditorContext.Provider, { value: actions }, createElement(VersionsControl, { video: open, children: entry }))),
    ),
  );
}

/** 视频栏把入口画成视频名菜单里的一项；这里用一颗普通按钮代替，aria-label 是说明、点它打开。 */
const entry = ({ open, tip, conflict }: VersionsEntry) =>
  createElement('button', { type: 'button', 'aria-label': tip, 'data-conflict': conflict, onClick: open });

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  history = vi.fn(() => Promise.resolve([]));
  undo = vi.fn(() => Promise.resolve(null));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useVersionsDialog.getState().hide();
  useVideo.setState({ video: null });
  vi.unstubAllGlobals();
});

describe('视频栏只有一个历史入口：视频名菜单里的版本记录', () => {
  it('提示写当前修订；对话框只有版本，不再列撤销历史', async () => {
    await mount();
    const item = button('版本记录 · 修订 12 · 这部视频不在项目里');
    expect(item).toBeDefined();
    expect(item!.dataset.conflict).toBe('false');
    await act(async () => item!.click());
    const text = document.body.textContent ?? '';
    expect(text).toContain('只有项目里的视频才有版本记录');
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    expect([...document.querySelectorAll('button')].some((b) => b.textContent === '撤销')).toBe(false);
    expect(history).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
  });
});
