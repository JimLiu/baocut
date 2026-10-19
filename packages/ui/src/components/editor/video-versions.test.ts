// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '@baocut/protocol';
import { RuntimeContext } from '../../runtime/context.tsx';
import type { RuntimeSession } from '../../runtime/session.ts';
import { useVideo, type OpenVideo } from '../../state/video-store.ts';
import { EditorContext, type EditorActions } from './editor-context.tsx';
import { useVersionsDialog } from './video-versions-conflict.tsx';
import { VersionsButton } from './video-versions.tsx';

const entries: HistoryEntry[] = [
  {
    transactionId: 'tx2',
    commandId: 'c2',
    label: 'Trim clip',
    actor: { kind: 'user', id: 'user_local' },
    videoRevision: '12',
    committedAt: new Date().toISOString(),
    undoDepth: 0,
    undoAvailable: true,
  },
  {
    transactionId: 'tx1',
    commandId: 'c1',
    label: 'Cut silence',
    actor: { kind: 'agent', id: 'agent:claude' },
    videoRevision: '11',
    committedAt: new Date().toISOString(),
    undoneBy: 'tx3',
    undoDepth: 0,
    undoAvailable: true,
  },
] as HistoryEntry[];

let container: HTMLDivElement;
let root: Root;
let history: ReturnType<typeof vi.fn>;
let undo: ReturnType<typeof vi.fn>;

/** 不在项目里的视频：没有版本，按钮仍在，打开就是「修改」。 */
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
      createElement(RuntimeContext.Provider, { value: runtime }, createElement(EditorContext.Provider, { value: actions }, createElement(VersionsButton, { video: open }))),
    ),
  );
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  history = vi.fn(() => Promise.resolve(entries));
  undo = vi.fn(() => Promise.resolve(null));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  useVersionsDialog.getState().hide();
  useVideo.setState({ video: null });
  vi.unstubAllGlobals();
});

describe('视频栏只有一个「历史」按钮，撤销历史在对话框里', () => {
  it('提示写当前修订；不在项目里的视频打开就是「修改」，可以单独撤销某一笔', async () => {
    await mount();
    const entry = button('历史 · 修订 12 · 这部视频不在项目里');
    expect(entry).toBeDefined();
    await act(async () => entry!.click());
    expect(history).toHaveBeenCalledWith(100);
    const text = document.body.textContent ?? '';
    expect(text).toContain('Trim clip');
    expect(text).toContain('修订 12 · 你');
    expect(text).toContain('Cut silence（已撤销）');
    // 已撤销的那一笔不再给撤销
    const undoButtons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === '撤销');
    expect(undoButtons).toHaveLength(1);
    await act(async () => undoButtons[0]!.click());
    expect(undo).toHaveBeenCalledWith({ transaction: 'tx2' });
  });

  it('视频还不能编辑时撤销按钮停用', async () => {
    await mount('stale');
    await act(async () => button('历史 · 修订 12 · 这部视频不在项目里')!.click());
    const undoButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '撤销');
    expect(undoButton).toBeDefined();
    expect(undoButton!.disabled || undoButton!.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});
