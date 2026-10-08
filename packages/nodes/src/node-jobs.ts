import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { canonicalJson, type FileJobObserver, type FileTranscribeRequest } from '@baocut/jobs';
import {
  NODE_ERROR,
  NODE_ERROR_STATUS,
  NODE_JOB_ERROR,
  RpcError,
  newId,
  type Id,
  type JobRecord,
  type JobState,
  type JobSubmitter,
  type ModelBundleStatus,
  type NodeErrorCode,
  type NodeJob,
  type NodeJobEvent,
  type NodeJobRequest,
  type NodeJobState,
} from '@baocut/protocol';
import { nodeJobRequestSchema } from '@baocut/protocol/schemas';
import { silentNodeLog, type NodeLogger } from './node-logger.ts';
import { NodesServer as NS } from '@baocut/protocol/messages/nodes';

/**
 * 节点上的远端任务（节点协议规范 §5–§7）。
 *
 * 任务在这里经历 `awaiting-input`（等发起端上传媒体），上传并核对摘要之后才交给 JobManager——与本机任务同一个
 * 模型包队列、同一个 Provider、同样的崩溃重试与输出校验。JobManager 的记录变化映射成 `NodeJob` 并记成带 `seq` 的事件；
 * Worker 崩溃后的自动重试不对外报告 `interrupted`（发起端会把它当作节点重启），只看到 `attempt` 加一。
 *
 * 文件：`<jobsDir>/<jobId>/input`（上传的媒体，任务终结即删）与 `result.json`（校验过的结果，`DELETE` 或终结后
 * 保留期满即删）。事件与记录在内存里；Runtime 重启后目录整个清掉，JobManager 的账本把未终结的标为 `interrupted`。
 */

/** NodeJobs 驱动的执行器：JobManager 在结构上满足它。 */
export interface NodeJobRunner {
  submitFile(request: FileTranscribeRequest, submitter: JobSubmitter, observer?: FileJobObserver): Promise<{ jobId: Id }>;
  cancel(jobId: Id): Promise<{ state: JobState }>;
  onChange(listener: (job: JobRecord) => void): () => void;
  list(): JobRecord[];
}

/** 模型包的状态：ModelCatalog 在结构上满足它。 */
export interface NodeModels {
  list(): Promise<ModelBundleStatus[]>;
  status(bundleId: string): Promise<ModelBundleStatus | null>;
}

export interface NodeLimits {
  /** 每个客户端未终结的任务上限（1 个运行加 8 个排队）。 */
  maxActivePerClient: number;
  /** 媒体上限（默认 16 GiB）。 */
  maxInputBytes: number;
  /** staging 所在磁盘至少留出的空间（默认 2 GiB）。 */
  diskReserveBytes: number;
  /** 创建后多久没完成上传就失败（默认 10 分钟）。 */
  inputExpiryMs: number;
  /** 终结后结果与记录保留多久（默认 10 分钟）。 */
  resultRetentionMs: number;
  /** `cancel` 等任务终结的最长时间（默认 15 秒）。 */
  cancelWaitMs: number;
  /** 记住多少个过期任务，用来对结果请求回 `410`（默认 1000）。 */
  tombstones: number;
}

export const DEFAULT_NODE_LIMITS: NodeLimits = {
  maxActivePerClient: 9,
  maxInputBytes: 16 * 1024 ** 3,
  diskReserveBytes: 2 * 1024 ** 3,
  inputExpiryMs: 10 * 60_000,
  resultRetentionMs: 10 * 60_000,
  cancelWaitMs: 15_000,
  tombstones: 1000,
};

/** 节点协议的 HTTP 错误：`code` 决定状态码（规范 §8）。 */
export class NodeHttpError extends Error {
  readonly code: NodeErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: NodeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NodeHttpError';
    this.code = code;
    this.status = NODE_ERROR_STATUS[code];
    this.details = details;
  }
}

type StoredEvent = Exclude<NodeJobEvent, { type: 'heartbeat' }>;
type EventListener = (event: StoredEvent | null) => void;
type WithoutSeq<T> = T extends unknown ? Omit<T, 'seq'> : never;

