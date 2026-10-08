import { agentEnv } from '@baocut/agent-drivers';
import { TopicLog, type Logger, type TopicSubscription } from '@baocut/harness';
import { openSystemTerminal, runShellCommand, type ShellCommandRun, type SystemTerminalResult } from '@baocut/process-host';
import {
  AGENT_SETUP_OUTPUT_LINES,
  RpcError,
  newId,
  nowIso,
  type AgentSetupAction,
  type AgentSetupEvent,
  type AgentSetupRun,
  type AgentSetupSnapshot,
  type AgentsView,
  type DriverId,
  type DriverInfo,
  type DriverInstallOption,
  type Id,
  type RpcParams,
  type RpcResult,
  type Seq,
  type SequencedEvent,
} from '@baocut/protocol';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';

/**
 * Agent 的安装、升级与登录动作（架构设计 §12.9「安装动作」）：
 *
 * - **命令只从探测结果里取**。客户端只说「哪个 Agent、做什么、哪种方式」，Runtime 在当前的 `agents.list`
 *   里找 `install[].command` / `upgrade` / `loginCommand`；找不到就 `invalid-request`。Renderer 只是半可信的。
 * - **应用内运行**（`agents.runSetup`）只收 brew、npm 这类：`script` 类（从网络下载脚本交给 shell）拒绝，
 *   只能复制或在系统终端里由用户自己运行。stdin 关闭、没有控制终端，要密码的会直接失败，界面提示去终端里运行；
 *   BaoCut 不提权。用户逐次确认由界面负责（确认时显示完整命令）。
 * - **输出**合并 stdout 与 stderr，按行经 `agent-setup` 主题送达（约 100 毫秒一批），只留最后
 *   `AGENT_SETUP_OUTPUT_LINES` 行；结束时整段记入日志，连同命令、退出码与耗时。
 * - **结束后重新探测**（与 `agents.detect { driverId }` 相同：强制探测这个 Agent），再送出终态；探测结果经 `agents` 主题推送，
 *   界面收到终态后读 `agents.list` 也是新结果。
 * - **系统终端**（`agents.openTerminal`）：登录、`script` 类安装、需要管理员权限的，都交给用户自己的终端。
 *
 * 不做成 Job：JobRecord 没有输出行，必填字段是模型计算的语义，还会持久化进账本、出现在 `jobs.list` 与智能体的任务工具里。
 * 运行记录只在内存里，留最近 `keepRuns` 次。
 *
 * 权限：网关的 principal 在 0.1 只用于日志（见 handlers.ts），这里同样不按连接类型限制；
 * 防线是「命令只从探测结果取、script 类不在应用内运行、stdin 关闭」。
 */

/** 从网络下载脚本交给 shell 执行的命令：即使探测结果把它标成别的类别，也不在应用内运行。 */
const PIPES_TO_SHELL = /\|\s*(ba|z)?sh\b/;

export interface AgentSetupOptions {
  /** 当前的 Agent 列表（`Harness.agents`）；`fresh` 时强制重新探测（给了 `driverId` 只探那一个）。 */
  agents: (options?: { fresh?: boolean; driverId?: DriverId }) => Promise<AgentsView>;
  log: Logger;
  /** 应用内运行用的环境（默认 `agentEnv()`：登录 shell 的环境，去掉宿主 Claude Code 会话的变量）。 */
  env?: () => Promise<NodeJS.ProcessEnv>;
  /** 打开系统终端（默认 `openSystemTerminal`）。测试注入假的，不真的打开终端。 */
  openTerminal?: (command: string) => Promise<SystemTerminalResult>;
  /** 内存里留几次运行记录（默认 20）；运行中的不算在内、不会被丢掉。 */
  keepRuns?: number;
  /** 输出攒多久送一批（默认 100 毫秒）。 */
  flushMs?: number;
}

interface Entry {
  run: AgentSetupRun;
  process: ShellCommandRun | null;
  pending: string[];
  flushTimer: NodeJS.Timeout | null;
  /** 进程结束、重新探测、终态送出之后才 resolve。 */
  done: Promise<void>;
  cancelRequested: boolean;
}

export class AgentSetup {
  readonly topic: TopicLog<AgentSetupSnapshot, AgentSetupEvent>;
  readonly #agents: AgentSetupOptions['agents'];
  readonly #log: Logger;
  readonly #env: () => Promise<NodeJS.ProcessEnv>;
  readonly #openTerminal: (command: string) => Promise<SystemTerminalResult>;
  readonly #keepRuns: number;
  readonly #flushMs: number;
  /** 插入顺序 = 开始顺序；快照里倒过来，新的在前。 */
  readonly #runs = new Map<Id, Entry>();
  readonly #byCommand = new Map<Id, Promise<{ run: AgentSetupRun }>>();
  #closing = false;

