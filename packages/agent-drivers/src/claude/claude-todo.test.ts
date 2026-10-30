import { describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeTodoState } from './claude-todo.ts';

/** Claude 的待办清单：TodoWrite 整份替换，TaskCreate / TaskUpdate / TaskList 按 id 累加。 */

const toolUse = (id: string, name: string, input: Record<string, unknown>, parent: string | null = null) =>
  ({
    type: 'assistant',
    message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    parent_tool_use_id: parent,
    session_id: 's',
  }) as unknown as SDKMessage;

const toolResult = (id: string, result: unknown, isError = false) =>
  ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] },
    parent_tool_use_id: null,
    tool_use_result: result,
    session_id: 's',
  }) as unknown as SDKMessage;

describe('ClaudeTodoState', () => {
  it('TodoWrite：工具调用一出来就是整份清单，状态换成 inProgress，带 activeForm', () => {
    const todos = new ClaudeTodoState();
    expect(
      todos.observe(
        toolUse('t1', 'TodoWrite', {
          todos: [
            { content: 'Read the brief', status: 'completed', activeForm: 'Reading the brief' },
            { content: 'Cut the intro', status: 'in_progress', activeForm: 'Cutting the intro' },
            { content: ' ', status: 'pending' },
          ],
        }),
      ),
    ).toEqual([
      { text: 'Read the brief', status: 'completed', activeForm: 'Reading the brief' },
      { text: 'Cut the intro', status: 'inProgress', activeForm: 'Cutting the intro' },
    ]);
    expect(todos.observe(toolResult('t1', null))).toBeNull();
  });

  it('TaskCreate 等结果里的 id 才记；TaskUpdate 跨回合改它、deleted 删掉；出错与 success: false 的不算', () => {
    const todos = new ClaudeTodoState();
    expect(todos.observe(toolUse('c1', 'TaskCreate', { subject: 'Cut the intro', description: 'd', activeForm: 'Cutting' }))).toBeNull();
    expect(todos.observe(toolResult('c1', { task: { id: '1', subject: 'Cut the intro' } }))).toEqual([
      { text: 'Cut the intro', status: 'pending', activeForm: 'Cutting' },
    ]);
    todos.observe(toolUse('c2', 'TaskCreate', { subject: 'Add captions', description: 'd' }));
    expect(todos.observe(toolResult('c2', { task: { id: '2', subject: 'Add captions' } }))).toHaveLength(2);

    todos.observe(toolUse('u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' }));
    expect(todos.observe(toolResult('u1', { success: true, taskId: '1' }))).toEqual([
      { text: 'Cut the intro', status: 'inProgress', activeForm: 'Cutting' },
      { text: 'Add captions', status: 'pending' },
    ]);

    todos.observe(toolUse('u2', 'TaskUpdate', { taskId: '2', status: 'completed' }));
    expect(todos.observe(toolResult('u2', { success: false }))).toBeNull();
    todos.observe(toolUse('u3', 'TaskUpdate', { taskId: '2', status: 'completed' }));
    expect(todos.observe(toolResult('u3', null, true))).toBeNull();
    todos.observe(toolUse('u4', 'TaskUpdate', { taskId: '9', status: 'completed' }));
    expect(todos.observe(toolResult('u4', { success: true }))).toBeNull();

    todos.observe(toolUse('d1', 'TaskUpdate', { taskId: '1', status: 'deleted' }));
    expect(todos.observe(toolResult('d1', { success: true }))).toEqual([{ text: 'Add captions', status: 'pending' }]);
  });

  it('TaskList 的结果整份替换；子智能体的帧不看；reset 清空', () => {
    const todos = new ClaudeTodoState();
    todos.observe(toolUse('l1', 'TaskList', {}));
    expect(
      todos.observe(
        toolResult('l1', {
          tasks: [
            { id: '3', subject: 'Export', status: 'completed' },
            { id: '4', subject: 'Gone', status: 'deleted' },
          ],
        }),
      ),
    ).toEqual([{ text: 'Export', status: 'completed' }]);
    expect(todos.observe(toolUse('t2', 'TodoWrite', { todos: [{ content: 'x', status: 'pending' }] }, 'toolu_parent'))).toBeNull();
    todos.reset();
    todos.observe(toolUse('u5', 'TaskUpdate', { taskId: '3', status: 'pending' }));
    expect(todos.observe(toolResult('u5', { success: true }))).toBeNull();
  });
});
