import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJsonAtomic } from '@baocut/runtime-storage';
import type { Id, JobRecord, JobState, JobSubmitter, PipelineCreateScope, Sequence, TranscribeRequest } from '@baocut/protocol';
import type { VideoPlace } from '../application-ledger.ts';
import { JobsVideoCreate } from '@baocut/protocol/messages/jobs/video-create.ts';
import { asLocalized } from '../job-text.ts';
import { PipelineStepError, type PipelineStepContext } from './pipeline.ts';
import type { PipelineVideos } from './translate.ts';
import type { PipelineTargets, VideoLease } from './video-target.ts';

/**
 * 视频工具共用的几步（架构设计 §7.9）：新建视频、把一个文件以链接素材导入（新建的视频与时间线还空着的视频同一笔事务放上主轨）、
 * 提交转写并等它。
 * 从链接导入（`link-import.ts`）与转录（`transcribe.ts`）都用这一份。
 *
 * 中断之后重试不重复做（流程的产出在步骤完成时才记下，「做完了、还没记下」的窗口靠下面各自的办法认回）：
 * - 新建视频：先在项目（或会话的来源目录）里占下目录（`PipelineTargets.reserve`，占下之后别的新建都跳过它），把位置写进这次运行的 staging
 *   （`create-intent.json`，失败与中断时保留），再新建到那里。重试时读回位置：那里已经有视频就认回它，还是空目录就建进去。
 * - 导入：事务的 `commandId` 固定（`<父任务>:import`），先按它向引擎查回执，提交过的直接用回执里的素材。
 * - 转写：先在 Job Ledger 里找这次运行提交过的转写 Job（`submitter` 是这个父任务、同一个视频与素材），完成了的直接用、
 *   还在跑的接着等，不再提交第二个（否则重试会多出一份转写）。
 */

/** 新建视频的意图：占下的位置。 */
const CREATE_INTENT = 'create-intent.json';

/** 导入要用到的视频能力：有回执查询时先查（重启之后的重试）。 */
export type MediaVideos = PipelineVideos & {
  /** 按 `commandId` 查已经提交的事务的回执；没有时 null。 */
  receipt?(videoId: Id, commandId: Id): Promise<{ refs: Record<string, Id> } | null>;
  /** 根序列（`place: 'if-empty'` 时看时间线空不空）；没打开时 null。 */
  rootSequence?(videoId: Id): Sequence | null;
};

/** 新建视频（`target.create`）：占位、记下意图、新建（或认回），交给流程持有。 */
export async function createHeldVideo(
  targets: Pick<PipelineTargets, 'reserve' | 'create'>,
  context: Pick<PipelineStepContext<unknown>, 'staging' | 'parentJobId' | 'hold'>,
  request: PipelineCreateScope & { name: string },
): Promise<VideoLease> {
  const file = path.join(context.staging, CREATE_INTENT);
  let intent = await readJson<{ place?: VideoPlace }>(file);
  if (!intent?.place) {
    const place = await targets.reserve(request);
    try {
      await writeJsonAtomic(file, { place });
    } catch (error) {
      // 意图没记下：占下的空目录不留。
      await fs.rmdir(path.join(String(place.root), String(place.file))).catch(() => {});
      throw error;
    }
    intent = { place };
  }
  const lease = await targets.create({ ...request, commandId: `${context.parentJobId}:create`, place: intent.place });
  context.hold(lease);
  return lease;
}

export interface MediaImport {
  videoId: Id;
  /** 文件的绝对路径：以链接素材导入（文件留在原处）。 */
  file: string;
  name: string;
  provenance: { origin: string; source?: unknown };
  /**
   * 同一笔事务把素材放上主轨（第一条同类轨道），从 0 开始、覆盖整段媒体（新建的视频用）；`'if-empty'` 时只在根序列上还没有
   * 任何片段时放（导入已有的空视频，例如对外服务先 `videos_create` 再下载进去）。
   */
  place: boolean | 'if-empty';
  /** 事务的标签（写进视频的历史）：目录文字的 `.text`。 */
  label: string;
}

