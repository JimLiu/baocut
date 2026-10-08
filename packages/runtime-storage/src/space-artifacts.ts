import fs from 'node:fs/promises';
import type {
  ApplicationState,
  ExportSettings,
  GeneratedOutput,
  Id,
  JobKind,
  JobRecord,
  JobState,
  JobSubmitter,
  PipelineRun,
  TextJobResult,
} from '@baocut/protocol';
import { readJson, writeJsonAtomic } from './json-file.ts';

/**
 * Space 派生条目时从一个任务读的事实（架构设计 §5.7）：正好是 `space-derive` 用到的字段，`JobRecord` 可以直接当它用。
 * 生成参数（原文、提示词）、用户库、授权、流程与取消的细节、警告都不在里面，文本结果只留媒体类型与长度。
 */
export interface SpaceJobFacts {
  jobId: Id;
  kind: JobKind;
  state: JobState;
  videoId: Id | null;
  providerId: string;
  modelId: string;
  inputHash: string;
  submitter: JobSubmitter;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  error: { code: string; message: string } | null;
  progress: { done: number; total: number | null } | null;
  result: {
    artifactId: string;
    outputs?: GeneratedOutput[];
    text?: { mediaType: TextJobResult['mediaType']; byteLength: number };
  } | null;
  export?: { settings: ExportSettings; videoRevision: string; destination: { files: string[] } };
  /** 只留最后一次应用的状态与原因。 */
  applications?: { state: ApplicationState; error: { code: string; message: string } | null }[];
  /**
   * 流程的名字与步骤（Job Ledger 里的流程才有；新建视频的步骤给出视频条目的来源，§7.9）。产物记录里有两种流程：文件到文件的
   * 保留名字与显式项目归属（下载转录）；新建了视频的，步骤只留完成了的 `create`、产出只留 `videoId`：Job Ledger 修剪掉这次运行之后，视频条目的来源照样在。
   */
  pipeline?: { name: string; steps?: PipelineRun['steps']; params?: { projectId?: unknown } };
}

/** 会留下产物条目的任务种类。 */
const ARTIFACT_KINDS = new Set<JobKind>(['synthesizeSpeech', 'generateImage', 'generateText', 'export']);
const TERMINAL = new Set<JobState>(['completed', 'failed', 'cancelled', 'interrupted', 'needs-reconciliation']);

/**
 * 文件到文件的流程（架构设计 §7.9）：输出发布成文件（`outputs[].path`），记为没有视频的生成记录；与生成的产物一样
 * 派生 Space 条目、留进产物记录。
 */
export const FILE_PIPELINES: ReadonlySet<string> = new Set(['transcode', 'translate-subtitles', 'link-import']);

/**
 * 文件到文件的流程的任务。转录只在只给文件时（结果有发布的文件）算：给了视频的转录写进视频，不留产物条目。
 */
export function isFilePipelineJob(job: {
  kind: JobKind;
  pipeline?: { name: string } | null | undefined;
  result?: { outputs?: readonly unknown[] | undefined } | null | undefined;
}): boolean {
  if (job.kind !== 'pipeline') return false;
  const name = job.pipeline?.name ?? '';
  return FILE_PIPELINES.has(name) || (name === 'transcribe' && (job.result?.outputs?.length ?? 0) > 0);
}

/**
 * 一个任务要不要留进产物记录：结束了、有结果、是会留下产物的种类。要留的返回它的派生用事实，否则 null。
 * 失败而没有结果的不留：它们只是占位，随 Job Ledger 修剪消失不丢东西。
 * 另外留新建了视频的流程（结束了、`create` 步骤完成了）：只为视频条目的来源，没有产物，也不随产物的清除去掉。
 */
export function spaceJobFacts(job: JobRecord): SpaceJobFacts | null {
  if (job.kind === 'pipeline' && !isFilePipelineJob(job)) return createdVideoFacts(job);
  if (!(ARTIFACT_KINDS.has(job.kind) || isFilePipelineJob(job)) || !TERMINAL.has(job.state) || !job.result) return createdVideoFacts(job);
  const last = job.applications?.at(-1);
  const createdSteps = createdVideoFacts(job)?.pipeline?.steps;
  const projectId = job.pipeline?.name === 'link-import' ? job.pipeline.params?.projectId : undefined;
  return {
    jobId: job.jobId,
    kind: job.kind,
    state: job.state,
    videoId: job.videoId,
    providerId: job.providerId,
    modelId: job.modelId,
    inputHash: job.inputHash,
    submitter: job.submitter,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    endedAt: job.endedAt,
    error: job.error ? { code: job.error.code, message: job.error.message } : null,
    progress: null,
    result: {
      artifactId: job.result.artifactId,
      ...(job.result.outputs ? { outputs: job.result.outputs } : {}),
      ...(job.result.text ? { text: { mediaType: job.result.text.mediaType, byteLength: job.result.text.byteLength } } : {}),
    },
    ...(job.export
      ? {
          export: {
            settings: job.export.settings,
            videoRevision: job.export.videoRevision,
            destination: { files: job.export.destination.files },
          },
        }
      : {}),
    ...(job.kind === 'pipeline' && job.pipeline ? {
      pipeline: {
        name: job.pipeline.name,
        ...(createdSteps ? { steps: createdSteps } : {}),
        ...(typeof projectId === 'string' ? { params: { projectId } } : {}),
      },
    } : {}),
    ...(last
      ? { applications: [{ state: last.state, error: last.error ? { code: last.error.code, message: last.error.message } : null }] }
      : {}),
  };
}

