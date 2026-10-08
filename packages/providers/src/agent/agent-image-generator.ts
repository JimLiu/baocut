import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentDriver, AgentSession } from '@baocut/harness';
import {
  ProviderFailure,
  type GenerationAttempt,
  type GenerationOutputFile,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSink,
} from '@baocut/models';
import type { ProviderUnavailableReason } from '@baocut/protocol';
import { IMAGE_MEDIA } from '../adapter.ts';
import type { CallReporter } from '../usage-reporter.ts';
import { ProvidersAgent as PA } from '@baocut/protocol/messages/providers';

/** 执行前的复核：启用了、Driver 可用、版本够。 */
export type AgentReadiness =
  | {
      ok: true;
      driver: AgentDriver;
      version: string;
      /** 用户手动指定的可执行文件；null 由 Driver 自己找。 */
      executable?: string | null;
    }
  | { ok: false; reason: ProviderUnavailableReason; message: string };

export interface AgentImageGeneratorOptions {
  providerId: string;
  label: string;
  /** 执行时再确认一次：排队期间被停用、退出登录或卸载的，不再开会话。 */
  ready: () => Promise<AgentReadiness>;
  /** 交给原生会话的开发者指令：任务、输出文件名与禁止事项。 */
  instructions: string;
  /** 回合的输入：提示词原样放进去。 */
  turnText: (prompt: string) => string;
  /** 约定的输出文件名（相对工作目录）。 */
  outputName: string;
  /** 一个回合的期限（毫秒）；到时中断并关闭会话，任务失败。 */
  turnTimeoutMs: number;
  /** 会话开起来之后的调用结束时的报告（用量账本，§6.10；没有账号，费用未知）。 */
  report?: CallReporter;
}

/** 错误说明里带上的回复摘录（不是输出，只帮用户看懂为什么没有图）。 */
const REPLY_EXCERPT = 300;
/** 在工作目录里找图片时最多往下几层。 */
const MAX_DEPTH = 3;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

type TurnResult =
  | { kind: 'completed' }
  | { kind: 'failed'; message: string }
  | { kind: 'interrupted' }
  | { kind: 'exited'; message: string }
  | { kind: 'timeout' }
  | { kind: 'cancelled' };

/**
 * 智能体作为图片 Provider 的执行者（架构设计 §6.9）。一次 `generate` 是一个专用的原生会话：
 *
 * - 不属于任何用户会话，不带视频上下文与历史，不给 MCP 服务（没有 BaoCut 的工具）；工作目录是这个 Job 的 staging，
 *   访问限定为只写这个目录（`confinement: 'cwd-write-only'`），会话请求的审批一律拒绝（没有人来批）。
 * - 只发一个回合：开发者指令说明任务，输入是提示词。回合结束（完成、失败、超时、取消）后会话关闭。
 * - 输出是会话写进 staging 的图片文件：有约定的文件名就取它，否则取唯一的那张，有多张就全部交出去、由 JobManager 的张数
 *   校验拒绝。只收普通文件（不跟随符号链接）。声明的媒体类型是请求的格式；文件头、解码与尺寸由 JobManager 校验。
 * - 智能体的文字回复不是输出：没有图片就失败（`PROVIDER_REJECTED`，`details.reason: 'no-image'`），只把回复的摘录放进
 *   错误详情。不重试，不换 Provider。
 */
export class AgentImageGenerator implements GenerationProvider {
  readonly id: string;
  readonly #options: AgentImageGeneratorOptions;
  readonly #inflight = new Map<AbortController, Promise<unknown>>();

  constructor(options: AgentImageGeneratorOptions) {
    this.#options = options;
    this.id = options.providerId;
  }

