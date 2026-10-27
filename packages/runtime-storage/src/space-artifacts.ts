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
import fs from 'node:fs/promises';
import path from 'node:path';
import { JsonStoreFile, type StoreOptions } from './store-file.ts';

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
  pipeline?: {
    name: string;
    steps?: PipelineRun['steps'];
    params?: { projectId?: unknown };
    document?: WritingDocumentFacts;
    /** `downloads-save` 交出的带出处的 Markdown：出处旁文件（`baocut.citations/1`，创作辅助集成设计 §3.4「智能体路径」）。 */
    citationsArtifactId?: string;
  };
}

/**
 * 写作类 AI 工具（`ai-tool` 的总结、博客、标题、简介）的结果：一份 Markdown 文档条目（产品设计 §5.10，创作辅助集成设计
 * §3.4），条目 ID 是正文的产物，出处旁文件是另一个产物。
 */
export interface WritingDocumentFacts {
  tool: string;
  byteLength: number;
  citationsArtifactId: string | null;
}

/** 写成文档条目的 `ai-tool` 工具。 */
const WRITING_TOOLS: ReadonlySet<string> = new Set(['summary', 'blog', 'title', 'desc']);

/** 写作类 AI 工具完成了的任务：它的正文列成文档条目。 */
export function writingDocumentOf(job: JobRecord): WritingDocumentFacts | null {
  if (job.kind !== 'pipeline' || job.pipeline?.name !== 'ai-tool' || job.state !== 'completed' || !job.result) return null;
  const summary = job.pipeline.summary as { tool?: unknown; text?: unknown; citationsArtifactId?: unknown } | null;
  if (!summary || typeof summary.tool !== 'string' || !WRITING_TOOLS.has(summary.tool) || typeof summary.text !== 'string') return null;
  return {
    tool: summary.tool,
    byteLength: Buffer.byteLength(summary.text, 'utf8'),
    citationsArtifactId: typeof summary.citationsArtifactId === 'string' ? summary.citationsArtifactId : null,
  };
}

/** 会留下产物条目的任务种类。 */
const ARTIFACT_KINDS = new Set<JobKind>(['synthesizeSpeech', 'generateImage', 'generateMusic', 'generateText', 'export']);
const TERMINAL = new Set<JobState>(['completed', 'failed', 'cancelled', 'interrupted', 'needs-reconciliation']);

/**
 * 文件到文件的流程（架构设计 §7.9）：输出发布成文件（`outputs[].path`），记为没有视频的生成记录；与生成的产物一样
 * 派生 Space 条目、留进产物记录。`downloads-save` 是智能体用 `downloads_save` 交出的文件（§3.5）：不经 Job Ledger，
 * 直接写进产物记录，派生方式相同。
 */
export const FILE_PIPELINES: ReadonlySet<string> = new Set([
  'transcode',
  'translate-subtitles',
  'link-import',
  'downloads-save',
  // 图片处理（§7.9）：放大、去除物体、去水印、重绘局部、扩展画面，结果是保存位置里的 PNG。
  'upscale-image',
  'remove-object',
  'remove-watermark',
  'repaint-image',
  'expand-image',
]);

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
  const document = writingDocumentOf(job);
  if (document) return { ...baseFacts(job), result: { artifactId: job.result!.artifactId }, pipeline: { name: job.pipeline!.name, document } };
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

/** 任务记录里派生条目都要的部分（结果与流程另给）。 */
function baseFacts(job: JobRecord): Omit<SpaceJobFacts, 'result'> {
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
  if (facts.kind === 'generateText' || facts.pipeline?.document) ids.add(facts.result.artifactId);
  for (const output of facts.result.outputs ?? []) ids.add(output.artifactId);
  return [...ids];
}

/**
 * 任务出了 Job Ledger 之后产物库还要为它留着的产物（架构设计 §5.7「产物记录」、§7.3）：bytes 就在产物库里的 Space 条目
 * 用到的，即生成的图片、音频与音乐，`generateText` 与写作类 AI 工具的正文，以及条目引用的出处旁文件。导出与文件到文件
 * 流程的条目按发布的文件定位，它们的产物副本不留；配音的句子、原始转写、流程的中间产物本来就不在这里。视频要的 bytes
 * 在它自己的 `blobs/` 里，视频文档里的产物 ID 只是来历（§5.5），不算引用。
 */
export function heldArtifactIdsOf(facts: SpaceJobFacts): string[] {
  const ids = new Set<string>();
  const citations = facts.pipeline?.document?.citationsArtifactId ?? facts.pipeline?.citationsArtifactId;
  if (citations) ids.add(citations);
  if (!facts.result || facts.kind === 'export' || isFilePipelineJob(facts)) return [...ids];
  if (facts.kind === 'generateText' || facts.pipeline?.document) ids.add(facts.result.artifactId);
  if (facts.kind !== 'pipeline') for (const output of facts.result.outputs ?? []) ids.add(output.artifactId);
  return [...ids];
}

const ARTIFACT_ID = /sha256:[0-9a-f]{64}/g;

/** 文本里的全部 `sha256:<64 位 hex>`。 */
function artifactIdsInText(text: string, into: Set<string>): Set<string> {
  for (const match of text.matchAll(ARTIFACT_ID)) into.add(match[0]);
  return into;
}

