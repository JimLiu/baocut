import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ModelInfo,
  Options,
  PermissionMode,
  PermissionResult,
  SDKAssistantMessageError,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { inspectClaude, type ClaudeAuthStatus, type ClaudeInstall } from '../claude/claude-binary.ts';
import type { ClaudeQuery, ClaudeQueryFactory, ClaudeQueryParams } from '../claude/claude-query.ts';

/**
 * 测试用的假 Claude：
 *
 * - `createFakeClaude()` 给出一个 Query 工厂，交给 `ClaudeDriver` / `ClaudeSession`。它产出的假 Query 本身是 async generator，
 *   带 `interrupt`、`setPermissionMode`、`setModel`、`supportedModels`、`streamInput`、`close`，按回合脚本回放 SDK 消息，
 *   能在 `canUseTool` 处停下等 BaoCut 答复。不起进程、不联网、不需要登录。
 * - `createFakeClaudeCli()` 是探测用的假 claude 可执行文件，只回答 `--version` 与 `auth status`。
 */

// ---- 假 Query ----

/** 一轮怎么回应。每收到一条「空闲时到达」的用户消息跑一次；回合中途到达的（steer）记进 `steered`。 */
export type FakeTurnScript = (turn: FakeTurn) => Promise<void> | void;

export interface FakeClaudeOptions {
  models?: ModelInfo[];
  /** 新会话的 id；默认随机。 */
  sessionId?: string;
  /** 能恢复的原生会话；不在其中的 `resume` 会收到「No conversation found」。默认都能恢复。 */
  resumable?: (sessionId: string) => boolean;
  /** 拒绝的权限模式：`setPermissionMode` 抛错（模拟 CLI 不支持 auto）。 */
  rejectModes?: PermissionMode[];
  turn?: FakeTurnScript;
}

export const FAKE_CLAUDE_MODELS: ModelInfo[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Default (recommended)',
    description: 'Use the default model (currently Opus 5.5) · $4/$20 per Mtok',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'opus',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus',
    description: 'Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'claude-fable-5-1[1m]',
    resolvedModel: 'claude-fable-5-1',
    displayName: 'Fable 5.1',
    description: 'Fable 5.1 · Most capable for your hardest and longest-running tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5-5',
    displayName: 'Sonnet',
    description: 'Sonnet 5.5 · Efficient for routine tasks · $2/$10 per Mtok',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'max'],
    supportsAutoMode: true,
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest for quick answers · $1/$5 per Mtok',
  },
];

export interface FakeClaude {
  factory: ClaudeQueryFactory;
  /** 按创建顺序的所有假 Query（会话重启、探测各起一个）。 */
  queries: FakeClaudeQuery[];
  last(): FakeClaudeQuery;
  /** 换掉之后各轮的脚本。 */
  onTurn(script: FakeTurnScript): void;
}

const DEFAULT_TURN: FakeTurnScript = (turn) => {
  turn.text('done');
  turn.result();
};

export function createFakeClaude(options: FakeClaudeOptions = {}): FakeClaude {
  const queries: FakeClaudeQuery[] = [];
  let script = options.turn ?? DEFAULT_TURN;
  return {
    factory: (params) => {
      const query = new FakeClaudeQuery(params, options, () => script);
      queries.push(query);
      return query;
    },
    queries,
    last() {
      const query = queries.at(-1);
      if (!query) throw new Error('还没有起过 Query');
      return query;
    },
    onTurn(next) {
      script = next;
    },
  };
}

/** 一个回合的脚本上下文。 */
export interface FakeTurn {
  readonly message: SDKUserMessage;
  readonly query: FakeClaudeQuery;
  /** 这一轮里追加（steer）进来的消息。 */
  readonly steered: SDKUserMessage[];
  emit(message: SDKMessage): void;
  /** 一段文字回复：先流式发两段 delta，再发整块的 assistant 消息。 */
  text(text: string): void;
  thinking(text: string): void;
  /** 发起一次工具调用（assistant 的 tool_use 块），返回它的 id。 */
  toolUse(name: string, input: Record<string, unknown>, id?: string): string;
  toolResult(id: string, content: string, isError?: boolean): void;
  /** 像 CLI 那样问 `canUseTool`，等 BaoCut 答复。中断会撤回这次请求（signal abort）。 */
  ask(name: string, input: Record<string, unknown>, toolUseId?: string): Promise<PermissionResult | null>;
  /** CLI 合成的出错回复（`SDKAssistantMessage.error`）。 */
  apiError(error: SDKAssistantMessageError, text: string): void;
  result(patch?: Record<string, unknown>): void;
  /** 等到这一轮里 `interrupt()` 被调用（已经调用过就立即返回）。 */
  interrupted(): Promise<void>;
  /** 等到收到一条追加的消息。 */
  nextSteer(): Promise<SDKUserMessage>;
}

