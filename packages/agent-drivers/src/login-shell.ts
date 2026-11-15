import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * 找 Agent 的命令行：登录 shell 的环境与 PATH、可执行检查、多个安装里挑版本最新的、给子进程的环境。
 * Claude、Codex 与 ACP 的 Driver 共用。
 */

const defaultRun = promisify(execFile);
const MARK = '__BAOCUT_ENV__';

/** 登录 shell 自己维护的状态，不是用户配的环境：不带过来。 */
const SHELL_STATE_ENV = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'BAOCUT_LOGIN_SHELL_PROBE']);

/** 探测失败后隔多久再试：shell 一直起不来时，不让每次取环境都等满 5 秒。 */
export const LOGIN_SHELL_RETRY_MS = 30_000;

/** 探测失败的类别：超时、shell 起不来、非零退出、输出里没有完整的标记（或超出上限）。 */
export type LoginShellFailureKind = 'timeout' | 'spawn' | 'exit' | 'output';

/** 一次失败的探测。只有类别、shell 的路径与退出码，不带环境变量与输出内容。 */
export interface LoginShellFailure {
  kind: LoginShellFailureKind;
  shell: string;
  exitCode?: number;
  /** 下次调用最早何时重新探测（`Date.now()` 的毫秒）。 */
  retryAt: number;
}

type ProbeRun = (
  file: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

export interface LoginShellEnvResolverOptions {
  run?: ProbeRun;
  platform?: NodeJS.Platform;
  env?: () => NodeJS.ProcessEnv;
  now?: () => number;
  retryMs?: number;
  onFailure?: (failure: LoginShellFailure) => void;
}

/**
 * 登录 shell 环境的解析器：成功的结果（以及 Windows 上的 null）只取一次、一直用；失败不缓存，过了 `retryMs`
 * 再调用时重新探测（issue 139：一次瞬时失败曾让整个进程一直拿精简的 PATH）。并发的调用共用同一次探测。
 */
export function createLoginShellEnvResolver(options: LoginShellEnvResolverOptions = {}): () => Promise<Record<string, string> | null> {
  const run = options.run ?? (defaultRun as unknown as ProbeRun);
  const platform = options.platform ?? process.platform;
  const currentEnv = options.env ?? (() => process.env);
  const now = options.now ?? Date.now;
  const retryMs = options.retryMs ?? LOGIN_SHELL_RETRY_MS;
  let settled: { env: Record<string, string> | null } | null = null;
  let pending: Promise<Record<string, string> | null> | null = null;
  let retryAt = 0;

  const probe = async (): Promise<Record<string, string> | null> => {
    const env = currentEnv();
    const shell = env.SHELL || '/bin/zsh';
    const fail = (kind: LoginShellFailureKind, exitCode?: number) => {
      retryAt = now() + retryMs;
      options.onFailure?.({ kind, shell, ...(exitCode === undefined ? {} : { exitCode }), retryAt });
      return null;
    };
    let stdout: string;
    try {
      ({ stdout } = await run(shell, ['-ilc', `printf '${MARK}'; /usr/bin/env -0; printf '${MARK}'`], {
        timeout: 5000,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...env, BAOCUT_LOGIN_SHELL_PROBE: '1' },
      }));
    } catch (error) {
      const failure = classifyProbeError(error);
      return fail(failure.kind, failure.exitCode);
    }
    const parts = stdout.split(MARK);
    if (parts.length < 3) return fail('output');
    const parsed = parseEnv0(parts[1]!);
    settled = { env: parsed };
    return parsed;
  };

  return () => {
    if (settled) return Promise.resolve(settled.env);
    if (platform === 'win32') {
      settled = { env: null };
      return Promise.resolve(null);
    }
    if (pending) return pending;
    if (now() < retryAt) return Promise.resolve(null);
    pending = probe().finally(() => {
      pending = null;
    });
    return pending;
  };
}

function classifyProbeError(error: unknown): { kind: LoginShellFailureKind; exitCode?: number } {
  const e = error as { code?: unknown; killed?: boolean; signal?: unknown };
  if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { kind: 'output' };
  if (e.killed || (e.signal && e.code === null)) return { kind: 'timeout' };
  if (typeof e.code === 'number') return { kind: 'exit', exitCode: e.code };
  return { kind: 'spawn' };
}

