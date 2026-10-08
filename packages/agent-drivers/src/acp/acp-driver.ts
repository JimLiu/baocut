/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/acp-agent.ts 的 ACPAgentClient.fetchCatalog（起一个临时进程、session/new、
 * 读模型表、关掉）与 PROBE_ENV，cursor-acp-agent.ts 的 resolveCursorCatalogModels / fetchCursorModelCatalog
 * （`cursor/list_available_models`），generic-acp-agent.ts 的通用 Driver 装配。
 * 改成 BaoCut 的 DriverProbe：需要登录（-32000）报 signed-out，模型表按版本缓存 10 分钟。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import { nowIso, driverAvailability, refOf, type DriverModel, type DriverProbe, type DriverState } from '@baocut/protocol';
import { DriversAcp, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import type { AgentDriver, AgentSession, CreateSessionOptions, DriverDescription, Logger, ProbeOptions } from '@baocut/harness';
import { refField, textOf, type DriverText } from '../driver-text.ts';
import { compareVersions } from '../login-shell.ts';
import { acpAt, locateAcp, type AcpInstall } from './acp-binary.ts';
import { AcpProcess, acpErrorMessage, isAuthRequired, withTimeout } from './acp-connection.ts';
import { deriveModels, type AcpSessionState } from './acp-items.ts';
import {
  ACP_ENV,
  ACP_PRESETS,
  ACP_SHARED_VERIFIED,
  loginAdvice,
  type AcpDriverId,
  type AcpPreset,
  type BuiltinAcpDriverId,
} from './acp-presets.ts';
import { AcpSession, acpCapabilities, agentError } from './acp-session.ts';

/** 模型表的缓存：拿到了留 10 分钟；没登录或出错 1 分钟后再试（登录、升级之后不必等太久）。 */
const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_RETRY_MS = 60_000;

interface AcpCatalog {
  state: 'ready' | 'signed-out' | 'error';
  /** signed-out 时是 Agent 的原话；error 时是 BaoCut 写的说明。 */
  detail: DriverText | null;
  models: DriverModel[];
  capabilities: DriverProbe['capabilities'];
}

export interface AcpDriverOptions {
  /**
   * 找到可执行文件。默认按 `BAOCUT_<ID>_PATH`、登录 shell 的 PATH 与已知安装位置找（`locateAcp`）。
   * 测试注入假的智能体，不读登录 shell，也不碰本机真实的命令。
   */
  locate?: () => Promise<AcpInstall | null>;
  /** 探测（起进程、初始化、建会话、取模型表）的总时限，默认 30 秒（Gemini CLI 冷启动就要十几秒）。 */
  probeTimeoutMs?: number;
  /** 能不能开会话；不给时取预设的 `verified`，预设也没给时取 `ACP_SHARED_VERIFIED`。 */
  verified?: boolean;
}

/**
 * 经 Agent Client Protocol 接入的 Driver（架构设计 §3.1）：一份实现，按预设（GitHub Copilot、Gemini CLI、Cursor Agent、Grok、Kimi Code，
 * 以及用户添加的智能体）区分怎么找、怎么启动、怎么登录。每个会话一个智能体进程。
 *
 * 共享实现经 claude-code-acp 适配器在真机上跑通了完整会话（新建、审批、追问、中断、恢复，§3.11 的 D08，`ACP_SHARED_VERIFIED`）：
 * 预设与用户添加的智能体默认 `verified`。各家智能体本身是否在 BaoCut 上实测过看预设的 `tested`。
 */
export class AcpDriver implements AgentDriver {
  readonly id: AcpDriverId;
  /** 能不能开会话（架构设计 §3.11 的 D08）：构造参数，其次预设，默认 `ACP_SHARED_VERIFIED`。 */
  readonly verified: boolean;
  /** 这一家在 BaoCut 里真机跑通过完整会话：取预设的 `tested`，不给为 false。 */
  readonly tested: boolean;
  /** 探测要拉起智能体进程（冷启动可达十几秒）：`agents.list` 不等它，也不做「便宜的纠正」（§3.11）。 */
  readonly slowProbe = true;
  readonly preset: AcpPreset;
  readonly #log: Logger;
  readonly #locate: () => Promise<AcpInstall | null>;
  readonly #probeTimeoutMs: number;
  readonly #catalogs = new Map<string, { at: number; ttl: number; result: Promise<AcpCatalog> }>();

  constructor(preset: AcpPreset | BuiltinAcpDriverId, log: Logger, options: AcpDriverOptions = {}) {
    this.preset = typeof preset === 'string' ? ACP_PRESETS[preset] : preset;
    this.id = this.preset.id;
    this.verified = options.verified ?? this.preset.verified ?? ACP_SHARED_VERIFIED;
    this.tested = this.preset.tested ?? false;
    this.#log = log.child(this.id);
    this.#locate = options.locate ?? (() => locateAcp(this.preset));
    this.#probeTimeoutMs = options.probeTimeoutMs ?? 30_000;
  }

  /**
   * 常量部分。能力（`capabilities`）其实来自智能体 `initialize` 的应答，是本机事实；探测缓存不存它，从磁盘缓存读回来时
   * 先用这里的保守值（`acpCapabilities(null)`），启动后的后台探测随即换成真实的；在那之前开的会话以 `initialize` 的
   * 应答为准（`AcpSession.capabilities`），只有发图片前的判断可能因保守值拒绝一次。
   */
  describe(): DriverDescription {
    const preset = this.preset;
    return {
      id: this.id,
      name: preset.name,
      command: preset.command,
      minVersion: preset.minVersion ?? '',
      plan: preset.plan ? String(preset.plan) : '',
      ...(preset.plan ? { planRef: refOf(preset.plan) } : {}),
      loginCommand: preset.loginCommand,
      install: preset.install ?? [],
      verified: this.verified,
      tested: this.tested,
      capabilities: acpCapabilities(null),
    };
  }

  async probe(options: ProbeOptions = {}): Promise<DriverProbe> {
    const preset = this.preset;
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
        ? DriversCommon.executableMissing({ command: preset.command, path: options.executable })
        : DriversCommon.commandMissing({ command: preset.command, hint: preset.installHint ?? DriversCommon.installItFirst() });
      return result('not-installed', detail);
    }
    const realExecutable = await fs.realpath(install.command).catch(() => null);
    // 没有最低版本（用户添加的智能体）：不看版本，直接起 ACP 模式探测。
    if (preset.minVersion !== null) {
      if (!install.version) return result('error', DriversCommon.versionFailed({ command: install.command }), { realExecutable });
      if (compareVersions(install.version, preset.minVersion) < 0) {
        return result('outdated', DriversCommon.outdated({ name: preset.name, version: install.version, min: preset.minVersion }), {
          realExecutable,
        });
      }
    }
    const catalog = await this.#catalog(install, options.force === true);
    const extra: Partial<DriverProbe> = { realExecutable, models: catalog.models, capabilities: catalog.capabilities };
    if (catalog.state === 'signed-out') {
      const login = preset.loginHint || preset.loginCommand ? loginAdvice(preset) : DriversAcp.loginPerInstructions();
      return result('signed-out', DriversAcp.signedOut({ name: preset.name, login, detail: catalog.detail ?? '' }), extra);
    }
    if (catalog.state === 'error') return result('error', catalog.detail, extra);
    return result('ready', null, extra);
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const install = await this.#find(options.executable);
    if (!install) throw agentError('driver-unavailable', DriversCommon.commandNotFound({ command: this.preset.command }), 'AGENT_NOT_INSTALLED');
    return AcpSession.start(install, this.preset, options, this.#log);
  }

  #find(executable: string | null | undefined): Promise<AcpInstall | null> {
    return executable ? acpAt(executable, { readVersion: this.preset.minVersion !== null }) : this.#locate();
  }

  /**
   * 模型表与登录状态，按「哪个命令、哪个版本」缓存；同时到来的探测共用一次。`force`（重新检测、安装结束、出错后的纠正）
   * 不用缓存，真的起一次进程：刚在终端里登录完点「重新检测」，不能还拿着 10 分钟内的 signed-out。新取的照样登记给之后共用。
   * 这层缓存与 Driver 注册表的缓存（§3.11）不冲突：注册表只决定什么时候调 `probe()`，这里只省掉短时间内重复起进程。
   */
  #catalog(install: AcpInstall, force: boolean): Promise<AcpCatalog> {
    const key = `${install.command}\0${install.version ?? ''}`;
    const hit = this.#catalogs.get(key);
    if (!force && hit && Date.now() - hit.at < hit.ttl) return hit.result;
    const entry: { at: number; ttl: number; result: Promise<AcpCatalog> } = {
      at: Date.now(),
      ttl: CATALOG_TTL_MS,
      result: Promise.resolve() as never,
    };
    entry.result = this.#readCatalog(install).then((catalog) => {
      if (catalog.state !== 'ready') entry.ttl = CATALOG_RETRY_MS;
      return catalog;
    });
    this.#catalogs.set(key, entry);
    return entry.result;
  }

  /**
   * 起一个临时进程：`initialize`、`session/new`（不连 MCP，不调模型）、读模型表，然后关掉。
   * 不打开浏览器（`NO_BROWSER`）：没登录的智能体在 `session/new` 回 -32000，记成 signed-out。
   */
  async #readCatalog(install: AcpInstall): Promise<AcpCatalog> {
    const preset = this.preset;
    let proc: AcpProcess | null = null;
    let done = false;
    let capabilities = acpCapabilities(null);
    const run = async (): Promise<AcpCatalog> => {
      const started = await AcpProcess.start({
        command: install.command,
        args: preset.args,
        cwd: os.homedir(),
        env: { ...install.env, ...preset.env, ...ACP_ENV },
        log: this.#log,
        label: preset.name,
        client: {
          requestPermission: () => ({ outcome: { outcome: 'cancelled' } }),
          sessionUpdate: () => undefined,
        },
        initTimeoutMs: this.#probeTimeoutMs,
      });
      // 超时之后才起来的进程：没人管了，直接关掉。
      if (done) {
        await started.close();
        throw new Error('probe timed out');
      }
      proc = started;
      const caps = proc.init.agentCapabilities;
      capabilities = acpCapabilities(caps);
      const session = await proc.connection.newSession({ cwd: os.homedir(), mcpServers: [] });
      let models = deriveModels(session as AcpSessionState);
      if (preset.models === 'cursor') models = (await this.#cursorModels(proc, models)) ?? models;
      if (caps?.sessionCapabilities?.close) {
        await withTimeout(proc.connection.closeSession({ sessionId: session.sessionId }), 2000, 'session/close timed out').catch(
          () => undefined,
        );
      }
      return { state: 'ready', detail: null, models, capabilities };
    };
    try {
      const running = run();
      // 超时之后它还会失败（进程被关掉）：那时没人等它了。
      running.catch(() => undefined);
      return await withTimeout(
        running,
        this.#probeTimeoutMs,
        String(DriversAcp.probeTimeout({ name: preset.name, seconds: Math.round(this.#probeTimeoutMs / 1000) })),
      );
    } catch (error) {
      if (isAuthRequired(error)) return { state: 'signed-out', detail: acpErrorMessage(error), models: [], capabilities };
      this.#log.warn('ACP probe failed', { error: acpErrorMessage(error) });
      return { state: 'error', detail: DriversAcp.acpModeFailed({ name: preset.name, error: acpErrorMessage(error) }), models: [], capabilities };
    } finally {
      done = true;
      await (proc as AcpProcess | null)?.close();
    }
  }

  /**
   * Cursor 的模型表走扩展方法 `cursor/list_available_models`（在会话里切换模型会改它的全局偏好，探测时不能那样逐个试）。
   * 取不到时退回 `session/new` 应答里的模型。
   */
  async #cursorModels(proc: AcpProcess, fallback: DriverModel[]): Promise<DriverModel[] | null> {
    try {
      const res = (await proc.connection.extMethod('cursor/list_available_models', {})) as { models?: unknown };
      if (!Array.isArray(res.models)) return null;
      const current = fallback.find((m) => m.isDefault)?.id ?? null;
      return res.models
        .filter((m): m is { value: string; name?: string } => !!m && typeof (m as { value?: unknown }).value === 'string')
        .map((m) => ({
          id: m.value,
          label: typeof m.name === 'string' && m.name ? m.name : m.value,
          description: null,
          tier: null,
          isDefault: m.value === current,
          efforts: [],
          defaultEffort: null,
        }));
    } catch (error) {
      this.#log.debug('cursor/list_available_models unavailable', { error: acpErrorMessage(error) });
      return null;
    }
  }
}

/** 内置 ACP 预设各一个 Driver，按 `BUILTIN_DRIVER_IDS` 的顺序。 */
export function acpDrivers(log: Logger): AcpDriver[] {
  return (['copilot', 'gemini', 'cursor', 'grok', 'kimi'] as const).map((id) => new AcpDriver(id, log));
}
