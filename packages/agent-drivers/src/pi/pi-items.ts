/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/pi/tool-call-mapper.ts（pi 自带工具 bash / read / edit / write / find / grep / ls 的参数形状、
 * edit 的 `edits[{oldText,newText}]` 与旧式 old_string / new_string、结果文字取 content / output / stdout、退出码取 exitCode / code）
 * 与 agent.ts 里按 message_update 的 assistantMessageEvent 拼文字与思考的做法。
 * 改成 BaoCut 的 AgentItem：改文件的工具输出 unified diff（edit 用 pi 给的 `details.patch`，没有时与 write 一样从参数合成），
 * bash 的输出与退出码取 `result.structuredContent`（1.0.4 实测），工具条目从 tool_execution_start 开始，不从流式的 toolcall_* 开始。
 */
import path from 'node:path';
import type { AgentEvent, AgentItem } from '@baocut/harness';
import type { ToolCallKind, ToolCallStatus } from '@baocut/protocol';
import { DriversCommon, DriversPi } from '@baocut/protocol/messages/agent-drivers';

type ToolItem = Extract<AgentItem, { kind: 'tool-call' }>;

interface OpenText {
  id: string;
  kind: 'agent-message' | 'reasoning';
  text: string;
}

interface OpenTool {
  item: ToolItem;
  name: string;
  args: Record<string, unknown>;
  startedAt: number;
  /** tool_execution_update 已经发出去的输出（partialResult 是累计的，只发新增的部分）。 */
  streamed: string;
}

/**
 * 把一轮里 pi 的事件翻成 BaoCut 的条目事件。一轮 = 一次 `prompt` 从 agent_start 到 agent_settled；
 * pi 的 turn_start / turn_end 是其中每一次模型调用，不对应 BaoCut 的回合，这里不管它们。
 */
export class PiItemMapper {
  readonly #turnId: string;
  readonly #cwd: string | null;
  readonly #now: () => number;
  /** 本轮第几条助手消息：同一条消息里的文字块与思考块按 contentIndex 区分。 */
  #message = 0;
  readonly #texts = new Map<number, OpenText>();
  readonly #tools = new Map<string, OpenTool>();

  constructor(turnId: string, cwd: string | null, now: () => number = Date.now) {
    this.#turnId = turnId;
    this.#cwd = cwd;
    this.#now = now;
  }

  get openTools(): number {
    return this.#tools.size;
  }

  map(event: Record<string, unknown>): AgentEvent[] {
    switch (event.type) {
      case 'message_start':
        if (role(event.message) === 'assistant') {
          this.#message += 1;
          this.#texts.clear();
        }
        return [];
      case 'message_update':
        return this.#update(event.assistantMessageEvent as Record<string, unknown> | undefined);
      case 'message_end':
        // 正常情况下 *_end 已经收好了；出错或中断时可能没有，按已有的文字收掉。
        return role(event.message) === 'assistant' ? this.#closeTexts() : [];
      case 'tool_execution_start':
        return this.#toolStart(event);
      case 'tool_execution_update':
        return this.#toolUpdate(event);
      case 'tool_execution_end':
        return this.#toolEnd(event);
      default:
        return [];
    }
  }