export class FakeClaudeQuery implements ClaudeQuery, AsyncIterator<SDKMessage, void> {
  readonly options: Options;
  readonly sessionId: string;
  /** 收到的所有用户消息（含追加的）。 */
  readonly inputs: SDKUserMessage[] = [];
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  closed = false;
  inputEnded = false;

  readonly #config: FakeClaudeOptions;
  readonly #script: () => FakeTurnScript;
  readonly #out: SDKMessage[] = [];
  readonly #readers: Array<{ resolve: (r: IteratorResult<SDKMessage, void>) => void; reject: (e: unknown) => void }> = [];
  #outDone = false;
  #outError: unknown = null;
  #initialized = false;
  #busy: FakeTurnState | null = null;
  readonly #pendingTurns: SDKUserMessage[] = [];
  readonly #asks = new Set<AbortController>();
  #messageSeq = 0;

  constructor(params: ClaudeQueryParams, config: FakeClaudeOptions, script: () => FakeTurnScript) {
    this.options = params.options;
    this.#config = config;
    this.#script = script;
    this.sessionId = params.options.resume ?? config.sessionId ?? randomUUID();
    void this.#consume(params.prompt);
  }

  // -- AsyncGenerator 的形状 --

  [Symbol.asyncIterator](): this {
    return this;
  }