/** 以链接素材导入一个文件（可选同一笔事务放上时间线），返回素材 ID。 */
export async function importMedia(
  videos: MediaVideos,
  context: Pick<PipelineStepContext<unknown>, 'parentJobId' | 'run'>,
  request: MediaImport,
): Promise<{ assetId: Id }> {
  const commandId = `${context.parentJobId}:import`;
  const { videoId } = request;
  // 上次提交了、产出还没记下就中断了：按命令认回那笔事务。
  const previous = await videos.receipt?.(videoId, commandId);
  if (previous?.refs.link) return { assetId: previous.refs.link };
  const state = videos.state(videoId);
  if (!state) throw new PipelineStepError('VIDEO_NOT_OPEN', JobsVideoCreate.videoClosed(), {});
  const place = request.place === 'if-empty' ? videos.rootSequence?.(videoId)?.items.length === 0 : request.place;
  const { refs } = await videos.apply(videoId, {
    commandId,
    expectedRevision: state.revision,
    label: request.label,
    run: context.run,
    operations: [
      { type: 'importAsset', path: request.file, name: request.name, ref: 'link', storage: 'linked', provenance: request.provenance },
      ...(place
        ? [
            {
              type: 'addItem' as const,
              sequenceId: state.rootSequenceId,
              asset: { ref: 'link' },
              at: { unit: 'frames' as const, value: 0 },
              alignment: 'floor-frame' as const,
            },
          ]
        : []),
    ],
  });
  const assetId = refs?.link;
  if (!assetId) throw new PipelineStepError('INTERNAL', JobsVideoCreate.noAsset(), {});
  return { assetId };
}

/** 流程里的转写：提交前检查配置、提交、等待与取消（复用 `models.transcribe` 的提交）。 */
export interface PipelineTranscriber {
  /**
   * 选定 Provider 与模型（没有配置时抛 `CAPABILITY_NOT_CONFIGURED`）。给了识别提示时一并核对模型收不收提示（不收时
   * `invalid-request`），在提交流程时就拒绝，不等下载、提交转写时才失败。
   */
  check(target?: { provider?: string; model?: string; hint?: string }): Promise<{ providerId: string; modelId: string }>;
  submit(request: TranscribeRequest, submitter: JobSubmitter): Promise<{ jobId: Id }>;
  /** 没有视频的转写（文件的转录）。`language` 是断言的语言（BCP 47）。 */
  submitFile?(
    request: { file: string; provider?: string; model?: string; language?: string; hint?: string },
    submitter: JobSubmitter,
  ): Promise<{ jobId: Id }>;
  settled(jobId: Id): Promise<JobState>;
  cancel(jobId: Id): Promise<unknown>;
  inspect(jobId: Id): JobRecord;
  /** Job Ledger 里的任务（重试时找这次运行提交过的转写）；没有时每次都重新提交。 */
  list?(): JobRecord[];
}

/**
 * 提交转写并等它完成（Job 自己把语音文档应用到视频，§7.3），返回 Job 与它写入的文档。重试时先认回这次运行提交过的、
 * 完成了或还在跑的转写。
 */
export async function transcribeInVideo(
  jobs: PipelineTranscriber,
  context: Pick<PipelineStepContext<unknown>, 'parentJobId' | 'attempt' | 'signal' | 'progress'>,
  request: Omit<TranscribeRequest, 'commandId'>,
  /** 完成了的转写还能不能用（例如它写入的文档被删了时不能）；不给时都能用。还在跑的总是接着等。 */
  usable: (job: JobRecord) => boolean = () => true,
): Promise<{ jobId: Id; documentId: Id | null; artifactId: string | null; transactionId: Id | null }> {
  const { parentJobId, signal } = context;
  context.progress(null, 'transcribing');
  const earlier = (jobs.list?.() ?? [])
    .filter(
      (job) =>
        job.kind === 'transcribe' &&
        job.submitter.kind === 'pipeline' &&
        job.submitter.id === parentJobId &&
        job.videoId === request.videoId &&
        job.assetId === request.assetId &&
        ((job.state === 'completed' && usable(job)) || job.state === 'queued' || job.state === 'running'),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
  // 每次执行一个命令：同一个命令会拿回上次失败的那个 Job。
  const commandId = context.attempt > 1 ? `${parentJobId}:transcribe:${context.attempt}` : `${parentJobId}:transcribe`;
  const { jobId } = earlier
    ? { jobId: earlier.jobId }
    : await jobs.submit({ ...request, commandId }, { kind: 'pipeline', id: parentJobId });
  const onAbort = () => void jobs.cancel(jobId).catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const state = await jobs.settled(jobId);
    signal.throwIfAborted();
    if (state !== 'completed') {
      const error = jobs.inspect(jobId).error;
      throw new PipelineStepError(
        error?.code ?? 'TRANSCRIBE_FAILED',
        error ? asLocalized(error.message, error.messageRef) : JobsVideoCreate.notCompleted({ state }),
        { jobId },
      );
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  const record = jobs.inspect(jobId);
  const result = record.result;
  // 写入文档的那笔事务（应用提交了的最后一次）。
  const applied = record.applications?.filter((app) => app.state === 'committed').at(-1);
  return {
    jobId,
    documentId: result?.documentId ?? null,
    artifactId: result?.artifactId ?? null,
    transactionId: applied?.receipt?.transactionId ?? null,
  };
}
