/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/pi/agent.ts 的回合生命周期（一次 prompt 到 agent_settled 为一轮，旧版没有
 * agent_settled 时以 agent_end 收尾；失败原因取最后一条助手消息的 errorMessage；中断先 clear_queue 再 abort；
 * steer 回「Unknown command: steer」时视为不支持；图片只在模型的 input 含 image 时随消息发）与 cli-runtime.ts 的启动参数。
 * 改成 BaoCut 的 AgentSession：开发者指令经 --append-system-prompt 文件、BaoCut 的 MCP 服务经临时扩展 registerMcpServer 注入，
 * 扩展的提问（extension_ui_request）一律取消并提示，恢复句柄是 pi 的会话文件。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentModeLabel, newId, RpcError, type AgentErrorCode, type DriverId, type DriverProbe, type Id, type Localized } from '@baocut/protocol';
import { DriversCommon, DriversPi } from '@baocut/protocol/messages/agent-drivers';
import {
  MCP_TOOL_CALL_TIMEOUT_MS,
  type AgentEvent,
  type AgentInput,
  type AgentPersistenceHandle,
  type AgentSession,
  type ApprovalResponse,
  type CreateSessionOptions,
  type InterruptReceipt,
  type Logger,
  type McpServerSpec,
  type TurnSettings,
} from '@baocut/harness';
import { agentError } from '../acp/acp-session.ts';
import { refField, textOf, type DriverText } from '../driver-text.ts';
import { PI_ENV, type PiInstall } from './pi-binary.ts';
import { PiItemMapper } from './pi-items.ts';
import { isPiThinkingLevel, parseModelReference, piModelId, piModelTakesImages, type PiModel } from './pi-models.ts';
import { PiRpcProcess, piErrorMessage } from './pi-rpc-process.ts';

/** Driver id（`BUILTIN_DRIVER_IDS` 里的 `pi`）。 */
export const PI_DRIVER_ID: DriverId = 'pi';

/**
 * pi 没有逐次询问的通道（它的工具执行前从不问人），BaoCut 只能让它在「完全访问」下运行。
 * 不是完全访问时会话里的提示；文字与原型 `designs/baocut/app/data.js` 里 Pi 的 caveat 一致（主语换成 Pi）。随语言变，用的时候再取。
 */
export function piAccessWarning(): Localized {
  return DriversPi.fullAccessOnly({ mode: agentModeLabel('fullAccess') });
}

/** steer 与 follow_up 都有（pi 0.84.4 起）；没有审批通道；会话文件可以恢复；图片随消息发（模型不收图片时退成路径提示）。 */
export const PI_CAPABILITIES: DriverProbe['capabilities'] = { steer: true, approvals: false, resume: true, images: true };

/** agent_end 之后等 agent_settled 的时间：旧版 pi 不发 agent_settled，过了这段还没有新的动静就当这一轮结束了。 */
const SETTLE_FALLBACK_MS = 1_500;
/** prompt 的应答：pi 开始跑之前会先等 direct 暴露的 MCP 服务最多 10 秒。 */
const PROMPT_ACK_TIMEOUT_MS = 60_000;
/** pi 允许的 MCP 服务名。 */
const MCP_NAME = /^[A-Za-z0-9_-]+$/;

interface Turn {
  id: string;
  mapper: PiItemMapper;
  cancelled: boolean;
  /** 收到过 agent_start：之后才等 agent_end / agent_settled 收尾。 */
  started: boolean;
  stopReason: string | null;
  errorMessage: string | null;
  settleTimer: NodeJS.Timeout | null;
}

interface PiState {
  model?: PiModel | null;
  thinkingLevel?: string;
  sessionFile?: string;
  sessionId?: string;
}

/** 恢复句柄里存的东西。 */
interface PiPersistence {
  sessionFile: string;
  sessionId: string | null;
}

/**
 * 一个 BaoCut 会话 = 一个 `pi --mode rpc` 进程（工作目录是项目目录）。pi 自己把对话存成会话文件（`~/.pi/agent/sessions/…`），
 * 恢复时用 `--session <文件>` 重新起进程。
 *
 * 访问模式：pi 执行命令、改文件之前不问人，BaoCut 管不了它的原生权限。不是「完全访问」时照常运行，但在会话开始
 * （与之后第一次切到别的模式）时发一条提示说清楚（`piAccessWarning`），而不是拒绝：Harness 按 `approvals: false`
 * 本来就只在完全访问下给它开会话，这里再拒一次只会让用户卡在一个说不清的错误上。BaoCut 自己的工具（MCP）照常由
 * Runtime 的 ApprovalService 按访问模式把关。
 */