interface Entry {
  job: NodeJob;
  clientId: string;
  request: NodeJobRequest;
  fingerprint: string;
  dir: string;
  events: StoredEvent[];
  listeners: Set<EventListener>;
  inputTimer: ReturnType<typeof setTimeout> | null;
  retentionTimer: ReturnType<typeof setTimeout> | null;
  upload: AbortController | null;
  /** 已经交给 JobManager。 */
  submitted: boolean;
  /** Worker 崩溃后自动重试的新尝试序号；这期间 JobManager 报告的 `interrupted` 不对外。 */
  retrying: number | null;
  output: { sha256: string; byteLength: number } | null;
  terminal: Promise<void>;
  settle: () => void;
}

export interface NodeJobsOptions {
  /** `<home>/staging/node-jobs` */
  dir: string;
  runner: NodeJobRunner;
  models: NodeModels;
  /** 这种能力此刻是否开放共享（默认全开）。只在创建时查：已经接受的任务不受之后的开关影响。 */
  capabilityEnabled?: (capability: string) => boolean;
  log?: NodeLogger;
  limits?: Partial<NodeLimits>;
  /** staging 所在磁盘的可用字节数（默认 `fs.statfs`）。 */
  freeBytes?: (dir: string) => Promise<number>;
}

const TERMINAL = new Set<NodeJobState>(['completed', 'failed', 'cancelled', 'interrupted']);
const INPUT_FILE = 'input';
const RESULT_FILE = 'result.json';

export function isNodeJobTerminal(state: NodeJobState): boolean {
  return TERMINAL.has(state);
}

export class NodeJobs {
  readonly limits: NodeLimits;
  readonly #dir: string;
  readonly #runner: NodeJobRunner;
  readonly #models: NodeModels;
  readonly #capabilityEnabled: (capability: string) => boolean;
  readonly #log: NodeLogger;
  readonly #freeBytes: (dir: string) => Promise<number>;
  readonly #entries = new Map<Id, Entry>();
  /** `<clientId>\n<clientJobId>` → jobId */
  readonly #idempotency = new Map<string, Id>();
  /** 保留期满删掉的任务：jobId → clientId（结果请求回 `410`）。 */
  readonly #expired = new Map<Id, string>();
  readonly #unsubscribe: () => void;

  constructor(options: NodeJobsOptions) {
    this.limits = { ...DEFAULT_NODE_LIMITS, ...options.limits };
    this.#dir = options.dir;
    this.#runner = options.runner;
    this.#models = options.models;
    this.#capabilityEnabled = options.capabilityEnabled ?? (() => true);
    this.#log = options.log ?? silentNodeLog;
    this.#freeBytes = options.freeBytes ?? diskFreeBytes;
    this.#unsubscribe = this.#runner.onChange((record) => this.#onRecord(record));
  }

