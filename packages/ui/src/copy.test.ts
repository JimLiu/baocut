import { setLocale } from '@baocut/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S } from './components/shell-copy.ts';
import { ST } from './components/start/start-copy.ts';
import { TK } from './components/tasks/tasks-copy.ts';
import { T } from './components/thread/thread-copy.ts';
import { ACCESS_MODE_LABEL, TASK_VIEW_COPY } from './copy.ts';
import { CONFETTI_SHAPE_NAMES, CONFETTI_STYLES } from './render/confetti.ts';
import { RT } from './runtime/runtime-copy.ts';
import { liveLabel } from './state/tasks-store.ts';
import type { TaskSummary } from '@baocut/protocol';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

const english = () => {
  vi.stubEnv('BAOCUT_LOCALE', 'en');
  setLocale('en');
};

describe('界面文案跟随界面语言', () => {
  it('英文界面读到英文文案，读取时才取值', () => {
    english();
    expect(ACCESS_MODE_LABEL.plan).toBe('Plan first');
    expect(S.conversationHeader.revealProject).toBe('Show Project Folder');
    expect(S.conversationHeader.noVideosIn('workdir')).not.toMatch(/\p{Script=Han}/u);
    expect(TK.link.stage.done).toBe('Done');
    expect(ST.flow.reason(['Network', 'timed out'])).toBe('Network: timed out');
    expect(T.change.revision(3, 4)).toBe('Version 3 → 4');
    expect(RT.noOpenVideo).toBe('No video is open');
    expect(liveLabel({ status: 'stopping' } as TaskSummary, undefined)).toBe('Stopping');
    expect(CONFETTI_SHAPE_NAMES.heart).toBe('Heart');
    expect(Object.hasOwn(CONFETTI_SHAPE_NAMES, 'ribbon')).toBe(true);
    expect(Object.values(TASK_VIEW_COPY).filter((v) => typeof v === 'string').join('')).not.toMatch(/\p{Script=Han}/u);
    expect(S.titleBar.summary).toBe('Summary');
    expect(S.titleBar.summaryOutputs(2)).toBe('Outputs · 2');
    expect(S.titleBar.summaryEmpty).toBe('This session has no outputs yet.');
    expect(S.titleBar.openTabsCount(1)).toBe('1 open tab');
    expect(S.titleBar.openTabsCount(3)).toBe('3 open tabs');
    expect(S.titleBar.showTabs).toBe('Show tabs');
  });

  it('换回简体中文后与原来的中文逐字一致', () => {
    english();
    vi.stubEnv('BAOCUT_LOCALE', 'zh-Hans');
    setLocale('zh-Hans');
    expect(S.conversationHeader.revealProject).toBe('在文件夹中显示项目');
    expect(S.conversationHeader.revealWorkdir).toBe('在文件夹中显示工作目录');
    expect(ST.flow.reason(['网络', '超时'])).toBe('网络：超时');
    expect(liveLabel({ status: 'running' } as TaskSummary, 'awaiting-approval')).toBe('等待批准');
    expect(CONFETTI_SHAPE_NAMES.heart).toBe('爱心');
    expect(S.titleBar.summary).toBe('会话摘要');
    expect(S.titleBar.summaryOutputs(2)).toBe('产物 · 2');
    expect(S.titleBar.summaryEmpty).toBe('这条会话还没有产物。');
    expect(S.titleBar.openTabsCount(3)).toBe('3 个已打开的标签页');
    expect(S.titleBar.openInFull('剪辑')).toBe('在完整视图中打开「剪辑」');
  });

  it('彩纸款名在已算好的配方上也随语言变', () => {
    let first: string;
    try {
      first = CONFETTI_STYLES[0]!.name;
    } catch {
      return; // 没有构建编辑语义 WASM 时款式目录读不到，跳过。
    }
    expect(first).toBe('缤纷纸片雨');
    english();
    expect(CONFETTI_STYLES[0]!.name).toBe('Rainbow paper');
  });
});