  constructor(options: AgentSetupOptions) {
    this.#agents = options.agents;
    this.#log = options.log.child('agent-setup');
    this.#env = options.env ?? agentEnv;
    this.#openTerminal = options.openTerminal ?? ((command) => openSystemTerminal(command));
    this.#keepRuns = options.keepRuns ?? 20;
    this.#flushMs = options.flushMs ?? 100;
    this.topic = new TopicLog(() => ({ runs: [...this.#runs.values()].reverse().map((entry) => copyRun(entry.run)) }), '0');
  }

  subscribe(afterSeq: Seq | undefined, listener: (event: SequencedEvent<AgentSetupEvent>) => void): TopicSubscription<AgentSetupSnapshot, AgentSetupEvent> {
    return this.topic.subscribe(afterSeq, listener);
  }

  /** `agents.runSetup`。同一个 `commandId` 返回同一次运行（当前状态）。 */
  run(params: RpcParams<'agents.runSetup'>): Promise<RpcResult<'agents.runSetup'>> {
    const known = this.#byCommand.get(params.commandId);
    if (known) return known.then(({ run }) => ({ run: copyRun(this.#runs.get(run.runId)?.run ?? run) }));
    const started = this.#start(params);
    this.#byCommand.set(params.commandId, started);
    // 被拒绝的请求不占这个 commandId：改了参数可以再试。
    started.catch(() => this.#byCommand.delete(params.commandId));
    return started;
  }

  /** `agents.cancelSetup`。已经做了的部分不回退。 */
  cancel(runId: Id): RpcResult<'agents.cancelSetup'> {
    const entry = this.#runs.get(runId);
    if (!entry) throw new RpcError('not-found', RcRuntime.noSuchRun({ runId }));
    if (entry.run.state !== 'running' || !entry.process) return { status: 'not-running' };
    entry.cancelRequested = true;
    entry.process.cancel();
    return { status: 'requested' };
  }

  /** `agents.openTerminal`。 */
  async openTerminal(params: RpcParams<'agents.openTerminal'>): Promise<RpcResult<'agents.openTerminal'>> {
    const driver = await this.#driver(params.driverId);
    let command: string;
    if (params.action === 'login') {
      if (!driver.loginCommand) throw new RpcError('invalid-request', RcRuntime.noLoginCommand({ agent: driver.name }));
      command = driver.loginCommand;
    } else {
      if (!params.kind) throw new RpcError('invalid-request', RcRuntime.installKindRequired());
      command = commandOf(driver, params.action, params.kind);
    }
    const result = await this.#openTerminal(command).catch((error: unknown) => ({ status: 'unsupported' as const, detail: String(error) }));
    if (result.status === 'opened') this.#log.info('Opened the command in the system terminal', { driverId: driver.id, action: params.action, kind: params.kind ?? null, command });
    else this.#log.warn('Could not open the system terminal', { driverId: driver.id, action: params.action, command, detail: result.detail });
    return { status: result.status, command };
  }

  /** Runtime 停止：结束还在运行的命令，等它们收尾（不再重新探测）。 */
  async shutdown(): Promise<void> {
    this.#closing = true;
    const running = [...this.#runs.values()].filter((entry) => entry.run.state === 'running');
    for (const entry of running) {
      entry.cancelRequested = true;
      entry.process?.cancel();
    }
    await Promise.race([Promise.all(running.map((entry) => entry.done)), new Promise((resolve) => setTimeout(resolve, 5000).unref?.())]);
  }

  async #driver(driverId: DriverId): Promise<DriverInfo> {
    const view = await this.#agents();
    const driver = view.drivers.find((candidate) => candidate.id === driverId);
    if (!driver) throw new RpcError('driver-unavailable', RcRuntime.driverNotRegistered({ driverId }));
    return driver;
  }

  async #start(params: RpcParams<'agents.runSetup'>): Promise<{ run: AgentSetupRun }> {
    if (this.#closing) throw new RpcError('busy', RcRuntime.runtimeStopping());
    const driver = await this.#driver(params.driverId);
    const command = commandOf(driver, params.action, params.kind);
    if (params.kind === 'script' || PIPES_TO_SHELL.test(command)) {
      throw new RpcError('invalid-request', RcRuntime.scriptNotRun());
    }
    const env = await this.#env();
    // 检查与登记在同一个同步段里：两个并发的请求不会都通过。
    if (this.#closing) throw new RpcError('busy', RcRuntime.runtimeStopping());
    for (const entry of this.#runs.values()) {
      if (entry.run.driverId === driver.id && entry.run.state === 'running') {
        throw new RpcError('busy', RcRuntime.commandAlreadyRunning({ agent: driver.name }), { runId: entry.run.runId });
      }
    }

    const run: AgentSetupRun = {
      runId: newId('setup'),
      driverId: driver.id,
      action: params.action,
      kind: params.kind,
      command,
      state: 'running',
      exitCode: null,
      output: [],
      droppedLines: 0,
      startedAt: nowIso(),
      endedAt: null,
      error: null,
    };
    const startedAt = Date.now();
    let resolveDone!: () => void;
    const entry: Entry = { run, process: null, pending: [], flushTimer: null, done: new Promise((resolve) => (resolveDone = resolve)), cancelRequested: false };
    this.#runs.set(run.runId, entry);
    this.#prune();
    this.topic.publish({ type: 'setup.updated', run: copyRun(run) });
    this.#log.info('Running the agent setup command', { runId: run.runId, driverId: run.driverId, action: run.action, kind: run.kind, command });

    entry.process = runShellCommand({ command, env, onLines: (lines) => this.#queue(entry, lines) });
    void entry.process.exited.then(async (exit) => {
      this.#flush(entry);
      // 重新探测在终态之前：界面收到终态时读 `agents.list` 就是新的。Runtime 停止时不探测。
      if (!this.#closing) {
        await this.#agents({ fresh: true, driverId: run.driverId }).catch((error: unknown) => this.#log.warn('Re-detecting agents after the run failed', { runId: run.runId, error: String(error) }));
      }
      run.exitCode = exit.code;
      run.error = exit.error;
      run.state = entry.cancelRequested || exit.cancelled ? 'cancelled' : exit.error === null && exit.code === 0 ? 'completed' : 'failed';
      run.endedAt = nowIso();
      entry.process = null;
      this.topic.publish({ type: 'setup.updated', run: copyRun(run) });
      const fields = {
        runId: run.runId,
        driverId: run.driverId,
        action: run.action,
        command,
        state: run.state,
        exitCode: exit.code,
        signal: exit.signal,
        durationMs: Date.now() - startedAt,
        error: exit.error,
        droppedLines: run.droppedLines,
        output: run.output.join('\n'),
      };
      if (run.state === 'completed') this.#log.info('Agent setup command finished', fields);
      else this.#log.warn('Agent setup command did not succeed', fields);
      this.#prune();
      resolveDone();
    });
    return { run: copyRun(run) };
  }

  #queue(entry: Entry, lines: string[]): void {
    entry.pending.push(...lines);
    // 攒着的也有上限：一次刷屏的输出不在内存里堆起来。
    if (entry.pending.length > AGENT_SETUP_OUTPUT_LINES) {
      const dropped = entry.pending.length - AGENT_SETUP_OUTPUT_LINES;
      entry.pending.splice(0, dropped);
      entry.run.droppedLines += dropped;
    }
    entry.flushTimer ??= setTimeout(() => this.#flush(entry), this.#flushMs);
  }

  /** 把攒着的行并进记录并送出（同一个同步段：快照与之后的事件同一水位）。 */
  #flush(entry: Entry): void {
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = null;
    if (!entry.pending.length) return;
    const lines = entry.pending;
    entry.pending = [];
    const output = entry.run.output;
    output.push(...lines);
    if (output.length > AGENT_SETUP_OUTPUT_LINES) {
      const dropped = output.length - AGENT_SETUP_OUTPUT_LINES;
      output.splice(0, dropped);
      entry.run.droppedLines += dropped;
    }
    this.topic.publish({ type: 'setup.output', runId: entry.run.runId, lines });
  }

  /** 只留最近 `keepRuns` 次结束了的记录。 */
  #prune(): void {
    const finished = [...this.#runs.values()].filter((entry) => entry.run.state !== 'running');
    const excess = this.#runs.size - this.#keepRuns;
    for (const entry of finished.slice(0, Math.max(0, excess))) this.#runs.delete(entry.run.runId);
  }
}

/** 探测结果里这个 Agent、这种方式的安装或升级命令；没有就 `invalid-request`。 */
function commandOf(driver: DriverInfo, action: AgentSetupAction, kind: DriverInstallOption['kind']): string {
  const option = driver.install.find((candidate) => candidate.kind === kind);
  if (!option) throw new RpcError('invalid-request', RcRuntime.noInstallKind({ agent: driver.name, kind }));
  const command = action === 'install' ? option.command : option.upgrade;
  if (!command.trim() || /[\r\n\0]/.test(command)) throw new RpcError('invalid-request', RcRuntime.commandNotRunnable({ agent: driver.name }));
  return command;
}

function copyRun(run: AgentSetupRun): AgentSetupRun {
  return { ...run, output: [...run.output] };
}
