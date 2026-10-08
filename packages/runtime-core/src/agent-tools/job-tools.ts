import { z } from 'zod';
import { RpcError, type Id, type JobRecord, type JobState } from '@baocut/protocol';
import {
  DUB_PIPELINE,
  isTerminal,
  LINK_IMPORT_PIPELINE,
  TRANSCODE_PIPELINE,
  TRANSCRIBE_PIPELINE,
  TRANSLATE_PIPELINE,
  TRANSLATE_SUBTITLES_PIPELINE,
  type JobManager,
  type PipelineRunner,
} from '@baocut/jobs';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import { approvalField, confirmSummary, type ToolPrincipal, type ToolScope } from './tool-scope.ts';

/**
 * 任务工具（Agent 面设计 §4.3、§6.2）：查看一个任务（`jobs_inspect`）、取消自己提交的任务（`jobs_cancel`）、等一个任务结束（`jobs_wait`）、
 * 列出看得到的任务（`jobs_list`）、重跑失败的固定流程（`jobs_retry`，即网关的 `pipelines.retry`）。看得到哪些任务由范围决定
 * （`visibleJob` / `visibleJobs`）：会话是本会话提交的与来源目录里已打开视频上的，对外服务是自己提交的，终端是全部。三个面都有。
 *
 * 取消是写操作（规划模式与 `read` 等级下拒绝，`ask` 等级下逐次确认），风险等级是 `command`，只能取消自己提交的任务。
 *
 * `jobs_wait` 的结果与 `jobs_inspect` 相同（直接用本组的 `jobs_inspect` 生成，不另写一份摘要），多一个 `settled`。最长等 50 秒：
 * 常见 MCP 客户端的请求超时是 60 秒；没等到就再调一次。
 */

export interface JobToolsDeps {
  jobs: Pick<JobManager, 'settled' | 'cancel'>;
  pipelines: Pick<PipelineRunner, 'retry'>;
  scope: ToolScope;
}

/** 等待的上限（秒）。 */
export const JOB_WAIT_MAX_SEC = 50;

/** 任务状态，与协议的 `JobState` 一一对应（少一个时类型检查不过）。 */
const JOB_STATES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted', 'needs-reconciliation'] as const;
type MissingState = Exclude<JobState, (typeof JOB_STATES)[number]>;
const _allStates: MissingState extends never ? true : never = true;
void _allStates;

/** `jobs_list` 的状态过滤：`JobState` 之一，或 `settled`（已经结束的，任何终态）。 */
const STATE_FILTERS = [...JOB_STATES, 'settled'] as const;

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const jobIdArg = z.string().min(1).max(200).describe('提交时返回的 jobId');

const schemas = {
  jobs_inspect: z.strictObject({ jobId: jobIdArg }),
  jobs_cancel: z.strictObject({ jobId: jobIdArg }),
  jobs_wait: z.strictObject({
    jobId: jobIdArg,
    timeoutSec: z
      .number()
      .int()
      .min(1)
      .max(JOB_WAIT_MAX_SEC)
      .optional()
      .describe(`可选。最多等多少秒，1 到 ${JOB_WAIT_MAX_SEC}，默认 ${JOB_WAIT_MAX_SEC}；到时还没结束就返回当时的状态（settled: false）`),
  }),
  jobs_list: z.strictObject({
    video: z.string().min(1).max(200).optional().describe('可选。只列这个视频上的任务：videoId'),
    state: z
      .enum(STATE_FILTERS)
      .optional()
      .describe(`可选。只列这种状态的任务：${JOB_STATES.join('、')}；settled 是已经结束的（除 queued、running 以外的全部）`),
    limit: z.number().int().min(1).max(100).optional().describe('可选。最多列几个，默认 20，最多 100'),
  }),
  jobs_retry: z.strictObject({
    jobId: jobIdArg.describe('失败、被取消或被中断的固定流程的 jobId（给流程里某一步的 jobId 时重跑它所在的流程）'),
  }),
};

