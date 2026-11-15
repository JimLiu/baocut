import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TopicLog, type Logger, type TopicSubscription } from '@baocut/harness';
import type { HostedJob, JobManager, PipelineTargets, VideoLease, VideoPlace } from '@baocut/jobs';
import { findBundledBinary, JsonLineWorker, WorkerRequestError, type WorkerCommand } from '@baocut/process-host';
import {
  newId,
  refOf,
  RECORDING_DEFAULTS,
  RpcError,
  type Id,
  type JobError,
  type JobPhase,
  type JobRecord,
  type JobSubmitter,
  type Localized,
  type RecordingOptions,
  type RecordingPermissions,
  type RecordingSources,
  type RecordingState,
  type RecordingStreamStatus,
  type RecordingSummary,
  type RecordingTarget,
  type RecordingsEvent,
  type RecordingsSnapshot,
  type SystemAccessNeed,
} from '@baocut/protocol';
import { RcRecordings } from '@baocut/protocol/messages/runtime-core';
import type { VideoService } from '../videos/video-service.ts';
import { importRecording } from './recording-import.ts';
import { buildPackage, RecordingPackageError, type ProbeDuration } from './recording-package.ts';
import {
  helloResult,
  RECORDING_WORKER_PROTOCOL,
  SETTINGS_PATHS,
  sourcesResult,
  startResult,
  workerEvent,
  type WorkerHello,
  type WorkerSources,
  type WorkerStartParams,
} from './worker-protocol.ts';

/**
 * 录制会话（屏幕录制设计 §7、§11–§13）：同一时刻只有一次录制，状态机、Recording Worker 的启停与崩溃、收尾与导入、没收完的恢复。
 *
 * - 目录：`<root>/<recordingId>/session.json`（摘要、新视频占下的位置、发起者），`capture/`（Worker 写的文件与日志），
 *   `package/`（换算出的指针轨与键盘轨）。导入成功之后整个目录删掉（素材已经以 `managed` 复制进视频）。
 * - 任务：每次录制一个托管任务（`kind: 'recording'`）。等待开始时是 `running` + `queued`，采集时 `recording` / `paused`，
 *   收尾 `finalizing`，导入 `applying`；进度是已录秒数，没有总量。
 * - 取消（`jobs.cancel`）与 Runtime 停止（中断）在采集中途时：停下 Worker、保留文件，录制变成可恢复的 `importable`。
 * - 启动时扫描目录：上次没收完的（采集中、收尾中、导入中）记成 `importable` + `unfinished`，等用户恢复或删除，不自动删。
 */

const ACTIVE: ReadonlySet<RecordingState> = new Set(['waiting', 'preparing', 'countdown', 'recording', 'paused', 'stopping', 'finalizing', 'importing']);
const CAPTURING: ReadonlySet<RecordingState> = new Set(['recording', 'paused']);
const BEFORE_CAPTURE: ReadonlySet<RecordingState> = new Set(['waiting', 'preparing', 'countdown']);
const RECOVERABLE: ReadonlySet<RecordingState> = new Set(['importable', 'failed']);

const RECORDING_WORKER_ENV = 'BAOCUT_RECORDING_WORKER';
/** 开始之前要求的最少剩余空间；低于 `warnFreeBytes`（约十分钟）只记警告。 */
const MIN_FREE_BYTES = 512 * 1024 * 1024;
const WARN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
const DISK_POLL_MS = 5000;

const PERMISSION_LABELS: Record<keyof RecordingPermissions, () => Localized> = {
  screen: RcRecordings.permScreen,
  camera: RcRecordings.permCamera,
  microphone: RcRecordings.permMicrophone,
  inputMonitoring: RcRecordings.permInputMonitoring,
};

/** Worker 在开始时被系统拒绝的错误码，对应缺的那项权限。 */
const WORKER_PERMISSION_CODES: Partial<Record<string, keyof RecordingPermissions>> = {
  SCREEN_PERMISSION_DENIED: 'screen',
  CAMERA_PERMISSION_DENIED: 'camera',
  MICROPHONE_PERMISSION_DENIED: 'microphone',
  INPUT_MONITORING_UNAVAILABLE: 'inputMonitoring',
};

export function resolveRecordingWorkerCommand(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env[RECORDING_WORKER_ENV]) return env[RECORDING_WORKER_ENV];
  return findBundledBinary('recording-worker', path.dirname(fileURLToPath(import.meta.url)), env);
}

/** ffprobe 读文件的时长（秒）；读不出时 null（崩溃留下的半截文件）。 */
export function ffprobeDuration(command: () => Promise<{ command: string; env?: NodeJS.ProcessEnv }>): ProbeDuration {
  return async (file) => {
    const tool = await command();
    return new Promise((resolve) => {
      execFile(
        tool.command,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
        { env: tool.env ?? process.env, timeout: 30_000 },
        (error, stdout) => {
          const seconds = Number.parseFloat(String(stdout).trim());
          resolve(error || !Number.isFinite(seconds) ? null : seconds);
        },
      );
    });
  };
}

