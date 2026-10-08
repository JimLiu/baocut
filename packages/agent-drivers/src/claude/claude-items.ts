import type { ToolCallKind, ToolCallStatus } from '@baocut/protocol';
import type { AgentEvent, AgentItem } from '@baocut/harness';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import { diffBodyLines, diffPath } from '../unified-diff.ts';

/**
 * Claude Agent SDK 的消息 → 驱动无关的 AgentItem / AgentEvent（架构设计 §3.1）。
 *
 * 打开 `includePartialMessages` 后，一段回复先以 `stream_event`（Messages API 的流式事件）逐字到达，
 * 每个内容块结束后 CLI 再发一条 `assistant` 消息带上这个块的全文（一条 API 消息拆成几条，`message.id` 相同）。
 * 投影器按 `${turnId}/${itemId}` 合并条目，所以流式 delta 与随后的完成事件必须用同一个 itemId：
 * 在 `content_block_start` 时按块的种类排队一个 id，`assistant` 消息里同种类的块按先后顺序认领。
 * 工具调用直接用 `tool_use` 的 id；它的结果在随后一条 `user` 消息的 `tool_result` 块里，不是用户发言。
 *
 * 子智能体（`parent_tool_use_id` 不为空）的帧不进时间线：它们在父级的那一个工具调用（Task / Agent）里。
 *
 * 改文件的工具（Edit / Write / MultiEdit）成功时，`output` 是 unified diff：它们的 tool_result 只是一句确认。
 * SDK 的结构化结果带补丁时按它拼（`structuredPatchLines`，真实行号与上下文），没有时从工具输入合成（`fileChangeDiff`）。
 * 失败、拒绝与中断时仍是 tool_result 的原文。
 */

type Block = { type: string; [key: string]: unknown };
type PartialEvent = Extract<SDKMessage, { type: 'stream_event' }>['event'];

interface OpenTool {
  item: Extract<AgentItem, { kind: 'tool-call' }>;
  name: string;
  input: Record<string, unknown>;
  startedAt: number;
}

/** 一个回合内的映射状态。每个回合新建一个。 */
export class ClaudeItemMapper {
  readonly #turnId: string;
  readonly #now: () => number;
  /** 会话的工作目录：diff 文件头里的路径相对它。 */
  readonly #cwd: string | null;
  /** 当前流式消息的 id（`message_start` 给出）。 */
  #messageId: string | null = null;
  /** 流式开过、还没被 `assistant` 消息认领的条目 id：messageId → 种类 → id 队列。 */
  readonly #streamed = new Map<string, { text: string[]; thinking: string[] }>();
  /** 流式块的 index → 条目 id，供 delta 查找。 */
  readonly #blockIds = new Map<number, { id: string; channel: 'text' | 'reasoning' }>();
  readonly #tools = new Map<string, OpenTool>();
  /** 用户拒绝过的 tool_use id：它的 tool_result 记为 declined，不是 failed。 */
  readonly #declined = new Set<string>();
  /** 回合在中断中：之后出错的工具结果记为 interrupted。 */
  #interrupting = false;
  #seq = 0;

  constructor(turnId: string, now: () => number = Date.now, cwd: string | null = null) {
    this.#turnId = turnId;
    this.#now = now;
    this.#cwd = cwd;
  }

  declined(toolUseId: string): void {
    this.#declined.add(toolUseId);
  }

  interrupting(): void {
    this.#interrupting = true;
  }

