import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession } from '@baocut/harness';
import { ProviderFailure, TextCallCancelled, type TextProvider, type TextReply, type TextRun } from '@baocut/models';
import type { CallReporter } from '../usage-reporter.ts';
import {
  messageOf,
  openConfinedSession,
  runAgentTurn,
  turnFailure,
  type AgentModelSettings,
  type AgentReadiness,
  type AgentTurnOutcome,
} from './agent-turn.ts';
import { ProvidersAgent as PA } from '@baocut/protocol/messages/providers';

export interface AgentTextGeneratorOptions {
  providerId: string;
  label: string;
  /** 执行时再确认一次：排队期间被停用、退出登录或卸载的，不再开会话。 */
  ready: () => Promise<AgentReadiness>;
  /** 每次调用在这里建一个新的空目录作为会话的工作目录，调用结束删掉。 */
  workRoot: string;
  /** 一个回合的期限（毫秒）；到时中断并关闭会话，调用失败。 */
  turnTimeoutMs: number;
  /** 会话开起来之后的调用结束时的报告（用量账本，§6.10；没有账号，订阅登录时费用记为订阅内）。 */
  report?: CallReporter;
}

/** 「Agent 默认模型」的模型 id：不传模型，按 Agent 自己的配置选（Codex 读 `~/.codex/config.toml`）。其余模型 id 是 Agent 模型表里的原生 id。 */
export const AGENT_TEXT_DEFAULT_MODEL = 'text-gen';

/** 交给原生会话的开发者指令（模型读的，用英文）。调用方的 system 消息接在后面。 */
const INSTRUCTIONS = [
  'You are running as a non-interactive text generation backend for another application. Nobody can answer questions or approve anything.',
  'Answer the request in the user message directly. Your final message is returned verbatim to the application as the generated text.',
  'Do not run commands, read or write files, or browse the web: everything you need is in the messages.',
  'Do not add greetings, explanations or notes about what you did unless the request asks for them.',
].join('\n');

/**
 * 智能体作为文本 Provider 的执行者（架构设计 §6.9）。一次 `generateText` 是一个专用的原生会话，与生图的会话同样受限：
 *
 * - 不属于任何用户会话，不带视频上下文与历史，不给 MCP 服务；工作目录是这次调用新建的空目录（调用结束删掉），访问限定为
 *   只写这个目录（`confinement: 'cwd-write-only'`），会话请求的审批一律拒绝。
 * - 只发一个回合：调用方的 system 消息接在开发者指令后面；其余消息是回合的输入（只有一条 user 消息时原样放进去，多条时
 *   按角色标出）。结构化输出把 JSON Schema 写进指令，由 `finishText` 校验（Agent 不接受 schema 参数）。
 * - 模型与推理强度：`AGENT_TEXT_DEFAULT_MODEL` 不传模型，别的模型 id 原样交给 Agent；推理强度是冻结参数里换档后的那一档
 *   （`parameters.effort`，原生 id 与 `TextEffort` 同名），null 不传、用模型自己的默认。
 * - 输出是智能体最后一条文字回复；结构化输出时去掉包住整段的 Markdown 代码围栏。结束原因总是 `stop`，没有 token 用量。
 *   temperature、seed 与输出上限都不下发（模型描述如实声明，§6.4 的参数检查在提交时拒绝或注明）。
 * - 不重试，不换 Provider。并发上限 1（`AgentProviderSource.textConcurrency`）。
 */
export class AgentTextGenerator implements TextProvider {
  readonly id: string;
  readonly #options: AgentTextGeneratorOptions;
  /** 上次进程留下的工作目录：第一次调用前清掉一次。 */
  #swept: Promise<void> | null = null;

  constructor(options: AgentTextGeneratorOptions) {
    this.#options = options;
    this.id = options.providerId;
  }