type ToolName = keyof typeof schemas;
type Args<N extends ToolName> = z.infer<(typeof schemas)[N]>;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  jobs_inspect: {
    title: '查看任务',
    description: [
      '查看一个任务的状态、进度与结果。',
      '状态（queued、running、completed、failed、cancelled、interrupted）、阶段与进度、冻结的 Provider、模型与参数、错误与补救；完成时给出每个输出（artifactId、媒体事实、导入视频得到的 assetId，转写是 documentId）。',
      '只读，不会触发新的计算。可以看你在这个会话里提交的任务，以及工作目录里已打开的视频上的任务。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '查看任务', args: { jobId: 'job_1' } }],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'jobId',
  },
  jobs_cancel: {
    title: '取消任务',
    description: [
      '取消你在这个会话里提交的一个任务。',
      '排队中的立即取消；运行中的等 Provider 停下。返回最终状态。',
      '用户停止任务时，这个会话还在排队或运行的任务会一并取消。',
    ].join('\n'),
    annotations: { destructiveHint: false, idempotentHint: true },
    effect: 'mutation',
    examples: [{ title: '取消任务', args: { jobId: 'job_1' } }],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'jobId',
  },
  jobs_wait: {
    title: '等待任务',
    description: [
      `等一个任务结束（最多 ${JOB_WAIT_MAX_SEC} 秒），返回与 jobs_inspect 相同的记录。`,
      `阻塞到任务进入终态（completed、failed、cancelled、interrupted、needs-reconciliation）或超时；超时不是错误：settled 为 false，按 next 再调一次 jobs_wait 接着等。上限 ${JOB_WAIT_MAX_SEC} 秒（timeoutSec 默认也是 ${JOB_WAIT_MAX_SEC}），避开常见客户端 60 秒的请求超时。`,
      '只读，不会触发新的计算；看得到的任务与 jobs_inspect 相同。等任务结束优先用它，不要反复调 jobs_inspect 轮询。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '等任务结束', args: { jobId: 'job_1' } },
      { title: '最多等 10 秒', args: { jobId: 'job_1', timeoutSec: 10 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'jobId',
  },
  jobs_list: {
    title: '列出任务',
    description: [
      '列出你看得到的任务，新的在前。',
      '每项是摘要：jobId、种类、状态、阶段与进度、视频、Provider 与模型、谁提交的、时间与错误码；详情用 jobs_inspect，等结束用 jobs_wait。固定流程的各步折叠在流程里，不单独列出。',
      '会话里看得到本会话提交的任务与工作目录里已打开视频上的任务；对外服务只看得到自己提交的。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '最近的任务', args: {} },
      { title: '一个视频上还在跑的任务', args: { video: 'video_0123456789abcdef', state: 'running' } },
      { title: '最近失败的五个', args: { state: 'failed', limit: 5 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
  },
  jobs_retry: {
    title: '重跑失败的流程',
    description: [
      '从失败的那一步重新执行一个固定流程（转写、翻译、配音、下载这类多步的任务）。',
      '只能重跑失败、被取消或被中断的流程，前面完成的步骤复用之前的产出；单个模型任务（语音、图片、转写）不能重跑，重新提交一次。',
      '返回 jobId（与原来相同，attempt 加一）；之后用 jobs_wait 等它结束。只能重跑你自己提交的流程。',
    ].join('\n'),
    annotations: { destructiveHint: false },
    effect: 'job',
    examples: [{ title: '重跑失败的流程', args: { jobId: 'job_1' } }],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'jobId',
  },
};

/** 任务失败时给智能体的下一步（命令与协议规范 §11.3 的恢复规则）。 */
const FAILURE_NEXT: Record<string, string> = {
  PROVIDER_AUTH_FAILED:
    '服务商拒绝了密钥：请用户在设置里的模型配置中检查或更换密钥（或 baocut models configure <providerId> --key-stdin --verify）。不要重试，也不要换服务商绕过。',
  PROVIDER_QUOTA_EXCEEDED: '服务商限速或额度用尽：告诉用户，由用户决定何时再提交或改用其他服务。不要自动重试。',
  PROVIDER_REJECTED: '服务商拒绝了这次请求：按 message 调整参数或换模型后重新提交；不要原样重试。',
  PROVIDER_UNAVAILABLE: '服务商暂时不可用：稍后重新提交，或请用户决定改用其他服务。',
  MODEL_OUTPUT_INVALID: '模型的输出没有通过校验，没有产物：可以重新提交一次（是新的任务）；反复失败就告诉用户。',
  STALE_JOB_INPUT:
    '任务的输入或目标视频已经变化（例如视频被关闭）：产物保留，但没有写入视频。重新 videos_inspect；生成的输出可以用 edits_apply 的 importAsset + artifactId（outputs 里的）导入，不必重新生成。',
  APPLY_FAILED:
    '结果已经生成，但写入视频被拒绝：产物保留。重新 videos_inspect 看当前状态，告诉用户；需要时用 edits_apply 的 importAsset + artifactId（outputs 里的）再导入，不必重新生成。',
  JOB_INTERRUPTED: '任务被中断（Runtime 停止或重启）：需要时重新提交。',
  TASK_PROTECTED:
    '这一步的写入触碰了任务合同里用户设的「不要改动」范围（被触碰的保护见 details），没有写入视频，前面步骤的结果保留。不要换办法绕过；告诉用户，由用户决定是否调整保护范围或自己处理。',
  EXPORT_VALIDATION_FAILED: '导出的文件没有通过校验，没有发布（details 列出问题）：告诉用户；不要原样重试。',
  EXPORT_RENDER_FAILED: 'ffmpeg 生成失败，没有发布：把 details 告诉用户；不要换办法绕过。',
  EXPORT_TOOL_MISSING: '缺 ffmpeg / ffprobe：把 details.remedy 转告用户，由用户安装；不要自己安装或绕过。',
  EXPORT_DESTINATION_EXISTS: '发布时目标文件已经存在：换一个 fileName 重新导出；确实要替换时先问用户。',
  EXPORT_DESTINATION_UNWRITABLE: '发布时目标目录不可写：换一个目录重新导出，或告诉用户。',
  ASSET_MISSING: '导出开始前素材文件不见了：告诉用户，请用户重新链接。',
  ASSET_CHANGED: '导出开始前链接的素材被改过：告诉用户，请用户确认后重新链接，再重新导出。',
  RESOURCE_ADMISSION_UNSATISFIABLE:
    '这项工作需要的内存、GPU 内存或磁盘超过了这台机器能给的量（details.dimensions）：告诉用户；可以缩小范围或降低输出尺寸后重新提交，不要原样重试。',
};
// i18n-ignore-end

export class JobTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: JobToolsDeps;

  constructor(deps: JobToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'jobs_inspect':
        return this.#inspect(args as Args<'jobs_inspect'>, principal);
      case 'jobs_cancel':
        return this.#cancel(args as Args<'jobs_cancel'>, principal);
      case 'jobs_wait':
        return this.#wait(args as Args<'jobs_wait'>, principal);
      case 'jobs_list':
        return this.#list(args as Args<'jobs_list'>, principal);
      case 'jobs_retry':
        return this.#retry(args as Args<'jobs_retry'>, principal);
      default:
        // i18n-ignore: 给模型的工具说明、错误与下一步
        return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    }
  }

  // ---- 查看与取消 ----

  async #inspect(args: Args<'jobs_inspect'>, principal: ToolPrincipal) {
    const { scope } = this.#deps;
    const access = scope.authorize(principal, false);
    return digestJob(await scope.visibleJob(args.jobId, access));
  }

  async #cancel(args: Args<'jobs_cancel'>, principal: ToolPrincipal) {
    const { scope, jobs } = this.#deps;
    const access = scope.authorize(principal, true);
    const record = await scope.visibleJob(args.jobId, access);
    if (!scope.owns(record, access)) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('JOB_NOT_OWNED', '只能取消你在这个会话里提交的任务；别人提交的任务由用户自己决定');
    }
    const approval = await scope.confirm(access, {
      tool: 'jobs_cancel',
      ...confirmSummary(RcAgentTools.cancelJobSummary({ jobId: record.jobId })),
      risk: 'command',
    });
    const { state } = await jobs.cancel(record.jobId);
    return { jobId: record.jobId, state, ...approvalField(approval) };
  }

  // ---- 等待、列出、重跑 ----

  async #wait(args: Args<'jobs_wait'>, principal: ToolPrincipal) {
    const { scope, jobs } = this.#deps;
    const access = scope.authorize(principal, false);
    const record = await scope.visibleJob(args.jobId, access);
    const timeoutSec = args.timeoutSec ?? JOB_WAIT_MAX_SEC;
    if (!isTerminal(record.state)) {
      await untilSettled(jobs.settled(record.jobId), timeoutSec * 1000, principal.kind === 'service' ? principal.signal : undefined);
    }
    const inspected = await this.#inspect({ jobId: record.jobId }, principal);
    const settled = isTerminal(inspected.state as JobState);
    if (settled) return { ...inspected, settled };
    const waiting = inspected.waiting as { detail?: string } | undefined;
    return {
      ...inspected,
      settled,
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: `等了 ${timeoutSec} 秒还没有结束${waiting?.detail ? `（还在等资源：${waiting.detail}）` : ''}：再调一次 jobs_wait 接着等。不要重复提交，也不要声称已经完成。`,
    };
  }

  async #list(args: Args<'jobs_list'>, principal: ToolPrincipal) {
    const { scope } = this.#deps;
    const access = scope.authorize(principal, false);
    const limit = args.limit ?? 20;
    const matched = (await scope.visibleJobs(access))
      .filter((r) => !r.parentJobId)
      .filter((r) => args.video === undefined || r.videoId === args.video)
      .filter((r) => args.state === undefined || (args.state === 'settled' ? isTerminal(r.state) : r.state === args.state))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      jobs: matched.slice(0, limit).map(summaryOf),
      total: matched.length,
      truncated: matched.length > limit,
      // i18n-ignore-start: 给模型的工具说明、错误与下一步
      next:
        matched.length > limit
          ? `只列出了最新的 ${limit} 个（共 ${matched.length} 个）：加 state 或 video 缩小范围，或调大 limit。详情用 jobs_inspect，等结束用 jobs_wait。`
          : '详情用 jobs_inspect，等结束用 jobs_wait。',
      // i18n-ignore-end
    };
  }

  async #retry(args: Args<'jobs_retry'>, principal: ToolPrincipal) {
    const { scope, pipelines } = this.#deps;
    const access = scope.authorize(principal, true);
    let record = await scope.visibleJob(args.jobId, access);
    // 流程里的一步：重跑它所在的流程。
    if (record.kind === 'pipeline-step' && record.parentJobId) record = await scope.visibleJob(record.parentJobId, access);
    // i18n-ignore-start: 给模型的工具说明、错误与下一步
    if (record.kind !== 'pipeline' || !record.pipeline) {
      throw new ToolError(
        'JOB_NOT_RETRYABLE',
        '这个任务不是固定流程，不能重跑：单个模型任务（语音、图片、转写）重新提交一次（是新的任务）',
        { kind: record.kind },
      );
    }
    if (!scope.owns(record, access)) {
      throw new ToolError('JOB_NOT_OWNED', '只能重跑你自己提交的流程；别人提交的由用户自己决定');
    }
    if (!isTerminal(record.state)) {
      throw new ToolError('JOB_NOT_RETRYABLE', '流程还没有结束：用 jobs_wait 等它结束；失败了再重跑', { state: record.state });
    }
    // i18n-ignore-end
    const approval = await scope.confirm(access, {
      tool: 'jobs_retry',
      ...confirmSummary(
        RcAgentTools.retryPipelineSummary({ jobId: record.jobId, pipeline: record.pipeline.name, attempt: record.attempt + 1 }),
      ),
      risk: 'command',
    });
    const { jobId } = await pipelines.retry(record.jobId).catch((error: unknown) => {
      throw toolErrorOf(error);
    });
    return {
      jobId,
      pipeline: record.pipeline.name,
      attempt: record.attempt + 1,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '流程已从停下的那一步重新开始（jobId 不变，attempt 加一）：用 jobs_wait 等它结束，state 为 completed 才算完成；不要重复提交。',
    };
  }
}

