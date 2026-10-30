// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineItem } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import { TODO_COPY } from './todo-copy.ts';
import { TodoDock } from './todo-dock.tsx';

type TaskItem = Extract<TimelineItem, { kind: 'task' }>;

const task = (over: Partial<TaskItem> = {}): TaskItem => ({
  kind: 'task',
  id: 'task_1',
  taskId: 'task_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  goal: 'g',
  status: 'running',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  error: null,
  todo: {
    items: [
      { text: 'Read the brief', status: 'completed' },
      { text: 'Cut the intro', status: 'inProgress', activeForm: 'Cutting the intro' },
      { text: 'Export', status: 'pending' },
    ],
  },
  ...over,
});

const render = (item: TaskItem | undefined) => renderToStaticMarkup(createElement(TodoDock, { task: item }));

describe('TodoDock', () => {
  it('任务在跑、有清单时出一行「已完成 / 总数 · 正在做的」，带无障碍标签', () => {
    const html = render(task());
    expect(html).toContain(`aria-label="${TODO_COPY.label}"`);
    expect(html).toContain('1/3 · Cutting the intro');
  });

  it('没有在跑的任务、任务结束了、清单为空时不显示', () => {
    expect(render(undefined)).toBe('');
    expect(render(task({ status: 'completed' }))).toBe('');
    expect(render(task({ todo: { items: [] } }))).toBe('');
    const { todo: _todo, ...bare } = task();
    expect(render(bare)).toBe('');
  });
});
