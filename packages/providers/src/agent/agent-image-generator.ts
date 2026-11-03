import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentSession } from '@baocut/harness';
import {
  ProviderFailure,
  type GenerationAttempt,
  type GenerationOutputFile,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSink,
} from '@baocut/models';
import { IMAGE_MEDIA } from '../adapter.ts';
import type { CallReporter } from '../usage-reporter.ts';
import { excerpt, messageOf, openConfinedSession, runAgentTurn, turnFailure, type AgentReadiness, type AgentTurnOutcome } from './agent-turn.ts';
import { ProvidersAgent as PA } from '@baocut/protocol/messages/providers';

export type { AgentReadiness } from './agent-turn.ts';

export interface AgentImageGeneratorOptions {
  providerId: string;
  label: string;
  /** 执行时再确认一次：排队期间被停用、退出登录或卸载的，不再开会话。 */
  ready: () => Promise<AgentReadiness>;
  /** 交给原生会话的开发者指令：任务与禁止事项。 */
  instructions: string;
  /** 回合的输入：提示词原样放进去。 */
  turnText: (prompt: string) => string;
  /** 图片在 staging 里的文件名（相对工作目录），由这里写入。 */
  outputName: string;
  /** 一个回合的期限（毫秒）；到时中断并关闭会话，任务失败。 */
  turnTimeoutMs: number;
  /** 会话开起来之后的调用结束时的报告（用量账本，§6.10；没有账号，订阅登录时费用记为订阅内）。 */
  report?: CallReporter;
}

/**
 * 智能体作为图片 Provider 的执行者（架构设计 §6.9）。一次 `generate` 是一个专用的原生会话：
 *
 * - 不属于任何用户会话，不带视频上下文与历史，不给 MCP 服务（没有 BaoCut 的工具）；工作目录是这个 Job 的 staging，
 *   访问限定为只写这个目录（`confinement: 'cwd-write-only'`），会话请求的审批一律拒绝（没有人来批）。
 * - 只发一个回合：开发者指令说明任务，输入是提示词。回合结束（完成、失败、超时、取消）后会话关闭。
 * - 输出只来自这个回合：原生事件报告的、内建工具生成并保存的那张图片（`AgentTurnOutcome.generatedImages`，几张时取最后一张），
 *   由这里抄进 staging。智能体自己写进 staging 的文件一律不算：它可能是从别处找来的旧图。只收普通文件（不跟随符号链接）。
 *   声明的媒体类型是请求的格式；文件头、解码与尺寸由 JobManager 校验。
 * - 智能体的文字回复不是输出：回合里没有生成图片就失败（`PROVIDER_REJECTED`，`details.reason: 'no-image'`），生成了但读不到
 *   也失败（`image-unavailable`），只把回复的摘录放进错误详情。不重试，不换 Provider。
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
    // 执行前复核时探测到的账号是不是订阅：按这一次调用记，不按报告时的最新探测（回合可以跑 10 分钟）。
    const call = { subscribed: false };
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
        ...(call.subscribed ? { cost: { kind: 'subscription' } as const } : {}),
        ...(error !== undefined ? { error } : {}),
      });
    };
    const running = this.#run(run, tracked, controller.signal, call);
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

  async #run(run: GenerationRun, sink: GenerationSink, signal: AbortSignal, call: { subscribed: boolean }): Promise<GenerationAttempt> {
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
    call.subscribed = ready.subscribed;
    if (signal.aborted) return { outcome: 'cancelled' };

    sink.generating();
    let session: AgentSession;
    try {
      session = await openConfinedSession(ready, run.staging, this.#options.instructions);
    } catch (error) {
      if (signal.aborted) return { outcome: 'cancelled' };
      throw new ProviderFailure('unavailable-remote', PA.sessionNotStarted({ label, error: messageOf(error) }).text, { providerId });
    }

    let outcome: AgentTurnOutcome;
    try {
      outcome = await runAgentTurn(session, this.#options.turnText(parameters.prompt), signal, this.#options.turnTimeoutMs);
    } finally {
      await session.close().catch(() => {});
    }
    const { result, replies, declined, generatedImages } = outcome;
    if (result.kind === 'cancelled') return { outcome: 'cancelled' };
    const failure = turnFailure(result, { label, providerId, declined, timeoutMs: this.#options.turnTimeoutMs });
    if (failure) throw failure;
    const facts = { providerId, ...(declined > 0 ? { declinedApprovals: declined } : {}) };

    const reply = excerpt(replies.join('\n'));
    const replyFact = reply ? { reply } : {};
    if (generatedImages.length === 0) {
      throw new ProviderFailure('rejected', (reply ? PA.noImageReply({ label, reply }) : PA.noImage({ label })).text, {
        code: 'PROVIDER_REJECTED',
        ...facts,
        reason: 'no-image',
        ...replyFact,
      });
    }
    const saved = generatedImages.findLast((file) => file !== null) ?? null;
    if (saved === null || !(await adoptImage(saved, path.join(run.staging, this.#options.outputName)))) {
      throw new ProviderFailure('rejected', PA.imageUnavailable({ label }).text, {
        code: 'PROVIDER_REJECTED',
        ...facts,
        reason: 'image-unavailable',
        ...(saved ? { savedPath: saved } : {}),
        ...replyFact,
      });
    }
    const outputs: GenerationOutputFile[] = [await describeOutput(run.staging, this.#options.outputName, IMAGE_MEDIA.png.mediaType)];
    sink.progress(outputs.length, parameters.count);
    return { outcome: 'completed', outputs, workerVersion: `${providerId} ${ready.version}` };
  }
}

/**
 * 把原生侧保存的图片抄到 `target`：只收普通文件（不跟随符号链接）。`target` 上智能体留下的东西先删掉（它可能是指向外面的符号链接）。
 * 读不到时返回 false。
 */
async function adoptImage(source: string, target: string): Promise<boolean> {
  try {
    if (!(await fs.lstat(source)).isFile()) return false;
    await fs.rm(target, { recursive: true, force: true });
    await fs.copyFile(source, target, fsConstants.COPYFILE_EXCL);
    return true;
  } catch {
    return false;
  }
}

async function describeOutput(staging: string, relative: string, mediaType: string): Promise<GenerationOutputFile> {
  const bytes = await fs.readFile(path.join(staging, relative));
  return { path: relative, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mediaType };
}