  /** Runtime 启动：上次留下的远端任务目录一律删除（它们的任务已不在内存里）。 */
  async sweep(): Promise<void> {
    await fs.rm(this.#dir, { recursive: true, force: true });
    await fs.mkdir(this.#dir, { recursive: true });
  }

  /** 这台节点上的远端任务数（`ShareStatus.jobs`）。 */
  counts(): { running: number; queued: number } {
    let running = 0;
    let queued = 0;
    for (const entry of this.#entries.values()) {
      if (entry.job.state === 'running') running++;
      else if (entry.job.state === 'queued') queued++;
    }
    return { running, queued };
  }

  // ---- §5.1 创建 ----

  async create(clientId: string, body: unknown): Promise<{ created: boolean; job: NodeJob }> {
    const parsed = nodeJobRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new NodeHttpError(NODE_ERROR.INVALID_REQUEST, NS.taskRequestInvalid().text, {
        issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const request = parsed.data as NodeJobRequest;
    const fingerprint = canonicalJson(request);
    const key = `${clientId}\n${request.clientJobId}`;
    const existing = this.#idempotent(key, fingerprint);
    if (existing) return { created: false, job: existing };

    if (!this.#capabilityEnabled(request.kind)) {
      throw new NodeHttpError(NODE_ERROR.CAPABILITY_DISABLED, NS.transcribeNotShared().text, { capability: request.kind });
    }
    const status = await this.#models.status(request.bundleId);
    if (!status || status.capability !== 'transcribe' || status.state === 'not-installed' || status.state === 'error') {
      throw new NodeHttpError(NODE_ERROR.MODEL_NOT_READY, NS.bundleNotReady().text, {
        bundleId: request.bundleId,
        state: status?.state ?? 'unknown',
        ...(status?.reason ? { reason: status.reason } : {}),
      });
    }
    this.#checkQueue(clientId);
    if (request.input.byteLength > this.limits.maxInputBytes) {
      throw new NodeHttpError(NODE_ERROR.INPUT_TOO_LARGE, NS.inputTooLarge().text, { maxBytes: this.limits.maxInputBytes });
    }
    await fs.mkdir(this.#dir, { recursive: true });
    const free = await this.#freeBytes(this.#dir);
    if (free < request.input.byteLength + this.limits.diskReserveBytes) {
      throw new NodeHttpError(NODE_ERROR.DISK_LOW, NS.diskLow().text);
    }

    // 两次 await 之间可能有同一个幂等键的创建，或者别的任务占满了队列。
    const raced = this.#idempotent(key, fingerprint);
    if (raced) return { created: false, job: raced };
    this.#checkQueue(clientId);

    const jobId = newId('job');
    const dir = path.join(this.#dir, jobId);
    let settle!: () => void;
    const terminal = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const entry: Entry = {
      job: {
        jobId,
        clientJobId: request.clientJobId,
        state: 'awaiting-input',
        phase: 'awaiting-input',
        progress: null,
        attempt: 1,
        error: null,
        output: null,
        lastSeq: 0,
      },
      clientId,
      request,
      fingerprint,
      dir,
      events: [],
      listeners: new Set(),
      inputTimer: null,
      retentionTimer: null,
      upload: null,
      submitted: false,
      retrying: null,
      output: null,
      terminal,
      settle,
    };
    this.#entries.set(jobId, entry);
    this.#idempotency.set(key, jobId);
    entry.inputTimer = setTimeout(() => {
      entry.inputTimer = null;
      if (entry.job.state !== 'awaiting-input') return;
      entry.upload?.abort();
      this.#log.warn('Remote job media was not uploaded in time', { jobId, clientId });
      void this.#finishLocal(entry, 'failed', { code: NODE_JOB_ERROR.INPUT_EXPIRED, message: NS.uploadExpired().text });
    }, this.limits.inputExpiryMs);
    entry.inputTimer.unref?.();
    await fs.mkdir(dir, { recursive: true });
    this.#emitJob(entry);
    this.#log.info('Remote job created', { jobId, clientId, bundleId: request.bundleId, byteLength: request.input.byteLength });
    return { created: true, job: structuredClone(entry.job) };
  }

  // ---- §5.2 上传 ----

  /**
   * 把请求体流式写进任务目录并同时算 sha256。`contentLength` 是请求头的值（缺失时调用方先回 400）。
   * 摘要与长度都相符时交给 JobManager；不符时任务以 `INPUT_HASH_MISMATCH` 失败、媒体立即删除。
   * 上传途中连接断开：删掉半个文件，任务仍等上传。
   */
  async upload(clientId: string, jobId: Id, contentLength: number, body: Readable): Promise<void> {
    const entry = this.#own(clientId, jobId);
    if (entry.job.state !== 'awaiting-input' || entry.upload) {
      throw new NodeHttpError(NODE_ERROR.INVALID_STATE, NS.notAwaitingUpload().text, { state: entry.job.state });
    }
    const expected = entry.request.input;
    if (contentLength !== expected.byteLength) {
      await this.#rejectInput(entry, NS.lengthMismatch().text);
      throw new NodeHttpError(NODE_ERROR.INPUT_HASH_MISMATCH, NS.lengthMismatch().text, {
        expectedBytes: expected.byteLength,
        receivedBytes: contentLength,
      });
    }

    const controller = new AbortController();
    entry.upload = controller;
    const file = path.join(entry.dir, INPUT_FILE);
    const partial = `${file}.part`;
    const hash = crypto.createHash('sha256');
    let received = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(body, meter, createWriteStream(partial), { signal: controller.signal });
    } catch (error) {
      await fs.rm(partial, { force: true }).catch(() => {});
      if (entry.upload === controller) entry.upload = null;
      if (controller.signal.aborted) throw new NodeHttpError(NODE_ERROR.INVALID_STATE, NS.noLongerAwaitingUpload().text, { state: entry.job.state });
      // 发起端断开：任务仍等上传，可以重传。
      this.#log.warn('Remote job upload interrupted', { jobId, clientId });
      throw error;
    }
    entry.upload = null;
    if (entry.job.state !== 'awaiting-input') {
      await fs.rm(partial, { force: true }).catch(() => {});
      throw new NodeHttpError(NODE_ERROR.INVALID_STATE, NS.noLongerAwaitingUpload().text, { state: entry.job.state });
    }
    const digest = `sha256:${hash.digest('hex')}`;
    if (received !== expected.byteLength || digest !== expected.contentHash) {
      await fs.rm(partial, { force: true }).catch(() => {});
      await this.#rejectInput(entry, NS.digestMismatch().text);
      throw new NodeHttpError(NODE_ERROR.INPUT_HASH_MISMATCH, NS.digestOrLengthMismatch().text);
    }
    await fs.rename(partial, file);
    if (entry.inputTimer) clearTimeout(entry.inputTimer);
    entry.inputTimer = null;

    // 交给 JobManager：记录的第一次变化（queued）在 submitFile 返回之前就会到达，所以先标记。
    entry.submitted = true;
    const options = entry.request.options;
    try {
      await this.#runner.submitFile(
        {
          jobId,
          file,
          contentHash: expected.contentHash,
          bundleId: entry.request.bundleId,
          language: options.language,
          track: expected.track,
          range: expected.range,
          diarize: options.diarize,
          hint: options.hint ?? null,
          timescale: options.timescale,
          resultFile: path.join(entry.dir, RESULT_FILE),
        },
        { kind: 'node', id: clientId },
        this.#observer(entry),
      );
    } catch (error) {
      entry.submitted = false;
      const unavailable = error instanceof RpcError && error.code === 'conflict';
      const bundle = unavailable ? (error.details as { bundle?: ModelBundleStatus | null } | undefined)?.bundle : undefined;
      await this.#finishLocal(
        entry,
        'failed',
        unavailable
          ? { code: 'MODEL_LOAD_FAILED', message: NS.bundleNotReady().text, details: { state: bundle?.state ?? 'unknown' } }
          : { code: 'JOB_INTERRUPTED', message: NS.notAccepted().text },
      );
      if (unavailable) throw new NodeHttpError(NODE_ERROR.MODEL_NOT_READY, NS.bundleNotReady().text, { state: bundle?.state ?? 'unknown' });
      throw new NodeHttpError(NODE_ERROR.INVALID_STATE, NS.notAccepted().text);
    }
    this.#log.info('Remote job media verified; queued', { jobId, clientId });
  }

  // ---- §5.3 读取、取消、删除 ----

  get(clientId: string, jobId: Id): NodeJob {
    return structuredClone(this.#own(clientId, jobId).job);
  }

  /** 幂等；运行中的任务等它终结，最长 `cancelWaitMs`，超时返回当前状态。 */
  async cancel(clientId: string, jobId: Id): Promise<NodeJob> {
    const entry = this.#own(clientId, jobId);
    await this.#cancel(entry, this.limits.cancelWaitMs);
    return structuredClone(entry.job);
  }

  /** 未终结的先取消，然后删除媒体、结果、事件与记录。之后这个任务一律 404。 */
  async remove(clientId: string, jobId: Id): Promise<void> {
    const entry = this.#own(clientId, jobId);
    await this.#cancel(entry, null);
    await this.#drop(entry, false);
  }

  /** 客户端被吊销：它的全部任务取消并删除。 */
  async removeClient(clientId: string): Promise<void> {
    const entries = [...this.#entries.values()].filter((e) => e.clientId === clientId);
    await Promise.allSettled(entries.map((e) => this.#cancel(e, null)));
    await Promise.allSettled(entries.map((e) => this.#drop(e, false)));
    for (const [jobId, owner] of this.#expired) if (owner === clientId) this.#expired.delete(jobId);
  }

  /** 共享关闭或 Runtime 停止：全部远端任务取消并删除。 */
  async closeAll(): Promise<void> {
    const entries = [...this.#entries.values()];
    await Promise.allSettled(entries.map((e) => this.#cancel(e, null)));
    await Promise.allSettled(entries.map((e) => this.#drop(e, false)));
    this.#expired.clear();
    await fs.rm(this.#dir, { recursive: true, force: true }).catch(() => {});
  }

  /** 不再接收 JobManager 的变化（Runtime 停止的最后一步）。 */
  detach(): void {
    this.#unsubscribe();
  }

  // ---- §6 事件 ----

  /**
   * 订阅一个任务的事件：先给出 `seq > since` 的已有事件；任务已经终结时 `done` 为 true（调用方写完就关闭）。
   * 否则之后的事件逐条交给 `listener`；终结的那条之后、或任务被删除时，`listener(null)` 表示结束。
   */
  subscribe(clientId: string, jobId: Id, since: number, listener: EventListener): { backlog: StoredEvent[]; done: boolean; close(): void } {
    const entry = this.#own(clientId, jobId);
    const backlog = entry.events.filter((e) => e.seq > since);
    if (isNodeJobTerminal(entry.job.state)) return { backlog, done: true, close() {} };
    entry.listeners.add(listener);
    return { backlog, done: false, close: () => entry.listeners.delete(listener) };
  }

  // ---- §7 结果 ----

  result(clientId: string, jobId: Id): { file: string; sha256: string; byteLength: number } {
    const entry = this.#entries.get(jobId);
    if (!entry || entry.clientId !== clientId) {
      if (this.#expired.get(jobId) === clientId) throw new NodeHttpError(NODE_ERROR.RESULT_EXPIRED, NS.resultDeleted().text);
      throw new NodeHttpError(NODE_ERROR.JOB_NOT_FOUND, NS.taskNotFound().text);
    }
    if (entry.job.state !== 'completed') throw new NodeHttpError(NODE_ERROR.INVALID_STATE, NS.taskNotCompleted().text, { state: entry.job.state });
    if (!entry.output) throw new NodeHttpError(NODE_ERROR.RESULT_EXPIRED, NS.resultDeleted().text);
    return { file: path.join(entry.dir, RESULT_FILE), ...entry.output };
  }

  // ---- 内部 ----

  #own(clientId: string, jobId: Id): Entry {
    const entry = this.#entries.get(jobId);
    // 别的客户端的任务一律当作不存在。
    if (!entry || entry.clientId !== clientId) throw new NodeHttpError(NODE_ERROR.JOB_NOT_FOUND, NS.taskNotFound().text);
    return entry;
  }

  #idempotent(key: string, fingerprint: string): NodeJob | null {
    const jobId = this.#idempotency.get(key);
    const entry = jobId ? this.#entries.get(jobId) : undefined;
    if (!entry) return null;
    if (entry.fingerprint !== fingerprint) throw new NodeHttpError(NODE_ERROR.IDEMPOTENCY_CONFLICT, NS.idempotencyConflict().text);
    return structuredClone(entry.job);
  }

  #checkQueue(clientId: string): void {
    let active = 0;
    for (const entry of this.#entries.values()) if (entry.clientId === clientId && !isNodeJobTerminal(entry.job.state)) active++;
    if (active >= this.limits.maxActivePerClient) {
      throw new NodeHttpError(NODE_ERROR.QUEUE_FULL, NS.queueFull().text, { limit: this.limits.maxActivePerClient });
    }
  }

  #observer(entry: Entry): FileJobObserver {
    return {
      warning: (warning) => {
        if (isNodeJobTerminal(entry.job.state)) return;
        const { code, segmentId, detail } = warning;
        this.#emit(entry, {
          type: 'warning',
          warning: { code, ...(segmentId !== undefined ? { segmentId } : {}), ...(detail !== undefined ? { detail } : {}) },
        });
      },
      language: (tag, confidence) => {
        if (!isNodeJobTerminal(entry.job.state)) this.#emit(entry, { type: 'language', tag, confidence });
      },
      retrying: (attempt) => {
        entry.retrying = attempt;
      },
      output: (output) => {
        entry.output = { sha256: output.sha256, byteLength: output.byteLength };
      },
    };
  }

  /** JobManager 的记录变化 → NodeJob。 */
  #onRecord(record: JobRecord): void {
    const entry = this.#entries.get(record.jobId);
    if (!entry || !entry.submitted || isNodeJobTerminal(entry.job.state)) return;
    // 崩溃后的自动重试：这一次标为 interrupted、紧接着回到 running。发起端只看到 attempt 加一。
    if (record.state === 'interrupted' && entry.retrying !== null && record.endedAt === null) return;
    if (record.state === 'running' && entry.retrying !== null && record.attempt >= entry.retrying) entry.retrying = null;
    const job = entry.job;
    // 节点只跑本机转写，不会有外发调用的 `needs-reconciliation`；万一出现按中断处理。
    const state: NodeJobState = record.state === 'needs-reconciliation' ? 'interrupted' : record.state;
    const next: Omit<NodeJob, 'lastSeq'> = {
      jobId: job.jobId,
      clientJobId: job.clientJobId,
      state,
      phase: record.phase,
      // 节点只跑转写：进度的单位只有秒与段。
      progress:
        record.progress && (record.progress.unit === 'seconds' || record.progress.unit === 'segments')
          ? { done: record.progress.done, total: record.progress.total, unit: record.progress.unit }
          : null,
      attempt: record.attempt,
      error: remoteError(record.error),
      output: state === 'completed' ? entry.output : null,
    };
    if (state === 'completed' && !entry.output) {
      next.state = 'failed';
      next.error = { code: 'INTERNAL', message: NS.completedWithoutResult().text };
    }
    if (sameJob(job, next)) return;
    Object.assign(job, next);
    this.#emitJob(entry);
    if (isNodeJobTerminal(job.state)) void this.#terminated(entry);
  }

  /** 节点自己让任务终结（等待上传时取消、上传不符、上传过期、交不进队列）。 */
  async #finishLocal(entry: Entry, state: 'failed' | 'cancelled', error: NodeJob['error']): Promise<void> {
    if (isNodeJobTerminal(entry.job.state)) return;
    Object.assign(entry.job, { state, phase: 'done', progress: null, error, output: null } satisfies Partial<NodeJob>);
    this.#emitJob(entry);
    await this.#terminated(entry);
  }

  async #rejectInput(entry: Entry, message: string): Promise<void> {
    await this.#finishLocal(entry, 'failed', { code: NODE_JOB_ERROR.INPUT_HASH_MISMATCH, message });
  }

  /** 终结：删上传的媒体（没有结果时整个目录），开始结果的保留期。 */
  async #terminated(entry: Entry): Promise<void> {
    if (entry.inputTimer) clearTimeout(entry.inputTimer);
    entry.inputTimer = null;
    entry.upload?.abort();
    const { jobId } = entry.job;
    this.#log.info('Remote job finished', { jobId, clientId: entry.clientId, state: entry.job.state, code: entry.job.error?.code });
    if (entry.job.state === 'completed') {
      await fs.rm(path.join(entry.dir, INPUT_FILE), { force: true }).catch(() => {});
      await fs.rm(path.join(entry.dir, `${INPUT_FILE}.part`), { force: true }).catch(() => {});
    } else {
      await fs.rm(entry.dir, { recursive: true, force: true }).catch(() => {});
    }
    if (this.#entries.get(jobId) === entry && !entry.retentionTimer) {
      entry.retentionTimer = setTimeout(() => {
        entry.retentionTimer = null;
        void this.#drop(entry, true);
      }, this.limits.resultRetentionMs);
      entry.retentionTimer.unref?.();
    }
    entry.settle();
  }

  async #cancel(entry: Entry, waitMs: number | null): Promise<void> {
    const state = entry.job.state;
    if (isNodeJobTerminal(state)) return;
    if (!entry.submitted) {
      entry.upload?.abort();
      await this.#finishLocal(entry, 'cancelled', null);
      return;
    }
    const cancelled = this.#runner.cancel(entry.job.jobId).catch((error: unknown) => {
      this.#log.warn('Failed to cancel remote job', { jobId: entry.job.jobId, error: String(error) });
    });
    const done = Promise.all([cancelled, entry.terminal]);
    if (waitMs === null) {
      await done;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([done, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))]);
    clearTimeout(timer);
  }

  /** 删除一个任务的文件、事件与记录；`expired` 时记一个墓碑，结果请求回 `410`。 */
  async #drop(entry: Entry, expired: boolean): Promise<void> {
    const { jobId } = entry.job;
    if (this.#entries.get(jobId) !== entry) return;
    this.#entries.delete(jobId);
    const key = `${entry.clientId}\n${entry.job.clientJobId}`;
    if (this.#idempotency.get(key) === jobId) this.#idempotency.delete(key);
    if (entry.inputTimer) clearTimeout(entry.inputTimer);
    if (entry.retentionTimer) clearTimeout(entry.retentionTimer);
    entry.upload?.abort();
    for (const listener of entry.listeners) listener(null);
    entry.listeners.clear();
    if (expired) {
      this.#expired.set(jobId, entry.clientId);
      while (this.#expired.size > this.limits.tombstones) this.#expired.delete(this.#expired.keys().next().value!);
    }
    await fs.rm(entry.dir, { recursive: true, force: true }).catch(() => {});
    this.#log.info(expired ? 'Remote job expired and was deleted' : 'Remote job deleted', { jobId, clientId: entry.clientId });
  }

  #emitJob(entry: Entry): void {
    this.#emit(entry, { type: 'job' });
  }

  /** 记一条事件并交给订阅者。`job` 事件带发出时完整的 NodeJob（`lastSeq` 就是这条的 seq）。 */
  #emit(entry: Entry, payload: { type: 'job' } | WithoutSeq<Extract<StoredEvent, { type: 'warning' | 'language' }>>): void {
    const seq = entry.job.lastSeq + 1;
    entry.job.lastSeq = seq;
    const event: StoredEvent =
      payload.type === 'job' ? { seq, type: 'job', job: structuredClone(entry.job) } : ({ seq, ...payload } as StoredEvent);
    entry.events.push(event);
    const terminal = event.type === 'job' && isNodeJobTerminal(event.job.state);
    for (const listener of [...entry.listeners]) {
      listener(event);
      if (terminal) listener(null);
    }
    if (terminal) entry.listeners.clear();
  }
}

function sameJob(current: NodeJob, next: Omit<NodeJob, 'lastSeq'>): boolean {
  const { lastSeq: _lastSeq, ...rest } = current;
  return canonicalJson(rest) === canonicalJson(next);
}

/**
 * 交给发起端的任务错误：去掉节点本机的诊断（Worker 的 stderr 尾部可能带本机路径），其余原样。
 * 诊断仍留在节点自己的 `jobs` 主题与账本里。
 */
function remoteError(error: JobRecord['error']): NodeJob['error'] {
  if (!error) return null;
  const { code, message, details } = error;
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const { stderrTail: _stderrTail, ...rest } = details as Record<string, unknown>;
    return { code, message, details: rest };
  }
  return details === undefined ? { code, message } : { code, message, details };
}

async function diskFreeBytes(dir: string): Promise<number> {
  const stats = await fs.statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}