  async generateText(run: TextRun, signal: AbortSignal): Promise<TextReply> {
    const { label, providerId, turnTimeoutMs } = this.#options;
    // 会话开起来才算一次真实调用；之前的检查失败与取消不记用量。订阅与否按执行前复核时的探测记。
    let startedAt: number | null = null;
    let subscribed = false;
    const report = (error?: unknown) => {
      if (startedAt === null || !this.#options.report || signal.aborted) return;
      this.#options.report({
        capability: 'generateText',
        modelId: run.modelId,
        source: run.source ?? 'inline',
        ...(run.ref ? { ref: run.ref } : {}),
        accountId: null,
        startedAt,
        units: {},
        ...(subscribed ? { cost: { kind: 'subscription' } as const } : {}),
        ...(error !== undefined ? { error } : {}),
      });
    };

    const ready = await this.#options.ready();
    if (!ready.ok) throw new ProviderFailure('unavailable', PA.unavailable({ label, message: ready.message }).text, { providerId, reason: ready.reason });
    subscribed = ready.subscribed;
    if (signal.aborted) throw new TextCallCancelled();

    const settings = settingsOf(run);
    const cwd = await this.#workDir();
    try {
      startedAt = Date.now();
      let session: AgentSession;
      try {
        session = await openConfinedSession(ready, cwd, instructionsOf(run), settings);
      } catch (error) {
        if (signal.aborted) throw new TextCallCancelled();
        const failure = new ProviderFailure('unavailable-remote', PA.sessionNotStarted({ label, error: messageOf(error) }).text, { providerId });
        report(failure);
        throw failure;
      }
      let outcome: AgentTurnOutcome;
      try {
        outcome = await runAgentTurn(session, turnTextOf(run), signal, turnTimeoutMs, settings);
      } finally {
        await session.close().catch(() => {});
      }
      if (outcome.result.kind === 'cancelled') throw new TextCallCancelled();
      const failure = turnFailure(outcome.result, { label, providerId, declined: outcome.declined, timeoutMs: turnTimeoutMs });
      if (failure) {
        report(failure);
        throw failure;
      }
      const last = outcome.replies.at(-1) ?? '';
      const reply: TextReply = {
        text: run.parameters.responseFormat.type === 'json' ? unfence(last) : last,
        finishReason: 'stop',
        usage: null,
        modelVersion: null,
        workerVersion: `${providerId} ${ready.version}`,
      };
      report();
      return reply;
    } finally {
      await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  }

  async #workDir(): Promise<string> {
    const root = this.#options.workRoot;
    this.#swept ??= fs.rm(root, { recursive: true, force: true }).catch(() => {});
    await this.#swept;
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    return fs.mkdtemp(path.join(root, 'call-'));
  }
}

/** 这次调用交给 Agent 的模型与推理强度。 */
function settingsOf(run: TextRun): AgentModelSettings {
  return { model: run.modelId === AGENT_TEXT_DEFAULT_MODEL ? null : run.modelId, effort: run.parameters.effort };
}

/** 开发者指令：固定的任务说明 + 结构化输出的 schema + 调用方的 system 消息。 */
function instructionsOf(run: TextRun): string {
  const parts = [INSTRUCTIONS];
  const format = run.parameters.responseFormat;
  if (format.type === 'json') {
    parts.push(
      'Your final message must be a single JSON value that conforms to the JSON Schema below, with no text before or after it and no Markdown code fences.',
      `JSON Schema${format.name ? ` (${format.name})` : ''}:\n${JSON.stringify(format.schema)}`,
    );
  }
  const system = run.parameters.messages.filter((m) => m.role === 'system' && m.content.trim().length > 0);
  if (system.length > 0) parts.push(`Instructions from the application:\n${system.map((m) => m.content).join('\n\n')}`);
  return parts.join('\n\n');
}

/** 回合的输入：只有一条 user 消息时原样放进去；多条时按角色标出，回复最后一条 user 消息。 */
function turnTextOf(run: TextRun): string {
  const messages = run.parameters.messages.filter((m) => m.role !== 'system');
  if (messages.length === 1 && messages[0]!.role === 'user') return messages[0]!.content;
  const lines = ['The conversation so far is below. Reply as the assistant to the last user message.'];
  for (const m of messages) lines.push(`<${m.role}>\n${m.content}\n</${m.role}>`);
  return lines.join('\n\n');
}

/** 去掉包住整段回复的 Markdown 代码围栏（```json … ```）；不是整段包住的原样返回。 */
function unfence(text: string): string {
  const match = /^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(text.trim());
  return match ? match[1]! : text;
}