export interface RecordingServiceOptions {
  /** 录制目录的根（Runtime Home 的 `recordings/`）。 */
  root: string;
  jobs: JobManager;
  videos: VideoService;
  targets: PipelineTargets;
  /** 已有视频的位置（`--video`、编辑器入口）：开着的视频直接取，没开的从 Space 找；找不到时 null。 */
  placeOf(videoId: Id): VideoPlace | null;
  /** Worker 的命令；null 时这台电脑不能录（`RECORDING_UNAVAILABLE`）。 */
  worker: () => WorkerCommand | null;
  probe: ProbeDuration;
  /** 这台电脑上开着 BaoCut 的桌面端（屏幕录制设计 §14：没有窗口的 Runtime 先不录）。 */
  hasWindow: () => boolean;
  log: Logger;
  platform?: NodeJS.Platform;
  /** 测试用：剩余空间与倒计时的一秒。 */
  freeBytes?: (dir: string) => Promise<number>;
  secondMs?: number;
  /** 测试用：导入的某一笔提交之后抛错（模拟导入中途退出）。 */
  faults?: { afterImportStep?: (step: 'assets' | 'timeline' | 'link') => void };
}

interface StoredSession {
  summary: RecordingSummary;
  place: VideoPlace | null;
  submitter: JobSubmitter;
  /** 导入每一笔第一次提交时用的版本与标签（`recording-import.ts`）：重做时原样再发，引擎才认作重放。 */
  importSteps?: Record<string, { expectedRevision: string; label: string }>;
}

interface Session extends StoredSession {
  job: HostedJob | null;
  worker: JsonLineWorker | null;
  /** 当前一段开始采集的时刻（`Date.now()`）；暂停与停止时 null。 */
  activeSince: number | null;
  /** 之前各段累计的秒数。 */
  accumulated: number;
  timers: Set<NodeJS.Timeout>;
  /** 正在走的收尾（停止、取消、崩溃都等同一份）。 */
  finishing: Promise<void> | null;
  /** 用户或 Runtime 正在停这个 Worker：退出不算崩溃。 */
  expectingExit: boolean;
}

export interface RecordingRequest {
  options?: Partial<RecordingOptions>;
  target?: RecordingTarget;
  submitter: JobSubmitter;
  /** 智能体在会话里发起：停在等待开始，界面按开始才采集。 */
  requestedBy?: { conversationId: Id } | null;
}

export class RecordingService {
  readonly topic: TopicLog<RecordingsSnapshot, RecordingsEvent>;
  readonly #o: RecordingServiceOptions;
  readonly #sessions = new Map<Id, Session>();
  readonly #platform: NodeJS.Platform;
  #closing = false;

  constructor(options: RecordingServiceOptions) {
    this.#o = options;
    this.#platform = options.platform ?? process.platform;
    this.topic = new TopicLog(() => ({ recordings: this.list() }), '0');
  }

