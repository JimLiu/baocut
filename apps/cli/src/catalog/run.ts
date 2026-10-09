import fs from 'node:fs';
import path from 'node:path';
import { localizeText, type CatalogToolError, type JobRecord, type ModelInstallResult } from '@baocut/protocol';
import { formatBytes } from '../admin/models-output.ts';
import { M } from '../cli-copy.ts';
import { CliError, EXIT, exitCodeForJob, isRecord, type ExitCode, type Output } from '../envelope.ts';
import type { Session } from '../runtime/connection.ts';
import { summaryOf, type CatalogCommand } from './command-tree.ts';
import { kebab, projectDirectory, type GlobalFlags } from './flags.ts';
import { ProgressReporter } from './progress.ts';
import { waitForJob, watchJobs, type JobWatcher } from '../job-wait.ts';

/**
 * 执行一条派生命令（Agent 面设计 §5）：`catalog.call` → 信封。
 *
 * - `destructive` 没有 `--yes`：不调用，说明会发生什么，退出码 4（§3.3；不做交互确认，确认是宿主的事）。
 * - `models install` 没有 `--yes`：先报大小、不下载（§4.3），同样退出码 4；已经装好或正在下载时照常调用（不会再下载）。
 * - `job`：默认等到终态（订阅 `jobs` 主题，不轮询 `jobs_wait`），结果是提交时的结果加 `job`（`jobs_inspect` 的记录）与
 *   `outputs`；`--no-wait` 直接返回 `jobId`；`--timeout` 到时给出 `jobId` 与最近的进度，退出码 1，任务继续；Ctrl-C 取消任务。
 *   `jobs retry` 只认这次重跑（结果的 `attempt`）之后的记录。
 * - `jobs wait`：不调用 `jobs_wait`（它最多等一会儿就返回），与默认等待同一条路径，退出码按终态。
 * - 结果超过 `--max-bytes`（默认 64 KiB）或给了 `--result-file`：完整结果写到文件，stdout 只给覆盖范围、路径与
 *   `truncated: true`（§5.5）。
 */
export interface RunContext {
  session: Session;
  command: CatalogCommand;
  args: Record<string, unknown>;
  globals: GlobalFlags;
  /** 工作目录（realpath）。 */
  cwd: string;
  output: Output;
  now?: () => Date;
}

export async function runTool(ctx: RunContext): Promise<ExitCode> {
  const { command, args, globals, output, cwd } = ctx;
  const { tool } = command;
  if (tool.effect === 'destructive' && !globals.yes) {
    return output.failure({
      code: 'CONFIRMATION_REQUIRED',
      message: M.confirmationRequired(command.display, summaryOf(tool.description)),
      tool: tool.name,
      args,
      next: M.confirmationNext(command.display),
    });
  }
  if (tool.name === 'models_install' && !globals.yes) {
    const refused = await installGate(ctx);
    if (refused !== null) return refused;
  }
  if (tool.name === 'jobs_wait') return waitCommand(ctx);

  let project: string | null = null;
  if (globals.project !== undefined) {
    project = projectDirectory(globals.project, cwd);
    const hasField = isRecord(tool.inputSchema.properties) && 'project' in tool.inputSchema.properties;
    if (!project && !hasField) throw new CliError('INVALID_ARGUMENTS', M.projectNotDirectory(globals.project));
  }

  // 先订阅再提交：提交之后的每一次变化都不会漏掉。
  const watcher = tool.effect === 'job' && (globals.wait ?? true) ? watchJobs(ctx.session.client) : null;
  let call;
  try {
    call = await request(ctx, () =>
      ctx.session.client.request('catalog.call', { name: tool.name, args, cwd, ...(project ? { project } : {}) }),
    );
  } catch (error) {
    watcher?.close();
    throw error;
  }
  if (!call.ok) {
    watcher?.close();
    return output.failure(call.error);
  }
  const result = isRecord(call.result) ? call.result : null;
  const jobId = result && typeof result.jobId === 'string' ? result.jobId : null;
  if (watcher && result && jobId) {
    // 重跑（`jobs retry`）沿用同一个 jobId：之前那次的终态不算。
    const minAttempt = typeof result.attempt === 'number' ? result.attempt : undefined;
    return waitAndReport(ctx, result, jobId, watcher, { minAttempt });
  }
  watcher?.close();
  return finish(ctx, call.result);
}

/**
 * `models install` 的确认（§4.3）：没有 `--yes` 时只取安装计划（网关的 `models.install` 不带 `confirmBytes` 不下载），报包名、
 * 大小与来源，退出码 4。已经装好、或这个模型包正在下载时返回 null：照常调用工具，它不会再下载。
 */
