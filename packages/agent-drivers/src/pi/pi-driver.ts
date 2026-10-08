/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/pi/agent.ts 的模型目录（起一个 `pi --mode rpc`、get_available_models、
 * 取当前模型、关掉）。改成 BaoCut 的 DriverProbe：登录状态按可用模型表是否为空判断，模型表按命令与版本缓存 10 分钟，
 * 协议路径已验证的标 `verified: true`，另记 `tested: false`（还没有用真实模型账号跑过）。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import { driverAvailability, nowIso, refOf, type DriverModel, type DriverProbe, type DriverState } from '@baocut/protocol';
import type { AgentDriver, AgentSession, CreateSessionOptions, DriverDescription, Logger, ProbeOptions } from '@baocut/harness';
import { DriversCommon, DriversPi } from '@baocut/protocol/messages/agent-drivers';
import { agentError } from '../acp/acp-session.ts';
import { refField, textOf, type DriverText } from '../driver-text.ts';
import { compareVersions } from '../login-shell.ts';
import { locatePi, PI_ENV, piAt, type PiInstall } from './pi-binary.ts';
import { derivePiModels, type PiModel } from './pi-models.ts';
import { PiRpcProcess, piErrorMessage } from './pi-rpc-process.ts';
import { PI_CAPABILITIES, PI_DRIVER_ID, PiSession } from './pi-session.ts';

/** 模型表的缓存：拿到了留 10 分钟；没登录或出错 1 分钟后再试。 */
const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_RETRY_MS = 60_000;

/**
 * 最低版本。用到的命令里最晚出现的是 clear_queue（pi 0.84.4，见 paseo 的兼容说明）；steer、agent_settled 另有退路
 * （回「Unknown command」时报不支持、没有 agent_settled 时以 agent_end 收尾）。只在 1.0.4 上实测过。
 * 原型里的 0.62.0 是演示值，没有采用。
 */
export const PI_MIN_VERSION = '0.84.4';

interface PiCatalog {
  state: 'ready' | 'signed-out' | 'error';
  detail: DriverText | null;
  models: DriverModel[];
}

export interface PiDriverOptions {
  /** 找到可执行文件。默认按 `BAOCUT_PI_PATH`、登录 shell 的 PATH 与常见安装位置找。测试注入假的 pi。 */
  locate?: () => Promise<PiInstall | null>;
  /** 探测（起进程、取模型表）的总时限，默认 30 秒（带着 API 密钥第一次取目录实测要十来秒）。 */
  probeTimeoutMs?: number;
}

/**
 * Pi（`@earendil-works/pi-coding-agent`）：经 `pi --mode rpc` 的 JSON 行协议接入（架构设计 §3.1）。每个会话一个 pi 进程。
 *
 * 开放程度（D08）：Driver 与 pi 之间的协议路径已经用真实的 pi 1.0.4 加脚本化的模型服务跑通（写、改、命令、读、steer、中断、
 * 恢复、MCP 与开发者指令），按「协议路径验证即放开」`verified` 为 true；还没有用真实的模型账号在 BaoCut 里实测，`tested` 为 false。
 * 没有审批通道（`approvals: false`），只适合「完全访问」。
 */
export class PiDriver implements AgentDriver {
  readonly id = PI_DRIVER_ID;
  /** 协议路径已用真实 pi 与脚本化模型服务验证（架构设计 §3.11 的 D08）：可以开会话。 */
  readonly verified = true;
  /** 还没有用真实模型账号在 BaoCut 里跑过：能开会话，界面提示「未在 BaoCut 实测」。 */
  readonly tested = false;
  /** 探测要起一个 `pi --mode rpc` 进程取模型表（带着 API 密钥第一次取要十来秒）：`agents.list` 不等它（§3.11）。 */
  readonly slowProbe = true;
  readonly #log: Logger;
  readonly #locate: () => Promise<PiInstall | null>;
  readonly #probeTimeoutMs: number;
  readonly #catalogs = new Map<string, { at: number; ttl: number; result: Promise<PiCatalog> }>();

  constructor(log: Logger, options: PiDriverOptions = {}) {
    this.#log = log.child('pi');
    this.#locate = options.locate ?? locatePi;
    this.#probeTimeoutMs = options.probeTimeoutMs ?? 30_000;
  }

  describe(): DriverDescription {
    return {
      id: this.id,
      name: 'Pi',
      command: 'pi',
      minVersion: PI_MIN_VERSION,
      plan: String(DriversPi.plan()),
      planRef: refOf(DriversPi.plan()),
      loginCommand: 'pi',
      install: [
        {
          kind: 'npm',
          label: 'npm',
          needs: 'Node.js',
          command: 'npm install -g @earendil-works/pi-coding-agent',
          upgrade: 'npm install -g @earendil-works/pi-coding-agent@latest',
        },
      ],
      verified: this.verified,
      tested: this.tested,
      capabilities: PI_CAPABILITIES,
    };
  }