  /** 还没拿到结果的工具调用。 */
  openTools(): Array<Extract<AgentItem, { kind: 'tool-call' }>> {
    return [...this.#tools.values()].map((t) => t.item);
  }

  map(message: SDKMessage): AgentEvent[] {
    switch (message.type) {
      case 'stream_event':
        return message.parent_tool_use_id ? [] : this.#onStream(message.event);
      case 'assistant':
        // 出错的回合里那条「API Error …」是 CLI 合成的，错误原文随 turn.completed 带出，这里不重复成一条回复。
        if (message.parent_tool_use_id || message.error) return [];
        return this.#onAssistant(message.message.id, message.message.content as unknown as Block[]);
      case 'user':
        if (message.parent_tool_use_id) return [];
        return this.#onUser(message.message.content as unknown, message.tool_use_result);
      default:
        return [];
    }
  }

  #onStream(event: PartialEvent): AgentEvent[] {
    const e = event as unknown as { type: string; index?: number; message?: { id?: string }; content_block?: Block; delta?: Block };
    switch (e.type) {
      case 'message_start':
        this.#messageId = e.message?.id ?? null;
        this.#blockIds.clear();
        return [];
      case 'content_block_start': {
        const type = e.content_block?.type;
        if ((type !== 'text' && type !== 'thinking') || e.index === undefined) return [];
        const id = this.#nextId();
        this.#queue(this.#messageId ?? '', type).push(id);
        this.#blockIds.set(e.index, { id, channel: type === 'text' ? 'text' : 'reasoning' });
        return [];
      }
      case 'content_block_delta': {
        const block = e.index === undefined ? undefined : this.#blockIds.get(e.index);
        if (!block || !e.delta) return [];
        const delta = e.delta.type === 'text_delta' ? e.delta.text : e.delta.type === 'thinking_delta' ? e.delta.thinking : null;
        if (typeof delta !== 'string' || delta === '') return [];
        return [{ type: 'item.delta', turnId: this.#turnId, itemId: block.id, channel: block.channel, delta }];
      }
      default:
        return [];
    }
  }

  #onAssistant(messageId: string, content: Block[]): AgentEvent[] {
    const events: AgentEvent[] = [];
    for (const block of content) {
      switch (block.type) {
        case 'text': {
          const id = this.#claim(messageId, 'text');
          const text = String(block.text ?? '');
          if (id.streamed || text) events.push(this.#completed({ kind: 'agent-message', id: id.id, text }));
          break;
        }
        case 'thinking': {
          // 思考内容可能被省略（只有签名）：流式没出过字、全文也为空时不留一条空的「思考」。
          const id = this.#claim(messageId, 'thinking');
          const text = String(block.thinking ?? '');
          if (id.streamed || text) events.push(this.#completed({ kind: 'reasoning', id: id.id, text }));
          break;
        }
        case 'tool_use': {
          const id = String(block.id ?? this.#nextId());
          const name = String(block.name ?? '');
          const input = (block.input ?? {}) as Record<string, unknown>;
          const item = toolCallItem(id, name, input);
          this.#tools.set(id, { item, name, input, startedAt: this.#now() });
          events.push({ type: 'item.started', turnId: this.#turnId, item });
          break;
        }
        default:
          // redacted_thinking、服务端工具块等不进时间线。
          break;
      }
    }
    return events;
  }

  /** `toolUseResult`：SDK 附在这条消息上的结构化工具输出（只在一条消息只答一个工具时用得上）。 */
  #onUser(content: unknown, toolUseResult: unknown): AgentEvent[] {
    if (!Array.isArray(content)) return [];
    const events: AgentEvent[] = [];
    const results = (content as Block[]).filter((block) => block.type === 'tool_result');
    for (const block of results) {
      const toolUseId = String(block.tool_use_id ?? '');
      const open = this.#tools.get(toolUseId);
      if (!open) continue;
      this.#tools.delete(toolUseId);
      const output = toolResultText(block.content);
      const isError = block.is_error === true;
      const status: ToolCallStatus = this.#declined.has(toolUseId)
        ? 'declined'
        : isError
          ? this.#interrupting
            ? 'interrupted'
            : 'failed'
          : 'completed';
      const diff =
        status === 'completed' && open.item.tool === 'file-change'
          ? this.#fileChangeDiff(open, output, results.length === 1 ? toolUseResult : undefined)
          : null;
      events.push(
        this.#completed({
          ...open.item,
          output: diff ?? (output || null),
          status,
          exitCode: open.item.tool === 'command' && (status === 'completed' || status === 'failed') ? bashExitCode(isError, output) : null,
          durationMs: Math.max(0, this.#now() - open.startedAt),
        }),
      );
    }
    return events;
  }

  #fileChangeDiff(open: OpenTool, resultText: string, toolUseResult: unknown): string | null {
    const file = str(open.input.file_path);
    if (!file) return null;
    const shown = diffPath(file, this.#cwd);
    const created = open.name === 'Write' && writeCreated(toolUseResult, resultText);
    const patch = structuredPatchLines(toolUseResult, file);
    if (patch) return [created ? '--- /dev/null' : `--- ${shown.a}`, `+++ ${shown.b}`, ...patch].join('\n');
    if (open.name === 'Edit') return fileChangeDiff(shown, [editHunk(open.input)]);
    if (open.name === 'MultiEdit') {
      const edits = Array.isArray(open.input.edits) ? (open.input.edits as Array<Record<string, unknown> | null>) : [];
      const hunks = edits.map((edit) => editHunk(edit ?? {}));
      return hunks.length ? fileChangeDiff(shown, hunks) : null;
    }
    if (open.name === 'Write') {
      const content = typeof open.input.content === 'string' ? open.input.content : '';
      return fileChangeDiff(shown, [{ removed: [], added: diffBodyLines(content) }], created ? 'created' : 'overwritten');
    }
    return null;
  }

  #completed(item: AgentItem): AgentEvent {
    return { type: 'item.completed', turnId: this.#turnId, item };
  }

  #queue(messageId: string, kind: 'text' | 'thinking'): string[] {
    let entry = this.#streamed.get(messageId);
    if (!entry) {
      entry = { text: [], thinking: [] };
      this.#streamed.set(messageId, entry);
    }
    return entry[kind];
  }

  #claim(messageId: string, kind: 'text' | 'thinking'): { id: string; streamed: boolean } {
    const id = this.#streamed.get(messageId)?.[kind].shift();
    return id ? { id, streamed: true } : { id: this.#nextId(), streamed: false };
  }

  #nextId(): string {
    this.#seq += 1;
    return `claude-${this.#seq}`;
  }
}

/** 工具名 → 时间线上的工具种类。 */
export function claudeToolKind(name: string): ToolCallKind {
  if (name === 'Bash') return 'command';
  if (FILE_TOOLS.has(name)) return 'file-change';
  if (name.startsWith('mcp__')) return 'mcp';
  if (name === 'WebSearch' || name === 'WebFetch') return 'web-search';
  return 'other';
}

/** 改文件的自带工具：审批是 `file-change`，「自动接受修改」档由原生的 acceptEdits 放行。 */
export const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** `mcp__server__tool` → `{ server, tool }`。不是 MCP 工具时为 null。 */
export function splitMcpTool(name: string): { server: string; tool: string } | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  return match ? { server: match[1]!, tool: match[2]! } : null;
}

/** 工具要改的文件。 */
export function toolFiles(input: Record<string, unknown>): string[] {
  const file = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path);
  return file ? [file] : [];
}

