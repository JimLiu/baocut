/*
 * 部分机制移植自 paseo（Apache-2.0，Copyright (c) 2025-present Mohamed Boudra），modified：
 * - packages/server/src/server/agent/providers/claude/models.ts 的 CLAUDE_SETTINGS_MODEL_ENV_KEYS 与 readClaudeSettingsModels
 *   （读 settings.json 的 model 与 env 里的模型）
 * - packages/server/src/server/agent/providers/claude/query.ts 的 spawnClaudeCodeProcess（Windows 上不经 cmd.exe 起 claude）
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DriversClaude } from '@baocut/protocol/messages/agent-drivers';
import type { DriverText } from '../driver-text.ts';
import { agentEnv, findOnPath, isExecutable, pickNewest } from '../login-shell.ts';

const run = promisify(execFile);

export interface ClaudeInstall {
  command: string;
  version: string | null;
  env: NodeJS.ProcessEnv;
}

/**
 * 在 PATH 上找的文件名，与 PATH 上找不到时（例如没进登录 shell 的配置）再看的常见位置。
 * - macOS / Linux：官方脚本（`~/.local/bin`）、旧版本地安装（`~/.claude/local`）、Homebrew。
 * - Windows：官方脚本装的 `%USERPROFILE%\.local\bin\claude.exe`；npm 全局安装的批处理垫片 `%APPDATA%\npm\claude.cmd`
 *   （见 `resolveCmdShim`）。未在 Windows 上验证。
 */
export function claudeSearch(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): { names: string[]; locations: string[] } {
  if (platform === 'win32') {
    const win = path.win32;
    const appData = env.APPDATA || win.join(home, 'AppData', 'Roaming');
    return {
      names: ['claude.exe', 'claude.cmd'],
      locations: [win.join(home, '.local', 'bin', 'claude.exe'), win.join(appData, 'npm', 'claude.cmd')],
    };
  }
  return {
    names: ['claude'],
    locations: [
      path.join(home, '.claude', 'local', 'claude'),
      path.join(home, '.local', 'bin', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ],
  };
}

/**
 * npm 在 Windows 上装的 `claude.cmd` 是批处理垫片。Node 20.12 / 18.20.2 起不经 shell 不能直接 `execFile` / `spawn` 一个 .cmd（EINVAL），
 * 经 cmd.exe 又会弄坏 SDK 传给 CLI 的带引号的 JSON 参数（paseo 的 claude/query.ts 因此用 `shell: false`）。所以从垫片里读出
 * 它真正启动的文件：npm cmd-shim 写成 `"%dp0%\<相对路径>"`，取最后一个（前面可能是 `%dp0%\node.exe`）。
 * `.exe` 直接用；`.js` 用 node 跑（见 `claudeExec`；SDK 遇到 `.js` 的 pathToClaudeCodeExecutable 也自己用 node 起）。
 * 读不出时为 null。未在 Windows 上验证。
 */
export function parseCmdShimTarget(content: string, shimDir: string): string | null {
  const targets = [...content.matchAll(/"%~?dp0%?\\([^"%]+)"/gi)].map((m) => m[1]!).filter((rel) => !/^node\.exe$/i.test(rel));
  const last = targets.at(-1);
  return last ? path.win32.join(shimDir, last) : null;
}

/** `.cmd` 换成垫片指向的文件；不是 `.cmd`、读不出时原样返回（探测随后报 `--version` 没有正常退出）。 */
export async function resolveCmdShim(file: string): Promise<string> {
  if (!/\.cmd$/i.test(file)) return file;
  try {
    const target = parseCmdShimTarget(await fs.readFile(file, 'utf8'), path.win32.dirname(file));
    return target && (await isExecutable(target)) ? target : file;
  } catch {
    return file;
  }
}

/** 跑 claude 的子命令（`--version`、`auth status`）用的程序与前置参数：`.js` 入口交给 node。 */
export function claudeExec(command: string): { file: string; args: string[] } {
  return /\.[cm]?js$/i.test(command) ? { file: 'node', args: [command] } : { file: command, args: [] };
}

let located: { at: number; result: Promise<ClaudeInstall | null> } | null = null;

/**
 * `BAOCUT_CLAUDE_PATH` 优先；否则在登录 shell 的 PATH 与常见安装位置里取版本最新的一个。
 * 结果缓存 30 秒，避免每次开会话都跑一遍 `--version`。
 */
export function locateClaude(): Promise<ClaudeInstall | null> {
  if (!located || Date.now() - located.at > 30_000) {
    located = { at: Date.now(), result: findClaude() };
  }
  return located.result;
}

async function findClaude(): Promise<ClaudeInstall | null> {
  const env = await agentEnv();
  const override = process.env.BAOCUT_CLAUDE_PATH;
  if (override) return inspectClaude(override, env);

  const search = claudeSearch(process.platform, env, os.homedir());
  const candidates: string[] = [];
  for (const name of search.names) {
    const onPath = await findOnPath(name, env.PATH ?? '');
    if (onPath) candidates.push(onPath);
  }
  for (const file of search.locations) {
    if (await isExecutable(file)) candidates.push(file);
  }
  const resolved = process.platform === 'win32' ? await Promise.all(candidates.map(resolveCmdShim)) : candidates;
  return pickNewest(resolved, (command) => inspectClaude(command, env));
}

/** 用户手动指定的 claude：只认这一个，不再到别处找。不存在或不可执行时为 null。 */
export async function claudeAt(command: string): Promise<ClaudeInstall | null> {
  if (!(await isExecutable(command))) return null;
  return inspectClaude(process.platform === 'win32' ? await resolveCmdShim(command) : command, await agentEnv());
}

/** 跑一次 `--version`，读不出版本时 version 为 null（探测报「出错」）。 */
export async function inspectClaude(command: string, env: NodeJS.ProcessEnv): Promise<ClaudeInstall> {
  return { command, version: await readClaudeVersion(command, env), env };
}

/** `claude --version` 输出 `2.1.284 (Claude Code)`。 */
export function parseClaudeVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

async function readClaudeVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const exec = claudeExec(command);
    const { stdout } = await run(exec.file, [...exec.args, '--version'], { env, timeout: 10_000 });
    return parseClaudeVersion(stdout);
  } catch {
    return null;
  }
}