const failureListeners = new Set<(failure: LoginShellFailure) => void>();

/** 订阅本进程登录 shell 探测的失败（Runtime 用来记日志）；返回取消订阅的函数。 */
export function onLoginShellProbeFailure(listener: (failure: LoginShellFailure) => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}

/**
 * 登录 shell 的整份环境（`$SHELL -ilc` 里 `env -0` 的结果），失败或 Windows 上为 null。成功后不再探测；失败时
 * 过 `LOGIN_SHELL_RETRY_MS` 再试（见 `createLoginShellEnvResolver`）。
 *
 * 从 Finder / Dock 启动的桌面应用拿不到 shell 配置里加的 PATH（例如 `~/.bun/bin`）与变量（`GEMINI_API_KEY`、
 * `XAI_API_KEY` 这类智能体自己读的密钥），在终端里开发时这个问题会被掩盖。做法参照 VS Code 的 shellEnv
 * （paseo 的 login-shell-env.ts 同样整份导入）；这里用 `env -0` 而不是再起一个 node，NUL 分隔，多行的值也不会切错。
 */
export const resolveLoginShellEnv = createLoginShellEnvResolver({
  onFailure: (failure) => {
    for (const listener of failureListeners) listener(failure);
  },
});

/** `env -0` 的输出 → 变量表，去掉 shell 自己的状态（`SHELL_STATE_ENV`）。 */
export function parseEnv0(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of text.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    if (!SHELL_STATE_ENV.has(key)) env[key] = entry.slice(eq + 1);
  }
  return env;
}

/**
 * 登录 shell 的环境与当前进程的合并：当前进程已有的变量以当前为准（Runtime 启动时给定的 `BAOCUT_*` 之类不被
 * shell 配置改掉），只在登录 shell 里有的补上；PATH 两边合并，登录 shell 的在前。
 */
export function mergeLoginEnv(login: Record<string, string> | null, current: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...login, ...current };
  const searchPath = mergePath(login?.PATH ?? '', current.PATH ?? '');
  if (searchPath) merged.PATH = searchPath;
  return merged;
}

/**
 * 外部工具（ffmpeg、ffprobe 等）的标准安装目录：macOS 与 Linux 上 Homebrew 的默认前缀与 `/usr/local/bin`。
 * Windows 不加：GUI 进程启动时就拿到注册表里完整的 PATH。
 */
export const STANDARD_TOOL_DIRS: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin'];

/**
 * Runtime 找外部工具用的 PATH：登录 shell 的 PATH 在前，当前进程的其次，最后补上存在的标准安装目录
 * （`STANDARD_TOOL_DIRS`）。登录 shell 探测失败、或探测出的 PATH 不全时，装在默认位置的工具也找得到；
 * 自定义前缀仍靠登录 shell。`BAOCUT_FFMPEG` 这类显式覆盖不走 PATH，不受影响。
 */
export function toolSearchPath(
  login: Record<string, string> | null,
  currentPath: string,
  platform: NodeJS.Platform,
  existingDirs: readonly string[],
): string {
  return mergePath(login?.PATH ?? '', currentPath, platform === 'win32' ? '' : existingDirs.join(path.delimiter));
}

/** 本进程的工具 PATH（`toolSearchPath`，标准目录只取存在的）。 */
export async function resolveToolSearchPath(): Promise<string> {
  const login = await resolveLoginShellEnv();
  const existing =
    process.platform === 'win32' ? [] : (await Promise.all(STANDARD_TOOL_DIRS.map(async (dir) => ((await isDirectory(dir)) ? dir : null)))).filter((d) => d !== null);
  return toolSearchPath(login, process.env.PATH ?? '', process.platform, existing);
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function mergePath(...lists: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const dir of list.split(path.delimiter)) {
      if (dir && !seen.has(dir)) {
        seen.add(dir);
        out.push(dir);
      }
    }
  }
  return out.join(path.delimiter);
}

