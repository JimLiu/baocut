import { describe, expect, it } from 'vitest';
import type { TodoItem } from '@baocut/protocol';
import { todoCurrent, todoProgress } from './agent-todo.ts';

const TODO: TodoItem[] = [
  { text: 'Read the brief', status: 'completed' },
  { text: 'Cut the intro', status: 'inProgress', activeForm: 'Cutting the intro' },
  { text: 'Export', status: 'pending' },
];

describe('agent todo', () => {
  it('数已完成的与总数', () => {
    expect(todoProgress(TODO)).toEqual({ done: 1, total: 3 });
    expect(todoProgress([])).toEqual({ done: 0, total: 0 });
  });

  it('正在做的：进行中的说法优先，没有说法用原话，没有进行中的取下一项待做，全做完时 null', () => {
    expect(todoCurrent(TODO)).toBe('Cutting the intro');
    expect(todoCurrent([{ text: 'a', status: 'inProgress' }])).toBe('a');
    expect(
      todoCurrent([
        { text: 'a', status: 'completed' },
        { text: 'b', status: 'pending' },
      ]),
    ).toBe('b');
    expect(todoCurrent([{ text: 'a', status: 'completed' }])).toBeNull();
  });
});