interface SpaceArtifactsFile {
  schemaVersion: 1;
  jobs: unknown[];
  /** 旧版本只为清扫保留的引用：读入时丢掉，下一次写（读入时就写一次）去掉。 */
  references?: unknown[];
  /**
   * 产物库清扫的起点（ISO 时间）：修改时间早于它的产物不删。旧文件没有它，读入时补成当时：开始保留引用之前修剪掉的任务的
   * 产物无从知道还有没有人用，一律留着。
   */
  sweepSince?: string;
}

/**
 * Space 的产物记录（架构设计 §5.7、§14「Space 与 Job Ledger 的保留」）：产出产物的任务的派生用事实，按 `jobId`。
 * Job Ledger 只留最近的若干个任务，修剪掉的任务的产物 bytes 还在，条目却会跟着消失；这里另留一份，不随修剪丢失。
 * 新建了视频的流程也留一条（没有产物），视频条目的来源（§7.9）不随修剪丢失。
 *
 * - 任务结束且有结果时写入（`SpaceCatalog` 订阅任务变化，启动时也从 Job Ledger 补一遍）；
 * - 一条记录的产物全部被物理删除或清除之后去掉；
 * - 产物库清扫只为这里 bytes 在产物库里的条目留产物（`heldArtifactIdsOf`）；旧版本另存的 `references` 读入时丢掉；
 * - 不是缓存：`space.rebuildIndex` 不删它。读坏了的行跳过，整个文件认不出时改名留存、从空的开始；更新版本写下的不改写
 *   （`store-file.ts`）。
 */
export class SpaceArtifactStore {
  readonly #file: JsonStoreFile;
  readonly #path: string;
  #jobs = new Map<Id, SpaceJobFacts>();
  /** 读入时认不出、跳过的行：下一次写会丢掉它们，这次运行里它们出现的产物 id 仍算引用。 */
  #skippedText = '';
  #sweepSince: string = new Date().toISOString();
  #saving: Promise<void> = Promise.resolve();

  constructor(file: string, options: StoreOptions = {}) {
    this.#file = new JsonStoreFile(file, options.log);
    this.#path = file;
  }

  /** 读入记录。返回跳过的行数与（整个文件认不出时）留存的文件名，供日志。 */
  async load(): Promise<{ skipped: number; quarantined: string | null }> {
    const read = await this.#file.read({
      recognize: (raw) =>
        Array.isArray(raw.jobs)
          ? {
              jobs: raw.jobs as unknown[],
              hadReferences: raw.references !== undefined,
              sweepSince: typeof raw.sweepSince === 'string' && Number.isFinite(Date.parse(raw.sweepSince)) ? raw.sweepSince : null,
            }
          : null,
    });
    this.#jobs = new Map();
    const skippedRows: unknown[] = [];
    const since = read.value?.sweepSince ?? null;
    this.#sweepSince = since ?? new Date().toISOString();
    let skipped = 0;
    for (const row of read.value?.jobs ?? []) {
      if (isFacts(row)) this.#jobs.set(row.jobId, row);
      else {
        skipped++;
        skippedRows.push(row);
      }
    }
    this.#skippedText = skippedRows.length > 0 ? JSON.stringify(skippedRows) : '';
    // 起点要先落盘：之后的清扫都以它为准，不能每次启动往后挪。旧版本的 `references` 同时去掉：清扫会读这个文件的文本。
    if ((since === null || read.value?.hadReferences) && read.status !== 'newer-version') await this.#save().catch(() => {});
    return { skipped, quarantined: read.status === 'quarantined' ? read.renamedTo : null };
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

  /** 产物库清扫的起点（毫秒）：修改时间早于它的产物不删。 */
  sweepSince(): number {
    return Date.parse(this.#sweepSince);
  }

  /**
   * 产物库清扫要保留的产物 id（架构设计 §7.3）：记录里 bytes 在产物库里的条目用到的（`heldArtifactIdsOf`），加上读不懂的
   * 部分里出现的每个 `sha256:<hex>`：读入时跳过的行、更新的版本写下而没有读进来的这个文件、改名留存的
   * `<文件>.corrupt-*`。宁多勿少，不因为一次读不懂就让下一轮清扫删掉它们。
   */
  async referencedArtifactIds(): Promise<Set<string>> {
    const ids = new Set(this.list().flatMap(heldArtifactIdsOf));
    artifactIdsInText(this.#skippedText, ids);
    await this.#saving.catch(() => {});
    const dir = path.dirname(this.#path);
    const base = path.basename(this.#path);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name === base ? !this.#file.readOnly : !name.startsWith(`${base}.corrupt-`)) continue;
      const text = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '');
      artifactIdsInText(text, ids);
    }
    return ids;
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
    const snapshot: SpaceArtifactsFile = {
      schemaVersion: 1,
      jobs: [...this.#jobs.values()],
      sweepSince: this.#sweepSince,
    };
    this.#saving = this.#saving.catch(() => {}).then(() => this.#file.write(snapshot));
    return this.#saving;
  }
}

/** 写作类 AI 工具的文档：结果有正文的产物，流程带 `document`。 */
function isWritingFacts(r: Record<string, unknown>): boolean {
  const result = r.result as { artifactId?: unknown } | null | undefined;
  const document = (r.pipeline as { document?: { tool?: unknown; byteLength?: unknown; citationsArtifactId?: unknown } } | undefined)?.document;
  return (
    typeof result?.artifactId === 'string' &&
    typeof document?.tool === 'string' &&
    typeof document.byteLength === 'number' &&
    (document.citationsArtifactId === null || typeof document.citationsArtifactId === 'string')
  );
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
  if (r.kind === 'pipeline' && isWritingFacts(r)) return true;
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