/** `claude auth status` 的 JSON（2.1.284 实测与二进制里的字段）。 */
export interface ClaudeAuthStatus {
  loggedIn?: boolean;
  /** `none` / `claude.ai` / `api_key` / `api_key_helper` / `oauth_token` / `third_party` */
  authMethod?: string;
  /** `firstParty` / `bedrock` / `vertex` / `foundry` / `gateway` …… */
  apiProvider?: string;
  subscriptionType?: string;
  email?: string;
  orgName?: string;
}

export interface ClaudeLogin {
  /** null：读不出登录状态（旧版本没有 `auth status`、输出不是 JSON）。 */
  loggedIn: boolean | null;
  /** 已登录的账号描述，例如「Claude Pro 订阅」。不含邮箱。BaoCut 写的是 `Localized`，第三方云的名字是原话。 */
  account: DriverText | null;
  detail: string | null;
}

/**
 * `claude auth status`：stdout 是 JSON；已登录时退出码 0，没登录时 1（stdout 照样是 JSON），所以退出码非 0 也要解析。
 * 不登录、不输入凭据，只读状态。
 */
export async function readClaudeLogin(install: ClaudeInstall): Promise<ClaudeLogin> {
  let stdout = '';
  let failure = '';
  try {
    const exec = claudeExec(install.command);
    ({ stdout } = await run(exec.file, [...exec.args, 'auth', 'status'], { env: install.env, timeout: 10_000 }));
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    stdout = e.stdout ?? '';
    failure = (e.stderr || e.message).trim();
  }
  let status: ClaudeAuthStatus;
  try {
    status = JSON.parse(stdout) as ClaudeAuthStatus;
  } catch {
    return { loggedIn: null, account: null, detail: failure || stdout.trim() || null };
  }
  // 第三方云（Bedrock、Vertex……）的鉴权在 CLI 之外，不看 loggedIn（未验证：手上没有这类账号）。
  const loggedIn = status.loggedIn === true || status.authMethod === 'third_party';
  return { loggedIn, account: loggedIn ? claudeAccount(status) : null, detail: null };
}