/** 工具输入的一行简述：审批卡片与时间线标题共用。 */
export function summarizeToolInput(name: string, input: Record<string, unknown>): string {
  return inputSummary(name, input) || name;
}

function inputSummary(name: string, input: Record<string, unknown>): string {
  const mcp = splitMcpTool(name);
  if (mcp) return `${mcp.server}.${mcp.tool}`;
  switch (name) {
    case 'Bash':
      return str(input.command) ?? '';
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return toolFiles(input)[0] ?? '';
    case 'Grep':
    case 'Glob':
      return [str(input.pattern), str(input.path)].filter(Boolean).join(' · ');
    case 'WebSearch':
      return str(input.query) ?? '';
    case 'WebFetch':
      return str(input.url) ?? '';
    case 'Task':
    case 'Agent':
      return str(input.description) ?? '';
    case 'AskUserQuestion': {
      const first = askedQuestions(input)[0];
      return first ? `${name} ${oneLine(first.question)}` : name;
    }
    default: {
      const first = Object.values(input).find((v): v is string => typeof v === 'string' && v.trim() !== '');
      return first ? `${name} ${oneLine(first)}` : name;
    }
  }
}

function toolCallItem(id: string, name: string, input: Record<string, unknown>): Extract<AgentItem, { kind: 'tool-call' }> {
  const tool = claudeToolKind(name);
  return {
    kind: 'tool-call',
    id,
    tool,
    // 读、搜一类的标题带上工具名，免得只剩一个路径看不出做了什么。
    title: READ_TOOLS.has(name) ? `${name} ${inputSummary(name, input)}`.trim() : summarizeToolInput(name, input),
    detail: toolDetail(name, input),
    output: null,
    status: 'running',
    exitCode: null,
    durationMs: null,
  };
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);

function toolDetail(name: string, input: Record<string, unknown>): string | null {
  if (name === 'Bash') return str(input.description);
  if (FILE_TOOLS.has(name)) return `${name} ${toolFiles(input)[0] ?? ''}`.trim();
  if (name === 'WebFetch') return str(input.prompt);
  if (name.startsWith('mcp__')) return JSON.stringify(input);
  // 计划全文：标题只放得下第一行，用户要在时间线上读完整的方案再决定批不批。
  if (name === 'ExitPlanMode') return str(input.plan)?.trim() ?? null;
  // Claude 本想问的问题与选项（这个工具会被拒绝，见 claude-session.ts 的 ASK_USER_QUESTION），留着让用户看得到。
  if (name === 'AskUserQuestion') {
    const lines = askedQuestions(input).flatMap((q) => [q.question, ...q.options.map((o) => `  - ${o}`)]);
    return lines.length ? lines.join('\n') : null;
  }
  return null;
}

/**
 * AskUserQuestion 的输入：`{ questions: [{ question, header?, options: [{ label, description? }], multiSelect? }] }`
 * （SDK sdk-tools.d.ts 的 AskUserQuestionInput）。选项也可能是字符串。
 */