/**
 * 宿主 Claude Code 会话留下的变量。Runtime 自己若是从 Claude Code 里启动的（开发、测试时），这些会漏给子进程，
 * 让 claude 以为自己嵌在别的会话里（"cannot be launched inside another session"），或带上宿主的强度、账号、
 * 文件检查点之类的开关（实测漏过 `CLAUDE_EFFORT`、`CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL`、
 * `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`、`CLAUDE_CODE_USER_EMAIL` 等十几个）。宿主会加新的，所以按前缀清：
 * `CLAUDE_*` 与 `CLAUDECODE*` 一律去掉，只留下面白名单里用户自己会配的。`ANTHROPIC_*` 不在清理范围内，原样保留。
 *
 * 限制：从 Claude Code 里启动 Runtime 时，宿主注入的 `ANTHROPIC_*`（例如 `ANTHROPIC_BASE_URL`）与用户自己配的分不出来，照样传下去。
 */
const HOST_ENV_PREFIXES = ['CLAUDE_', 'CLAUDECODE'];

/**
 * 按前缀清理时保留的 `CLAUDE_*`：都是用户在自己的 shell 里配、宿主会话不会设的（名字都在 claude 2.1.281 的二进制里核对过）。
 * 强度（`CLAUDE_EFFORT`、`CLAUDE_CODE_EFFORT_LEVEL`）不留：BaoCut 每一轮自己给。
 */
export const USER_CLAUDE_ENV = new Set([
  // 配置目录
  'CLAUDE_CONFIG_DIR',
  // 选用哪家云或网关，以及跳过 CLI 自己的云鉴权（由外部代理或网关代为鉴权）
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_SKIP_VERTEX_AUTH',
  'CLAUDE_CODE_SKIP_FOUNDRY_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_AWS_AUTH',
  'CLAUDE_CODE_SKIP_ANTHROPIC_GOOGLE_CLOUD_AUTH',
  'CLAUDE_CODE_SKIP_MANTLE_AUTH',
  // 凭据：`claude setup-token` 生成的长期令牌；apiKeyHelper 的缓存时长
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_API_KEY_HELPER_TTL_MS',
  // 企业网络：mTLS 客户端证书、证书库
  'CLAUDE_CODE_CLIENT_CERT',
  'CLAUDE_CODE_CLIENT_KEY',
  'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
  'CLAUDE_CODE_CERT_STORE',
  // 请求与输出
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CODE_MAX_RETRIES',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  // 命令执行的环境（Windows 上 Git Bash 的位置）
  'CLAUDE_CODE_SHELL',
  'CLAUDE_CODE_SHELL_PREFIX',
  'CLAUDE_CODE_GIT_BASH_PATH',
  'CLAUDE_CODE_TMPDIR',
]);

/** 去掉宿主 Claude Code 会话的变量（见 `HOST_ENV_PREFIXES`），返回新对象，不改传入的。 */
export function stripHostSessionEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (HOST_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) && !USER_CLAUDE_ENV.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/** 给 Agent 子进程的环境：登录 shell 的环境补上当前进程没有的变量（`mergeLoginEnv`），去掉宿主会话的变量。 */
export async function agentEnv(): Promise<NodeJS.ProcessEnv> {
  return stripHostSessionEnv(mergeLoginEnv(await resolveLoginShellEnv(), process.env));
}

export async function isExecutable(file: string): Promise<boolean> {
  try {
    await fs.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findOnPath(name: string, searchPath: string): Promise<string | null> {
  for (const dir of searchPath.split(path.delimiter)) {
    if (dir && (await isExecutable(path.join(dir, name)))) return path.join(dir, name);
  }
  return null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 几个安装位置里挑版本最新、能读出版本的那个；都读不出版本时取第一个（让探测报出错原文，而不是「没装」）。
 */
export async function pickNewest<T extends { version: string | null }>(
  candidates: Iterable<string>,
  inspect: (command: string) => Promise<T>,
): Promise<T | null> {
  const installs = await Promise.all([...new Set(candidates)].map(inspect));
  const usable = installs.filter((i) => i.version !== null);
  usable.sort((a, b) => compareVersions(b.version!, a.version!));
  return usable[0] ?? installs[0] ?? null;
}