  async probe(options: ProbeOptions = {}): Promise<DriverProbe> {
    const install = await this.#find(options.executable);
    const base = {
      ...this.describe(),
      latestVersion: null,
      account: null,
      models: [],
      configModel: null,
      configModelKnown: null,
      checkedAt: nowIso(),
    };
    const result = (state: Exclude<DriverState, 'disabled'>, detail: DriverText | null, extra: Partial<DriverProbe> = {}): DriverProbe => ({
      ...base,
      version: install?.version ?? null,
      executable: install?.command ?? options.executable ?? null,
      realExecutable: null,
      ...extra,
      state,
      ...driverAvailability(state),
      detail: textOf(detail),
      ...refField('detailRef', detail),
    });
    if (!install) {
      const detail = options.executable
        ? DriversCommon.executableMissing({ command: 'pi', path: options.executable })
        : DriversCommon.commandMissing({ command: 'pi', hint: DriversPi.installHint() });
      return result('not-installed', detail);
    }
    const realExecutable = await fs.realpath(install.command).catch(() => null);
    if (!install.version) return result('error', DriversCommon.versionFailed({ command: install.command }), { realExecutable });
    if (compareVersions(install.version, PI_MIN_VERSION) < 0) {
      return result('outdated', DriversCommon.outdated({ name: 'Pi', version: install.version, min: PI_MIN_VERSION }), { realExecutable });
    }
    const catalog = await this.#catalog(install, options.force === true);
    const extra: Partial<DriverProbe> = { realExecutable, models: catalog.models };
    if (catalog.state === 'signed-out') return result('signed-out', catalog.detail, extra);
    if (catalog.state === 'error') return result('error', catalog.detail, extra);
    return result('ready', null, extra);
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const install = await this.#find(options.executable);
    if (!install) throw agentError('driver-unavailable', DriversCommon.commandNotFound({ command: 'pi' }), 'AGENT_NOT_INSTALLED');
    return PiSession.start(install, options, this.#log);
  }

  #find(executable: string | null | undefined): Promise<PiInstall | null> {
    return executable ? piAt(executable) : this.#locate();
  }

  /** 模型表与登录状态，按「哪个命令、哪个版本」缓存；同时到来的探测共用一次，`force` 不用缓存。 */
  #catalog(install: PiInstall, force: boolean): Promise<PiCatalog> {
    const key = `${install.command}\0${install.version ?? ''}`;
    const hit = this.#catalogs.get(key);
    if (!force && hit && Date.now() - hit.at < hit.ttl) return hit.result;
    const entry: { at: number; ttl: number; result: Promise<PiCatalog> } = { at: Date.now(), ttl: CATALOG_TTL_MS, result: null as never };
    entry.result = this.#readCatalog(install).then((catalog) => {
      if (catalog.state !== 'ready') entry.ttl = CATALOG_RETRY_MS;
      return catalog;
    });
    this.#catalogs.set(key, entry);
    return entry.result;
  }

  /**
   * 起一个临时的 `pi --mode rpc --no-session`（在主目录，不写会话文件）：get_available_models 与 get_state，然后关掉。不调模型。
   *
   * 登录状态：pi 的 get_available_models 只列出有可用凭据的模型（`/login` 的订阅登录、auth.json 里的密钥、环境变量里的
   * API 密钥、models.json 自定义的服务都算），一个都没有就是没登录。不看 `~/.pi/agent/auth.json` 在不在：pi 每次启动都会建一个
   * 内容为 `{}` 的空文件，它在不代表登录了；探测也不读凭据文件的内容（架构设计 §3.11）。
   */
  async #readCatalog(install: PiInstall): Promise<PiCatalog> {
    const proc = new PiRpcProcess(
      { command: install.command, args: ['--mode', 'rpc', '--no-session'], cwd: os.homedir(), env: { ...install.env, ...PI_ENV } },
      this.#log,
    );
    const timeout = this.#probeTimeoutMs;
    try {
      const [available, state] = await Promise.all([
        proc.request({ type: 'get_available_models' }, timeout),
        proc.request({ type: 'get_state' }, timeout).catch(() => null),
      ]);
      const raw = (available as { models?: unknown } | null)?.models;
      const list = Array.isArray(raw) ? (raw as PiModel[]) : [];
      const current = ((state as { model?: PiModel | null } | null)?.model ?? null) as PiModel | null;
      const models = derivePiModels(list, current);
      if (!models.length) {
        return {
          state: 'signed-out',
          detail: DriversPi.signedOut(),
          models: [],
        };
      }
      return { state: 'ready', detail: null, models };
    } catch (error) {
      this.#log.warn('Pi probe failed', { error: piErrorMessage(error) });
      return { state: 'error', detail: DriversPi.rpcFailed({ error: piErrorMessage(error) }), models: [] };
    } finally {
      await proc.close();
    }
  }
}
