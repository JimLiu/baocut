import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RpcError, driverAvailability, nowIso, refOf, type DriverInstallOption, type DriverModel, type DriverProbe, type DriverState } from '@baocut/protocol';
import { DriversClaude, DriversCommon } from '@baocut/protocol/messages/agent-drivers';
import type { AgentDriver, AgentSession, CreateSessionOptions, DriverDescription, Logger, ProbeOptions } from '@baocut/harness';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { officialScript, refField, textOf, type DriverText } from '../driver-text.ts';
import { compareVersions } from '../login-shell.ts';
import { claudeAt, claudeConfigDir, locateClaude, readClaudeLogin, readClaudeSettingsModels, type ClaudeInstall } from './claude-binary.ts';
import { FALLBACK_CLAUDE_MODELS, claudeModelKnown, mapClaudeModels, withSettingsModels, type ClaudeModelEntry } from './claude-models.ts';
import { createMessageInput, sdkQueryFactory, type ClaudeQueryFactory } from './claude-query.ts';
import { ClaudeSession, claudeSettingsOptions } from './claude-session.ts';

const CAPABILITIES: DriverProbe['capabilities'] = { steer: true, approvals: true, resume: true, images: true };

/** 流式输入、`canUseTool`、`supportedModels()` 这些 SDK 依赖的控制协议在 2.0 之后才齐（未逐版核对，按 SDK 的要求取整）。 */
export const CLAUDE_MIN_VERSION = '2.0.0';

/** 设计稿 data.js 的三种安装方式。官方脚本的名字随语言变，用的时候再取。 */
const installOptions = (): DriverInstallOption[] => [
  officialScript('curl -fsSL https://claude.ai/install.sh | bash', 'claude update'),
  { kind: 'brew', label: 'Homebrew', needs: 'Homebrew', command: 'brew install --cask claude-code', upgrade: 'brew upgrade --cask claude-code' },
  { kind: 'npm', label: 'npm', needs: 'Node.js', command: 'npm install -g @anthropic-ai/claude-code', upgrade: 'npm install -g @anthropic-ai/claude-code@latest' },
];

export interface ClaudeDriverOptions {
  /**
   * 找到 claude 可执行文件。默认按 `BAOCUT_CLAUDE_PATH`、登录 shell 的 PATH 与常见安装位置找（`locateClaude`）。
   * 测试注入假的 claude，不读登录 shell，也不碰本机真实的 claude。
   */
  locate?: () => Promise<ClaudeInstall | null>;
  /** 起 Query 的工厂。默认是 SDK 的 `query()`；测试注入假 Query（`testing/fake-claude.ts`）。 */
  queryFactory?: ClaudeQueryFactory;
  /** Claude Code 的用户设置文件，读其中的 `model` 与 `env` 里的模型。默认 `$CLAUDE_CONFIG_DIR/settings.json`（`~/.claude/settings.json`）。 */
  settingsFile?: string;
}

/**
 * Claude Code Driver：经 `@anthropic-ai/claude-agent-sdk` 驱动用户自己安装的 claude（架构设计 §3.1）。
 * 每个会话一个长驻的 Query，也就是一个 claude 进程（§2.1「Agent 进程：按会话」）。
 */
export class ClaudeDriver implements AgentDriver {
  readonly id = 'claude' as const;
  /** 在 BaoCut 里真机跑通过完整会话（§3.11 的 D08）。 */
  readonly tested = true;
  readonly #log: Logger;
  readonly #locate: () => Promise<ClaudeInstall | null>;
  readonly #factory: ClaudeQueryFactory;
  readonly #settingsFile: string | null;
  #models: { key: string; result: Promise<ClaudeModelEntry[] | null> } | null = null;

  constructor(log: Logger, options: ClaudeDriverOptions = {}) {
    this.#log = log.child('claude');
    this.#locate = options.locate ?? locateClaude;
    this.#factory = options.queryFactory ?? sdkQueryFactory;
    this.#settingsFile = options.settingsFile ?? null;
  }

  describe(): DriverDescription {
    return {
      id: this.id,
      name: 'Claude Code',
      command: 'claude',
      minVersion: CLAUDE_MIN_VERSION,
      plan: String(DriversClaude.plan()),
      planRef: refOf(DriversClaude.plan()),
      // 与设计稿一致用 `claude`（首次运行会引导登录）；`claude auth login` 在 2.1.x 才有，最低版本 2.0.0 不一定有。
      loginCommand: 'claude',
      install: installOptions(),
      // 经过集成测试，可以开会话（架构设计 §3.11 的 D08）。
      verified: true,
      tested: this.tested,
      capabilities: CAPABILITIES,
    };
  }