  next(): Promise<IteratorResult<SDKMessage, void>> {
    if (this.#out.length > 0) return Promise.resolve({ value: this.#out.shift()!, done: false });
    if (this.#outError) return Promise.reject(this.#outError);
    if (this.#outDone) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.#readers.push({ resolve, reject }));
  }

  async return(): Promise<IteratorResult<SDKMessage, void>> {
    this.close();
    return { value: undefined, done: true };
  }

  async throw(error: unknown): Promise<IteratorResult<SDKMessage, void>> {
    this.close();
    throw error;
  }

  // -- Query 的控制方法 --

  async interrupt(): Promise<unknown> {
    this.calls.push({ method: 'interrupt', args: [] });
    for (const ask of this.#asks) ask.abort();
    const busy = this.#busy;
    if (busy) {
      busy.interrupted = true;
      for (const wake of busy.interruptWaiters.splice(0)) wake();
    }
    return { still_queued: [] };
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.calls.push({ method: 'setPermissionMode', args: [mode] });
    if (this.#config.rejectModes?.includes(mode)) throw new Error(`permission mode ${mode} is not available`);
  }

  async setModel(model?: string): Promise<void> {
    this.calls.push({ method: 'setModel', args: [model] });
  }

  async supportedModels(): Promise<ModelInfo[]> {
    this.calls.push({ method: 'supportedModels', args: [] });
    return this.#config.models ?? FAKE_CLAUDE_MODELS;
  }

  async streamInput(stream: AsyncIterable<SDKUserMessage>): Promise<void> {
    this.calls.push({ method: 'streamInput', args: [] });
    for await (const message of stream) this.#receive(message);
  }

  close(): void {
    if (this.closed) return;
    this.calls.push({ method: 'close', args: [] });
    this.closed = true;
    for (const ask of this.#asks) ask.abort();
    this.end();
  }

  /** 进程正常退出：输出流结束。 */
  end(): void {
    this.#outDone = true;
    for (const reader of this.#readers.splice(0)) reader.resolve({ value: undefined, done: true });
  }

  /** 进程出错退出：输出流抛错。 */
  crash(error: Error): void {
    this.#outError = error;
    for (const reader of this.#readers.splice(0)) reader.reject(error);
  }

  /** 方法被调用过的参数，按顺序。 */
  callsOf(method: string): unknown[][] {
    return this.calls.filter((c) => c.method === method).map((c) => c.args);
  }

  emit(message: SDKMessage): void {
    if (this.#outDone || this.#outError) return;
    const reader = this.#readers.shift();
    if (reader) reader.resolve({ value: message, done: false });
    else this.#out.push(message);
  }

  // -- 回合 --

  async #consume(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of prompt) this.#receive(message);
    this.inputEnded = true;
  }

  #receive(message: SDKUserMessage): void {
    if (this.closed) return;
    this.inputs.push(message);
    if (this.#busy) {
      this.#busy.steered.push(message);
      const wake = this.#busy.steerWaiters.shift();
      if (wake) {
        this.#busy.steersTaken += 1;
        wake(message);
      }
      return;
    }
    this.#pendingTurns.push(message);
    if (this.#pendingTurns.length === 1) void this.#runTurns();
  }

  async #runTurns(): Promise<void> {
    while (this.#pendingTurns.length > 0 && !this.closed) {
      const message = this.#pendingTurns[0]!;
      if (!this.#initialized) {
        const resume = this.options.resume;
        if (resume && this.#config.resumable && !this.#config.resumable(resume)) {
          this.emit(resultMessage(this.sessionId, {
            subtype: 'error_during_execution',
            is_error: true,
            errors: [`No conversation found with session ID: ${resume}`],
          }));
          this.#pendingTurns.shift();
          continue;
        }
        this.#initialized = true;
        this.emit({
          type: 'system',
          subtype: 'init',
          session_id: this.sessionId,
          model: this.options.model ?? 'claude-opus-5-5',
          permissionMode: this.options.permissionMode ?? 'default',
          tools: [],
          mcp_servers: Object.keys(this.options.mcpServers ?? {}).map((name) => ({ name, status: 'connected' })),
          cwd: this.options.cwd ?? '',
        } as unknown as SDKMessage);
      }
      const state: FakeTurnState = { steered: [], steersTaken: 0, steerWaiters: [], interrupted: false, interruptWaiters: [] };
      this.#busy = state;
      try {
        await this.#script()(this.#turn(message, state));
      } catch (error) {
        this.crash(error instanceof Error ? error : new Error(String(error)));
      }
      this.#busy = null;
      this.#pendingTurns.shift();
    }
  }

  #turn(message: SDKUserMessage, state: FakeTurnState): FakeTurn {
    const query = this;
    const sid = this.sessionId;
    return {
      message,
      query,
      steered: state.steered,
      emit: (m) => query.emit(m),
      text: (text) => query.#block('text', text),
      thinking: (text) => query.#block('thinking', text),
      toolUse(name, input, id = `toolu_${randomUUID().slice(0, 8)}`) {
        query.emit(assistantMessage(sid, query.#nextMessageId(), [{ type: 'tool_use', id, name, input }]));
        return id;
      },
      toolResult(id, content, isError = false) {
        query.emit({
          type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
          parent_tool_use_id: null,
          session_id: sid,
        } as unknown as SDKMessage);
      },
      async ask(name, input, toolUseId = `toolu_${randomUUID().slice(0, 8)}`) {
        const canUseTool = query.options.canUseTool;
        if (!canUseTool) throw new Error('没有 canUseTool');
        const controller = new AbortController();
        query.#asks.add(controller);
        try {
          return await canUseTool(name, input, { signal: controller.signal, toolUseID: toolUseId, requestId: randomUUID() });
        } finally {
          query.#asks.delete(controller);
        }
      },
      apiError(error, text) {
        query.emit({ ...assistantMessage(sid, query.#nextMessageId(), [{ type: 'text', text }]), error } as unknown as SDKMessage);
      },
      result(patch = {}) {
        query.emit(resultMessage(sid, patch));
      },
      interrupted() {
        if (state.interrupted) return Promise.resolve();
        return new Promise<void>((resolve) => state.interruptWaiters.push(resolve));
      },
      nextSteer() {
        const ready = state.steered[state.steersTaken];
        if (ready) {
          state.steersTaken += 1;
          return Promise.resolve(ready);
        }
        return new Promise<SDKUserMessage>((resolve) => state.steerWaiters.push(resolve));
      },
    };
  }

  #block(kind: 'text' | 'thinking', text: string): void {
    const id = this.#nextMessageId();
    const half = Math.ceil(text.length / 2);
    const stream = (event: Record<string, unknown>) =>
      this.emit({ type: 'stream_event', event, parent_tool_use_id: null, uuid: randomUUID(), session_id: this.sessionId } as unknown as SDKMessage);
    stream({ type: 'message_start', message: { id } });
    stream({ type: 'content_block_start', index: 0, content_block: kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' } });
    for (const part of [text.slice(0, half), text.slice(half)]) {
      if (!part) continue;
      stream({
        type: 'content_block_delta',
        index: 0,
        delta: kind === 'text' ? { type: 'text_delta', text: part } : { type: 'thinking_delta', thinking: part },
      });
    }
    stream({ type: 'content_block_stop', index: 0 });
    this.emit(assistantMessage(this.sessionId, id, [kind === 'text' ? { type: 'text', text } : { type: 'thinking', thinking: text, signature: 'sig' }]));
  }

  #nextMessageId(): string {
    this.#messageSeq += 1;
    return `msg_${this.#messageSeq}`;
  }
}

interface FakeTurnState {
  steered: SDKUserMessage[];
  steersTaken: number;
  steerWaiters: Array<(message: SDKUserMessage) => void>;
  interrupted: boolean;
  interruptWaiters: Array<() => void>;
}

function assistantMessage(sessionId: string, id: string, content: unknown[]): SDKMessage {
  return {
    type: 'assistant',
    message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content, stop_reason: null, stop_sequence: null, usage: {} },
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: sessionId,
  } as unknown as SDKMessage;
}

function resultMessage(sessionId: string, patch: Record<string, unknown>): SDKMessage {
  const subtype = (patch.subtype as string | undefined) ?? 'success';
  return {
    type: 'result',
    subtype,
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: subtype !== 'success',
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: {},
    modelUsage: {},
    permission_denials: [],
    ...(subtype === 'success' ? { result: 'done' } : { errors: [] }),
    uuid: randomUUID(),
    session_id: sessionId,
    ...patch,
  } as unknown as SDKMessage;
}

// ---- 探测用的假 claude 可执行文件 ----

export interface FakeClaudeCliScenario {
  /** false：`locate` 返回 null（没有安装）。 */
  installed: boolean;
  /** `--version` 输出的版本；null：`--version` 以非 0 退出。 */
  version: string | null;
  /** `auth status` 输出的 JSON；null：没有这个子命令（旧版本）。 */
  auth: ClaudeAuthStatus | null;
}

export interface FakeClaudeCli {
  dir: string;
  command: string;
  locate: () => Promise<ClaudeInstall | null>;
  scenario(patch: Partial<FakeClaudeCliScenario>): void;
  /** 每次调用的参数。 */
  calls(): string[][];
}

const DEFAULT_CLI: FakeClaudeCliScenario = {
  installed: true,
  version: '2.1.284',
  auth: { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', subscriptionType: 'max', email: 'someone@example.com' },
};

const CLI_ENTRY = fileURLToPath(new URL('./fake-claude-cli.ts', import.meta.url));

export async function createFakeClaudeCli(dir: string, scenario: Partial<FakeClaudeCliScenario> = {}): Promise<FakeClaudeCli> {
  await fs.mkdir(dir, { recursive: true });
  const command = path.join(dir, 'claude');
  // 假 claude 是 .ts：22.18 之前的 Node 要显式打开类型剥离（之后默认打开，这个标志无害）；环境被收窄过，不能靠 NODE_OPTIONS。
  await fs.writeFile(command, `#!/bin/sh\nexec "${process.execPath}" --experimental-strip-types --no-warnings "${CLI_ENTRY}" "$@"\n`, { mode: 0o755 });
  const scenarioFile = path.join(dir, 'scenario.json');
  const logFile = path.join(dir, 'log.jsonl');
  let current: FakeClaudeCliScenario = { ...DEFAULT_CLI, ...scenario };
  const write = () => writeFileSync(scenarioFile, JSON.stringify(current));
  write();
  // 只给假 claude 它需要的环境：PATH（shell 要）与它自己的目录。CLAUDE_CONFIG_DIR 指向空目录，不读本机的 ~/.claude。
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', FAKE_CLAUDE_DIR: dir, CLAUDE_CONFIG_DIR: path.join(dir, 'config') };
  return {
    dir,
    command,
    locate: async () => (current.installed ? inspectClaude(command, env) : null),
    scenario(patch) {
      current = { ...current, ...patch };
      write();
    },
    calls() {
      let text = '';
      try {
        text = readFileSync(logFile, 'utf8');
      } catch {
        return [];
      }
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { args: string[] }).args);
    },
  };
}
