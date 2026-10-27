// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskAction, TaskRow } from '../model/task-list.ts';
import { jobRow } from '../model/task-list.ts';
import { job } from '../testing/task-records.ts';

const state = vi.hoisted(() => ({ rows: [] as TaskRow[], act: vi.fn<(action: TaskAction) => void>() }));
vi.mock('./tasks/use-task-rows.ts', () => ({ useTaskRows: () => ({ rows: state.rows, ready: true }) }));
vi.mock('./tasks/use-task-actions.ts', async (original) => ({
  ...(await original<typeof import('./tasks/use-task-actions.ts')>()),
  useTaskAction: () => state.act,
}));

const { TaskPill } = await import('./task-pill.tsx');

let container: HTMLDivElement;
let root: Root;

/** 这个视频（v1）上在跑的一条转录；没有进度时环转圈。 */
const row = (jobId: string) => jobRow(job({ jobId }), { projects: [], conversations: [] });

async function mount(rows: TaskRow[]) {
  state.rows = rows;
  await act(() => root.render(createElement(TaskPill, { videoId: 'v1' })));
}

/** 停上去 250ms 才弹卡；聚焦和悬停走同一条路。 */
async function openCard() {
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="video-bar-task-pill"]')!.focus());
  await act(async () => vi.advanceTimersByTime(300));
}

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  state.act.mockReset();
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('视频栏的任务进度环', () => {
  it('没有任务时不画', async () => {
    await mount([]);
    expect(container.innerHTML).toBe('');
  });

  it('一条：环不写字，名字是任务与进度；卡底给取消', async () => {
    const one = { ...row('a'), pct: 40 };
    await mount([one]);
    const ring = document.querySelector<HTMLButtonElement>('[data-testid="video-bar-task-pill"]')!;
    expect(ring.textContent).toBe('');
    expect(ring.getAttribute('aria-label')).toContain('40%');
    expect(ring.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('40');

    await openCard();
    const cancel = buttons().find((b) => b.textContent === '取消任务');
    expect(cancel).toBeDefined();
    await act(async () => cancel!.click());
    expect(state.act).toHaveBeenCalledWith(one.action);
  });

  it('多条：角上标总条数，卡里不给取消', async () => {
    await mount([row('a'), row('b')]);
    const ring = document.querySelector<HTMLButtonElement>('[data-testid="video-bar-task-pill"]')!;
    expect(ring.getAttribute('aria-label')).toMatch(/^2 个后台任务 · /);
    expect(ring.textContent).toBe('2');
    expect(ring.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);

    await openCard();
    expect(document.body.textContent).toContain('全部任务');
    expect(buttons().some((b) => b.textContent === '取消任务')).toBe(false);
  });
});