/** 等任务结束、超时或请求中止，先到的为准；超时与中止不是错误。 */
async function untilSettled(settled: Promise<unknown>, timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      settled.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
      new Promise<void>((resolve) => {
        if (!signal) return;
        if (signal.aborted) return resolve();
        onAbort = resolve;
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** `jobs_list` 的一项：`jobs_inspect` 的摘要部分，不含参数、输出与下一步。 */
function summaryOf(record: JobRecord) {
  return {
    jobId: record.jobId,
    kind: record.kind,
    ...(record.pipeline ? { pipeline: record.pipeline.name } : {}),
    state: record.state,
    phase: record.phase,
    progress: record.progress,
    attempt: record.attempt,
    videoId: record.videoId,
    providerId: record.providerId,
    modelId: record.modelId,
    submittedBy: record.submitter.kind === 'agent' ? 'agent' : record.submitter.kind === 'service' ? 'external' : 'user',
    createdAt: record.createdAt,
    endedAt: record.endedAt,
    ...(record.error ? { error: { code: record.error.code, message: record.error.message } } : {}),
    ...(record.wait ? { waiting: { reason: record.wait.reason, detail: record.wait.detail } } : {}),
  };
}

/** 服务的拒绝换成工具的错误：`details.code`（`JOB_NOT_RETRYABLE`……）作为工具错误码。 */
function toolErrorOf(error: unknown): unknown {
  if (error instanceof RpcError && typeof error.details === 'object' && error.details !== null) {
    const { code, ...rest } = error.details as Record<string, unknown>;
    if (typeof code === 'string') return new ToolError(code, error.message, rest);
  }
  return error;
}

/** 固定流程完成之后的下一步：结果在哪里（`pipeline.summary`）、接着可以做什么。认不出的流程用通用的说明。 */
export function pipelineNext(name: string, summary: Record<string, unknown> | null, videoId: Id | null): string | null {
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  switch (name) {
    case TRANSCRIBE_PIPELINE:
      if (summary && 'files' in summary && !('documentId' in summary)) {
        return '转录完成，没有建视频：pipeline.summary.files 是写出的 TXT 与 SRT 文稿（outputs 的 path 相同）。把位置告诉用户；要读内容时直接读这些文件。';
      }
      return '转录完成：pipeline.summary.documentId 是新写入的转写（speech 文档，可以给 documents_read），summary.captions 是建的字幕层（status 为 created 时 documentId 是字幕文档）；新建视频时 summary.videoId 是新视频。接着可以 documents_read、captions_create 或 export。';
    case TRANSLATE_PIPELINE:
      return '翻译完成：pipeline.summary.documentId 是新写入的译文（translation 文档），summary.captions 是建的目标语言字幕层。要文件时用 export。';
    case TRANSLATE_SUBTITLES_PIPELINE:
      return '翻译完成：pipeline.summary.file（outputs[0].path）是译好的字幕文件。把位置告诉用户。';
    case DUB_PIPELINE:
      return '配音完成：配音放在新的配音轨上（pipeline.summary.trackId），summary.translation 是用的译文，summary.units 说明放上了几句、几句没有合成及原因。把结果告诉用户；要成片时用 export。';
    case TRANSCODE_PIPELINE:
      return '转码完成：outputs 的 path（pipeline.summary.files）是输出的文件，原文件不动。把位置告诉用户。';
    case LINK_IMPORT_PIPELINE:
      // 只下载的从链接导入：文件已经写好（outputs 的 path），文稿与字幕同样。
      if (videoId === null) {
        return '下载完成，没有导入视频：outputs 里的 path 是下载的文件（媒体，转写了时还有 TXT 文稿与 SRT 字幕）。把位置告诉用户；要读文稿内容时直接读 path，读不到时用 artifacts_save 把它的 artifactId 存进工作目录。要翻译时自己翻，写成工作目录里的新文件，再用 downloads_save 放进下载目录。';
      }
      return `${
        summary?.createdVideo === true
          ? '下载完成，新建了视频：summary.videoId 是新视频，下载的媒体已放上时间线（主轨、从 0 开始），pipeline.summary.assetId 是导入的素材'
          : '下载完成并导入到已有的视频：summary.videoId 是那个视频，pipeline.summary.assetId 是导入的素材（它的时间线原来是空的时已放上主轨，否则只在素材库里，要用时 edits_apply 的 addItem 放上去）'
      }${
        summary && typeof summary.transcribeJobId === 'string'
          ? `；转写写进了视频的 speech 文档（${
              typeof summary.documentId === 'string' ? 'summary.documentId' : 'videos_inspect 的文档里'
            }）${linkImportCaptionsNext(summary.captions)}`
          : ''
      }。`;
    default:
      return null;
  }
  // i18n-ignore-end
}

/** 从链接导入建字幕层这一步的下一步：建好了指向字幕文档，没建（停用、没放上时间线……）指向 captions_create。 */
function linkImportCaptionsNext(captions: unknown): string {
  const status = captions && typeof captions === 'object' ? (captions as { status?: unknown }).status : undefined;
  // i18n-ignore: 给模型的下一步
  if (status === 'created') return '，字幕层也建好了（summary.captions 的 documentId 是字幕文档）';
  // i18n-ignore: 给模型的下一步
  return '，要字幕层时用 captions_create';
}

/** 任务记录给模型看的版本：冻结的选择与参数、错误与下一步、每个输出。 */
function digestJob(record: JobRecord) {
  const generation = record.generation
    ? record.generation.capability === 'synthesizeSpeech'
      ? (({ text, ...rest }) => ({ ...rest, textChars: [...text].length }))(record.generation)
      : record.generation.capability === 'generateText'
        ? (({ messages, responseFormat, ...rest }) => ({
            ...rest,
            messages: messages.length,
            inputChars: messages.reduce((sum, m) => sum + [...m.content].length, 0),
            responseFormat: responseFormat.type,
          }))(record.generation)
        : record.generation
    : undefined;
  const outputs = record.result?.outputs?.map((o) => ({
    artifactId: o.artifactId,
    mediaType: o.mediaType,
    assetId: o.assetId,
    media: o.media,
    // 导出：发布的文件、格式与校验结果。
    ...(o.path !== undefined ? { path: o.path } : {}),
    ...(o.format !== undefined ? { format: o.format } : {}),
    ...(o.validation !== undefined ? { validation: o.validation } : {}),
  }));
  return {
    jobId: record.jobId,
    kind: record.kind,
    state: record.state,
    phase: record.phase,
    progress: record.progress,
    attempt: record.attempt,
    providerId: record.providerId,
    modelId: record.modelId,
    videoId: record.videoId,
    ...(record.assetId ? { assetId: record.assetId, assetRevision: record.assetRevision } : {}),
    ...(generation ? { parameters: generation } : {}),
    ...(record.export
      ? { export: { settings: record.export.settings, videoRevision: record.export.videoRevision, destination: record.export.destination } }
      : {}),
    submittedBy: record.submitter.kind === 'agent' ? 'agent' : record.submitter.kind === 'service' ? 'external' : 'user',
    createdAt: record.createdAt,
    endedAt: record.endedAt,
    ...(record.error
      ? {
          error: {
            code: record.error.code,
            message: record.error.message,
            ...(record.error.details !== undefined ? { details: record.error.details } : {}),
          },
        }
      : {}),
    ...(record.warnings.length ? { warnings: record.warnings } : {}),
    // 应用到视频的各次尝试（只有状态与原因）与取消的三件事实（§7.2、§7.4）：智能体看得到，但不能对账。
    ...(record.applications?.length
      ? {
          applications: record.applications.map((a) => ({
            state: a.state,
            videoId: a.videoId,
            ...(a.error ? { reason: a.error.message } : {}),
          })),
        }
      : {}),
    ...(record.cancellation ? { cancellation: record.cancellation } : {}),
    // 固定流程（一级动词 transcribe、translate、dub、transcode、download）：每一步的状态与完成时的摘要（新文稿、字幕层、文件）。
    ...(record.pipeline
      ? {
          pipeline: {
            name: record.pipeline.name,
            steps: record.pipeline.steps.map((step) => ({ name: step.name, status: step.status })),
            stoppedAt: record.pipeline.stoppedAt,
            summary: record.pipeline.summary,
          },
        }
      : {}),
    // 排队时在等什么（§7.6、§7.7）：同一队列的并发，或机器上的资源。
    ...(record.wait ? { waiting: { reason: record.wait.reason, detail: record.wait.detail, since: record.wait.since } } : {}),
    ...(record.result
      ? record.kind === 'transcribe'
        ? { result: { documentId: record.result.documentId, artifactId: record.result.artifactId } }
        : record.result.text
          ? { result: { artifactId: record.result.artifactId, text: record.result.text } }
          : { outputs: outputs ?? [] }
      : {}),
    next: nextFor(record),
  };
}

function nextFor(record: JobRecord): string {
  // i18n-ignore-start: 给模型的工具说明、错误与下一步
  switch (record.state) {
    case 'queued':
    case 'running':
      if (record.wait?.reason === 'resources') {
        return `还没有开始，正在等待资源（${record.wait.detail}）：前面的任务结束后自动开始。过一会儿再用 jobs_wait 等；不要重复提交，也不要取消重来。`;
      }
      return '还没有完成：用 jobs_wait 等它结束。不要重复提交，也不要声称已经完成。';
    case 'completed':
      if (record.kind === 'export') {
        return '导出完成：outputs 里是每个文件的 path（已经写到磁盘）与校验结果。把路径告诉用户；有 warnings 时一并说明。';
      }
      if (record.kind === 'transcribe') {
        return record.result?.documentId
          ? '转写已写入视频的 speech 文档（documentId），videos_inspect 的文档里能看到。'
          : '转写完成，但没有识别到语音或音轨，没有写入文档（见 warnings）。';
      }
      if (record.kind === 'generateText') {
        return '文本已发布为产物（artifactId），result.text.preview 是开头一段；warnings 里有 output-truncated 时内容不完整。';
      }
      if (record.kind === 'pipeline' && record.pipeline) {
        const done = pipelineNext(record.pipeline.name, record.pipeline.summary, record.videoId);
        if (done) return done;
      }
      if (record.videoId !== null) {
        const imported = record.result?.outputs?.every((o) => o.assetId !== null) ?? false;
        return imported
          ? '输出已导入视频为候选素材（assetId），还不在时间线上。要用时先 videos_inspect 取得 revision，再 edits_apply 的 addItem（asset 用这个 assetId）。'
          : '输出已生成，但有的没能导入视频（assetId 为 null）：产物保留。重新 videos_inspect 看视频的状态，告诉用户。';
      }
      return '输出只发布为产物（artifactId），没有导入任何视频，工作目录里也没有文件。要放进视频用 edits_apply 的 {"type":"importAsset","artifactId":…}（不重新生成）；需要文件本身时用 artifacts_save。';
    case 'failed':
      if (record.kind === 'export' && record.result?.outputs?.length) {
        return '导出只完成了一部分：outputs 里的文件已经发布，error.details.failed 列出没有导出的文件与原因。如实告诉用户。';
      }
      // 结果触碰了任务的保护范围（§3.2）：要不要应用只能由用户决定，智能体不能再导入一次绕过。
      if ((record.error?.details as { reason?: unknown } | undefined)?.reason === 'TASK_PROTECTED') {
        return '结果已经生成，但触碰了任务合同里用户设的「不要改动」范围（details.protections），没有写入视频；产物保留为候选。不要用 edits_apply 再导入或换办法绕过；告诉用户，由用户决定要不要应用（用户可以在任务列表里自己应用）。';
      }
      return FAILURE_NEXT[record.error?.code ?? ''] ?? '任务失败：把错误告诉用户；不要换一种办法绕过。';
    case 'cancelled':
      return record.result
        ? '任务已停止：结果已经生成，但停止之后不再自动应用到视频（产物保留为候选，见 applications）。告诉用户，由用户决定要不要用。'
        : '任务已取消，没有结果。';
    case 'needs-reconciliation':
      return '外发的调用在 Runtime 停止时还没有结果：不知道远端有没有执行、有没有计费。不要重新提交；告诉用户到任务列表里决定重试或放弃（智能体不能代做）。';
    case 'interrupted':
      return FAILURE_NEXT.JOB_INTERRUPTED!;
  }
  // i18n-ignore-end
}