async function installGate(ctx: RunContext): Promise<ExitCode | null> {
  const bundleId = typeof ctx.args.bundleId === 'string' ? ctx.args.bundleId : defaultTranscribeBundle();
  const planned: ModelInstallResult = await request(ctx, () => ctx.session.client.request('models.install', { bundleId }));
  const { plan } = planned;
  if (planned.jobId || plan.upToDate) return null;
  const size = formatBytes(plan.confirmBytes) + (plan.downloadBytes === null ? M.sizeEstimated : '');
  return ctx.output.failure({
    code: 'CONFIRMATION_REQUIRED',
    message: M.installConfirmationRequired(plan.bundleId, size, plan.source),
    tool: 'models_install',
    bundleId: plan.bundleId,
    size,
    downloadBytes: plan.downloadBytes,
    estimatedBytes: plan.estimatedBytes,
    resumedBytes: plan.resumedBytes,
    source: plan.source,
    components: plan.components
      .filter((c) => c.action === 'download')
      .map((c) => ({ component: c.component, repo: c.repo, bytes: c.bytes })),
    next: `baocut models install --bundle-id ${plan.bundleId} --yes`,
  });
}

/**
 * 这台机器默认的转写模型包：与 `@baocut/models` 的 `defaultTranscribeBundle` 相同（`models_install` 不给 `bundleId` 时装它）。
 * CLI 不依赖那个包，`run.test.ts` 核对两边一致；CLI 与它连的 Runtime 在同一台机器上。
 */
export function defaultTranscribeBundle(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  return platform === 'darwin' && arch === 'arm64' ? 'moss-transcribe-diarize@mlx-8bit' : 'moss-transcribe-diarize@candle';
}

/**
 * `jobs wait <jobId>`（§5.4）：先经 `jobs_inspect` 过一遍可见性（错误码与 MCP 相同），再与默认等待走同一条路径：订阅 `jobs`
 * 主题等到终态，`--timeout`（或工具的 `--timeout-sec`）到时 `WAIT_TIMEOUT`，退出码按终态，Ctrl-C 取消任务。
 */
async function waitCommand(ctx: RunContext): Promise<ExitCode> {
  const { client } = ctx.session;
  const jobId = String(ctx.args.jobId);
  const timeout = typeof ctx.args.timeoutSec === 'number' ? ctx.args.timeoutSec : ctx.globals.timeout;
  const watcher = watchJobs(client);
  let initial: JobRecord;
  try {
    const check = await request(ctx, () => client.request('catalog.call', { name: 'jobs_inspect', args: { jobId }, cwd: ctx.cwd }));
    if (!check.ok) {
      watcher.close();
      return ctx.output.failure(check.error);
    }
    initial = await request(ctx, () => client.request('jobs.inspect', { jobId }));
  } catch (error) {
    watcher.close();
    throw error;
  }
  return waitAndReport({ ...ctx, globals: { ...ctx.globals, timeout } }, { jobId }, jobId, watcher, { initial });
}

/** 写成功的信封；结果太大时落盘。 */
function finish(ctx: RunContext, result: unknown, next?: string | null): ExitCode {
  const spilled = spill(ctx, result);
  const hint = next === undefined ? (isRecord(result) && typeof result.next === 'string' ? result.next : null) : next;
  return ctx.output.success(spilled, hint);
}