  /** 回合结束：还开着的文字收掉，还没有终态的工具记成 interrupted（不能当成完成）。 */
  finish(): AgentEvent[] {
    const events = this.#closeTexts();
    for (const [id, open] of this.#tools) {
      this.#tools.delete(id);
      events.push(this.#completed({ ...open.item, status: 'interrupted', durationMs: Math.max(0, this.#now() - open.startedAt) }));
    }
    return events;
  }

  #update(e: Record<string, unknown> | undefined): AgentEvent[] {
    if (!e) return [];
    const index = typeof e.contentIndex === 'number' ? e.contentIndex : 0;
    switch (e.type) {
      case 'text_start':
      case 'thinking_start':
        return this.#open(index, e.type === 'text_start' ? 'agent-message' : 'reasoning');
      case 'text_delta':
      case 'thinking_delta': {
        const delta = typeof e.delta === 'string' ? e.delta : '';
        if (!delta) return [];
        const kind = e.type === 'text_delta' ? 'agent-message' : 'reasoning';
        const events = this.#texts.has(index) ? [] : this.#open(index, kind);
        const open = this.#texts.get(index)!;
        open.text += delta;
        events.push({
          type: 'item.delta',
          turnId: this.#turnId,
          itemId: open.id,
          channel: kind === 'agent-message' ? 'text' : 'reasoning',
          delta,
        });
        return events;
      }
      case 'text_end':
      case 'thinking_end': {
        const kind = e.type === 'text_end' ? 'agent-message' : 'reasoning';
        const events = this.#texts.has(index) ? [] : this.#open(index, kind);
        const open = this.#texts.get(index)!;
        this.#texts.delete(index);
        // *_end 带着这一块的全文，以它为准。
        const text = typeof e.content === 'string' ? e.content : open.text;
        if (!text && events.length) return []; // 从没开过、也没有字：不留空条目
        events.push(this.#completed({ kind: open.kind, id: open.id, text }));
        return events;
      }
      default:
        return [];
    }
  }

  #open(index: number, kind: OpenText['kind']): AgentEvent[] {
    const open: OpenText = { id: `${this.#turnId}:m${this.#message}:${index}`, kind, text: '' };
    this.#texts.set(index, open);
    return [{ type: 'item.started', turnId: this.#turnId, item: { kind, id: open.id, text: '' } }];
  }

  #closeTexts(): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const open of this.#texts.values()) events.push(this.#completed({ kind: open.kind, id: open.id, text: open.text }));
    this.#texts.clear();
    return events;
  }

  #toolStart(event: Record<string, unknown>): AgentEvent[] {
    const id = String(event.toolCallId ?? '');
    if (!id || this.#tools.has(id)) return [];
    const name = String(event.toolName ?? '');
    const args = record(event.args);
    // 工具调用 id 来自模型服务，有的服务每轮都从 call_0 数起：带上回合 id，免得同一会话里条目 id 撞车。
    const item = piToolItem(`${this.#turnId}:${id}`, name, args, this.#cwd);
    this.#tools.set(id, { item, name, args, startedAt: this.#now(), streamed: '' });
    return [{ type: 'item.started', turnId: this.#turnId, item }];
  }

  #toolUpdate(event: Record<string, unknown>): AgentEvent[] {
    const open = this.#tools.get(String(event.toolCallId ?? ''));
    if (!open || open.item.tool === 'file-change') return [];
    const text = contentText(record(event.partialResult).content);
    if (!text || !text.startsWith(open.streamed) || text === open.streamed) return [];
    const delta = text.slice(open.streamed.length);
    open.streamed = text;
    return [{ type: 'item.delta', turnId: this.#turnId, itemId: open.item.id, channel: 'output', delta }];
  }

  #toolEnd(event: Record<string, unknown>): AgentEvent[] {
    const id = String(event.toolCallId ?? '');
    const open = this.#tools.get(id);
    if (!open) return [];
    this.#tools.delete(id);
    const result = event.result;
    const isError = event.isError === true;
    const status: ToolCallStatus = isError ? 'failed' : 'completed';
    const { output, exitCode } = toolResult(open.name, result, isError);
    let shown = output;
    if (open.item.tool === 'file-change' && status === 'completed') {
      shown = fileChangeDiff(open.name, open.args, result, this.#cwd) ?? output;
    }
    return [
      this.#completed({
        ...open.item,
        output: shown || null,
        status,
        exitCode: open.item.tool === 'command' ? exitCode : null,
        durationMs: Math.max(0, this.#now() - open.startedAt),
      }),
    ];
  }

  #completed(item: AgentItem): AgentEvent {
    return { type: 'item.completed', turnId: this.#turnId, item };
  }
}

/** 工具名 → 时间线上的工具种类。 */
export function piToolKind(name: string): ToolCallKind {
  if (name === 'bash') return 'command';
  if (name === 'edit' || name === 'write') return 'file-change';
  if (name.startsWith('mcp__')) return 'mcp';
  if (name === 'web_search' || name === 'web_fetch') return 'web-search';
  return 'other';
}

const READ_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

export function piToolItem(id: string, name: string, args: Record<string, unknown>, cwd: string | null): ToolItem {
  const tool = piToolKind(name);
  const file = str(args.path) ?? str(args.file_path);
  let title: string;
  let detail: string | null = null;
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) {
    title = `${mcp[1]}.${mcp[2]}`;
    detail = JSON.stringify(args);
  } else if (name === 'bash') {
    title = str(args.command) ?? name;
  } else if (tool === 'file-change') {
    const shown = file ? displayPath(file, cwd) : '';
    title = shown || name;
    detail = `${name} ${shown}`.trim();
  } else if (READ_TOOLS.has(name)) {
    const target =
      name === 'read' || name === 'ls' ? (file ? displayPath(file, cwd) : '') : [str(args.pattern), file].filter(Boolean).join(' · ');
    title = `${name} ${target}`.trim();
  } else {
    const first = Object.values(args).find((v): v is string => typeof v === 'string' && v.trim() !== '');
    title = first ? `${name} ${oneLine(first)}` : name || String(DriversPi.toolFallback());
  }
  return { kind: 'tool-call', id, tool, title, detail, output: null, status: 'running', exitCode: null, durationMs: null };
}

/**
 * 工具结果的文字与退出码。bash（1.0.4 实测）：`structuredContent: { output, exit_code }`，`content` 的文字末尾另附一行
 * `Command exited with code N`；没有 structuredContent 时从文字里剥这一行。旧版的 `output` / `stdout` / `exitCode` / `code` 也认。
 */
export function toolResult(name: string, result: unknown, isError: boolean): { output: string; exitCode: number | null } {
  if (typeof result === 'string') return { output: result, exitCode: name === 'bash' ? (isError ? null : 0) : null };
  const r = record(result);
  const structured = record(r.structuredContent);
  let output =
    (name === 'bash' ? str(structured.output, true) : null) ??
    contentText(r.content) ??
    str(r.output, true) ??
    str(r.stdout, true) ??
    str(r.text, true) ??
    '';
  let exitCode = num(structured.exit_code) ?? num(r.exitCode) ?? num(r.code);
  if (name === 'bash') {
    const tail = /\n*Command exited with code (\d+)\s*$/.exec(output);
    if (tail && structured.output === undefined) {
      output = output.slice(0, tail.index);
      exitCode ??= Number(tail[1]);
    }
    exitCode ??= isError ? null : 0;
  }
  return { output, exitCode };
}

/**
 * 改文件的工具成功时的 unified diff。edit：pi 在 `details.patch` 给了带行号与上下文的补丁（`details.diff` 是它自己界面用的
 * 带行号格式，不是 unified diff），直接用；没有时从 `edits` 合成。write：结果里没有 details，全文按新增行合成；
 * 拿不到旧内容，分不清新建还是覆盖，只写 `+++` 头。
 */
export function fileChangeDiff(name: string, args: Record<string, unknown>, result: unknown, cwd: string | null): string | null {
  const patch = str(record(record(result).details).patch);
  if (name === 'edit' && patch) return patch.replace(/\n$/, '');
  const file = str(args.path) ?? str(args.file_path);
  if (!file) return null;
  const shown = diffPath(file, cwd);
  if (name === 'write') {
    const added = bodyLines(str(args.content, true) ?? '');
    return [`+++ ${shown.b}`, `@@ -0,0 +1,${added.length} @@`, ...added.map((l) => `+${l}`)].join('\n');
  }
  const edits = Array.isArray(args.edits) ? args.edits.map(record) : [args];
  const hunks = edits
    .map((edit) => ({
      removed: bodyLines(str(edit.oldText, true) ?? str(edit.old_string, true) ?? str(edit.oldString, true) ?? ''),
      added: bodyLines(str(edit.newText, true) ?? str(edit.new_string, true) ?? str(edit.newString, true) ?? ''),
    }))
    .filter((h) => h.removed.length || h.added.length);
  if (!hunks.length) return null;
  const lines = [`--- ${shown.a}`, `+++ ${shown.b}`];
  for (const hunk of hunks) {
    lines.push('@@ -0,0 +0,0 @@', ...hunk.removed.map((l) => `-${l}`), ...hunk.added.map((l) => `+${l}`));
  }
  return lines.join('\n');
}

function bodyLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r?\n$/, '').split(/\r?\n/);
}

/** diff 头里的路径：工作目录里的写相对路径（`a/` / `b/` 前缀），工作目录外的绝对路径原样写。 */
function diffPath(file: string, cwd: string | null): { a: string; b: string } {
  const shown = displayPath(file, cwd);
  if (path.isAbsolute(shown)) return { a: shown, b: shown };
  const posix = shown.split(path.sep).join('/');
  return { a: `a/${posix}`, b: `b/${posix}` };
}

function displayPath(file: string, cwd: string | null): string {
  if (!cwd || !path.isAbsolute(file)) return file;
  const relative = path.relative(cwd, file);
  if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return relative;
  return file;
}

/** 内容块里的文字拼起来；图片记成占位。没有内容块时为 null。 */
function contentText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  return content
    .map((c) => {
      const block = record(c);
      return block.type === 'text' ? String(block.text ?? '') : block.type === 'image' ? String(DriversCommon.imagePlaceholder()) : '';
    })
    .filter(Boolean)
    .join('\n');
}

function role(message: unknown): string | null {
  return str(record(message).role);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, allowEmpty = false): string | null {
  return typeof value === 'string' && (allowEmpty || value.trim() !== '') ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function oneLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