function askedQuestions(input: Record<string, unknown>): Array<{ question: string; options: string[] }> {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.flatMap((item) => {
    const q = item as { question?: unknown; options?: unknown } | null;
    const question = str(q?.question);
    if (!question) return [];
    const options = (Array.isArray(q?.options) ? q.options : []).flatMap((option) => {
      if (typeof option === 'string') return option.trim() ? [option.trim()] : [];
      const o = option as { label?: unknown; description?: unknown } | null;
      const label = str(o?.label);
      if (!label) return [];
      const description = str(o?.description);
      return [description ? `${label} — ${description}` : label];
    });
    return [{ question, options }];
  });
}

interface Hunk {
  removed: string[];
  added: string[];
}

/**
 * SDK 结构化结果里的补丁（`structuredPatch`：每块 `oldStart` / `oldLines` / `newStart` / `newLines` 与带前缀的 `lines`）
 * → 块头加正文的各行，带真实行号与上下文。没有、为空、指向别的文件或形状不对时为 null，改从工具输入合成。
 */
function structuredPatchLines(toolUseResult: unknown, file: string): string[] | null {
  const result = toolUseResult as { filePath?: unknown; structuredPatch?: unknown } | null | undefined;
  if (!result || typeof result !== 'object') return null;
  if (typeof result.filePath === 'string' && result.filePath !== file) return null;
  const hunks = result.structuredPatch;
  if (!Array.isArray(hunks) || hunks.length === 0) return null;
  const out: string[] = [];
  for (const raw of hunks) {
    const hunk = raw as { oldStart?: unknown; oldLines?: unknown; newStart?: unknown; newLines?: unknown; lines?: unknown } | null;
    const numbers = [hunk?.oldStart, hunk?.oldLines, hunk?.newStart, hunk?.newLines];
    if (!numbers.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) return null;
    const lines = hunk!.lines;
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === 'string' && /^[ +\-\\]/.test(line))) return null;
    out.push(`@@ -${numbers[0]},${numbers[1]} +${numbers[2]},${numbers[3]} @@`, ...(lines as string[]));
  }
  return out;
}

/**
 * 从工具输入合成的 unified diff：`--- a/<路径>`、`+++ b/<路径>` 文件头，每处改动一个块。
 * 输入里没有行号：Edit / MultiEdit 的块头写 `@@ -0,0 +0,0 @@`，上下文只有被替换的那两段本身；
 * Write 全是新增行，块头 `@@ -0,0 +1,N @@`。新建的文件旧侧是 `/dev/null`；覆盖已有文件时拿不到旧内容，只写 `+++` 头。
 */
function fileChangeDiff(file: { a: string; b: string }, hunks: Hunk[], write?: 'created' | 'overwritten'): string {
  const lines: string[] = [];
  if (write === 'created') lines.push('--- /dev/null');
  else if (!write) lines.push(`--- ${file.a}`);
  lines.push(`+++ ${file.b}`);
  for (const hunk of hunks) {
    lines.push(write ? `@@ -0,0 +1,${hunk.added.length} @@` : '@@ -0,0 +0,0 @@');
    for (const line of hunk.removed) lines.push(`-${line}`);
    for (const line of hunk.added) lines.push(`+${line}`);
  }
  return lines.join('\n');
}

function editHunk(edit: Record<string, unknown>): Hunk {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return { removed: diffBodyLines(text(edit.old_string)), added: diffBodyLines(text(edit.new_string)) };
}

/**
 * Write 是不是新建了文件：先看 SDK 的结构化结果（`type: 'create' | 'update'`），没有时看确认文字
 * （未验证：「File created successfully」按 Claude Code 的输出习惯推断，没跑真实回合核对）。
 * 两样都没有时按覆盖处理：只少一个 `---` 头，diff 照样成立。
 */
function writeCreated(toolUseResult: unknown, resultText: string): boolean {
  const type = (toolUseResult as { type?: unknown } | null | undefined)?.type;
  if (type === 'create' || type === 'update') return type === 'create';
  return /^File created successfully/i.test(resultText.trim());
}

/** `tool_result.content`：字符串，或文本 / 图片块的数组。图片记成占位。 */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Block[])
    .map((c) => (c.type === 'text' ? String(c.text ?? '') : c.type === 'image' ? String(DriversCommon.imagePlaceholder()) : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Bash 的退出码。Claude Code 的 tool_result 不带结构化的退出码：成功记 0；失败时内容以「Exit code N」开头就取 N
 * （未验证：按 Claude Code 的输出习惯推断，没跑真实回合核对）。
 */
function bashExitCode(isError: boolean, output: string): number | null {
  if (!isError) return 0;
  const match = /^Exit code (\d+)/.exec(output.trim());
  return match ? Number(match[1]) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function oneLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}
