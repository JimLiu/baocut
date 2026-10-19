import { spawn, type ChildProcess } from 'node:child_process';
import { killProcessTree, type SpawnProcess } from '@baocut/process-host';

/**
 * 运行 git（版本记录设计 §5.4）：参数是数组、不经 shell，POSIX 上自成一个进程组，超时整组终止；每次调用都带固定的安全参数，
 * 不执行仓库带来的钩子、fsmonitor、签名程序、编辑器与分页器，不访问网络。
 *
 * - 环境：去掉调用方环境里所有 `GIT_*` 变量（`GIT_DIR`、`GIT_WORK_TREE`、`GIT_CONFIG_COUNT` 这一类会把命令指到别处或注入配置），
 *   只留 `GIT_CONFIG_GLOBAL`、`GIT_CONFIG_SYSTEM`、`GIT_CONFIG_NOSYSTEM`（用户自己选的全局配置位置）；也去掉 `EMAIL`，免得没配身份时
 *   git 拿它当作者。再补上 `GIT_TERMINAL_PROMPT=0`、不用编辑器与分页器、`LC_ALL=C`（解析输出），只读查询加 `GIT_OPTIONAL_LOCKS=0`。
 * - 输出按字节收，路径类输出用 `-z`。
 */

/** 每次调用都带的 `-c`：钩子目录另给（BaoCut 的空目录）。 */
const SAFE_CONFIG = [
  'core.fsmonitor=false',
  'commit.gpgSign=false',
  'tag.gpgSign=false',
  'maintenance.auto=false',
  'gc.auto=0',
  'submodule.recurse=false',
  'diff.ignoreSubmodules=all',
  'log.showSignature=false',
  'core.editor=:',
  'core.pager=cat',
  'core.askPass=',
  'credential.helper=',
  'protocol.allow=never',
] as const;

/** 留下的 `GIT_*` 环境变量（大写比较：Windows 的环境变量不分大小写）。 */
const KEPT_GIT_ENV = new Set(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM']);

const DEFAULT_TIMEOUT_MS = 60_000;
const STDERR_LIMIT = 64 * 1024;

export interface GitRunnerOptions {
  /** git 可执行文件的绝对路径。 */
  git: string;
  /** 工具环境（登录 shell 的 PATH）。 */
  env: NodeJS.ProcessEnv;
  /** `core.hooksPath` 指向的空目录（Runtime Home 里）。 */
  hooksDir: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** 测试注入。 */
  spawn?: SpawnProcess;
}

export interface GitRunOptions {
  /** 只读查询：加 `GIT_OPTIONAL_LOCKS=0`，不顺手刷新索引。 */
  query?: boolean;
  /** 路径参数按字面解释（`--literal-pathspecs`）。发现视频用的 `:(glob)` 查询不加。 */
  literal?: boolean;
  /** 额外的 `-c`（作者的兜底身份）。 */
  config?: readonly string[];
  /** 标准输入（`--pathspec-from-file=-`）。 */
  input?: string | Buffer;
  timeoutMs?: number;
}

export interface GitResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
}

/** git 没能运行（启动失败、超时、被信号结束）：不是 git 自己的非零退出。 */
export class GitRunError extends Error {
  readonly kind: 'failed-to-start' | 'timed-out' | 'signalled';

  constructor(kind: GitRunError['kind'], message: string) {
    super(message);
    this.name = 'GitRunError';
    this.kind = kind;
  }
}

export class GitRunner {
  readonly git: string;
  readonly #options: GitRunnerOptions;
  readonly #env: NodeJS.ProcessEnv;

  constructor(options: GitRunnerOptions) {
    this.git = options.git;
    this.#options = options;
    this.#env = gitEnv(options.env);
  }

  /** 完整的参数（测试与日志用）。 */
  argv(args: readonly string[], options: GitRunOptions = {}): string[] {
    const config = [...SAFE_CONFIG, `core.hooksPath=${this.#options.hooksDir}`, ...(options.config ?? [])];
    return ['--no-pager', ...(options.literal ? ['--literal-pathspecs'] : []), ...config.flatMap((entry) => ['-c', entry]), ...args];
  }

  /** 运行一条 git 命令。非零退出照常返回；没能运行时抛出 `GitRunError`。 */
  async run(cwd: string, args: readonly string[], options: GitRunOptions = {}): Promise<GitResult> {
    const platform = this.#options.platform ?? process.platform;
    const posix = platform !== 'win32';
    const run = this.#options.spawn ?? spawn;
    const env = options.query ? { ...this.#env, GIT_OPTIONAL_LOCKS: '0' } : this.#env;
    const argv = this.argv(args, options);
    return await new Promise<GitResult>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = run(this.git, argv, {
          cwd,
          env,
          stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
          windowsHide: true,
          detached: posix,
        });
      } catch (error) {
        reject(new GitRunError('failed-to-start', String(error)));
        return;
      }
      const stdout: Buffer[] = [];
      let stderr = '';
      let timedOut = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        killProcessTree(child, 'SIGKILL', { platform, spawn: run });
      }, options.timeoutMs ?? this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const finish = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outcome();
      };
      child.stdout!.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr!.setEncoding('utf8');
      child.stderr!.on('data', (chunk: string) => {
        if (stderr.length < STDERR_LIMIT) stderr += chunk.slice(0, STDERR_LIMIT - stderr.length);
      });
      child.on('error', (error: NodeJS.ErrnoException) => finish(() => reject(new GitRunError('failed-to-start', error.code ?? error.message))));
      child.on('close', (code, signal) =>
        finish(() => {
          if (timedOut) reject(new GitRunError('timed-out', `git ${args[0] ?? ''} timed out`));
          else if (code === null) reject(new GitRunError('signalled', `git ${args[0] ?? ''} was terminated by ${signal ?? 'a signal'}`));
          else resolve({ exitCode: code, stdout: Buffer.concat(stdout), stderr });
        }),
      );
      if (options.input !== undefined) {
        // git 不读完标准输入就退出时（参数错误）写入会 EPIPE：结果以退出码为准。
        child.stdin!.on('error', () => {});
        child.stdin!.end(options.input);
      }
    });
  }
}

/** 运行 git 用的环境：见文件头。 */
export function gitEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    const upper = key.toUpperCase();
    if (upper.startsWith('GIT_') && !KEPT_GIT_ENV.has(upper)) continue;
    if (upper === 'EMAIL' || upper === 'LC_ALL' || upper === 'LANGUAGE') continue;
    env[key] = value;
  }
  return {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: ':',
    GIT_PAGER: 'cat',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GCM_INTERACTIVE: 'never',
    LC_ALL: 'C',
  };
}

/** 一行输出（去掉末尾的换行）。 */
export function line(output: Buffer): string {
  return output.toString('utf8').replace(/\r?\n$/, '');
}

/** `-z` 输出拆成条目（末尾的空串去掉）。 */
export function nulFields(output: Buffer): string[] {
  const fields = output.toString('utf8').split('\0');
  if (fields.at(-1) === '') fields.pop();
  return fields;
}

/** git 的错误输出里给人看的那一句：`fatal:` / `error:` 开头的第一行，没有时第一行。 */
export function gitErrorDetail(result: Pick<GitResult, 'stderr' | 'exitCode'>): string {
  const lines = result.stderr
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter(Boolean);
  const said = lines.find((text) => /^(fatal|error):/.test(text)) ?? lines[0];
  return said ? said.replace(/^(fatal|error):\s*/, '') : `exit code ${result.exitCode}`;
}
