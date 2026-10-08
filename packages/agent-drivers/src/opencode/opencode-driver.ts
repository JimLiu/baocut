/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * packages/server/src/server/agent/providers/opencode/runtime-client.ts 的版本判定（1.x 走旧接口、2.0.10 起走 v2），
 * v2/agent.ts 的 OpenCodeV2AgentClient（fetchCatalog 起 serve 读模型表、createSession / resumeSession）。
 * 改成 BaoCut 的 DriverProbe：只接 2.x，1.x 报版本过低；没有账号也算就绪（OpenCode Zen 的免费模型不用登录），
 * 模型表按版本缓存 10 分钟；已在真机（opencode 2.0.24）以免费模型通过集成验收，标 `verified: true`。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import { nowIso, driverAvailability, refOf, type DriverId, type DriverModel, type DriverProbe, type DriverState } from '@baocut/protocol';
import type { AgentDriver, AgentSession, CreateSessionOptions, DriverDescription, Logger, ProbeOptions } from '@baocut/harness';
import { DriversCommon, DriversOpencode } from '@baocut/protocol/messages/agent-drivers';
import { refField, textOf, type DriverText } from '../driver-text.ts';
import { compareVersions } from '../login-shell.ts';
import { agentError } from '../acp/acp-session.ts';
import { locateOpenCode, majorVersion, openCodeAt, type OpenCodeInstall } from './opencode-binary.ts';
import { readCatalog } from './opencode-models.ts';
import { OPENCODE_PRESET } from './opencode-preset.ts';
import { OpenCodeServer } from './opencode-server.ts';
import { OPENCODE_DRIVER_ID, OpenCodeSession, openCodeCapabilities } from './opencode-session.ts';

/** 模型表的缓存：拿到了留 10 分钟；出错 1 分钟后再试。 */
const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_RETRY_MS = 60_000;

interface OpenCodeCatalogResult {
  state: 'ready' | 'error';
  detail: DriverText | null;
  models: DriverModel[];
  account: string | null;
}

export interface OpenCodeDriverOptions {
  /** 找到可执行文件。默认按 `BAOCUT_OPENCODE_PATH`、登录 shell 的 PATH 与已知安装位置找。测试注入假的 opencode。 */
  locate?: () => Promise<OpenCodeInstall | null>;
  /** 探测（起 serve、读模型表）与开会话的时限，默认 30 秒。 */
  timeoutMs?: number;
}

/**
 * OpenCode（2.x）的 Driver（架构设计 §3.1）：每个会话起一个 `opencode serve`，经它的 v2 HTTP API 与事件流驱动。
 *
 * 已在真机（opencode 2.0.24）以免费模型验证编辑审批、拒绝、中断、恢复与图片回合（D08）：`verified` 为 true。
 */
export class OpenCodeDriver implements AgentDriver {
  readonly id: DriverId = OPENCODE_DRIVER_ID;
  /** 已在真机以免费模型通过集成验收（架构设计 §3.11 的 D08）。 */
  readonly verified = true;
  /** 已在 BaoCut 里以真实的 opencode 跑通完整会话。 */
  readonly tested = true;
  /** 探测要起一个 `opencode serve` 读模型表：`agents.list` 不等它，也不做「便宜的纠正」（§3.11）。 */
  readonly slowProbe = true;
  readonly #log: Logger;
  readonly #locate: () => Promise<OpenCodeInstall | null>;
  readonly #timeoutMs: number;
  readonly #catalogs = new Map<string, { at: number; ttl: number; result: Promise<OpenCodeCatalogResult> }>();

