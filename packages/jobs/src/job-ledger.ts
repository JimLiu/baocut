import type { JobRecord, JobWarning } from '@baocut/protocol';
import { readJson, writeJsonAtomic } from '@baocut/runtime-storage';
import type { VideoPlace } from './application-ledger.ts';
import type { GenerationInputSpec, TaskInputSpec, TranscribeInputSpec } from './input-hash.ts';

/**
 * Job 账本：`<runtime-home>/store/jobs.json`（与其他存储一样是 JSON 文件，原子写，并且 fsync 文件与目录，§7.3）。
 * 每条是公开的 `JobRecord` 加上冻结的任务规格；写入串行，后发起的写一定落在后面。
 */

export interface StoredJob {
  record: JobRecord;
  /**
   * 转写任务是 `TranscribeInputSpec`，生成任务（`record.kind` 为 `synthesizeSpeech` / `generateImage`）是 `GenerationInputSpec`，
   * 导出（`export`）是 `TaskInputSpec`；由别的模块执行、JobManager 只记账的任务（固定流程）是 `HostedJobSpec`。
   */
  spec: TranscribeInputSpec | GenerationInputSpec | TaskInputSpec | HostedJobSpec;
  /** 第一次尝试的 Worker 版本：重试必须相同（架构设计 §6.5）。 */
  workerVersion: string | null;
  /** 提交时视频的位置：重启后重新排队要先按它打开视频（§7.5）。没有视频时没有。 */
  videoPlace?: VideoPlace | null;
  /** 远端任务 ID（可查询的在线 Provider 提交之后给出，重启后据此查询，§7.5）。现有的 Provider 都没有。 */
  remoteTaskId?: string;
  /** 发布意图（§7.3）：写产物库之前落账，结果与应用记下（或任务结束）时清掉。重启时有它，就按它认领产物。 */
  publishing?: PublishIntent;
}

/** 将要发布的产物与结果。产物库按内容寻址，产物 ID 在写之前就算得出。 */
export interface PublishIntent {
  /** `sha256:<hex>`，按应用的顺序。 */
  artifactIds: string[];
  /** 发布之后的结果（应用之后补上的文档与素材 ID 不在里面）。 */
  result: NonNullable<JobRecord['result']>;
  /** 要应用到视频时的目标引用；只发布、不应用时 null。 */
  targetRefs: string[] | null;
  warnings: JobWarning[];
}

/** 托管任务：执行与冻结的参数由宿主（`hosted` 是它的名字）自己负责，这里只有记录。 */
export interface HostedJobSpec {
  hosted: string;
}

interface LedgerFile {
  formatVersion: 1;
  jobs: StoredJob[];
}

/** 终结的状态：`needs-reconciliation` 也算（不再执行，等用户用 `jobs.reconcile` 决定）。 */
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'needs-reconciliation']);

export function isTerminal(state: JobRecord['state']): boolean {
  return TERMINAL.has(state);
}

export class JobLedger {
  readonly file: string;
  #chain: Promise<void> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  async load(): Promise<StoredJob[]> {
    const data = await readJson<LedgerFile>(this.file).catch(() => null);
    if (!data || data.formatVersion !== 1 || !Array.isArray(data.jobs)) return [];
    return data.jobs.filter((job) => job && typeof job.record?.jobId === 'string');
  }

  /** 排队写入一份完整的快照（按创建先后）。返回这次写入完成的 Promise。 */
  save(jobs: readonly StoredJob[]): Promise<void> {
    const data: LedgerFile = { formatVersion: 1, jobs: structuredClone([...jobs]) };
    const next = this.#chain.then(() => writeJsonAtomic(this.file, data, { durable: true }));
    this.#chain = next.catch(() => {});
    return next;
  }

  /** 等所有排队的写入完成。 */
  flush(): Promise<void> {
    return this.#chain;
  }
}
