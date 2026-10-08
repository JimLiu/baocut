import fs from 'node:fs/promises';
import { RpcError, driverAvailability, nowIso, refOf, type DriverInstallOption, type DriverProbe, type DriverState } from '@baocut/protocol';
import type { AgentDriver, AgentSession, CreateSessionOptions, DriverDescription, Logger, ProbeOptions } from '@baocut/harness';
import { DriversCodex, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import { refField, textOf, type DriverText } from '../driver-text.ts';
import { compareVersions } from '../login-shell.ts';
import { codexAt, locateCodex, codexAccount, readCodexLogin, type CodexInstall } from './codex-binary.ts';
import { codexHome, readCodexConfigModel } from './codex-config.ts';
import { listCodexModels, type CodexCatalog } from './codex-models.ts';
import { CODEX_CAPABILITIES, CodexSession } from './codex-session.ts';

/** 模型目录的缓存：拿到了留 10 分钟；失败或空表 1 分钟后再试（登录、升级之后不必等太久）。 */
const CATALOG_TTL_MS = 10 * 60_000;
const CATALOG_RETRY_MS = 60_000;

/** 机器协议（`codex-protocol.ts`）对照的版本；更旧的 app-server 字段对不上（架构设计 §6.9）。 */
export const CODEX_MIN_VERSION = '0.158.0';

const INSTALL: DriverInstallOption[] = [
  { kind: 'brew', label: 'Homebrew', needs: 'Homebrew', command: 'brew install codex', upgrade: 'brew upgrade codex' },
  { kind: 'npm', label: 'npm', needs: 'Node.js', command: 'npm install -g @openai/codex', upgrade: 'npm install -g @openai/codex@latest' },
];

export interface CodexDriverOptions {
  /**
   * 找到 codex 可执行文件。默认按 `BAOCUT_CODEX_PATH`、登录 shell 的 PATH 与已知安装位置找（`locateCodex`）。
   * 测试注入假的 codex，不读登录 shell，也不碰本机真实的 codex。
   */
  locate?: () => Promise<CodexInstall | null>;
  /** 取模型表（临时 app-server）的总时限，默认 15 秒。测试用来覆盖卡住不应答的情形。 */
  modelListTimeoutMs?: number;
}

/**
 * Codex Driver：经 `codex app-server` 的机器协议接入（架构设计 §3.1）。
 * 每个会话一个 app-server 进程（§2.1「Agent 进程：按会话」）。
 */
export class CodexDriver implements AgentDriver {
  readonly id = 'codex' as const;
  /** 在 BaoCut 里真机跑通过完整会话（§3.11 的 D08）。 */
  readonly tested = true;
  readonly #log: Logger;
  readonly #locate: () => Promise<CodexInstall | null>;
  readonly #modelListTimeoutMs: number | undefined;
  readonly #catalogs = new Map<string, { at: number; ttl: number; result: Promise<CodexCatalog | null> }>();

  constructor(log: Logger, options: CodexDriverOptions = {}) {
    this.#log = log.child('codex');
    this.#locate = options.locate ?? locateCodex;
    this.#modelListTimeoutMs = options.modelListTimeoutMs;
  }

  describe(): DriverDescription {
    return {
      id: this.id,
      name: 'Codex',
      command: 'codex',
      minVersion: CODEX_MIN_VERSION,
      plan: String(DriversCodex.plan()),
      planRef: refOf(DriversCodex.plan()),
      loginCommand: 'codex login',
      install: INSTALL,
      // 经过集成测试，可以开会话（架构设计 §3.11 的 D08）。
      verified: true,
      tested: this.tested,
      capabilities: CODEX_CAPABILITIES,
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
        ? DriversCommon.executableMissing({ command: 'codex', path: options.executable })
        : DriversCommon.commandMissing({ command: 'codex', hint: DriversCodex.installHint() });
      return result('not-installed', detail);
    }
    const [realExecutable, configModel] = await Promise.all([
      fs.realpath(install.command).catch(() => null),
      readCodexConfigModel(install.env),
    ]);
    if (!install.version) return result('error', DriversCommon.versionFailed({ command: install.command }), { realExecutable, configModel });
    if (compareVersions(install.version, CODEX_MIN_VERSION) < 0) {
      return result('outdated', DriversCommon.outdated({ name: 'Codex', version: install.version, min: CODEX_MIN_VERSION }), { realExecutable, configModel });
    }
    // 未登录也取模型表：依 codex 源码（models-manager），没有凭据时不联网，退回随 CLI 发布的内置表与本地缓存（未实测）。
    const [login, catalog] = await Promise.all([readCodexLogin(install), this.#catalog(install, options.force === true)]);
    const extra: Partial<DriverProbe> = {
      realExecutable,
      models: catalog?.models ?? [],
      configModel,
      // 含隐藏模型在内认不认得配置里的模型；没有配置或没拿到目录时说不清，为 null。
      configModelKnown: configModel && catalog && catalog.all.length > 0 ? catalog.all.includes(configModel) : null,
    };
    if (!login.loggedIn) {
      return result('signed-out', DriversCodex.signedOut({ detail: login.detail }), extra);
    }
    const account = codexAccount(login.detail);
    return result('ready', null, { ...extra, account: textOf(account), ...refField('accountRef', account) });
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const install = await this.#find(options.executable);
    if (!install) throw new RpcError('driver-unavailable', DriversCommon.commandNotFound({ command: 'codex' }));
    try {
      return await CodexSession.start(install, options, this.#log);
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError('driver-failed', DriversCommon.startFailed({ name: 'Codex', error: error instanceof Error ? error.message : String(error) }));
    }
  }

  #find(executable: string | null | undefined): Promise<CodexInstall | null> {
    return executable ? codexAt(executable) : this.#locate();
  }

  /**
   * 模型目录，按「哪个 codex、哪个版本、哪个配置目录」缓存；同时到来的探测共用一次请求。
   * 拿不到（超时、出错）为 null，探测照常返回，`models` 给空表。`force`（重新检测）不用缓存，新取的照样登记给之后共用。
   */
  #catalog(install: CodexInstall, force: boolean): Promise<CodexCatalog | null> {
    const key = [install.command, install.version ?? '', codexHome(install.env)].join('\0');
    const hit = this.#catalogs.get(key);
    if (!force && hit && Date.now() - hit.at < hit.ttl) return hit.result;
    const entry = { at: Date.now(), ttl: CATALOG_TTL_MS, result: Promise.resolve<CodexCatalog | null>(null) };
    entry.result = listCodexModels(install, this.#log, this.#modelListTimeoutMs).then(
      (catalog) => {
        if (catalog.all.length === 0) entry.ttl = CATALOG_RETRY_MS;
        return catalog;
      },
      (error: unknown) => {
        this.#log.warn("Couldn't get the Codex model list", { error: error instanceof Error ? error.message : String(error) });
        entry.ttl = CATALOG_RETRY_MS;
        return null;
      },
    );
    this.#catalogs.set(key, entry);
    return entry.result;
  }
}
