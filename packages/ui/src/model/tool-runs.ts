import {
  pipelineStepLabel,
  GRANT_DATA_KIND_LABELS,
  GRANT_DATA_KINDS,
  grantCreateParamsFor,
  LINK_COOKIE_BROWSERS,
  localizeText,
  RpcError,
  type GrantCreateParams,
  type GrantRequestItem,
  type Id,
  type JobRecord,
  type LinkCookieBrowser,
  type ModelCapabilitiesView,
  type ModelRef,
  type PipelineStepState,
  type SpeechModelInfo,
  type TextModelInfo,
  type ToolInputKind,
  type ToolStatus,
  type TranscribeDestination,
} from '@baocut/protocol';
import { recipientName } from './data-grants.ts';
import { usedCookieText } from './link-cookies.ts';
import type { ToolId, ToolTargetKey, VideoToolId } from './tool-catalog.ts';
import { langLabel } from './tool-targets.ts';
import { cloudModelOptions, modelKeyOf, speaks, type ToolModelOption } from './tools-models.ts';
import { M } from './tool-runs-copy.ts';
import { transcribeJobOf } from './transcribe-speakers.ts';
import { jobErrorText } from './localized-text.ts';

/**
 * 视频工具的一次运行（产品设计 §2.7「进度与失败」「结果页的下一步」「授权在当场完成」，设计稿 model-tool-runs.js）。
 *
 * 一次运行就是后台任务里的一条固定流程父任务（`kind: 'pipeline'`）：步骤、进度、失败停在哪一步都读 `jobs` 主题里的记录，
 * 不在界面里另跑一份。步骤表照 Runtime 的流程（`pipeline.steps`，名字与标签由 Runtime 给），不照设计稿的演示表；
 * 跳过的步骤（这次用不到，例如不新建视频时的「新建视频」）不列。
 *
 * 提交：流程名与目录固定带上的参数从 `tools.list` 的 `execution`（按输入种类的 `executionByInput`）来，合进界面给的参数，
 * 不写死；被当场授权拒绝（`details.pendingGrants`）时请用户确认、逐项 `grants.create`，再用同一个 `commandId` 重提。
 */

// ---- 流程与工具 ----

/** 流程名 → 工具页（转码按 `action` 分压缩与合并）；不属于任何工具时 null。 */
export function toolOfJob(job: Pick<JobRecord, 'kind' | 'pipeline'>): ToolId | null {
  const name = job.pipeline?.name;
  switch (name) {
    case 'transcribe':
      return 'transcribe';
    case 'translate':
    case 'translate-subtitles':
      return 'translate-subtitles';
    case 'dub':
      return 'dub';
    case 'link-import':
      return 'link-import';
    case 'transcode':
      return job.pipeline?.params.action === 'merge' ? 'merge-video' : job.pipeline?.params.action === 'extract-audio' ? 'extract-audio' : 'compress-video';
    default:
      return null;
  }
}

/**
 * 后台任务详情里按视频工具的运行来画的流程任务（步骤、从这一步重试、回到工具）：转录、翻译字幕、翻译配音。
 * 下载视频也使用此视图；带旧视频目标的链接流程保留原详情页。
 */
export function toolRunOf(job: Pick<JobRecord, 'kind' | 'pipeline'>): VideoToolId | null {
  if (job.kind !== 'pipeline') return null;
  const tool = toolOfJob(job);
  if (tool === 'link-import' && !job.pipeline?.params.videoId && !job.pipeline?.params.create && !job.pipeline?.params.target) return tool;
  return tool === 'transcribe' || tool === 'translate-subtitles' || tool === 'dub' ? tool : null;
}

/** 这条任务算不算这个视频工具的运行记录：转录页另收「从链接开始、下载后转录」的链接导入（设计稿：同一个结果）。 */
export function isRunOf(job: JobRecord, tool: VideoToolId): boolean {
  if (job.kind !== 'pipeline' || !job.pipeline) return false;
  if (toolOfJob(job) === tool) return true;
  return tool === 'transcribe' && job.pipeline.name === 'link-import' && job.pipeline.params.transcribe === true;
}