  async probe(options: ProbeOptions = {}): Promise<DriverProbe> {
    const install = await this.#find(options.executable);
    const base = {
      ...this.describe(),
      latestVersion: null,
      account: null,
      models: [] as DriverModel[],
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
        ? DriversCommon.executableMissing({ command: 'claude', path: options.executable })
        : DriversCommon.commandMissing({ command: 'claude', hint: DriversClaude.installHint() });
      return result('not-installed', detail);
    }
    const realExecutable = await fs.realpath(install.command).catch(() => null);
    if (!install.version) return result('error', DriversCommon.versionFailed({ command: install.command }), { realExecutable });
    if (compareVersions(install.version, CLAUDE_MIN_VERSION) < 0) {
      return result('outdated', DriversCommon.outdated({ name: 'Claude Code', version: install.version, min: CLAUDE_MIN_VERSION }), {
        realExecutable,
      });
    }

    const settingsFile = this.#settingsFile ?? path.join(claudeConfigDir(install.env), 'settings.json');
    const [login, models, settings] = await Promise.all([
      readClaudeLogin(install),
      this.#readModels(install, realExecutable, settingsFile, options.force === true),
      readClaudeSettingsModels(settingsFile),
    ]);
    const table = models ?? FALLBACK_CLAUDE_MODELS;
    const configModel = settings.model;
    const extra: Partial<DriverProbe> = {
      realExecutable,
      // settings.json 的 env 里指定的模型并在后面（会话加载 user 层，它们能用）。
      models: withSettingsModels(table, settings.envModels).map(({ resolvedModel: _, ...model }) => model),
      configModel,
      // 比的是 CLI 自己的模型表：`model` 写了这一版 CLI 不认得的模型时，界面提示升级。
      configModelKnown: configModel === null ? null : claudeModelKnown(configModel, table),
    };
    if (login.loggedIn === false) {
      return result('signed-out', DriversClaude.signedOut(), extra);
    }
    // 读不出登录状态（旧版本没有 `auth status`）时不挡着：真没登录的话，第一轮会以 AGENT_AUTH_REQUIRED 失败。
    if (login.loggedIn === null) this.#log.warn("Couldn't read Claude Code's sign-in status", { detail: login.detail });
    return result('ready', null, { ...extra, account: textOf(login.account), ...refField('accountRef', login.account) });
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const install = await this.#find(options.executable);
    if (!install) throw new RpcError('driver-unavailable', DriversCommon.commandNotFound({ command: 'claude' }));
    // claude 进程在第一轮才起（见 ClaudeSession），这里不会因为进程启动失败而抛错。
    return new ClaudeSession(install, options, this.#log, this.#factory);
  }

  #find(executable: string | null | undefined): Promise<ClaudeInstall | null> {
    return executable ? claudeAt(executable) : this.#locate();
  }

  /**
   * 模型表：起一个不发消息的 Query，问 `supportedModels()`，问完就关。不花钱、不要求登录（2.1.284 实测约 0.3 秒）。
   * 模型表只随 claude 的版本与用户设置（settings.json 的 env 会改模型）变，所以按「可执行文件、版本、settings.json
   * 的修改时间」缓存，不设时效：同一个 claude 在 Runtime 里只问一次，升级或改了设置后的下一次探测才重问，
   * 平常的探测只剩 `--version` 与 `auth status` 两个短命令。失败为 null（调用方退回内置表），失败不缓存。
   * `force`（重新检测）不用缓存。
   */
  async #readModels(
    install: ClaudeInstall,
    realExecutable: string | null,
    settingsFile: string,
    force: boolean,
  ): Promise<ClaudeModelEntry[] | null> {
    const settingsMtime = await fs.stat(settingsFile).then(
      (stat) => stat.mtimeMs,
      () => null,
    );
    const key = `${realExecutable ?? install.command}@${install.version}#${settingsMtime ?? 'none'}`;
    const cached = this.#models;
    if (!force && cached && cached.key === key) return cached.result;
    const entry = { key, result: this.#fetchModels(install) };
    this.#models = entry;
    void entry.result.then((models) => {
      if (models === null && this.#models === entry) this.#models = null;
    });
    return entry.result;
  }

  async #fetchModels(install: ClaudeInstall): Promise<ClaudeModelEntry[] | null> {
    const input = createMessageInput<SDKUserMessage>();
    let query: ReturnType<ClaudeQueryFactory> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      query = this.#factory({
        prompt: input.iterable,
        options: {
          pathToClaudeCodeExecutable: install.command,
          env: install.env,
          cwd: os.tmpdir(),
          // 与会话同样的设置层：user 层 env 里的 ANTHROPIC_DEFAULT_*_MODEL 之类会影响模型表；hooks 关掉，探测不触发 SessionStart。
          ...claudeSettingsOptions(),
          persistSession: false,
        },
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('supportedModels timed out')), 15_000);
      });
      const infos = await Promise.race([query.supportedModels(), timeout]);
      const models = mapClaudeModels(infos);
      return models.length > 0 ? models : null;
    } catch (error) {
      this.#log.warn("Couldn't read Claude Code's model list; using the built-in short list", { error: error instanceof Error ? error.message : String(error) });
      return null;
    } finally {
      clearTimeout(timer);
      input.end();
      try {
        query?.close();
      } catch {
        // 已经退出。
      }
    }
  }
}