/** 大结果落盘（§5.5）：返回要写到 stdout 的结果（原样，或覆盖范围与继续读取的办法）。 */
export function spill(ctx: Pick<RunContext, 'globals' | 'cwd' | 'command' | 'now'>, result: unknown): unknown {
  const text = JSON.stringify(result);
  const bytes = Buffer.byteLength(text ?? '');
  const target = ctx.globals.resultFile;
  if (target === undefined && bytes <= ctx.globals.maxBytes) return result;
  const stamp = (ctx.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const file =
    target !== undefined ? path.resolve(ctx.cwd, target) : path.join(ctx.cwd, '.baocut-out', `${ctx.command.tool.name}-${stamp}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  const paging = pagingFlags(ctx.command);
  return {
    truncated: true,
    path: file,
    bytes,
    coverage: coverageOf(result),
    summary: summarize(result),
    continueWith: {
      file,
      // 要整个结果直接写在 stdout 上时给的上限（向上取整到 KiB）。
      maxBytes: Math.ceil(bytes / 1024) * 1024,
      ...(paging.length ? { paging } : {}),
    },
    note: target !== undefined ? M.resultFileWritten : M.spilledNote(ctx.globals.maxBytes),
  };
}

/** 覆盖范围：完整结果的顶层键、每个数组有多少项（结果本身是数组时给 `items`）。 */
function coverageOf(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) return { items: result.length };
  if (!isRecord(result)) return typeof result === 'string' ? { chars: result.length } : {};
  const arrays: Record<string, number> = {};
  for (const [key, value] of Object.entries(result)) if (Array.isArray(value)) arrays[key] = value.length;
  return { keys: Object.keys(result).filter((key) => key !== 'next'), ...(Object.keys(arrays).length ? { arrays } : {}) };
}

/** 摘要：顶层的短标量照抄（id、版本、`nextCursor`），数组给条数，对象给键，长文本给字数。 */
function summarize(result: unknown): unknown {
  if (Array.isArray(result)) return { items: result.length };
  if (!isRecord(result)) return typeof result === 'string' ? { chars: result.length } : result;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result)) {
    if (key === 'next') continue;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = value.length <= 200 ? value : { chars: value.length };
    else if (Array.isArray(value)) out[key] = { items: value.length };
    else if (isRecord(value)) out[key] = { keys: Object.keys(value).slice(0, 20) };
  }
  return out;
}

/** 这条命令能缩小结果的参数（分页、条数、时间范围）：落盘时建议用它们分批读。 */
const PAGING_FIELDS = /^(limit|offset|cursor|page|range|fromSeconds|toSeconds)$/;

function pagingFlags(command: CatalogCommand): string[] {
  const properties = isRecord(command.tool.inputSchema.properties) ? command.tool.inputSchema.properties : {};
  return Object.keys(properties)
    .filter((field) => PAGING_FIELDS.test(field))
    .map((field) => `--${kebab(field)}`);
}

/** 请求失败时分清是 Runtime 断了（退出码 3）还是别的。 */
async function request<T>(ctx: RunContext, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (ctx.session.client.state.status !== 'connected') {
      throw new CliError('RUNTIME_UNAVAILABLE', M.runtimeLost(error instanceof Error ? error.message : String(error)));
    }
    throw error;
  }
}

/** 等任务到终态（§5.4）；`--timeout` 到时给出 `jobId` 与最近的进度，退出码 1，任务继续。 */
async function waitAndReport(
  ctx: RunContext,
  submitted: Record<string, unknown>,
  jobId: string,
  watcher: JobWatcher,
  options: { minAttempt?: number | undefined; initial?: JobRecord } = {},
): Promise<ExitCode> {
  const progress = new ProgressReporter(ctx.globals.progress, ctx.output.stderr);
  const outcome = await waitForJob(ctx.session.client, jobId, watcher, {
    progress,
    timeoutSec: ctx.globals.timeout,
    ...(options.minAttempt !== undefined ? { minAttempt: options.minAttempt } : {}),
    ...(options.initial ? { initial: options.initial } : {}),
  });
  if (outcome.kind === 'finished') {
    return outcome.job.state === 'completed' ? completed(ctx, submitted, outcome.job) : stopped(ctx, outcome.job);
  }
  const job = outcome.job;
  return ctx.output.failure(
    {
      code: 'WAIT_TIMEOUT',
      message: M.waitTimeout(ctx.globals.timeout!, jobId),
      jobId,
      ...(job ? { state: job.state, stage: job.phase, progress: job.progress } : {}),
      next: `baocut jobs wait ${jobId}`,
    },
    EXIT.failed,
  );
}

/** `jobs_inspect` 的记录（Agent 面的形态：输出、下一步）；取不到时 null。 */
async function inspect(ctx: RunContext, jobId: string): Promise<Record<string, unknown> | null> {
  try {
    const call = await ctx.session.client.request('catalog.call', { name: 'jobs_inspect', args: { jobId }, cwd: ctx.cwd });
    return call.ok && isRecord(call.result) ? call.result : null;
  } catch {
    return null;
  }
}

async function completed(ctx: RunContext, submitted: Record<string, unknown>, job: JobRecord): Promise<ExitCode> {
  const record = (await inspect(ctx, job.jobId)) ?? { ...job };
  const { next: _submittedNext, ...rest } = submitted;
  const outputs = record.outputs ?? job.result?.outputs;
  const { next: recordNext, ...recordRest } = record;
  // 提交回执里的 state 是提交那一刻的（queued / running）：等到终态之后换成终态，与 job.state 一致。
  const result = {
    ...rest,
    ...('state' in rest ? { state: job.state } : {}),
    job: recordRest,
    ...(outputs !== undefined ? { outputs } : {}),
  };
  return finish(ctx, result, typeof recordNext === 'string' ? recordNext : null);
}

/** 以失败、取消、中断或待对账结束：按任务的错误码给退出码（只会是 1 或 2）。 */
async function stopped(ctx: RunContext, job: JobRecord): Promise<ExitCode> {
  const record = await inspect(ctx, job.jobId);
  const code = job.error?.code ?? FALLBACK_CODE[job.state] ?? 'JOB_FAILED';
  const { next: recordNext, ...recordRest } = record ?? {};
  const error: CatalogToolError = {
    code,
    message: job.error ? localizeText(job.error.message, job.error.messageRef) : M.jobEnded(job.state),
    jobId: job.jobId,
    state: job.state,
    ...(job.error?.details !== undefined && job.error.details !== null ? { details: job.error.details } : {}),
    ...(record ? { job: recordRest } : {}),
    ...(typeof recordNext === 'string' ? { next: recordNext } : {}),
  };
  return ctx.output.failure(error, exitCodeForJob(code));
}

/** 任务没有带错误码就结束时用的码。 */
const FALLBACK_CODE: Partial<Record<JobRecord['state'], string>> = {
  cancelled: 'JOB_CANCELLED',
  'needs-reconciliation': 'JOB_NEEDS_RECONCILIATION',
  interrupted: 'JOB_INTERRUPTED',
};