/** 这个工具的运行记录，新的在前。 */
export function runsOf(jobs: readonly JobRecord[], tool: VideoToolId): JobRecord[] {
  return jobs.filter((j) => isRunOf(j, tool)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

// ---- 步骤与进度 ----

export type RunStepStatus = 'done' | 'running' | 'failed' | 'pending';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RunStep {
  name: string;
  label: string;
  status: RunStepStatus;
  /** 在跑的这一步的进度（0–100）；读不出时 null。 */
  pct: number | null;
}

export interface RunView {
  jobId: Id;
  status: RunStatus;
  steps: RunStep[];
  /** 当前这一步（在跑、停住的，或下一步要跑的）在 `steps` 里的序号。 */
  cur: number;
  /** 失败、取消时给人看的原因。 */
  error: string | null;
  errorCode: string | null;
  /** 重试过几次（第一次为 1）。 */
  attempt: number;
}

/** Runtime 的步骤状态 → 界面的四种；跳过的步骤为 null（不列）。 */
export function stepStatus(status: PipelineStepState['status']): RunStepStatus | null {
  switch (status) {
    case 'completed':
      return 'done';
    case 'running':
      return 'running';
    case 'failed':
    case 'cancelled':
    case 'interrupted':
      return 'failed';
    case 'pending':
      return 'pending';
    case 'skipped':
      return null;
    default: {
      const never: never = status;
      return never;
    }
  }
}

function runStatus(job: JobRecord): RunStatus {
  switch (job.state) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'cancelled';
    case 'failed':
    case 'interrupted':
    case 'needs-reconciliation':
      return 'failed';
    default: {
      const never: never = job.state;
      return never;
    }
  }
}

/** 子任务的进度（0–100）：有总量时按比例，没有时 null。 */
function childPct(jobId: Id | null, jobs: readonly JobRecord[]): number | null {
  if (!jobId) return null;
  const p = jobs.find((j) => j.jobId === jobId)?.progress;
  if (!p || !p.total) return null;
  return Math.max(0, Math.min(100, (p.done / p.total) * 100));
}

export const DIARIZE_STEP = {
  name: 'diarize' as const,
  get label(): string {
    return M.diarizeStep;
  },
};

/**
 * 一条流程任务的运行视图；不是流程任务时 null。`jobs` 用来读在跑那一步的子任务进度。
 * `opts.diarizeStep`：转录由「说话人区分」模型包区分说话人（model/transcribe-speakers.ts `diarizeStepOf`）时，把「转写」
 * 拆成「转写」与「识别说话人」两步（设计稿 model-tool-runs.js `plan`）；流程里是同一步，按转写任务的阶段（`diarizing`）分开。
 */
export function runView(job: JobRecord, jobs: readonly JobRecord[] = [], opts: { diarizeStep?: boolean } = {}): RunView | null {
  const pipeline = job.pipeline;
  if (!pipeline) return null;
  const steps: RunStep[] = [];
  for (const s of pipeline.steps) {
    const status = stepStatus(s.status);
    if (!status) continue;
    if (opts.diarizeStep && pipeline.name === 'transcribe' && s.name === 'transcribe') {
      steps.push(...splitDiarize(pipelineStepLabel(s), status, childPct(s.jobId, jobs), transcribeJobOf(job.jobId, jobs)?.phase === 'diarizing'));
      continue;
    }
    steps.push({ name: s.name, label: pipelineStepLabel(s), status, pct: status === 'running' ? childPct(s.jobId, jobs) : null });
  }
  const status = runStatus(job);
  let cur = steps.findIndex((s) => s.status === 'running' || s.status === 'failed');
  if (cur < 0) cur = steps.findIndex((s) => s.status === 'pending');
  if (cur < 0) cur = Math.max(0, steps.length - 1);
  const stopped = status === 'failed' || status === 'cancelled';
  return {
    jobId: job.jobId,
    status,
    steps,
    cur,
    error: stopped ? (jobErrorText(job.error) ?? null) : null,
    errorCode: stopped ? (job.error?.code ?? null) : null,
    attempt: Math.max(1, job.attempt),
  };
}

/** 「转写」拆成两步：转写任务到了区分说话人的阶段，转写算完成、在跑（或停在）「识别说话人」；之前「识别说话人」等着。 */
function splitDiarize(label: string, status: RunStepStatus, pct: number | null, diarizing: boolean): RunStep[] {
  const later = (s: RunStepStatus): RunStep => ({ ...DIARIZE_STEP, status: s, pct: null });
  if (status === 'done' || status === 'pending') return [{ name: 'transcribe', label, status, pct: null }, later(status)];
  if (diarizing) return [{ name: 'transcribe', label, status: 'done', pct: null }, later(status)];
  return [{ name: 'transcribe', label, status, pct: status === 'running' ? pct : null }, later('pending')];
}

/** 整次运行的进度（0–100）：完成的步骤加上当前这一步的比例。 */
export function pct(run: RunView): number {
  if (run.status === 'done') return 100;
  if (!run.steps.length) return 0;
  const done = run.steps.filter((s) => s.status === 'done').length;
  const current = run.steps[run.cur];
  const part = current && current.status === 'running' ? (current.pct ?? 0) / 100 : 0;
  return Math.round(((done + part) / run.steps.length) * 100);
}

/** 状态短语：正在转写 · 第 2 / 4 步；失败时说停在哪一步。 */
export function phase(run: RunView): string {
  if (run.status === 'done') return M.phaseDone;
  if (run.status === 'queued') return M.phaseQueued;
  const step = run.steps[run.cur];
  if (!step) return run.status === 'cancelled' ? M.phaseCancelled : run.status === 'failed' ? M.phaseUnfinished : M.phasePreparing;
  const at = M.stepAt(run.cur + 1, run.steps.length);
  if (run.status === 'cancelled') return M.cancelledAt(step.label, at);
  if (run.status === 'failed') return M.stoppedAt(step.label, at);
  return M.runningAt(step.label, at);
}

/** 步骤行右边那几个字：完成 / 停在这一步 / N% / 等待。 */
export function stepNote(step: RunStep): string {
  if (step.status === 'done') return M.stepDone;
  if (step.status === 'failed') return M.stepStopped;
  if (step.status === 'running') return step.pct === null ? M.stepRunning : `${Math.round(step.pct)}%`;
  return M.stepWaiting;
}

// ---- 结果页 ----

/** 结果是不是一个视频（有「打开编辑」）。 */
export function opensMovie(tool: VideoToolId, input: ToolInputKind, opts: { target?: ToolTargetKey } = {}): boolean {
  return !(tool === 'translate-subtitles' && input === 'file') && !((tool === 'link-import' || tool === 'transcribe') && opts.target === 'none');
}

// ---- 当场授权 ----

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGrantItem(value: unknown): value is GrantRequestItem {
  if (!isObject(value)) return false;
  return (
    typeof value.recipient === 'string' &&
    typeof value.capability === 'string' &&
    typeof value.purpose === 'string' &&
    Array.isArray(value.dataKinds) &&
    value.dataKinds.every((k) => typeof k === 'string' && (GRANT_DATA_KINDS as readonly string[]).includes(k))
  );
}

/** 拒绝里带的待批准项（`details.pendingGrants`，只有在场用户的拒绝带）；没有时 null。 */
export function pendingGrantsOf(error: unknown): GrantRequestItem[] | null {
  const details = error instanceof RpcError ? error.details : isObject(error) ? error.details : undefined;
  if (!isObject(details) || !Array.isArray(details.pendingGrants)) return null;
  const items = details.pendingGrants.filter(isGrantItem);
  return items.length ? items : null;
}

/** 同一位接收方、同一组数据种类：同意过一次的认得出来（防止发放之后还被拒时循环）。 */
export function grantKey(item: Pick<GrantRequestItem, 'recipient' | 'dataKinds'>): string {
  return `${item.recipient}:${[...item.dataKinds].sort().join(',')}`;
}

/** 服务商 ID → 名字（模型视图里各能力的服务商）：授权的接收方照它写。 */
export function providerLabels(view: ModelCapabilitiesView | null): Map<string, string> {
  const map = new Map<string, string>();
  if (view) for (const cap of Object.values(view)) for (const p of cap.providers) map.set(p.providerId, p.label);
  return map;
}

export interface GrantLine {
  key: string;
  recipient: string;
  what: string;
  cost: string;
}

/** 授权卡的一项：发给谁、发什么、预计多少钱（有估算时写金额，否则照实说估不出）。 */
export function grantLines(items: readonly GrantRequestItem[], labels: ReadonlyMap<string, string>): GrantLine[] {
  const seen = new Set<string>();
  const out: GrantLine[] = [];
  for (const item of items) {
    const key = grantKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const recipient = recipientName(item.recipient, labels);
    const cost = item.estimate
      ? M.costEstimate(item.estimate.amount, item.estimate.currency)
      : item.cost === 'subscription'
        ? M.costSubscription(recipient)
        : item.cost === 'free-local'
          ? M.costFree
          : M.costMetered(recipient);
    const what = M.grantWhat(
      item.dataKinds.map((k) => GRANT_DATA_KIND_LABELS[k]),
      localizeText(item.purpose, item.purposeRef),
    );
    out.push({ key, recipient, what, cost });
  }
  return out;
}

// ---- 提交 ----

export interface PipelineRequest {
  pipeline: string;
  params: Record<string, unknown>;
}

/**
 * 这个工具从这种输入开始时怎么执行：流程名与目录固定带上的参数（`execution.params`，例如翻译字幕的 `captions: true`）
 * 合进界面给的参数（界面的叠在上面）。状态还没到、或这个工具不是流程时 null（不提交，不回退到写死的流程名）。
 */
export function toolRequest(status: ToolStatus | null | undefined, input: ToolInputKind, params: Record<string, unknown>): PipelineRequest | null {
  if (!status) return null;
  const execution = status.executionByInput?.[input] ?? status.execution;
  if (execution.kind !== 'pipeline') return null;
  return { pipeline: execution.pipeline, params: { ...(execution.params ?? {}), ...params } };
}

/** 会话里提交用到的两个方法（测试里换成假的）。 */
export interface ToolStartSession {
  startPipelineWithCommand(pipeline: string, params: Record<string, unknown>, commandId: string): Promise<Id>;
  createGrant(params: GrantCreateParams): Promise<unknown>;
}

export type StartOutcome =
  | { kind: 'started'; jobId: Id }
  | { kind: 'grants'; items: GrantRequestItem[] }
  /** 取代被改过的文稿、又没给 `acceptEdited`（`TRANSCRIPT_EDITED`，产品设计：重新转录的手工修改闸门）：同意之后带上它重提。 */
  | { kind: 'edited'; error: Error }
  | { kind: 'failed'; error: Error };

/** 提交时以 `TRANSCRIPT_EDITED` 拒绝（`RpcError.code` 是 `conflict`，码在 `details.code`）。 */
export function transcriptEditedOf(error: unknown): boolean {
  const details = error instanceof RpcError ? error.details : isObject(error) ? error.details : undefined;
  return isObject(details) && details.code === 'TRANSCRIPT_EDITED';
}

/** 已经同意并发放过、Runtime 还是要这几项时的说明（不再循环请用户同意）。 */
export const grantLoopText = (): string => M.grantLoop;

/** 启动一次：被当场授权拒绝时交回待批准项（同一个 `commandId` 留着重提），其余失败照原样交回。 */
export async function startTool(session: ToolStartSession, request: PipelineRequest, commandId: string): Promise<StartOutcome> {
  try {
    const jobId = await session.startPipelineWithCommand(request.pipeline, request.params, commandId);
    return { kind: 'started', jobId };
  } catch (error) {
    const items = pendingGrantsOf(error);
    if (items) return { kind: 'grants', items };
    const err = error instanceof Error ? error : new Error(String(error));
    if (transcriptEditedOf(error)) return { kind: 'edited', error: err };
    return { kind: 'failed', error: err };
  }
}

/**
 * 用户同意之后：逐项发放（`grants.create(grantCreateParamsFor(item))`），再用同一个 `commandId` 重提。`granted` 记着这一轮
 * 发放过的项（`grantKey`）：重提又被拒、要的还是发放过的，停下来说明，不再请用户同意。
 */
export async function grantAndRestart(
  session: ToolStartSession,
  request: PipelineRequest,
  commandId: string,
  items: readonly GrantRequestItem[],
  granted: Set<string>,
): Promise<StartOutcome> {
  if (items.some((item) => granted.has(grantKey(item)))) return { kind: 'failed', error: new Error(grantLoopText()) };
  try {
    for (const item of items) {
      await session.createGrant(grantCreateParamsFor(item));
      granted.add(grantKey(item));
    }
  } catch (error) {
    return { kind: 'failed', error: error instanceof Error ? error : new Error(String(error)) };
  }
  const outcome = await startTool(session, request, commandId);
  if (outcome.kind === 'grants' && outcome.items.every((item) => granted.has(grantKey(item)))) return { kind: 'failed', error: new Error(grantLoopText()) };
  return outcome;
}

// ---- 各工具的参数 ----

/** 视频目标：Space 里的条目（候选只给条目 ID；没打开过的视频没有 videoId），或新建。 */
export type VideoTarget = { entryId: Id } | { create: { projectId: Id; name?: string; media?: string } };

export interface AsrChoice {
  provider?: string;
  model?: string;
  /** 断言的语言；空串或不给时自动检测。 */
  language?: string;
  /** 识别不识别说话人（「更多选项」的开关）；工具页总是明确给 true / false，不给时 Runtime 按模型决定。 */
  diarize?: boolean;
}

/**
 * 视频已有文稿时的落点（产品设计：重新转录）：`new-video` 新建视频（`name` 空时 Runtime 取「<原名> · 重新转录」），
 * `replace` 换用文稿、译文结转；`acceptEdited` 是用户看过手工修改提醒、仍要取代。视频还没有文稿时 Runtime 不看这些。
 */
export interface TranscribeDestinationChoice {
  destination: TranscribeDestination;
  name?: string;
  acceptEdited?: boolean;
}

/** 转录（`transcribe` 流程）：本机文件新建视频，或写进 Space 里的视频；`assetId` 在视频里有几个素材、用户选了一个时给。 */
export function transcribeParams(
  target: VideoTarget,
  asr: AsrChoice,
  assetId?: Id | null,
  dest?: TranscribeDestinationChoice | null,
): Record<string, unknown> {
  const name = dest?.destination === 'new-video' ? dest.name?.trim() : '';
  return {
    target,
    ...(assetId ? { assetId } : {}),
    ...(dest && 'entryId' in target ? { destination: dest.destination } : {}),
    ...(name && 'entryId' in target ? { name } : {}),
    ...(dest?.destination === 'replace' && 'entryId' in target ? { translations: 'carry' } : {}),
    ...(dest?.destination === 'replace' && dest.acceptEdited && 'entryId' in target ? { acceptEdited: true } : {}),
    ...(asr.provider ? { provider: asr.provider } : {}),
    ...(asr.model ? { model: asr.model } : {}),
    ...(asr.language ? { language: asr.language } : {}),
    ...(asr.diarize !== undefined ? { diarize: asr.diarize } : {}),
  };
}

/**
 * 只给文件的转录（`transcribe` 流程不给目标，`TranscribeFileParams`）：本机文件或 Space 里的媒体条目（`{ entryId }`），
 * TXT 与 SRT 写到 `outDir`（不给时是保存位置）。不收 `diarize`、`assetId` 与 `captions`。
 */
export function transcribeFileParams(file: string | { entryId: Id }, asr: AsrChoice, outDir?: string): Record<string, unknown> {
  return {
    file,
    ...(outDir ? { outDir } : {}),
    ...(asr.provider ? { provider: asr.provider } : {}),
    ...(asr.model ? { model: asr.model } : {}),
    ...(asr.language ? { language: asr.language } : {}),
  };
}

/** 从链接导入（`link-import` 流程）：落点新建 / 加进已有 / 只下载；`transcribe` 下载后转写（用默认的语音识别模型）。 */
export function linkParams(o: {
  url: string;
  target: ToolTargetKey;
  projectId?: Id | null;
  entryId?: Id | null;
  transcribe?: boolean;
}): Record<string, unknown> {
  const params: Record<string, unknown> = { url: o.url.trim() };
  if (o.target === 'create' && o.projectId) params.target = { create: { projectId: o.projectId } };
  else if (o.target === 'video' && o.entryId) params.target = { entryId: o.entryId };
  else if (o.projectId) params.projectId = o.projectId;
  if (o.transcribe && o.target !== 'none') params.transcribe = true;
  return params;
}

/** 翻译字幕（视频）：`translate` 流程；`captions: true` 由目录带，双语要在它之上（`toolRequest` 合并）。 */
export function translateVideoParams(o: {
  entryId: Id;
  documentId?: Id | null;
  targetLanguage: string;
  bilingual: boolean;
  provider?: string;
  model?: string;
}) {
  return {
    target: { entryId: o.entryId },
    ...(o.documentId ? { documentId: o.documentId } : {}),
    targetLanguage: o.targetLanguage,
    ...(o.bilingual ? { bilingual: true } : {}),
    ...(o.provider ? { provider: o.provider } : {}),
    ...(o.model ? { model: o.model } : {}),
  };
}

/** 翻译字幕（字幕文件）：`translate-subtitles` 流程，文件到文件。 */
export function translateFileParams(o: {
  /** 字幕文件的本机路径，或 Space 里的字幕条目。 */
  input: string | { entryId: Id };
  targetLanguage: string;
  bilingual: boolean;
  provider?: string;
  model?: string;
  /** 这次的保存位置；不给时 Runtime 写到它的保存位置。 */
  outDir?: string;
}) {
  return {
    input: o.input,
    targetLanguage: o.targetLanguage,
    ...(o.bilingual ? { bilingual: true } : {}),
    ...(o.provider ? { provider: o.provider } : {}),
    ...(o.model ? { model: o.model } : {}),
    ...(o.outDir ? { outDir: o.outDir } : {}),
  };
}

export type OriginalAudio = 'duck' | 'mute' | 'keep';

/**
 * 翻译配音：选了已有的译文时给 `translationId`（与它的来源文稿），否则给目标语言与翻译用的文本模型（`textProvider` /
 * `textModel`）先翻译。`provider` / `model` 是语音合成；音色不给（用模型的默认音色，说话人绑定的照旧）。
 */
export function dubParams(o: {
  entryId: Id;
  translation: { id: Id; documentId: Id } | null;
  targetLanguage: string | null;
  /** 先翻译时的来源文稿；不给时由 Runtime 取视频里唯一的一份。 */
  documentId?: Id | null;
  originalAudio: OriginalAudio;
  provider?: string;
  model?: string;
  textProvider?: string;
  textModel?: string;
}) {
  return {
    target: { entryId: o.entryId },
    ...(o.translation
      ? { translationId: o.translation.id, documentId: o.translation.documentId }
      : {
          targetLanguage: o.targetLanguage,
          ...(o.documentId ? { documentId: o.documentId } : {}),
          ...(o.textProvider ? { textProvider: o.textProvider } : {}),
          ...(o.textModel ? { textModel: o.textModel } : {}),
        }),
    originalAudio: o.originalAudio,
    ...(o.provider ? { provider: o.provider } : {}),
    ...(o.model ? { model: o.model } : {}),
  };
}

/** 翻译要结构化输出：不支持的那只列着但用不了（同字幕面板与首页固定流程的翻译）。 */
export function translateModelOptions(view: ModelCapabilitiesView): ToolModelOption<TextModelInfo>[] {
  return cloudModelOptions(view, 'generateText').map((o) =>
    o.usable && o.info.structuredOutput === false ? { ...o, usable: false, why: M.noStructuredOutput } : o,
  );
}

/**
 * 配音引擎的缺省：选过的还在就用它；否则生效的默认值（能用、会念这门语言时），再否则第一只能用又会念的、第一只能用的。
 * `lang` 不知道（译文没标语言）时不按语言挑。
 */
export function dubEngineKey(
  options: readonly ToolModelOption<Pick<SpeechModelInfo, 'languages'>>[],
  saved: string | null,
  effective: ModelRef | null,
  lang: string | null,
): string | null {
  if (saved && options.some((o) => o.key === saved)) return saved;
  const fits = (o: ToolModelOption<Pick<SpeechModelInfo, 'languages'>>) => o.usable && (!lang || speaks(o.info.languages, lang));
  const preferred = effective ? modelKeyOf(effective.providerId, effective.modelId) : null;
  return (options.find((o) => o.key === preferred && fits(o)) ?? options.find(fits) ?? options.find((o) => o.usable) ?? options[0])?.key ?? null;
}

// ---- 失败之后 ----

/** 转录时视频主轨上有几个素材（`TRANSCRIBE_ASSET_AMBIGUOUS`）：要用户选一个，带 `assetId` 重新开始。 */
export function ambiguousAssets(job: Pick<JobRecord, 'error'> | null): Id[] | null {
  const error = job?.error;
  if (!error || error.code !== 'TRANSCRIBE_ASSET_AMBIGUOUS' || !isObject(error.details)) return null;
  const ids = error.details.assetIds;
  return Array.isArray(ids) ? ids.filter((x): x is Id => typeof x === 'string') : null;
}

/**
 * 选好素材后重新开始（新的一次运行、新的 commandId）：照这次冻结的参数，加上 `assetId`；这次已经写进了某个视频时
 * 目标换成那个视频（不再新建一个）。
 */
export function withAsset(job: Pick<JobRecord, 'pipeline' | 'videoId'>, assetId: Id): PipelineRequest | null {
  const pipeline = job.pipeline;
  if (!pipeline) return null;
  const params: Record<string, unknown> = { ...pipeline.params, assetId };
  if (job.videoId) params.target = { videoId: job.videoId };
  return { pipeline: pipeline.name, params };
}

/** 这次运行从哪种输入开始（没有本机记录时从冻结参数推）。 */
export function runInput(job: Pick<JobRecord, 'pipeline'>): ToolInputKind {
  const pipeline = job.pipeline;
  if (!pipeline) return 'video';
  if (pipeline.name === 'translate-subtitles') return 'file';
  if (pipeline.name === 'link-import') return 'link';
  if (pipeline.name === 'transcribe' && 'file' in pipeline.params) return 'file';
  const target = isObject(pipeline.params.target) ? pipeline.params.target : null;
  return target && isObject(target.create) ? 'file' : 'video';
}

/** 从链接导入与转录的落点、是否下载后转录（从冻结参数推）。只给文件的转录是 `none`。 */
export function runOpts(job: Pick<JobRecord, 'pipeline'>): { target?: ToolTargetKey; transcribe?: boolean } {
  const pipeline = job.pipeline;
  if (pipeline?.name === 'transcribe') {
    if ('file' in pipeline.params) return { target: 'none' };
    const target = isObject(pipeline.params.target) ? pipeline.params.target : null;
    return target && isObject(target.create) ? { target: 'create' } : {};
  }
  if (!pipeline || pipeline.name !== 'link-import') return {};
  const target = isObject(pipeline.params.target) ? pipeline.params.target : null;
  return { target: !target ? 'none' : isObject(target.create) ? 'create' : 'video', transcribe: pipeline.params.transcribe === true };
}

// ---- 结果 ----

/** 本机这次提交时记下的名字（摘要里只有 ID）：运行标题、视频名、项目名、来源文稿的语言。 */
export interface RunMeta {
  tool: VideoToolId;
  input: ToolInputKind;
  title: string;
  videoName?: string | null;
  projectName?: string | null;
  sourceLanguage?: string | null;
  target?: ToolTargetKey;
  transcribe?: boolean;
}

/**
 * 流程建立的字幕层（`summary.captions`）。合并 main 之后换成 protocol 的 `PipelineCaptionsSummary`
 * （origin/main:packages/protocol/src/pipelines.ts）。
 */
export interface CaptionsFacts {
  status: 'created' | 'existing' | 'disabled' | 'not-on-timeline' | 'empty';
  enabled: boolean | null;
  bilingual: boolean;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function captionsOf(value: unknown): CaptionsFacts | null {
  if (!isObject(value)) return null;
  const status = value.status;
  if (status !== 'created' && status !== 'existing' && status !== 'disabled' && status !== 'not-on-timeline' && status !== 'empty') return null;
  return { status, enabled: typeof value.enabled === 'boolean' ? value.enabled : null, bilingual: value.bilingual === true };
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function dirName(path: string): string {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join('/') || path;
}

/** 字幕层那一句；没建时说为什么，参数关掉时不说。 */
function captionsLine(c: CaptionsFacts | null, lang: string | null, translation: boolean): string | null {
  if (!c) return null;
  switch (c.status) {
    case 'created':
      return M.captionsCreated({ language: translation ? langLabel(lang) : null, bilingual: c.bilingual, disabled: c.enabled === false });
    case 'existing':
      return translation ? M.captionsExistingTranslation : M.captionsExistingTranscript;
    case 'not-on-timeline':
      return M.captionsNotOnTimeline;
    case 'empty':
      return M.captionsEmpty;
    case 'disabled':
      return null;
    default: {
      const never: never = c.status;
      return never;
    }
  }
}

/** 换用文稿的结转（摘要的 `translations`、`captionPins`、`dubs`）：每种语言的译文与配音、pin 各一句；有过期的提示去刷新。 */
function carryLines(summary: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const translations = carryTranslationsOf(summary);
  for (const t of translations) lines.push(M.carryTranslation(langLabel(t.language), t.kept, t.keptReviewed, t.stale));
  const pins = isObject(summary.captionPins) ? summary.captionPins : null;
  const reanchored = pins ? (num(pins.reanchored) ?? 0) : 0;
  const orphaned = pins ? (num(pins.orphaned) ?? 0) : 0;
  if (reanchored + orphaned > 0) lines.push(M.carryPins(reanchored, orphaned));
  const dubs = Array.isArray(summary.dubs) ? summary.dubs.filter(isObject) : [];
  for (const d of dubs) lines.push(M.carryDub(langLabel(str(d.language)), num(d.kept) ?? 0, num(d.stale) ?? 0));
  if (!lines.length) return [M.nothingToCarry];
  if (translations.some((t) => t.stale > 0)) lines.push(M.refreshHint);
  return lines;
}

/**
 * 换用了文稿的那次转录（`summary.target === 'replace'`）：结果页给「撤销」（按 `replaced.transactionId` 撤销那一笔，没有时不给）
 * 与「刷新过期译文」（有过期的句子时）。别的运行 null。
 */
export function transcriptSwitchOf(job: JobRecord): { videoId: Id; transactionId: Id | null; stale: boolean } | null {
  const summary = job.pipeline?.name === 'transcribe' && job.state === 'completed' ? job.pipeline.summary : null;
  if (!summary || summary.target !== 'replace') return null;
  const videoId = str(summary.videoId);
  if (!videoId) return null;
  const transactionId = isObject(summary.replaced) ? str(summary.replaced.transactionId) : null;
  return { videoId, transactionId, stale: carryTranslationsOf(summary).some((t) => t.stale > 0) };
}

/** 摘要里结转的译文（读不出的项跳过）。 */
export function carryTranslationsOf(
  summary: Record<string, unknown> | null | undefined,
): Array<{ language: string; kept: number; keptReviewed: number; stale: number }> {
  if (!summary || !Array.isArray(summary.translations)) return [];
  return summary.translations.filter(isObject).map((t) => ({
    language: str(t.language) ?? '',
    kept: num(t.kept) ?? 0,
    keptReviewed: num(t.keptReviewed) ?? 0,
    stale: num(t.stale) ?? 0,
  }));
}

/**
 * 结果页的几句话（设计稿 tool-specs.jsx 的 `result`），从流程摘要（`pipeline.summary`）读；摘要里只有 ID，名字取 `meta`
 * （本机这次提交时记下的）或 `videoName`（按视频 ID 在 Space 里查到的）。读不出时空数组。
 */
export function resultLines(job: JobRecord, meta: RunMeta | null, videoName: string | null): string[] {
  const summary = job.pipeline?.summary;
  if (!summary || !job.pipeline) return [];
  const name = meta?.videoName ?? videoName ?? M.thisVideo;
  const project = meta?.projectName ?? null;
  const lines: string[] = [];
  switch (job.pipeline.name) {
    case 'transcribe': {
      const model = str(summary.modelId);
      if (Array.isArray(summary.files)) {
        const names = summary.files.filter((f): f is string => typeof f === 'string').map(baseName);
        lines.push(M.savedFiles(names));
        lines.push(M.transcriptLanguage(langLabel(str(summary.language)), model));
        return lines;
      }
      // 落点（`summary.target`，产品设计：重新转录）：新建视频、取代文稿，或原来没有文稿、直接写进去。
      const target = str(summary.target);
      if (target === 'replace') lines.push(M.replacedTranscript(name));
      else if (target === 'new-video') {
        const created = isObject(summary.newVideo) ? str(summary.newVideo.name) : null;
        // 提交时记下的 `meta.videoName` 是原视频；按 ID 查到的 `videoName` 是新视频。
        lines.push(M.newVideoFrom(created ?? videoName ?? M.newVideo, project, meta?.videoName ?? null));
      } else if (summary.createdVideo === true) lines.push(M.createdVideoLinked(videoName ?? meta?.videoName ?? M.newVideo, project));
      else lines.push(M.wroteTranscript(name));
      lines.push(M.transcriptLanguage(langLabel(str(summary.language)), model));
      const speakers = job.pipeline.params.diarize === true ? num(summary.speakerCount) : null;
      if (speakers) lines.push(M.speakersFound(speakers));
      const caption = captionsLine(captionsOf(summary.captions), null, false);
      if (caption) lines.push(caption);
      if (target === 'replace') lines.push(...carryLines(summary));
      return lines;
    }
    case 'translate': {
      const lang = str(summary.targetLanguage);
      lines.push(M.wroteTranslation(name, langLabel(lang), meta?.sourceLanguage ? langLabel(meta.sourceLanguage) : null));
      const units = num(summary.unitCount);
      if (units !== null) lines.push(M.unitCount(units));
      const caption = captionsLine(captionsOf(summary.captions), lang, true);
      if (caption) lines.push(caption);
      return lines;
    }
    case 'translate-subtitles': {
      const file = str(summary.file);
      if (file) lines.push(M.subtitleFileWritten(baseName(file), dirName(file)));
      if (summary.bilingual === true) lines.push(M.bilingualLayout);
      const stripped = num(summary.markupStripped);
      if (stripped) lines.push(M.markupStripped(stripped));
      return lines;
    }
    case 'dub': {
      const lang = str(summary.language);
      const translation = isObject(summary.translation) ? summary.translation : null;
      lines.push(translation?.created === true ? M.dubTranslated(langLabel(lang)) : M.dubReusedTranslation(langLabel(lang)));
      const synthesis = isObject(summary.synthesis) ? summary.synthesis : null;
      const engine = synthesis ? [str(synthesis.providerId), str(synthesis.modelId)].filter(Boolean).join(' · ') : '';
      lines.push(M.dubWritten(name, langLabel(lang), engine));
      const units = isObject(summary.units) ? summary.units : null;
      const placed = num(units?.placed);
      const total = num(units?.total);
      if (placed !== null && total !== null) lines.push(M.dubPlaced(placed, total));
      const audio = summary.originalAudio;
      if (audio === 'duck' || audio === 'mute' || audio === 'keep') lines.push(M.originalAudio[audio]);
      return lines;
    }
    case 'link-import': {
      const files = isObject(summary.files) ? summary.files : null;
      const media = str(files?.media);
      const file = media ? baseName(media) : M.media;
      const title = str(summary.title);
      const videoId = str(summary.videoId);
      if (summary.createdVideo === true) lines.push(M.linkCreatedVideo(videoName ?? title ?? M.newVideo, project));
      else if (videoId) lines.push(M.linkAddedTo(file, name));
      else lines.push(M.linkDownloaded(file, media ? dirName(media) : null));
      const browser = str(summary.cookieBrowser);
      if (browser && (LINK_COOKIE_BROWSERS as readonly string[]).includes(browser)) lines.push(usedCookieText(browser as LinkCookieBrowser));
      // 从链接导入的转写不建字幕层（远端 §14 记为未实现）：照实说。
      if (Array.isArray(summary.transcriptFiles)) lines.push(M.linkTranscribedFiles);
      else if (str(summary.transcribeJobId)) lines.push(M.linkTranscribed);
      return lines;
    }
    default:
      return lines;
  }
}

/** 运行写进（或新建）的视频；没有视频时 null。 */
export function resultVideoId(job: JobRecord): Id | null {
  const summary = job.pipeline?.summary;
  return (summary && str(summary.videoId)) ?? job.videoId ?? null;
}

/** 没有本机记录时的运行标题：工具名加上能从冻结参数里读出的东西（文件名、链接、目标语言）。 */
export function fallbackTitle(job: JobRecord, toolName: string, videoName: string | null): string {
  const params = job.pipeline?.params ?? {};
  const target = isObject(params.target) ? params.target : null;
  const create = target && isObject(target.create) ? target.create : null;
  const media = str(create?.media) ?? str(params.file);
  const lang = str(params.targetLanguage);
  const what = media
    ? baseName(media)
    : str(params.url)
      ? str(params.url)!.replace(/^https?:\/\//, '')
      : str(params.input)
        ? baseName(str(params.input)!)
        : (videoName ?? M.fallbackVideo);
  return `${toolName} · ${what}${lang ? ` → ${langLabel(lang)}` : ''}`;
}