  constructor(log: Logger, options: OpenCodeDriverOptions = {}) {
    this.#log = log.child('opencode');
    this.#locate = options.locate ?? locateOpenCode;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  describe(): DriverDescription {
    return {
      id: this.id,
      name: OPENCODE_PRESET.name,
      command: OPENCODE_PRESET.command,
      minVersion: OPENCODE_PRESET.minVersion,
      plan: String(OPENCODE_PRESET.plan),
      planRef: refOf(OPENCODE_PRESET.plan),
      loginCommand: OPENCODE_PRESET.loginCommand,
      install: [...OPENCODE_PRESET.install],
      verified: this.verified,
      tested: this.tested,
      capabilities: openCodeCapabilities(),
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
        ? DriversCommon.executableMissing({ command: 'opencode', path: options.executable })
        : DriversCommon.commandMissing({ command: 'opencode', hint: OPENCODE_PRESET.installHint });
      return result('not-installed', detail);
    }
    const realExecutable = await fs.realpath(install.command).catch(() => null);
    if (!install.version) return result('error', DriversCommon.versionFailed({ command: install.command }), { realExecutable });
    if (majorVersion(install.version) !== 2 || compareVersions(install.version, OPENCODE_PRESET.minVersion) < 0) {
      const newer = (majorVersion(install.version) ?? 0) > 2;
      return result(
        'outdated',
        newer
          ? DriversOpencode.unsupportedMajor({ version: install.version })
          : DriversOpencode.tooOld({ version: install.version, min: OPENCODE_PRESET.minVersion, command: OPENCODE_PRESET.install[0]!.command }),
        { realExecutable },
      );
    }
    const catalog = await this.#catalog(install, options.force === true);
    const extra: Partial<DriverProbe> = { realExecutable, models: catalog.models, account: catalog.account };
    if (catalog.state === 'error') return result('error', catalog.detail, extra);
    return result('ready', catalog.detail, extra);
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const install = await this.#find(options.executable);
    if (!install) throw agentError('driver-unavailable', DriversCommon.commandNotFound({ command: 'opencode' }), 'AGENT_NOT_INSTALLED');
    if (!install.version || majorVersion(install.version) !== 2 || compareVersions(install.version, OPENCODE_PRESET.minVersion) < 0) {
      throw agentError(
        'driver-unavailable',
        DriversOpencode.unsupportedVersion({ version: install.version ?? DriversOpencode.versionUnknown(), min: OPENCODE_PRESET.minVersion }),
        null,
      );
    }
    return OpenCodeSession.start(install, options, this.#log, this.#timeoutMs);
  }

  #find(executable: string | null | undefined): Promise<OpenCodeInstall | null> {
    return executable ? openCodeAt(executable) : this.#locate();
  }

  /** 模型表，按「哪个命令、哪个版本」缓存；同时到来的探测共用一次；`force` 不用缓存。 */
  #catalog(install: OpenCodeInstall, force: boolean): Promise<OpenCodeCatalogResult> {
    const key = `${install.command}\0${install.version ?? ''}`;
    const hit = this.#catalogs.get(key);
    if (!force && hit && Date.now() - hit.at < hit.ttl) return hit.result;
    const entry: { at: number; ttl: number; result: Promise<OpenCodeCatalogResult> } = {
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

  /** 起一个临时的 serve，在用户主目录下读模型表与已启用的 provider，然后关掉。不建会话、不调模型。 */
  async #readCatalog(install: OpenCodeInstall): Promise<OpenCodeCatalogResult> {
    let server: OpenCodeServer | null = null;
    try {
      server = await OpenCodeServer.start({
        command: install.command,
        env: install.env,
        cwd: os.homedir(),
        log: this.#log,
        startupTimeoutMs: this.#timeoutMs,
      });
      const catalog = await readCatalog(server, os.homedir());
      // 没有账号也能用：OpenCode 自带 OpenCode Zen 的免费模型，不用登录。如实说明，不报未登录。
      const detail = catalog.account
        ? null
        : DriversOpencode.noModelAccount({ command: OPENCODE_PRESET.loginCommand });
      return { state: 'ready', detail, models: catalog.models, account: catalog.account };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#log.warn('OpenCode probe failed', { error: message });
      return { state: 'error', detail: DriversOpencode.probeFailed({ error: message }), models: [], account: null };
    } finally {
      await server?.close();
    }
  }
}