  async generate(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort();
    // 进入生成阶段（要开会话了）才算一次真实调用；之前的检查失败与取消不记用量。
    let startedAt: number | null = null;
    const tracked: GenerationSink = {
      generating: () => {
        startedAt ??= Date.now();
        sink.generating();
      },
      progress: (done, total, unit) => sink.progress(done, total, unit),
      ...(sink.warning ? { warning: (warning) => sink.warning!(warning) } : {}),
    };
    const report = (outputs: number, error?: unknown) => {
      if (startedAt === null || !this.#options.report || controller.signal.aborted) return;
      this.#options.report({
        capability: 'generateImage',
        modelId: run.modelId,
        source: 'job',
        ref: { jobId: run.jobId },
        accountId: null,
        startedAt,
        units: outputs > 0 ? { images: outputs } : {},
        ...(error !== undefined ? { error } : {}),
      });
    };
    const running = this.#run(run, tracked, controller.signal);
    this.#inflight.set(controller, running);
    try {
      const attempt = await running;
      if (attempt.outcome === 'completed') report(attempt.outputs.length);
      return attempt;
    } catch (error) {
      report(0, error);
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.#inflight.delete(controller);
    }
  }

  /** 正常停止：中断在途的回合、关闭会话，等它们收尾。 */
  async close(): Promise<void> {
    const running = [...this.#inflight.entries()];
    for (const [controller] of running) controller.abort();
    await Promise.allSettled(running.map(([, promise]) => promise));
  }

  async #run(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    const { label, providerId } = this.#options;
    const parameters = run.parameters;
    if (parameters.capability !== 'generateImage') {
      throw new ProviderFailure('unavailable', PA.imagesOnly({ label }).text, { providerId });
    }
    // 参数在提交时按模型描述检查过（尺寸、seed、张数、格式都不接受）；这里再挡一次，不把它们悄悄丢掉。
    if (parameters.count !== 1 || parameters.size !== null || parameters.seed !== null || parameters.format !== 'png') {
      throw new ProviderFailure('rejected', PA.onePngOnly({ label }).text, { code: 'PROVIDER_REJECTED', providerId });
    }
    if (signal.aborted) return { outcome: 'cancelled' };

    const ready = await this.#options.ready();
    if (!ready.ok) throw new ProviderFailure('unavailable', PA.unavailable({ label, message: ready.message }).text, { providerId, reason: ready.reason });
    if (signal.aborted) return { outcome: 'cancelled' };

    sink.generating();
    let session: AgentSession;
    try {
      session = await ready.driver.createSession({
        cwd: run.staging,
        // 受限会话（confinement）的策略固定，访问模式不起作用；模型与强度用 Agent 自己的默认。
        accessMode: 'fullAccess',
        model: null,
        effort: null,
        executable: ready.executable ?? null,
        resume: null,
        developerInstructions: this.#options.instructions,
        confinement: 'cwd-write-only',
      });
    } catch (error) {
      if (signal.aborted) return { outcome: 'cancelled' };
      throw new ProviderFailure('unavailable-remote', PA.sessionNotStarted({ label, error: messageOf(error) }).text, { providerId });
    }

    let replies: string[] = [];
    let declined = 0;
    let result: TurnResult;
    try {
      ({ result, replies, declined } = await this.#turn(session, this.#options.turnText(parameters.prompt), signal));
    } finally {
      await session.close().catch(() => {});
    }

    const facts = { providerId, ...(declined > 0 ? { declinedApprovals: declined } : {}) };
    switch (result.kind) {
      case 'cancelled':
        return { outcome: 'cancelled' };
      case 'timeout':
        throw new ProviderFailure(
          'unavailable-remote',
          PA.timedOut({ label, minutes: Math.round(this.#options.turnTimeoutMs / 60_000) }).text,
          { ...facts, reason: 'timeout' },
        );
      case 'exited':
        throw new ProviderFailure('unavailable-remote', PA.exited({ label, message: result.message }).text, { ...facts, reason: 'exited' });
      case 'failed':
      case 'interrupted':
        throw new ProviderFailure('rejected', PA.notCompleted({ label, reason: result.kind === 'failed' ? result.message : PA.turnInterrupted() }).text, {
          code: 'PROVIDER_REJECTED',
          ...facts,
          reason: result.kind === 'failed' ? 'turn-failed' : 'turn-interrupted',
        });
      case 'completed':
        break;
    }

    const images = await collectImages(run.staging);
    if (images.length === 0) {
      const reply = excerpt(replies.join('\n'));
      throw new ProviderFailure('rejected', (reply ? PA.noImageReply({ label, reply }) : PA.noImage({ label })).text, {
        code: 'PROVIDER_REJECTED',
        ...facts,
        reason: 'no-image',
        ...(reply ? { reply } : {}),
      });
    }
    const chosen = images.includes(this.#options.outputName) ? [this.#options.outputName] : images;
    const outputs: GenerationOutputFile[] = [];
    for (const relative of chosen) outputs.push(await describeOutput(run.staging, relative, IMAGE_MEDIA.png.mediaType));
    sink.progress(outputs.length, parameters.count);
    return { outcome: 'completed', outputs, workerVersion: `${providerId} ${ready.version}` };
  }

  /** 发一个回合，等它结束、失败、会话退出、超时或取消。取消与超时时请求中断（会话随后关闭）。 */
  async #turn(
    session: AgentSession,
    text: string,
    signal: AbortSignal,
  ): Promise<{ result: TurnResult; replies: string[]; declined: number }> {
    const replies: string[] = [];
    const errors: string[] = [];
    let declined = 0;
    let settle!: (result: TurnResult) => void;
    const done = new Promise<TurnResult>((resolve) => (settle = resolve));
    const unsubscribe = session.subscribe((event) => {
      switch (event.type) {
        case 'item.completed':
          if (event.item.kind === 'agent-message' && event.item.text.trim()) replies.push(event.item.text.trim());
          return;
        case 'approval.requested':
          // 没有人来批：越界的动作一律拒绝。
          declined++;
          void session.respondToApproval(event.approvalId, { decision: 'decline' }).catch(() => {});
          return;
        case 'session.error':
          if (!event.willRetry) errors.push(event.message);
          return;
        case 'turn.completed':
          if (event.outcome === 'completed') settle({ kind: 'completed' });
          else if (event.outcome === 'interrupted') settle({ kind: 'interrupted' });
          else settle({ kind: 'failed', message: event.error ?? errors.at(-1) ?? PA.unknownError().text });
          return;
        case 'session.exited':
          settle({ kind: 'exited', message: event.error ?? errors.at(-1) ?? PA.processExited().text });
          return;
        default:
          return;
      }
    });
    const onAbort = () => settle({ kind: 'cancelled' });
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => settle({ kind: 'timeout' }), this.#options.turnTimeoutMs);
    let turnId: string | null = null;
    try {
      if (signal.aborted) return { result: { kind: 'cancelled' }, replies, declined };
      try {
        turnId = (await session.startTurn({ text }, { accessMode: 'fullAccess', model: null, effort: null })).turnId;
      } catch (error) {
        settle({ kind: 'exited', message: PA.turnNotStarted({ error: messageOf(error) }).text });
      }
      const result = await done;
      if ((result.kind === 'cancelled' || result.kind === 'timeout') && turnId) await session.interrupt(turnId).catch(() => {});
      return { result, replies, declined };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
    }
  }
}

/** staging 里的图片候选：普通文件（不跟随符号链接），扩展名或文件头是图片。隐藏文件不算。按路径排序。 */
async function collectImages(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(file, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (IMAGE_EXTENSION.test(entry.name) || (await looksLikeImage(file))) found.push(path.relative(root, file));
    }
  };
  await walk(root, 0);
  return found.sort();
}

async function looksLikeImage(file: string): Promise<boolean> {
  const handle = await fs.open(file, 'r').catch(() => null);
  if (!handle) return false;
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await handle.read(head, 0, 12, 0);
    const b = head.subarray(0, bytesRead);
    return (
      (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
      (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
      (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') ||
      (b.length >= 4 && b.toString('latin1', 0, 4) === 'GIF8')
    );
  } finally {
    await handle.close();
  }
}

async function describeOutput(staging: string, relative: string, mediaType: string): Promise<GenerationOutputFile> {
  const bytes = await fs.readFile(path.join(staging, relative));
  return { path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mediaType };
}

function excerpt(text: string): string {
  const chars = [...text.trim()];
  return chars.length > REPLY_EXCERPT ? `${chars.slice(0, REPLY_EXCERPT).join('')}…` : chars.join('');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
