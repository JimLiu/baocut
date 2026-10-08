import path from 'node:path';
import readline from 'node:readline/promises';
import type { ParseArgsOptionsConfig, parseArgs } from 'node:util';
import type { BaoCutClient } from '@baocut/client';
import type { CatalogToolError, JobRecord } from '@baocut/protocol';
import { ProgressReporter } from '../catalog/progress.ts';
import { M as CLI } from '../cli-copy.ts';
import { CliError, EXIT, exitCodeForJob, type ExitCode, type Output } from '../envelope.ts';
import { waitForJob, watchJobs } from '../job-wait.ts';

/**
 * 管理桶（Agent 面设计 §7）的公共部分：每个名词一个文件（`admin/<名词>.ts`），各自声明旗标与用法，共用这里的上下文、
 * §5.1 的信封与 §5.2 的退出码。手写的格式（`*-output.ts`）只在给人读时用；`--json`（stdout 不是 TTY 时默认）写协议方法的
 * 原始结果。
 */

/** 每个名词都认的旗标。 */
export const COMMON_OPTIONS = {
  json: { type: 'boolean' },
  'no-json': { type: 'boolean' },
  'no-start': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies ParseArgsOptionsConfig;

export type AdminValues<O extends ParseArgsOptionsConfig> = ReturnType<
  typeof parseArgs<{ options: O & typeof COMMON_OPTIONS; allowPositionals: true; strict: true }>
>['values'];

export interface AdminNoun<O extends ParseArgsOptionsConfig = ParseArgsOptionsConfig> {
  name: string;
  /** 与目录同名的名词（`models`、`jobs`、`space`、`library`、`skills`）只认这些子命令，其余交给派生命令。 */
  verbs?: readonly string[];
  partial?: true;
  /** 不连 Runtime 的子命令（`skill path`）：`ctx.client` 不可用。 */
  offline?: readonly string[];
  /** `baocut <名词> --help` 与 `baocut help <名词>` 的正文。 */
  usage: string;
  options: O;
  run(ctx: AdminRun<AdminValues<O>>): Promise<ExitCode>;
}

/** 声明一个名词（保留旗标的字面类型）。 */
export function defineNoun<const O extends ParseArgsOptionsConfig>(noun: AdminNoun<O>): AdminNoun<O> {
  return noun;
}

export interface FollowOptions {
  /** 完成时：写结果，返回退出码。 */
  complete: (job: JobRecord) => Promise<ExitCode> | ExitCode;
  /** 失败、取消或中断时补充说明（写 stderr）；之后写失败信封。 */
  stopped?: (job: JobRecord) => void;
  /** 只认第几次尝试之后的记录。 */
  minAttempt?: number;
  onUpdate?: (job: JobRecord) => void;
}

export class AdminRun<V> {
  readonly #client: BaoCutClient | null;
  readonly output: Output;
  readonly cwd: string;
  /** Runtime Home（`BAOCUT_HOME`）。 */
  readonly home: string;
  readonly env: NodeJS.ProcessEnv;
  /** 名词之后的位置参数。 */
  readonly args: string[];
  readonly values: V;
  readonly usage: string;

  constructor(init: {
    client: BaoCutClient | null;
    output: Output;
    cwd: string;
    home?: string;
    env?: NodeJS.ProcessEnv;
    args: string[];
    values: V;
    usage: string;
  }) {
    this.#client = init.client;
    this.output = init.output;
    this.cwd = init.cwd;
    this.home = init.home ?? '';
    this.env = init.env ?? process.env;
    this.args = init.args;
    this.values = init.values;
    this.usage = init.usage;
  }

  /** 到 Runtime 的连接；名词声明为 `offline` 的子命令里没有。 */
  get client(): BaoCutClient {
    if (!this.#client) throw new Error(CLI.noRuntimeClient);
    return this.#client;
  }

  /** 成功：`--json` 写原始结果的信封，给人读时打印这几行。 */
  done(result: unknown, lines: readonly string[], next?: string | null): ExitCode {
    return this.output.report(result, lines, next);
  }

  /** 没有抛错、但这条命令没有做成（审批已处理过、服务没起来等）：失败信封。 */
  fail(error: CatalogToolError, exitCode?: ExitCode): ExitCode {
    return this.output.failure(error, exitCode);
  }

  /** 给人看的过程说明，写 stderr（不碰 stdout 的 JSON）。 */
  log(line: string): void {
    this.output.stderr.write(`${line}\n`);
  }

  /** 用法错误（退出码 4）。 */
  usageError(message: string = this.usage): CliError {
    return new CliError('INVALID_ARGUMENTS', message);
  }

  /** 跑一段参数解析：`*-output.ts` 里的解析函数抛的普通错误都是用法错误。 */
  parse<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw this.usageError(error instanceof Error ? error.message : String(error));
    }
  }

  /** 相对路径按工作目录解析。 */
  resolve(file: string): string {
    return path.resolve(this.cwd, file);
  }

  /**
   * 要用户同意才做的事（下载、执行更新命令）：`--yes` 直接同意；终端里问一次；不在终端里又没给 `--yes` 时以
   * `CONFIRMATION_REQUIRED`（退出码 4）拒绝，不默认同意。
   */
  async confirm(question: string, yes: boolean | undefined, refusal: string): Promise<boolean> {
    if (yes) return true;
    if (!process.stdin.isTTY) throw new CliError('CONFIRMATION_REQUIRED', refusal);
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = (await rl.question(question)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes';
    } finally {
      rl.close();
    }
  }

  /** 提交一个任务并跟到终态：进度写 stderr，完成交给 `complete`，失败写失败信封（退出码按任务的错误码）。 */
  async follow(submit: () => Promise<{ jobId: string }>, options: FollowOptions): Promise<ExitCode> {
    const watcher = watchJobs(this.client);
    let jobId: string;
    try {
      ({ jobId } = await submit());
    } catch (error) {
      watcher.close();
      throw error;
    }
    const progress = new ProgressReporter('text', this.output.stderr);
    const outcome = await waitForJob(this.client, jobId, watcher, {
      progress,
      ...(options.minAttempt !== undefined ? { minAttempt: options.minAttempt } : {}),
      ...(options.onUpdate ? { onUpdate: options.onUpdate } : {}),
    });
    const job = outcome.job!;
    if (job.state === 'completed') return options.complete(job);
    options.stopped?.(job);
    const code = job.error?.code ?? (job.state === 'cancelled' ? 'JOB_CANCELLED' : 'JOB_FAILED');
    return this.output.failure(
      {
        code,
        message: job.error?.message ?? job.state,
        jobId: job.jobId,
        state: job.state,
        ...(job.error?.details !== undefined && job.error.details !== null ? { details: job.error.details } : {}),
      },
      exitCodeForJob(code),
    );
  }
}

/** 读标准输入的全部内容。 */
export async function readStdin(prompt: string | null): Promise<string> {
  if (process.stdin.isTTY && prompt) process.stderr.write(`${prompt}\n`);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

export { EXIT };
