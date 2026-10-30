/*
 * 移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/claude/task-state.ts 的 `ClaudeTaskState`（TodoWrite 整份替换，
 * TaskCreate / TaskUpdate / TaskList 按 id 累加）。改成 BaoCut 的 `TodoItem`，状态写成 `inProgress`，不记 id 以外的字段。
 */
import type { TodoItem } from '@baocut/protocol';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

type TaskTool = 'TodoWrite' | 'TaskCreate' | 'TaskUpdate' | 'TaskList';

const TASK_TOOLS = new Set<string>(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList']);

/**
 * Claude 的待办清单（架构设计 §11.3）。两套工具：旧的 `TodoWrite` 每次给整份清单；现在默认的 `TaskCreate` / `TaskUpdate` /
 * `TaskList` 按任务 id 增删改，id 在 `TaskCreate` 的结果里，所以要等 `tool_result` 才能记。清单属于原生会话，跨回合累加：
 * 第二个回合的 `TaskUpdate` 改的是第一个回合建的任务。原生会话换了（恢复不了、重新开始）时 `reset`。
 *
 * 子智能体的帧（`parent_tool_use_id` 不为空）不看。工具的结构化结果（`tool_use_result`）的形状取自 paseo，没有用真实会话核对过。
 */
export class ClaudeTodoState {
  readonly #tasks = new Map<string, TodoItem>();
  readonly #calls = new Map<string, { name: TaskTool; input: Record<string, unknown> }>();

  /** 看一条消息；清单变了时返回整份清单（可能是空表），没变时 null。 */
  observe(message: SDKMessage): TodoItem[] | null {
    if (message.type === 'assistant') {
      if (message.parent_tool_use_id || message.error) return null;
      let changed = false;
      for (const block of blocks(message.message.content)) {
        if (block.type !== 'tool_use') continue;
        const id = str(block.id);
        const name = str(block.name);
        if (!id || !name || !TASK_TOOLS.has(name)) continue;
        const input = record(block.input) ?? {};
        if (name === 'TodoWrite') {
          this.#replace(input.todos);
          changed = true;
        } else {
          this.#calls.set(id, { name: name as TaskTool, input });
        }
      }
      return changed ? this.#snapshot() : null;
    }
    if (message.type === 'user') {
      if (message.parent_tool_use_id) return null;
      const results = blocks(message.message.content).filter((block) => block.type === 'tool_result');
      let changed = false;
      for (const block of results) {
        const id = str(block.tool_use_id);
        const call = id ? this.#calls.get(id) : undefined;
        if (!id || !call) continue;
        this.#calls.delete(id);
        if (block.is_error === true) continue;
        // 结构化结果只在一条消息只答一个工具时对得上。
        const result = results.length === 1 ? record(message.tool_use_result) : null;
        if (result?.success === false) continue;
        changed = this.#apply(call.name, call.input, result) || changed;
      }
      return changed ? this.#snapshot() : null;
    }
    return null;
  }

  reset(): void {
    this.#tasks.clear();
    this.#calls.clear();
  }

  #replace(todos: unknown): void {
    this.#tasks.clear();
    if (!Array.isArray(todos)) return;
    todos.forEach((entry, index) => {
      const item = todoItem(entry);
      if (item) this.#tasks.set(`todo:${index}`, item);
    });
  }

  #apply(name: TaskTool, input: Record<string, unknown>, result: Record<string, unknown> | null): boolean {
    switch (name) {
      case 'TaskCreate': {
        const task = record(result?.task);
        const id = str(task?.id) ?? str(result?.taskId);
        const text = str(task?.subject) ?? str(input.subject);
        if (!id || !text) return false;
        const activeForm = str(input.activeForm);
        this.#tasks.set(id, { text, status: 'pending', ...(activeForm ? { activeForm } : {}) });
        return true;
      }
      case 'TaskUpdate': {
        const id = str(input.taskId) ?? str(result?.taskId);
        const current = id ? this.#tasks.get(id) : undefined;
        if (!id || !current) return false;
        const status = input.status ?? record(result?.statusChange)?.to;
        if (status === 'deleted') {
          this.#tasks.delete(id);
          return true;
        }
        const text = str(input.subject);
        const activeForm = str(input.activeForm);
        this.#tasks.set(id, {
          ...current,
          ...(text ? { text } : {}),
          ...(activeForm ? { activeForm } : {}),
          ...(status === undefined ? {} : { status: todoStatus(status) }),
        });
        return true;
      }
      case 'TaskList': {
        if (!Array.isArray(result?.tasks)) return false;
        this.#tasks.clear();
        for (const entry of result.tasks) {
          const id = str(record(entry)?.id);
          const item = todoItem(entry);
          if (id && item) this.#tasks.set(id, item);
        }
        return true;
      }
      case 'TodoWrite':
        return false;
    }
  }

  #snapshot(): TodoItem[] {
    return [...this.#tasks.values()];
  }
}

function todoItem(value: unknown): TodoItem | null {
  const entry = record(value);
  const text = str(entry?.subject) ?? str(entry?.content);
  if (!entry || !text || entry.status === 'deleted') return null;
  const activeForm = str(entry.activeForm);
  return { text, status: todoStatus(entry.status), ...(activeForm ? { activeForm } : {}) };
}

function todoStatus(value: unknown): TodoItem['status'] {
  return value === 'completed' ? 'completed' : value === 'in_progress' ? 'inProgress' : 'pending';
}

function blocks(content: unknown): Array<Record<string, unknown>> {
  return Array.isArray(content) ? content.flatMap((block) => (record(block) ? [record(block)!] : [])) : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