/** 新建了视频的流程的事实：结果与产物都不留，步骤只留完成了的 `create` 与它新建的视频。 */
function createdVideoFacts(job: JobRecord): SpaceJobFacts | null {
  if (!TERMINAL.has(job.state) || !job.pipeline) return null;
  const create = job.pipeline.steps.find((step) => step.name === 'create' && step.status === 'completed');
  const videoId = create?.output?.videoId;
  if (!create || typeof videoId !== 'string') return null;
  return {
    jobId: job.jobId,
    kind: job.kind,
    state: job.state,
    videoId: job.videoId,
    providerId: job.providerId,
    modelId: job.modelId,
    inputHash: job.inputHash,
    submitter: job.submitter,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    endedAt: job.endedAt,
    error: job.error ? { code: job.error.code, message: job.error.message } : null,
    progress: null,
    result: null,
    pipeline: { name: job.pipeline.name, steps: [{ ...create, output: { videoId } }] },
  };
}

/** 一条记录里的全部产物 id（生成的输出、文本全文、导出的文件）。 */
export function artifactIdsOf(facts: SpaceJobFacts): string[] {
  if (!facts.result) return [];
  const ids = new Set<string>();
  if (facts.kind === 'generateText') ids.add(facts.result.artifactId);
  for (const output of facts.result.outputs ?? []) ids.add(output.artifactId);
  return [...ids];
}

interface SpaceArtifactsFile {
  schemaVersion: 1;
  jobs: unknown[];
}

/**
 * Space 的产物记录（架构设计 §5.7、§14「Space 与 Job Ledger 的保留」）：产出产物的任务的派生用事实，按 `jobId`。
 * Job Ledger 只留最近的若干个任务，修剪掉的任务的产物 bytes 还在，条目却会跟着消失；这里另留一份，不随修剪丢失。
 * 新建了视频的流程也留一条（没有产物），视频条目的来源（§7.9）不随修剪丢失。
 *
 * - 任务结束且有结果时写入（`SpaceCatalog` 订阅任务变化，启动时也从 Job Ledger 补一遍）；
 * - 一条记录的产物全部被物理删除或清除之后去掉；
 * - 不是缓存：`space.rebuildIndex` 不删它。读坏了的行跳过，整个文件读不了时改名留存、从空的开始。
 */
export class SpaceArtifactStore {
  readonly #file: string;
  #jobs = new Map<Id, SpaceJobFacts>();
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.#file = file;
  }

  /** 读入记录。返回跳过的行数与（整个文件读不了时）留存的文件名，供日志。 */
  async load(): Promise<{ skipped: number; quarantined: string | null }> {
    let data: SpaceArtifactsFile | null;
    try {
      data = await readJson<SpaceArtifactsFile>(this.#file);
    } catch {
      const quarantined = `${this.#file}.corrupt-${Date.now()}`;
      await fs.rename(this.#file, quarantined).catch(() => {});
      this.#jobs = new Map();
      return { skipped: 0, quarantined };
    }
    this.#jobs = new Map();
    let skipped = 0;
    for (const row of Array.isArray(data?.jobs) ? data.jobs : []) {
      if (isFacts(row)) this.#jobs.set(row.jobId, row);
      else skipped++;
    }
    return { skipped, quarantined: null };
  }

  list(): SpaceJobFacts[] {
    return [...this.#jobs.values()];
  }

  get(jobId: Id): SpaceJobFacts | null {
    return this.#jobs.get(jobId) ?? null;
  }

  /** 写入或更新一批记录；没有变化时不落盘。 */
  put(records: readonly SpaceJobFacts[]): Promise<void> {
    let changed = false;
    for (const record of records) {
      const before = this.#jobs.get(record.jobId);
      if (before && JSON.stringify(before) === JSON.stringify(record)) continue;
      this.#jobs.set(record.jobId, record);
      changed = true;
    }
    return changed ? this.#save() : this.#saving;
  }

  remove(jobIds: readonly Id[]): Promise<void> {
    let changed = false;
    for (const jobId of jobIds) changed = this.#jobs.delete(jobId) || changed;
    return changed ? this.#save() : this.#saving;
  }

  flush(): Promise<void> {
    return this.#saving;
  }

  #save(): Promise<void> {
    const snapshot: SpaceArtifactsFile = { schemaVersion: 1, jobs: [...this.#jobs.values()] };
    this.#saving = this.#saving.catch(() => {}).then(() => writeJsonAtomic(this.#file, snapshot));
    return this.#saving;
  }
}

function isFacts(row: unknown): row is SpaceJobFacts {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  const common =
    typeof r.jobId === 'string' &&
    typeof r.kind === 'string' &&
    typeof r.state === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string' &&
    typeof r.inputHash === 'string' &&
    typeof r.submitter === 'object' &&
    r.submitter !== null;
  if (!common) return false;
  const filePipeline = isFilePipelineJob(r as { kind: JobKind; pipeline?: { name: string }; result?: { outputs?: unknown[] } | null });
  if (r.kind === 'pipeline' && (!filePipeline || !r.result)) {
    // 新建了视频的流程：步骤里有完成了的 `create` 与它的 `videoId`。
    const pipeline = r.pipeline as { name?: unknown; steps?: unknown } | undefined;
    if (!pipeline || typeof pipeline.name !== 'string' || !Array.isArray(pipeline.steps)) return false;
    return pipeline.steps.some((step) => {
      const s = step as { name?: unknown; status?: unknown; output?: { videoId?: unknown } | null } | null;
      return s?.name === 'create' && s.status === 'completed' && typeof s.output?.videoId === 'string';
    });
  }
  return (
    (ARTIFACT_KINDS.has(r.kind as JobKind) || filePipeline) &&
    typeof r.result === 'object' &&
    r.result !== null &&
    typeof (r.result as Record<string, unknown>).artifactId === 'string'
  );
}