export class PiSession implements AgentSession {
  readonly id = newId('ags');
  readonly capabilities = PI_CAPABILITIES;
  readonly #log: Logger;
  readonly #cwd: string;
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #tempDir: string;
  #proc!: PiRpcProcess;
  #state: PiState = {};
  #turn: Turn | null = null;
  #closed = false;
  #early: AgentEvent[] | null = [];
  #accessWarned = false;
  #askWarned = false;
  /** 这个进程发过 agent_settled：之后 agent_end 不再算收尾。 */
  #settles = false;
  #mcpExtension: string | null = null;

  private constructor(cwd: string, tempDir: string, log: Logger) {
    this.#cwd = cwd;
    this.#tempDir = tempDir;
    this.#log = log;
  }

  static async start(install: PiInstall, options: CreateSessionOptions, log: Logger): Promise<PiSession> {
    if (options.confinement) {
      // pi 没有沙箱参数，限制不了只写工作目录、不联网（架构设计 §6.9）。
      throw new RpcError('driver-unavailable', DriversCommon.confinedUnsupported({ name: 'Pi' }));
    }
    // 临时目录放开发者指令与 MCP 扩展（扩展里有令牌）：只有自己能读，关会话时删掉。
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-pi-'));
    await fs.chmod(tempDir, 0o700);
    const session = new PiSession(options.cwd, tempDir, log);
    try {
      await session.#open(install, options);
    } catch (error) {
      await session.#proc?.close();
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof RpcError) throw error;
      throw agentError('driver-failed', DriversCommon.startFailed({ name: 'Pi', error: piErrorMessage(error) }), null);
    }
    return session;
  }

  async #open(install: PiInstall, options: CreateSessionOptions): Promise<void> {
    const args = ['--mode', 'rpc'];
    const instructions = options.developerInstructions?.trim();
    if (instructions) {
      // 写成文件再交给 --append-system-prompt：指令可能很长，也免得出现在进程列表里。
      const file = path.join(this.#tempDir, 'instructions.md');
      await fs.writeFile(file, instructions, { mode: 0o600 });
      args.push('--append-system-prompt', file);
    }
    const extension = await this.#writeMcpExtension(options.mcpServers);
    if (extension) args.push('--extension', extension);

    const resume = readPersistence(options.resume);
    if (resume) {
      const exists = await fs
        .stat(resume.sessionFile)
        .then((s) => s.isFile())
        .catch(() => false);
      if (exists) args.push('--session', resume.sessionFile);
      else {
        // 原生会话恢复不了时如实告知，不假装上下文还在（架构设计 §2.5）。pi 在有了第一条回复之后才写会话文件。
        this.#warn(DriversCommon.resumeFailed({ name: 'Pi', error: DriversPi.sessionFileMissing() }));
      }
    }

    this.#proc = new PiRpcProcess({ command: install.command, args, cwd: options.cwd, env: { ...install.env, ...PI_ENV } }, this.#log);
    this.#proc.onMessage((message) => this.#onEvent(message));
    void this.#proc.exited.then((reason) => this.#onExit(reason));
    try {
      this.#state = ((await this.#proc.request({ type: 'get_state' })) ?? {}) as PiState;
    } catch (error) {
      const tail = this.#proc.stderrTail();
      const text = piErrorMessage(error);
      throw new Error(tail && !text.includes(tail) ? String(DriversPi.withStderr({ error: text, tail })) : text);
    }
    this.#checkAccess(options.accessMode);
  }

  /**
   * BaoCut 的工具通道（Streamable HTTP 的 MCP 服务）：pi 1.0 自带 MCP 支持，但只读它自己的 mcp.json；
   * 这里写一个只给这个进程用的扩展，在加载时 `registerMcpServer`。`exposure: 'direct'` 让工具像自带工具一样直接声明给模型
   * （默认的 codemode 要模型先写脚本才调得到）；超时与原生审批一样「一直等」（MCP_TOOL_CALL_TIMEOUT_MS，单位秒）。
   * 装了替换自带 MCP 的扩展时，注册会以 extension_error 报出来，届时提示用户。
   */
  async #writeMcpExtension(servers: Record<string, McpServerSpec> | undefined): Promise<string | null> {
    const entries = Object.entries(servers ?? {}).filter(([name]) => {
      if (MCP_NAME.test(name)) return true;
      this.#warn(DriversPi.mcpNameInvalid({ name }));
      return false;
    });
    if (!entries.length) return null;
    const timeout = Math.round(MCP_TOOL_CALL_TIMEOUT_MS / 1000);
    const config = Object.fromEntries(
      entries.map(([name, spec]) => [name, { url: spec.url, headers: spec.headers, exposure: 'direct', timeout }]),
    );
    const source = [
      // i18n-ignore: 写进 Pi 扩展源码的注释，交给 Pi 加载，不给人看
      '// BaoCut 为这个 Pi 会话生成的扩展：注册 BaoCut 的 MCP 服务。会话结束时删除。',
      `const servers = ${JSON.stringify(config)};`,
      'export default function baocut(pi) {',
      '  for (const [name, config] of Object.entries(servers)) pi.registerMcpServer(name, config);',
      '}',
      '',
    ].join('\n');
    const file = path.join(this.#tempDir, `baocut-mcp-${randomUUID().slice(0, 8)}.mjs`);
    await fs.writeFile(file, source, { mode: 0o600 });
    this.#mcpExtension = file;
    return file;
  }

  async startTurn(input: AgentInput, settings: TurnSettings): Promise<{ turnId: string }> {
    if (this.#closed || this.#proc.hasExited) throw new Error(String(DriversCommon.sessionClosed({ name: 'Pi' })));
    if (this.#turn) throw new Error(String(DriversCommon.turnInProgress()));
    this.#checkAccess(settings.accessMode);
    await this.#applyModel(settings);
    await this.#applyEffort(settings);
    const message = await this.#message(input);
    const turnId = newId('turn');
    const turn: Turn = {
      id: turnId,
      mapper: new PiItemMapper(turnId, this.#cwd),
      cancelled: false,
      started: false,
      stopReason: null,
      errorMessage: null,
      settleTimer: null,
    };
    this.#turn = turn;
    this.#emit({ type: 'turn.started', turnId });
    this.#proc.request({ type: 'prompt', ...message }, PROMPT_ACK_TIMEOUT_MS).then(
      (data) => {
        // handled：扩展或命令自己处理掉了，没有起模型调用，不会有 agent_settled。
        if ((data as { disposition?: unknown } | null)?.disposition === 'handled') this.#finish(turn);
      },
      (error: unknown) => {
        // 进程退了：交给 session.exited（Harness 记成 AGENT_EXITED），这里不再报一遍。
        if (this.#proc.hasExited) return;
        if (turn.cancelled) return this.#finish(turn);
        const text = piErrorMessage(error);
        this.#finish(turn, { error: text, code: errorCode(text) });
      },
    );
    return { turnId };
  }

  async steer(turnId: string, input: AgentInput): Promise<'accepted' | 'unavailable'> {
    const turn = this.#turn;
    if (!turn || turn.id !== turnId || turn.cancelled) return 'unavailable';
    try {
      // pi 在当前这批工具调用结束之后、下一次模型调用之前把它交给模型。
      await this.#proc.request({ type: 'steer', ...(await this.#message(input)) });
      return 'accepted';
    } catch (error) {
      // 旧版回「Unknown command: steer」。别的错误（回合恰好结束）同样交给 Harness 排到下一轮。
      this.#log.info('Pi does not accept steer', { error: piErrorMessage(error) });
      return 'unavailable';
    }
  }

  async interrupt(turnId: string): Promise<InterruptReceipt> {
    const turn = this.#turn;
    if (!turn || turn.id !== turnId) return { status: 'not-running' };
    turn.cancelled = true;
    // 先清掉排队的 steer / follow_up，免得 abort 之后它们又起一轮。旧版没有 clear_queue，忽略。
    await this.#proc.requestStopWork({ type: 'clear_queue' }, 5_000).catch(() => undefined);
    // abort 要等 pi 空闲下来才应答（跑着的命令被杀掉之后）。短时间内没应答也算已经发出；发不出去才是 unknown。
    const abort = this.#proc.requestStopWork({ type: 'abort' }, null);
    const outcome = await Promise.race([
      abort.then(
        () => 'ok' as const,
        (error: unknown) => {
          this.#log.warn('Pi interrupt failed', { error: piErrorMessage(error) });
          return 'failed' as const;
        },
      ),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 5_000).unref()),
    ]);
    if (outcome === 'ok' && this.#turn === turn && !turn.started) this.#finish(turn);
    return { status: outcome === 'failed' ? 'unknown' : 'requested' };
  }

  /** pi 不来请求审批（`capabilities.approvals` 为 false），这里没有可答的。 */
  async respondToApproval(_approvalId: Id, _response: ApprovalResponse): Promise<void> {}

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener);
    const early = this.#early;
    if (early) {
      this.#early = null;
      // 订阅方可能还没登记好这个会话（AgentManager 订阅之后才记下它）：下一个微任务再补发。
      queueMicrotask(() => early.forEach((event) => this.#emit(event)));
    }
    return () => this.#listeners.delete(listener);
  }

  describePersistence(): AgentPersistenceHandle | null {
    const sessionFile = this.#state.sessionFile;
    if (!sessionFile) return null;
    const data: PiPersistence = { sessionFile, sessionId: this.#state.sessionId ?? null };
    return { driverId: PI_DRIVER_ID, data };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#turn?.settleTimer) clearTimeout(this.#turn.settleTimer);
    await this.#proc.close();
    await fs.rm(this.#tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

  // ---- 每一轮的设置 ----

  #checkAccess(mode: TurnSettings['accessMode']): void {
    if (mode === 'fullAccess' || this.#accessWarned) return;
    this.#accessWarned = true;
    this.#warn(piAccessWarning());
  }

  async #applyModel(settings: TurnSettings): Promise<void> {
    if (!settings.model) return;
    const current = this.#state.model;
    if (current && piModelId(current) === settings.model) return;
    const ref = parseModelReference(settings.model);
    const provider = ref.provider ?? (current && current.provider !== 'unknown' ? current.provider : null);
    if (!provider) throw agentError('driver-failed', DriversPi.modelFormat({ model: settings.model }), 'AGENT_MODEL_UNAVAILABLE');
    try {
      const model = (await this.#proc.request({ type: 'set_model', provider, modelId: ref.id })) as PiModel | null;
      this.#state.model = model ?? { provider, id: ref.id };
    } catch (error) {
      throw agentError('driver-failed', DriversPi.switchModelFailed({ model: settings.model, error: piErrorMessage(error) }), 'AGENT_MODEL_UNAVAILABLE');
    }
  }

  async #applyEffort(settings: TurnSettings): Promise<void> {
    const level = settings.effort;
    if (!level || level === this.#state.thinkingLevel) return;
    if (!isPiThinkingLevel(level)) {
      this.#warn(DriversPi.effortUnsupported({ level }));
      return;
    }
    try {
      await this.#proc.request({ type: 'set_thinking_level', level });
      this.#state.thinkingLevel = level;
    } catch (error) {
      this.#warn(DriversPi.effortFailed({ error: piErrorMessage(error) }));
    }
  }

  /** prompt / steer 的消息体。模型不收图片时不发图片，改成在文字后面附上图片的本机路径（pi 有 read 工具）。 */
  async #message(input: AgentInput): Promise<{ message: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> }> {
    const images = input.images ?? [];
    if (!images.length) return { message: input.text };
    if (!piModelTakesImages(this.#state.model)) {
      // i18n-ignore: 附在提示词后面交给模型的图片路径提示
      const hints = images.map((image) => `[图片：${image.path}]`).join('\n');
      return { message: `${input.text}\n\n${hints}` };
    }
    const encoded = await Promise.all(
      images.map(async (image) => ({
        type: 'image' as const,
        data: (await fs.readFile(image.path)).toString('base64'),
        mimeType: image.mimeType,
      })),
    );
    return { message: input.text, images: encoded };
  }

  // ---- 事件 ----

  #onEvent(event: Record<string, unknown>): void {
    switch (event.type) {
      case 'extension_ui_request':
        return this.#onUiRequest(event);
      case 'extension_error': {
        const error = String(event.error ?? '');
        if (this.#mcpExtension && String(event.extensionPath ?? '') === this.#mcpExtension) {
          this.#warn(DriversPi.mcpConnectFailed({ error }));
        } else {
          this.#warn(DriversPi.extensionError({ error }));
        }
        return;
      }
      case 'auto_retry_start': {
        const message: DriverText = event.errorMessage != null ? String(event.errorMessage) : DriversPi.modelCallFailed();
        this.#emit({
          type: 'session.error',
          turnId: this.#turn?.id ?? null,
          message: String(message),
          ...refField('messageRef', message),
          willRetry: true,
          code: errorCode(String(event.errorMessage ?? '')),
        });
        return;
      }
      case 'auto_retry_end':
        if (event.success === false && this.#turn && typeof event.finalError === 'string') this.#turn.errorMessage = event.finalError;
        return;
    }
    const turn = this.#turn;
    if (!turn) return;
    switch (event.type) {
      case 'agent_start':
        turn.started = true;
        if (turn.settleTimer) clearTimeout(turn.settleTimer);
        turn.settleTimer = null;
        break;
      case 'message_end': {
        const message = (event.message ?? {}) as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
        if (message.role === 'assistant') {
          turn.stopReason = typeof message.stopReason === 'string' ? message.stopReason : null;
          turn.errorMessage = typeof message.errorMessage === 'string' && message.errorMessage ? message.errorMessage : null;
        }
        break;
      }
      case 'agent_end':
        // 后面还可能有自动重试、压缩后重来、排队的 steer：以 agent_settled 为准。旧版不发 agent_settled，过一会儿没动静就收尾。
        if (event.willRetry !== true && !this.#settles) {
          if (turn.settleTimer) clearTimeout(turn.settleTimer);
          turn.settleTimer = setTimeout(() => this.#finish(turn), SETTLE_FALLBACK_MS);
          turn.settleTimer.unref?.();
        }
        break;
      case 'agent_settled':
        this.#settles = true;
        this.#finish(turn);
        return;
    }
    for (const mapped of turn.mapper.map(event)) this.#emit(mapped);
  }

  /** 扩展要用户作答（select / confirm / input / editor）：BaoCut 没有这条通道，立即取消；只是通知的转成提示。 */
  #onUiRequest(event: Record<string, unknown>): void {
    const method = String(event.method ?? '');
    if (method === 'notify') {
      if (event.notifyType === 'error' || event.notifyType === 'warning') this.#warn(DriversPi.notice({ message: String(event.message ?? '') }));
      return;
    }
    if (!['select', 'confirm', 'input', 'editor'].includes(method)) return; // setStatus、setWidget 之类不需要应答
    this.#proc.send({ type: 'extension_ui_response', id: event.id, cancelled: true });
    if (!this.#askWarned) {
      this.#askWarned = true;
      const title = typeof event.title === 'string' ? event.title : '';
      this.#warn(DriversPi.extensionAsked({ title }));
    }
  }

  #finish(turn: Turn, failure?: { error: string; code: AgentErrorCode | null }): void {
    if (this.#turn !== turn) return;
    if (turn.settleTimer) clearTimeout(turn.settleTimer);
    for (const mapped of turn.mapper.finish()) this.#emit(mapped);
    this.#turn = null;
    let outcome: 'completed' | 'interrupted' | 'failed' = 'completed';
    let error: DriverText | null = null;
    let code: AgentErrorCode | null = null;
    if (turn.cancelled || turn.stopReason === 'aborted') outcome = 'interrupted';
    else if (failure) ({ error, code } = failure);
    else if (turn.stopReason === 'error' || turn.errorMessage) {
      error = turn.errorMessage ?? DriversPi.modelCallFailed();
      code = errorCode(String(error));
    }
    if (error) outcome = 'failed';
    this.#emit({ type: 'turn.completed', turnId: turn.id, outcome, error: textOf(error), ...refField('errorRef', error), errorCode: code });
  }

  #onExit(reason: Localized): void {
    const turn = this.#turn;
    if (turn) {
      if (turn.settleTimer) clearTimeout(turn.settleTimer);
      for (const mapped of turn.mapper.finish()) this.#emit(mapped);
      this.#turn = null;
    }
    this.#emit({ type: 'session.exited', error: this.#closed ? null : String(reason), ...(this.#closed ? {} : refField('errorRef', reason)) });
  }

  #warn(message: DriverText): void {
    this.#emit({ type: 'session.warning', message: String(message), ...refField('messageRef', message) });
  }

  #emit(event: AgentEvent): void {
    // 开会话期间的提示（恢复失败、访问模式）在 Harness 订阅之前发出：先存着，订阅时补发。
    if (this.#early) {
      this.#early.push(event);
      return;
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        this.#log.error('AgentEvent listener threw', { error: String(error) });
      }
    }
  }
}

function readPersistence(handle: AgentPersistenceHandle | null): PiPersistence | null {
  if (!handle || handle.driverId !== PI_DRIVER_ID) return null;
  const data = handle.data as { sessionFile?: unknown; sessionId?: unknown } | null;
  if (typeof data?.sessionFile !== 'string' || !data.sessionFile) return null;
  return { sessionFile: data.sessionFile, sessionId: typeof data.sessionId === 'string' ? data.sessionId : null };
}

/** 错误文字 → 结构化原因（pi 的错误只有文字）。 */
export function errorCode(text: string): AgentErrorCode | null {
  if (/no api key|not logged in|\/login|unauthori[sz]ed|authentication|\b401\b|invalid api key/i.test(text)) return 'AGENT_AUTH_REQUIRED';
  if (/rate.?limit|too many requests|\b429\b/i.test(text)) return 'AGENT_RATE_LIMITED';
  if (/credit|billing|quota|insufficient.?balance|\b402\b/i.test(text)) return 'AGENT_BILLING_REQUIRED';
  return null;
}