  /** 读入上次留下的录制：没收完的记成可以恢复的，开始之前就停了的（什么都没录）删掉。 */
  async init(): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(this.#o.root);
    } catch {
      return;
    }
    for (const name of names) {
      const dir = path.join(this.#o.root, name);
      let stored: StoredSession;
      try {
        stored = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8')) as StoredSession;
      } catch {
        continue;
      }
      const { summary } = stored;
      if (summary.state === 'in-timeline' || summary.state === 'discarded' || BEFORE_CAPTURE.has(summary.state)) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        continue;
      }
      const session = this.#session({ ...stored, summary: { ...summary, dir } });
      if (ACTIVE.has(summary.state)) {
        session.summary.state = 'importable';
        session.summary.unfinished = true;
        session.summary.jobId = null;
        session.summary.error ??= this.#jobError('RECORDING_INTERRUPTED', RcRecordings.interrupted());
        session.summary.streams = session.summary.streams.map((s) => ({ ...s, active: false }));
      }
      this.#sessions.set(summary.recordingId, session);
      await this.#persist(session);
    }
  }

  list(): RecordingSummary[] {
    return [...this.#sessions.values()]
      .map((s) => this.#view(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  subscribe(afterSeq: string | undefined, listener: (event: never) => void): TopicSubscription<unknown, unknown> {
    return this.topic.subscribe(afterSeq, listener as never) as TopicSubscription<unknown, unknown>;
  }

  status(recordingId?: Id): RecordingSummary | null {
    if (recordingId) return this.#view(this.#get(recordingId));
    const current = this.#current();
    return current ? this.#view(current) : null;
  }

  /** 能录什么、各项权限的状态。只问状态，不触发系统的授权窗口。 */
  async sources(): Promise<RecordingSources> {
    const empty: RecordingSources = {
      platform: this.#platform,
      available: false,
      reason: null,
      permissions: { screen: 'unknown', camera: 'unknown', microphone: 'unknown', inputMonitoring: 'unknown' },
      displays: [],
      windows: [],
      cameras: [],
      microphones: [],
    };
    const command = this.#o.worker();
    if (!command) return { ...empty, reason: RcRecordings.noWorker().text };
    const current = this.#current();
    const worker = current?.worker ?? (await JsonLineWorker.start(command));
    try {
      const hello = helloResult.parse(await worker.request('hello', {}, { timeoutMs: 15_000 }));
      if (!hello.capture.supported) return { ...empty, platform: hello.platform, reason: RcRecordings.unsupportedPlatform().text };
      const sources = sourcesResult.parse(await worker.request('sources', {}, { timeoutMs: 30_000 }));
      return { platform: hello.platform, available: true, reason: null, ...sources };
    } finally {
      if (worker !== current?.worker) await worker.close().catch(() => {});
    }
  }

  /**
   * 预检（`record --dry-run` 与开始之前）：Worker 在、平台能录、开着桌面端、必需的权限没有被拒、磁盘够。不对时抛
   * `RECORDING_UNAVAILABLE` / 权限错误 / `RECORDING_DISK_FULL`；返回解析过的选项与将要用的设备。
   */
  async precheck(partial: Partial<RecordingOptions> = {}): Promise<{ options: RecordingOptions; sources: RecordingSources; freeBytes: number }> {
    const options = { ...RECORDING_DEFAULTS, ...partial };
    const sources = await this.#reachable();
    this.#checkPermissions(options, sources.permissions);
    this.#checkSource(options, sources);
    await fs.mkdir(this.#o.root, { recursive: true });
    const freeBytes = await this.#freeBytes();
    if (freeBytes < MIN_FREE_BYTES) {
      throw new RpcError('conflict', RcRecordings.diskFull({ free: formatBytes(freeBytes) }), { code: 'RECORDING_DISK_FULL', freeBytes });
    }
    return { options, sources, freeBytes };
  }

  /** 这台电脑此刻能不能录：开着桌面端、Worker 在、平台支持。不对时抛 `RECORDING_UNAVAILABLE`（`reason` 说明是哪一项）。 */
  async #reachable(): Promise<RecordingSources> {
    if (!this.#o.hasWindow()) throw unavailable('no-window', RcRecordings.noWindow());
    const sources = await this.sources();
    if (!sources.available) {
      const command = this.#o.worker();
      throw unavailable(command ? 'unsupported' : 'no-worker', command ? RcRecordings.unsupportedPlatform() : RcRecordings.noWorker());
    }
    return sources;
  }

  /**
   * 开一次录制。智能体发起的（`requestedBy`）停在等待开始；别的直接准备、倒计时、开始采集，预检不过时抛错、不留下会话。
   * 已有一次没有结束的录制时 `RECORDING_BUSY`。
   */
  async request(request: RecordingRequest): Promise<RecordingSummary> {
    if (this.#closing) throw new RpcError('busy', RcRecordings.busy(), { code: 'RECORDING_BUSY' });
    const busy = this.#current();
    if (busy) throw new RpcError('conflict', RcRecordings.busy(), { code: 'RECORDING_BUSY', recordingId: busy.summary.recordingId });
    const target = request.target ?? null;
    if (!target) throw new RpcError('invalid-request', RcRecordings.targetNeeded(), { code: 'RECORDING_TARGET_NEEDED' });
    if ('videoId' in target && !this.#o.placeOf(target.videoId)) {
      throw new RpcError('not-found', RcRecordings.videoNotFound({ id: target.videoId }), { code: 'VIDEO_NOT_FOUND', videoId: target.videoId });
    }
    if ('create' in target && !target.create.projectId && !target.create.conversationId) {
      throw new RpcError('invalid-request', RcRecordings.targetNeeded(), { code: 'RECORDING_TARGET_NEEDED' });
    }
    const options = { ...RECORDING_DEFAULTS, ...request.options };
    const waiting = Boolean(request.requestedBy);
    // 等待开始的只核对能不能录（缺权限在面板上显示，用户按开始时再查）；直接开始的走完整的预检。
    if (waiting) await this.#reachable();
    else await this.precheck(options);
    const recordingId = newId('rec');
    const dir = path.join(this.#o.root, recordingId);
    await fs.mkdir(path.join(dir, 'capture'), { recursive: true });
    const now = new Date().toISOString();
    const session = this.#session({
      summary: {
        recordingId,
        state: waiting ? 'waiting' : 'preparing',
        jobId: null,
        options,
        target,
        requestedBy: request.requestedBy ?? null,
        createdAt: now,
        startedAt: null,
        elapsed: 0,
        streams: [],
        videoId: 'videoId' in target ? target.videoId : null,
        unfinished: false,
        dir,
        error: null,
        result: null,
      },
      place: null,
      submitter: request.submitter,
    });
    this.#sessions.set(recordingId, session);
    this.#hostJob(session);
    await this.#changed(session);
    if (!waiting) this.#begin(session);
    return this.#view(session);
  }

  /** `recordings.start`：开始等待中的那一次（可以改选项与落点），或者新开一次。 */
  async start(
    params: { recordingId?: Id; options?: Partial<RecordingOptions>; target?: RecordingTarget },
    submitter: JobSubmitter,
  ): Promise<RecordingSummary> {
    if (!params.recordingId) return this.request({ options: params.options, target: params.target, submitter });
    const session = this.#get(params.recordingId);
    if (session.summary.state !== 'waiting') throw notState('RECORDING_NOT_WAITING', RcRecordings.notWaiting(), session);
    const options = { ...session.summary.options, ...params.options };
    // 预检不过时会话留在等待开始：面板上改一改还可以再按开始。
    await this.precheck(options);
    session.summary.options = options;
    if (params.target) session.summary.target = params.target;
    session.summary.state = 'preparing';
    await this.#changed(session);
    this.#begin(session);
    return this.#view(session);
  }

  /** 面板关掉（还没开始采集）：任务以取消结束，什么都没录，目录删掉。 */
  async cancel(recordingId: Id): Promise<RecordingSummary> {
    const session = this.#get(recordingId);
    if (!BEFORE_CAPTURE.has(session.summary.state)) throw notState('RECORDING_NOT_WAITING', RcRecordings.notWaiting(), session);
    await this.#dropBeforeCapture(session, 'cancelled', this.#jobError('RECORDING_CANCELLED', RcRecordings.closedBeforeStart()));
    return this.#view(session);
  }

  async pause(recordingId?: Id): Promise<RecordingSummary> {
    const session = this.#capturing(recordingId);
    if (session.summary.state !== 'recording') throw notState('RECORDING_NOT_RECORDING', RcRecordings.notRecording(), session);
    await session.worker!.request('pause', {}, { timeoutMs: 30_000 });
    this.#closeSegment(session);
    session.summary.state = 'paused';
    session.summary.streams = session.summary.streams.map((s) => ({ ...s, active: false }));
    await this.#changed(session);
    return this.#view(session);
  }

  async resume(recordingId?: Id): Promise<RecordingSummary> {
    const session = this.#capturing(recordingId);
    if (session.summary.state !== 'paused') throw notState('RECORDING_NOT_PAUSED', RcRecordings.notPaused(), session);
    await session.worker!.request('resume', {}, { timeoutMs: 30_000 });
    session.activeSince = Date.now();
    session.summary.state = 'recording';
    await this.#changed(session);
    return this.#view(session);
  }

  /** 停止并保留：返回只表示收到了（`stopping`），收尾与导入在任务里走完。倒计时中停止等于取消（什么都没录）。 */
  async stop(recordingId?: Id): Promise<RecordingSummary> {
    const session = recordingId ? this.#get(recordingId) : this.#current();
    if (!session) throw new RpcError('conflict', RcRecordings.notRecording(), { code: 'RECORDING_NOT_RECORDING' });
    if (BEFORE_CAPTURE.has(session.summary.state)) return this.cancel(session.summary.recordingId);
    if (!CAPTURING.has(session.summary.state)) throw notState('RECORDING_NOT_RECORDING', RcRecordings.notRecording(), session);
    void this.#finish(session, { import: true });
    return this.#view(session);
  }

  /** 丢弃：删掉录下的文件。已经进了视频的不在这里删（用撤销或在视频里删）。 */
  async discard(recordingId: Id): Promise<{ recordingId: Id; removed: true }> {
    const session = this.#get(recordingId);
    const state = session.summary.state;
    if (state === 'in-timeline') throw notState('RECORDING_IMPORTED', RcRecordings.alreadyImported(), session);
    if (state === 'importing' || state === 'finalizing' || state === 'stopping') {
      throw notState('RECORDING_BUSY', RcRecordings.stillActive(), session);
    }
    if (BEFORE_CAPTURE.has(state)) {
      await this.#dropBeforeCapture(session, 'cancelled', null);
    } else {
      if (CAPTURING.has(state)) await this.#stopWorker(session, 'kill');
      this.#clearTimers(session);
      session.summary.state = 'discarded';
      await session.job?.finish('cancelled');
      await fs.rm(session.summary.dir, { recursive: true, force: true });
      this.#sessions.delete(recordingId);
      this.topic.publish({ type: 'recording.upsert', recording: this.#view(session) });
    }
    this.topic.publish({ type: 'recording.removed', recordingId });
    return { recordingId, removed: true };
  }

  /** 恢复：把没收完的（崩溃、取消、导入失败）重新收尾并导入，一个新的任务；导入按同样的命令 ID 重做，不会重复。 */
  async recover(recordingId: Id, submitter: JobSubmitter): Promise<RecordingSummary> {
    const session = this.#get(recordingId);
    if (ACTIVE.has(session.summary.state)) throw notState('RECORDING_BUSY', RcRecordings.stillActive(), session);
    if (!RECOVERABLE.has(session.summary.state)) throw notState('RECORDING_NOT_RECOVERABLE', RcRecordings.notRecoverable(), session);
    const busy = this.#current();
    if (busy) throw new RpcError('conflict', RcRecordings.busy(), { code: 'RECORDING_BUSY', recordingId: busy.summary.recordingId });
    session.submitter = submitter;
    session.summary.error = null;
    session.summary.state = 'finalizing';
    this.#hostJob(session);
    await this.#changed(session);
    void this.#finish(session, { import: true, captured: true });
    return this.#view(session);
  }

  /** 等一次录制走到不再变的状态（测试与 `record` 的等待）。 */
  async settled(recordingId: Id): Promise<RecordingSummary> {
    const session = this.#get(recordingId);
    while (session.finishing || (ACTIVE.has(session.summary.state) && !CAPTURING.has(session.summary.state) && session.summary.state !== 'waiting')) {
      if (session.finishing) await session.finishing;
      else await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return this.#view(session);
  }

  /** Runtime 停止：采集中的停下并保留（下次启动可以恢复），等待开始的取消。 */
  async shutdown(): Promise<void> {
    this.#closing = true;
    for (const session of this.#sessions.values()) {
      if (BEFORE_CAPTURE.has(session.summary.state)) {
        await this.#dropBeforeCapture(session, 'interrupted', null);
      } else if (CAPTURING.has(session.summary.state)) {
        await this.#finish(session, { import: false, end: 'interrupted' });
      } else if (session.finishing) {
        await session.finishing.catch(() => {});
      }
    }
  }

  // ---- 内部 ----

  #session(stored: StoredSession): Session {
    return { ...stored, job: null, worker: null, activeSince: null, accumulated: stored.summary.elapsed, timers: new Set(), finishing: null, expectingExit: false };
  }

  #get(recordingId: Id): Session {
    const session = this.#sessions.get(recordingId);
    if (!session) throw new RpcError('not-found', RcRecordings.notFound({ id: recordingId }), { code: 'RECORDING_NOT_FOUND', recordingId });
    return session;
  }

  /** 当前没有结束的那一次（同一时刻最多一次）。 */
  #current(): Session | null {
    for (const session of this.#sessions.values()) if (ACTIVE.has(session.summary.state)) return session;
    return null;
  }

  #capturing(recordingId?: Id): Session {
    const session = recordingId ? this.#get(recordingId) : this.#current();
    if (!session || !CAPTURING.has(session.summary.state) || !session.worker) {
      throw new RpcError('conflict', RcRecordings.notRecording(), { code: 'RECORDING_NOT_RECORDING' });
    }
    return session;
  }

  #elapsed(session: Session): number {
    const live = session.activeSince === null ? 0 : (Date.now() - session.activeSince) / 1000;
    return Math.round((session.accumulated + live) * 1000) / 1000;
  }

  #closeSegment(session: Session): void {
    if (session.activeSince !== null) session.accumulated += (Date.now() - session.activeSince) / 1000;
    session.activeSince = null;
  }

  #view(session: Session): RecordingSummary {
    return structuredClone({ ...session.summary, elapsed: this.#elapsed(session) });
  }

  async #persist(session: Session): Promise<void> {
    // 已进时间线或已丢弃的录制目录已经删掉，不再写回去。
    if (session.summary.state === 'discarded' || session.summary.state === 'in-timeline') return;
    const stored: StoredSession = {
      summary: { ...session.summary, elapsed: this.#elapsed(session) },
      place: session.place,
      submitter: session.submitter,
      ...(session.importSteps ? { importSteps: session.importSteps } : {}),
    };
    await fs.mkdir(session.summary.dir, { recursive: true }).catch(() => {});
    await fs.writeFile(path.join(session.summary.dir, 'session.json'), JSON.stringify(stored, null, 2)).catch((error) => {
      this.#o.log.warn('Writing the recording session failed', { recordingId: session.summary.recordingId, error: String(error) });
    });
  }

  async #changed(session: Session, options: { persist?: boolean } = {}): Promise<void> {
    this.#syncJob(session);
    if (options.persist !== false) await this.#persist(session);
    this.topic.publish({ type: 'recording.upsert', recording: this.#view(session) });
  }

  #hostJob(session: Session): void {
    const now = new Date().toISOString();
    const { recordingId } = session.summary;
    const record: JobRecord = {
      jobId: newId('job'),
      kind: 'recording',
      state: 'running',
      phase: phaseOf(session.summary.state),
      progress: { done: this.#elapsed(session), total: null, unit: 'seconds' },
      videoId: session.summary.videoId,
      assetId: null,
      assetRevision: null,
      contentHash: `sha256:${'0'.repeat(64)}`,
      providerId: 'local',
      modelId: 'recording-worker',
      bundleId: null,
      inputHash: `sha256:${'0'.repeat(64)}`,
      submitter: session.submitter,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
      recording: { recordingId, result: null },
    };
    session.job = this.#o.jobs.host(record, {
      hosted: 'recording',
      control: {
        cancel: () => void this.#jobStopped(session, 'cancelled'),
        interrupt: () => void this.#jobStopped(session, 'interrupted'),
      },
    });
    session.summary.jobId = session.job.jobId;
  }

  /** 任务被取消或中断：开始之前的丢掉；采集中的停下并保留（可以恢复）。 */
  async #jobStopped(session: Session, end: 'cancelled' | 'interrupted'): Promise<void> {
    if (BEFORE_CAPTURE.has(session.summary.state)) {
      await this.#dropBeforeCapture(session, end, end === 'cancelled' ? this.#jobError('RECORDING_CANCELLED', RcRecordings.closedBeforeStart()) : null);
    } else if (CAPTURING.has(session.summary.state)) {
      await this.#finish(session, { import: false, end });
    } else if (!session.finishing) {
      await session.job?.finish(end);
    }
  }

  #syncJob(session: Session): void {
    const job = session.job;
    if (!job || isDone(job.record().state)) return;
    job.update(
      {
        phase: phaseOf(session.summary.state),
        progress: { done: this.#elapsed(session), total: null, unit: 'seconds' },
        videoId: session.summary.videoId,
        recording: { recordingId: session.summary.recordingId, result: session.summary.result },
      },
      { persist: true },
    );
  }

  #jobError(code: string, message: Localized, details?: unknown): JobError {
    return { code, message: message.text, messageRef: refOf(message), ...(details !== undefined ? { details } : {}) };
  }

  async #dropBeforeCapture(session: Session, end: 'cancelled' | 'interrupted' | 'failed', error: JobError | null): Promise<void> {
    this.#clearTimers(session);
    if (session.worker) await this.#stopWorker(session, 'kill');
    session.summary.state = end === 'failed' ? 'failed' : 'discarded';
    session.summary.error = error;
    await session.job?.finish(end, error ? { error } : undefined);
    await fs.rm(session.summary.dir, { recursive: true, force: true }).catch(() => {});
    this.#sessions.delete(session.summary.recordingId);
    this.topic.publish({ type: 'recording.upsert', recording: this.#view(session) });
    this.topic.publish({ type: 'recording.removed', recordingId: session.summary.recordingId });
  }

  #clearTimers(session: Session): void {
    for (const timer of session.timers) clearTimeout(timer);
    session.timers.clear();
  }

  #later(session: Session, ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      session.timers.delete(timer);
      run();
    }, ms);
    session.timers.add(timer);
  }

  /** 准备、倒计时、开始采集（在后台走；失败时会话以 `failed` 结束、目录删掉，什么都还没录）。 */
  #begin(session: Session): void {
    void (async () => {
      const { options } = session.summary;
      const command = this.#o.worker();
      try {
        if (!command) throw unavailable('no-worker', RcRecordings.noWorker());
        const worker = await JsonLineWorker.start({ ...command, onStderrLine: (line) => this.#o.log.debug('recording-worker', { line }) });
        session.worker = worker;
        worker.onEvent((event) => void this.#onWorkerEvent(session, event));
        worker.onExit((exit) => {
          if (session.worker !== worker) return;
          session.worker = null;
          if (session.expectingExit || exit.expected) return;
          void this.#onWorkerCrashed(session, exit.code);
        });
        const hello: WorkerHello = helloResult.parse(await worker.request('hello', {}, { timeoutMs: 15_000 }));
        if (hello.protocol !== RECORDING_WORKER_PROTOCOL || !hello.capture.supported) throw unavailable('unsupported', RcRecordings.unsupportedPlatform());
        // 倒计时（Runtime 数，Worker 只管采集）。
        for (let left = options.countdown; left > 0; left--) {
          if (!BEFORE_CAPTURE.has(session.summary.state)) return;
          session.summary.state = 'countdown';
          session.summary.countdownLeft = left;
          await this.#changed(session, { persist: false });
          await new Promise<void>((resolve) => this.#later(session, this.#o.secondMs ?? 1000, resolve));
        }
        if (!BEFORE_CAPTURE.has(session.summary.state)) return;
        delete session.summary.countdownLeft;
        const params: WorkerStartParams = {
          dir: path.join(session.summary.dir, 'capture'),
          source: options.source,
          camera: options.camera,
          microphone: options.microphone,
          systemAudio: options.systemAudio,
          cursor: options.cursor,
          keys: options.keys,
          fps: options.fps,
        };
        startResult.parse(await worker.request('start', params, { timeoutMs: 60_000 }));
        if (!BEFORE_CAPTURE.has(session.summary.state)) return;
        session.activeSince = Date.now();
        session.summary.startedAt = new Date().toISOString();
        session.summary.state = 'recording';
        await this.#changed(session);
        this.#tick(session);
        if (options.duration !== null) this.#later(session, options.duration * 1000, () => void this.stop(session.summary.recordingId).catch(() => {}));
        this.#later(session, DISK_POLL_MS, () => void this.#checkDisk(session));
      } catch (error) {
        if (!BEFORE_CAPTURE.has(session.summary.state)) return;
        this.#o.log.warn('Starting the recording failed', { recordingId: session.summary.recordingId, error: String(error) });
        await this.#dropBeforeCapture(session, 'failed', this.#errorOf(error));
      }
    })();
  }

  /** 录制中每秒更新一次任务的进度与主题（不写盘）。 */
  #tick(session: Session): void {
    this.#later(session, this.#o.secondMs ?? 1000, () => {
      if (!CAPTURING.has(session.summary.state)) return;
      void this.#changed(session, { persist: false });
      this.#tick(session);
    });
  }

  async #checkDisk(session: Session): Promise<void> {
    if (!CAPTURING.has(session.summary.state)) return;
    const free = await this.#freeBytes().catch(() => Number.POSITIVE_INFINITY);
    if (free < MIN_FREE_BYTES / 2) {
      this.#o.log.warn('Disk almost full, stopping the recording', { recordingId: session.summary.recordingId, free });
      session.job?.update({ warnings: [{ code: 'RECORDING_DISK_LOW', detail: RcRecordings.diskLowStopped().text, detailRef: refOf(RcRecordings.diskLowStopped()) }] }, { persist: true });
      await this.#finish(session, { import: true });
      return;
    }
    this.#later(session, DISK_POLL_MS, () => void this.#checkDisk(session));
  }

  async #onWorkerEvent(session: Session, raw: { event: string; params: unknown }): Promise<void> {
    const parsed = workerEvent.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (event.event === 'stream') {
      const others = session.summary.streams.filter((s) => s.role !== event.params.role);
      const before = session.summary.streams.find((s) => s.role === event.params.role);
      session.summary.streams = [...others, { role: event.params.role, device: before?.device ?? null, active: true, ...(before?.lost ? { lost: true } : {}) }];
      await this.#changed(session, { persist: false });
    } else if (event.event === 'device-lost') {
      session.summary.streams = session.summary.streams.map((s) => (s.role === event.params.role ? { ...s, active: false, lost: true } : s));
      session.job?.update({ warnings: [...(session.job.record().warnings ?? []), { code: 'RECORDING_DEVICE_LOST', detail: event.params.role }] }, { persist: true });
      await this.#changed(session);
    } else if (event.event === 'disk-low') {
      await this.#finish(session, { import: true });
    } else if (event.event === 'failed') {
      this.#o.log.warn('The recording worker reported a failure', { ...event.params });
      session.summary.error = this.#jobError('RECORDING_WORKER_FAILED', RcRecordings.workerFailed({ reason: event.params.message }));
      await this.#finish(session, { import: true });
    }
  }

  /** Worker 在采集中途退出：已经写下的保留，录制变成可以恢复的。 */
  async #onWorkerCrashed(session: Session, code: number | null): Promise<void> {
    this.#o.log.warn('The recording worker exited unexpectedly', { recordingId: session.summary.recordingId, code });
    if (BEFORE_CAPTURE.has(session.summary.state)) return; // `#begin` 的请求会失败，由它收拾。
    if (!CAPTURING.has(session.summary.state)) return;
    this.#clearTimers(session);
    this.#closeSegment(session);
    const error = this.#jobError('RECORDING_WORKER_CRASHED', RcRecordings.workerCrashed(), { exitCode: code });
    session.summary.state = 'importable';
    session.summary.unfinished = true;
    session.summary.error = error;
    session.summary.streams = session.summary.streams.map((s) => ({ ...s, active: false }));
    await session.job?.finish('failed', { error });
    await this.#changed(session);
  }

  async #stopWorker(session: Session, how: 'stop' | 'kill'): Promise<void> {
    const worker = session.worker;
    if (!worker) return;
    session.expectingExit = true;
    try {
      if (how === 'stop') await worker.request('stop', {}, { timeoutMs: 120_000 });
      await worker.close();
    } catch (error) {
      this.#o.log.warn('Stopping the recording worker failed', { error: String(error) });
      await worker.kill().catch(() => {});
    } finally {
      session.worker = null;
      session.expectingExit = false;
    }
  }

  /**
   * 收尾：停下 Worker（还在采集时），读日志换算成录制包，再导入。`import: false`（任务取消、Runtime 停止）只停下与保留，
   * 录制变成可以恢复的 `importable`。
   */
  #finish(session: Session, how: { import: boolean; end?: 'cancelled' | 'interrupted'; captured?: boolean }): Promise<void> {
    if (session.finishing) return session.finishing;
    const run = async () => {
      this.#clearTimers(session);
      if (CAPTURING.has(session.summary.state)) {
        session.summary.state = 'stopping';
        this.#closeSegment(session);
        session.summary.streams = session.summary.streams.map((s) => ({ ...s, active: false }));
        await this.#changed(session);
        await this.#stopWorker(session, 'stop');
      }
      if (!how.import) {
        session.summary.state = 'importable';
        session.summary.unfinished = true;
        const error = this.#jobError('RECORDING_INTERRUPTED', RcRecordings.interrupted());
        session.summary.error = error;
        await session.job?.finish(how.end ?? 'interrupted', { error });
        await this.#changed(session);
        return;
      }
      await this.#finalizeAndImport(session);
    };
    session.finishing = run().finally(() => {
      session.finishing = null;
    });
    return session.finishing;
  }

  async #finalizeAndImport(session: Session): Promise<void> {
    const { recordingId, dir, target } = session.summary;
    let lease: VideoLease | null = null;
    try {
      session.summary.state = 'finalizing';
      await this.#changed(session);
      const pkg = await buildPackage(path.join(dir, 'capture'), path.join(dir, 'package'), this.#o.probe);
      session.summary.state = 'importable';
      await this.#changed(session);
      session.summary.state = 'importing';
      await this.#changed(session);
      lease = await this.#leaseTarget(session, target);
      session.summary.videoId = lease.videoId;
      await this.#changed(session);
      const at = 'videoId' in target ? (target.at ?? 0) : 0;
      const result = await importRecording(this.#o.videos, {
        videoId: lease.videoId,
        recordingId,
        pkg,
        at,
        actor: { kind: 'user', id: 'user_local' },
        onStep: (step) => this.#o.faults?.afterImportStep?.(step),
        steps: (session.importSteps ??= {}),
        persist: () => this.#persist(session),
      });
      session.summary.unfinished = false;
      session.summary.error = null;
      session.summary.result = result;
      // 素材已经复制进视频：录制目录不再需要，先删掉再报告完成。
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      this.#syncJob(session);
      if (pkg.warnings.length) {
        session.job?.update({ warnings: [...(session.job.record().warnings ?? []), ...pkg.warnings.map((detail) => ({ code: 'RECORDING_WARNING', detail }))] }, { persist: true });
      }
      await session.job?.finish('completed');
      // 任务先结束再改状态、广播：看到 in-timeline 的一方查任务就是完成态。
      session.summary.state = 'in-timeline';
      await this.#changed(session);
    } catch (error) {
      this.#o.log.warn('Finishing the recording failed', { recordingId, error: String(error) });
      const jobError = this.#errorOf(error);
      session.summary.state = jobError.code === 'RECORDING_EMPTY' ? 'failed' : 'importable';
      session.summary.unfinished = true;
      session.summary.error = jobError;
      await session.job?.finish('failed', { error: jobError });
      await this.#changed(session);
    } finally {
      lease?.release();
    }
  }

  /** 落点：已有的视频以租约打开；新建的先占下目录（记进会话），重做时认回同一个。 */
  async #leaseTarget(session: Session, target: RecordingTarget): Promise<VideoLease> {
    if ('videoId' in target) {
      const place = this.#o.placeOf(target.videoId);
      if (!place) throw new RpcError('not-found', RcRecordings.videoNotFound({ id: target.videoId }), { code: 'VIDEO_NOT_FOUND', videoId: target.videoId });
      return this.#o.targets.lease(place);
    }
    const { projectId, conversationId } = target.create;
    const scope = projectId ? { projectId } : { conversationId: conversationId! };
    const name = target.create.name ?? RcRecordings.videoName({ stamp: stampOf(session.summary.startedAt ?? session.summary.createdAt) }).text;
    if (!session.place) {
      session.place = await this.#o.targets.reserve({ ...scope, name });
      await this.#persist(session);
    }
    return this.#o.targets.create({ ...scope, name, commandId: `${session.summary.recordingId}_video`, place: session.place });
  }

  #errorOf(error: unknown): JobError {
    if (error instanceof RpcError) {
      const details = (error.details ?? {}) as { code?: string };
      return { code: details.code ?? error.code, message: error.message, ...(error.messageRef ? { messageRef: error.messageRef } : {}), details: error.details };
    }
    if (error instanceof RecordingPackageError) {
      return this.#jobError(error.code, error.code === 'RECORDING_EMPTY' ? RcRecordings.empty() : RcRecordings.journalInvalid(), { reason: error.message });
    }
    if (error instanceof WorkerRequestError) {
      // 预检只挡「拒绝过」的权限：屏幕权限分不出拒绝与没问过，还没问过的又可能在开始时被拒，Worker 这时报出是哪一项。
      const permission = Object.hasOwn(WORKER_PERMISSION_CODES, error.code) ? WORKER_PERMISSION_CODES[error.code] : undefined;
      if (permission) {
        const paths = SETTINGS_PATHS[this.#platform] ?? SETTINGS_PATHS.darwin!;
        const systemAccess: SystemAccessNeed[] = [{ permission, state: 'denied', settingsPath: paths[permission] }];
        return this.#jobError('RECORDING_PERMISSION_DENIED', RcRecordings.permissionDenied({ names: PERMISSION_LABELS[permission]().text }), {
          systemAccess,
          workerCode: error.code,
        });
      }
      return this.#jobError('RECORDING_WORKER_FAILED', RcRecordings.workerFailed({ reason: error.message }), { workerCode: error.code });
    }
    const reason = error instanceof Error ? error.message : String(error);
    return this.#jobError('RECORDING_IMPORT_FAILED', RcRecordings.importFailed({ reason }));
  }

  #checkPermissions(options: RecordingOptions, permissions: RecordingPermissions): void {
    const wanted: Array<keyof RecordingPermissions> = ['screen'];
    if (options.camera) wanted.push('camera');
    if (options.microphone) wanted.push('microphone');
    if (options.keys !== 'off') wanted.push('inputMonitoring');
    // 拒绝与受限的才挡；还没问过的（not-determined）让系统在开始时弹它自己的授权窗口。
    const missing = wanted.filter((p) => permissions[p] === 'denied' || permissions[p] === 'restricted');
    if (missing.length === 0) return;
    const paths = SETTINGS_PATHS[this.#platform] ?? SETTINGS_PATHS.darwin!;
    const systemAccess: SystemAccessNeed[] = missing.map((permission) => ({ permission, state: permissions[permission], settingsPath: paths[permission] }));
    const names = missing.map((p) => PERMISSION_LABELS[p]().text).join(', ');
    throw new RpcError('forbidden', RcRecordings.permissionDenied({ names }), { code: 'RECORDING_PERMISSION_DENIED', systemAccess });
  }

  #checkSource(options: RecordingOptions, sources: RecordingSources): void {
    const source = options.source;
    const missing =
      (source.kind === 'window' && !sources.windows.some((w) => w.id === source.windowId)) ||
      (source.kind !== 'window' && source.displayId !== undefined && !sources.displays.some((d) => d.id === source.displayId)) ||
      (options.camera !== null && options.camera !== 'default' && !sources.cameras.some((c) => c.id === options.camera)) ||
      (options.microphone !== null && options.microphone !== 'default' && !sources.microphones.some((m) => m.id === options.microphone));
    if (missing) throw new RpcError('not-found', RcRecordings.sourceNotFound(), { code: 'RECORDING_SOURCE_NOT_FOUND' });
  }

  async #freeBytes(): Promise<number> {
    if (this.#o.freeBytes) return this.#o.freeBytes(this.#o.root);
    const stats = await fs.statfs(this.#o.root);
    return stats.bavail * stats.bsize;
  }
}

/** 磁盘不到十分钟的录制时（`record --dry-run` 与面板的警告）。 */
export function lowDiskWarning(freeBytes: number): boolean {
  return freeBytes < WARN_FREE_BYTES;
}

function unavailable(reason: 'no-worker' | 'unsupported' | 'no-window' | 'remote', message: Localized): RpcError {
  return new RpcError('unsupported', message, { code: 'RECORDING_UNAVAILABLE', reason });
}

function notState(code: string, message: Localized, session: Session): RpcError {
  return new RpcError('conflict', message, { code, recordingId: session.summary.recordingId, state: session.summary.state });
}

function phaseOf(state: RecordingState): JobPhase {
  switch (state) {
    case 'waiting':
      return 'queued';
    case 'preparing':
    case 'countdown':
      return 'starting';
    case 'recording':
      return 'recording';
    case 'paused':
      return 'paused';
    case 'stopping':
    case 'finalizing':
      return 'finalizing';
    case 'importable':
    case 'importing':
      return 'applying';
    default:
      return 'done';
  }
}

function isDone(state: JobRecord['state']): boolean {
  return state !== 'queued' && state !== 'running';
}

function stampOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

export type { WorkerSources };
