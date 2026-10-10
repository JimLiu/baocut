import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale, type VideoSnapshot } from '@baocut/protocol';
import { captureEditorContext } from './agent-context.ts';
import { useEditor } from './editor-store.ts';
import { useShell, type Route } from './shell-store.ts';
import { useVideo, type OpenVideo } from './video-store.ts';

// Node 里没有可用的 localStorage：给持久化一个内存版本，先于 store 模块加载。
vi.hoisted(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  });
});

const target = { projectId: 'p1', path: 'videos/样片' };

function open(): void {
  const video = {
    id: 'vid_1',
    name: '样片',
    revision: '3',
    rootSequenceId: 'seq',
    sequences: { seq: { items: [{ id: 'item_1' }] } },
  } as unknown as VideoSnapshot;
  useVideo.setState({
    video: {
      target,
      videoId: 'vid_1',
      ref: { source: { projectId: 'p1' }, relPath: 'videos/样片' },
      state: { video, eventSeq: 1 },
      status: 'ready',
    } as unknown as OpenVideo,
  });
  useShell.setState({ route: { tab: 'space', category: 'all', projectId: 'p1', video: target } as unknown as Route });
  useEditor.setState({ videoId: 'vid_1', selection: ['item_1', 'gone'], playhead: 1.23456 });
}

describe('发给智能体的编辑器上下文', () => {
  const initial = getLocale();
  // 测试环境可能用 `BAOCUT_LOCALE` 钉住语言；这里要真的换语言。
  beforeEach(() => vi.stubEnv('BAOCUT_LOCALE', ''));
  afterEach(() => {
    setLocale(initial);
    vi.unstubAllEnvs();
  });

  it('带上发送这一刻的界面语言', () => {
    open();
    setLocale('zh-Hans');
    expect(captureEditorContext({ conversationId: null, projectId: 'p1' })).toEqual({
      videoId: 'vid_1',
      videoName: '样片',
      videoPath: 'videos/样片',
      revision: '3',
      selection: ['item_1'],
      playheadSeconds: 1.235,
      uiLanguage: 'zh-Hans',
    });
    setLocale('pt-BR');
    expect(captureEditorContext({ conversationId: null, projectId: 'p1' })?.uiLanguage).toBe('pt-BR');
  });

  it('视频不属于这个会话的来源时不附上下文', () => {
    open();
    expect(captureEditorContext({ conversationId: null, projectId: 'p2' })).toBeNull();
  });
});