function subscription(type: string | undefined): DriverText | undefined {
  switch (type) {
    case 'pro':
      return DriversClaude.subscriptionPro();
    case 'max':
      return DriversClaude.subscriptionMax();
    case 'team':
      return DriversClaude.subscriptionTeam();
    case 'enterprise':
      return DriversClaude.subscriptionEnterprise();
    default:
      return undefined;
  }
}

/** 第三方云的名字：产品名照原样，带说明的由 BaoCut 写。 */
function provider(name: string | undefined): DriverText | undefined {
  switch (name) {
    case 'bedrock':
      return 'Amazon Bedrock';
    case 'vertex':
      return 'Google Vertex AI';
    case 'foundry':
      return 'Microsoft Foundry';
    case 'anthropicAws':
      return DriversClaude.providerAnthropicAws();
    case 'anthropicGoogleCloud':
      return DriversClaude.providerAnthropicGoogleCloud();
    default:
      return undefined;
  }
}

/**
 * 登录方式 → 设置页上的账号描述。邮箱不放进来：它会出现在日志与快照里。BaoCut 写的说明是 `Localized`（探测结果带
 * `accountRef`），没认出的第三方云照 CLI 给的原名。
 */
export function claudeAccount(status: ClaudeAuthStatus): DriverText {
  if (status.apiProvider === 'gateway') return DriversClaude.enterpriseGateway();
  switch (status.authMethod) {
    case 'claude.ai':
      return subscription(status.subscriptionType) ?? DriversClaude.claudeAccount();
    case 'oauth_token':
      return DriversClaude.longLivedToken();
    case 'api_key':
    case 'api_key_helper':
      return DriversClaude.apiKey();
    case 'third_party':
      return provider(status.apiProvider) ?? status.apiProvider ?? DriversClaude.thirdPartyCloud();
    default:
      return DriversClaude.claudeAccount();
  }
}

/** `claudeAccount` 的文字（当前语言）。 */
export function describeClaudeAccount(status: ClaudeAuthStatus): string {
  return String(claudeAccount(status));
}

/** Claude Code 的配置目录：`CLAUDE_CONFIG_DIR`，默认 `~/.claude`。 */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

/**
 * 用户设置里指定模型的 `env` 键（会话加载 user 层，见 claude-session.ts 的 `claudeSettingsOptions`，这些会生效）。
 * `ANTHROPIC_SMALL_FAST_MODEL` 是后台用的小模型，不是可选的主模型，不收。
 */
export const CLAUDE_SETTINGS_MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_FABLE_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

export interface ClaudeSettingsModels {
  /** `settings.json` 的 `model`。没写为 null。 */
  model: string | null;
  /** `settings.json` 的 `env` 里指定的模型，按 `CLAUDE_SETTINGS_MODEL_ENV_KEYS` 的顺序，去重。 */
  envModels: Array<{ key: (typeof CLAUDE_SETTINGS_MODEL_ENV_KEYS)[number]; id: string }>;
}

/** 用户设置里的模型（`settings.json` 的 `model` 与 `env`）。读不到、不是 JSON 时什么都没有。 */
export async function readClaudeSettingsModels(file: string): Promise<ClaudeSettingsModels> {
  const none: ClaudeSettingsModels = { model: null, envModels: [] };
  let settings: { model?: unknown; env?: unknown };
  try {
    settings = JSON.parse(await fs.readFile(file, 'utf8')) as { model?: unknown; env?: unknown };
  } catch {
    return none;
  }
  if (!settings || typeof settings !== 'object') return none;
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const env = settings.env && typeof settings.env === 'object' ? (settings.env as Record<string, unknown>) : {};
  const envModels: ClaudeSettingsModels['envModels'] = [];
  for (const key of CLAUDE_SETTINGS_MODEL_ENV_KEYS) {
    const id = text(env[key]);
    if (id && !envModels.some((m) => m.id === id)) envModels.push({ key, id });
  }
  return { model: text(settings.model), envModels };
}
