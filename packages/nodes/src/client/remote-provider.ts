import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ProviderFailure,
  type AsrWarning,
  type TranscribeAttempt,
  type TranscribeProvider,
  type TranscribeRun,
  type TranscribeSink,
  type TranscribeJobPhase,
} from '@baocut/models';
import {
  NODE_ERROR,
  type NodeHealth,
  type NodeJob,
  type NodeJobRequest,
  type RemoteNodeLostReason,
  type RemoteNodeRejectReason,
} from '@baocut/protocol';
import { isNodeJobTerminal } from '../node-jobs.ts';
import { silentNodeLog, type NodeLogger } from '../node-logger.ts';
import {
  NodeClient,
  NodeConnectionError,
  NodeRequestAborted,
  NodeResponseError,
  readEventStream,
  rejectReason,
  versionCompatible,
} from './node-http.ts';
import type { PairedNodeRecord } from './node-store.ts';
import { NodesClient as NC } from '@baocut/protocol/messages/nodes';

/**
 * 远端节点 Provider（架构设计 §6.7；节点协议规范 §9）：把一次转写尝试交给已配对的节点。一个实例服务所有已配对的节点，
 * 目标节点由 `TranscribeRun.node` 给出（不给时取 `providerId` 的 `node:<nodeId>`）。
 *
 * 一次尝试：预检 `GET /v1/health`（可达、版本、`nodeId`、能力开关、模型包状态）→ `POST /v1/jobs`（`clientJobId` 为
 * `<jobId>:<尝试序号>`）→ `PUT input` 流式上传素材的原始文件 → 跟事件流，把阶段、进度、警告与语言转给 sink →
 * `completed` 时把结果下载到这次尝试的 staging 目录并核对 sha256 与长度 → `DELETE`（尽力）→ 交还 JobManager，
 * 由它像本机结果一样校验、发布、应用。
 *
 * 事件流断开（含 `heartbeatTimeoutMs` 内没有任何数据）就带 `since=<最后的 seq>` 重连，退避 0.5 → 5 秒；连续失败
 * `lostAfterMs` 仍连不上，失败为 `REMOTE_NODE_LOST`（`stream-lost`）。节点报告任务 `interrupted`、重连时任务已不存在
 * （404，节点重启并清掉了它）、或任务不是我们取消的却以 `cancelled` 终结（节点关闭共享或停止），都是 `node-restarted`。
 *
 * 取消：`POST cancel` 等节点确认（节点最多等 15 秒，本机 20 秒），然后 `DELETE`。节点不可达时本次尝试仍以
 * `cancelled` 兑现，并带警告 `remote-cancel-unconfirmed`。
 *
 * 令牌只出现在请求的 `Authorization` 头里：日志、错误说明与详情都不带它。
 */

export interface RemoteTiming {
  /** 普通 JSON 请求（健康、创建、读取）的期限。 */
  requestTimeoutMs: number;
  /** 上传与下载的连接空闲期限。 */
  transferIdleMs: number;
  /** 任务创建之后连续失败多久算失联（规范：60 秒）。 */
  lostAfterMs: number;
  /** 事件流多久没有任何数据（心跳每 15 秒一条）算断开（默认 45 秒）。 */
  heartbeatTimeoutMs: number;
  backoffMinMs: number;
  backoffMaxMs: number;
  /** 取消等节点确认的期限（节点自己最多等 15 秒）。 */
  cancelTimeoutMs: number;
  /** 结束后 `DELETE` 的期限（尽力）。 */
  deleteTimeoutMs: number;
}

export const DEFAULT_REMOTE_TIMING: RemoteTiming = {
  requestTimeoutMs: 15_000,
  transferIdleMs: 60_000,
  lostAfterMs: 60_000,
  heartbeatTimeoutMs: 45_000,
  backoffMinMs: 500,
  backoffMaxMs: 5_000,
  cancelTimeoutMs: 20_000,
  deleteTimeoutMs: 5_000,
};

/** 已配对节点的查询：NodeStore 在结构上满足它。 */
export interface PairedNodes {
  get(nodeId: string): PairedNodeRecord | null;
  /** 令牌只在发请求时取；凭据存储不可用时抛错。 */
  token(nodeId: string): Promise<string | null>;
  credentialProblem(nodeId: string): string | null;
}

export interface RemoteNodeProviderOptions {
  nodes: PairedNodes;
  log?: NodeLogger;
  timing?: Partial<RemoteTiming>;
}

const WORKER_PHASES = new Set<string>(['decoding', 'vad', 'transcribing', 'aligning', 'diarizing', 'finalizing']);
const RESULT_FILE = 'result.json';

/** 一次尝试里已知的节点任务。 */
interface Attempt {
  client: NodeClient;
  token: string;
  nodeId: string;
  /** 节点上的任务 ID（创建之后才有）。 */
  remoteJobId: string | null;
}

export class RemoteNodeProvider implements TranscribeProvider {
  readonly id = 'node';
  readonly timing: RemoteTiming;
  readonly #nodes: PairedNodes;
  readonly #log: NodeLogger;
  readonly #inflight = new Set<AbortController>();

  constructor(options: RemoteNodeProviderOptions) {
    this.#nodes = options.nodes;
    this.#log = options.log ?? silentNodeLog;
    this.timing = { ...DEFAULT_REMOTE_TIMING, ...options.timing };
  }

  async transcribe(run: TranscribeRun, sink: TranscribeSink, signal: AbortSignal): Promise<TranscribeAttempt> {
    if (signal.aborted) return { outcome: 'cancelled', workerVersion: null };
    const nodeId = run.node ?? (run.providerId?.startsWith('node:') ? run.providerId.slice('node:'.length) : undefined);
    if (!nodeId) throw new ProviderFailure('unavailable', NC.noNodeSpecified().text);
    const node = this.#nodes.get(nodeId);
    if (!node) throw rejected('unpaired', nodeId, NC.nodeNotPaired().text);
    let token: string | null;
    try {
      token = await this.#nodes.token(nodeId);
    } catch {
      // 不回退到别的存放：如实报告，任务失败。原因里没有令牌。
      const reason = this.#nodes.credentialProblem(nodeId) ?? NC.tokenUnreadableDefault().text;
      throw new ProviderFailure('unavailable', NC.nodeTokenUnavailable({ alias: node.alias, reason }).text, { node: nodeId });
    }
    if (!token) throw rejected('unpaired', nodeId, NC.noToken().text);
    const attempt: Attempt = { client: new NodeClient(node.host, node.port), token, nodeId, remoteJobId: null };
    // 本次尝试自己的中止：调用方取消，或 Provider 关闭。
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    this.#inflight.add(controller);
    try {
      return await this.#run(run, sink, attempt, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return this.#cancel(attempt, run.jobId);
      if (attempt.remoteJobId && error instanceof ProviderFailure && error.kind === 'remote-failed') await this.#forget(attempt);
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.#inflight.delete(controller);
    }
  }

  async close(): Promise<void> {
    // JobManager 停止时已经中止了在途任务；这里只是保险。
    for (const controller of this.#inflight) controller.abort();
  }

  // ---- 一次尝试 ----

  async #run(run: TranscribeRun, sink: TranscribeSink, attempt: Attempt, signal: AbortSignal): Promise<TranscribeAttempt> {
    const { client, token, nodeId } = attempt;
    const t = this.timing;
    const stat = await fs.stat(run.input.file).catch(() => null);
    if (!stat?.isFile()) throw new ProviderFailure('input-unreadable', NC.mediaUnreadable().text);
    if (!run.mediaType) throw new ProviderFailure('unavailable', NC.mediaTypeMissing().text);

    // 1. 预检
    let health: NodeHealth;
    try {
      health = await client.health({ timeoutMs: t.requestTimeoutMs, signal });
    } catch (error) {
      throw this.#mapBeforeJob(error, nodeId, client);
    }
    const bundleId = run.bundleId ?? run.modelId;
    if (!bundleId) throw new ProviderFailure('unavailable', NC.noBundle().text);
    this.#precheck(health, nodeId, bundleId);

    // 2. 创建
    const request: NodeJobRequest = {
      clientJobId: `${run.jobId}:${run.runGeneration}`,
      kind: 'transcribe',
      bundleId,
      input: {
        contentHash: run.input.contentHash,
        byteLength: stat.size,
        mediaType: run.mediaType,
        track: run.input.track,
        range: run.input.range ? { start: run.input.range.start, end: run.input.range.end } : null,
      },
      options: {
        language: run.options.language,
        diarize: run.options.diarize,
        ...(run.options.hint ? { hint: run.options.hint } : {}),
        timescale: run.options.timescale,
      },
    };
    let created: NodeJob;
    try {
      created = await client.createJob(token, request, { timeoutMs: t.requestTimeoutMs, signal });
    } catch (error) {
      throw this.#mapBeforeJob(error, nodeId, client);
    }
    attempt.remoteJobId = created.jobId;
    this.#log.info('Remote job created', { jobId: run.jobId, node: nodeId, remoteJobId: created.jobId });

    // 3. 上传（媒体的原始文件，流式）
    if (created.state === 'awaiting-input') await this.#upload(attempt, run.input.file, stat.size, signal);

    // 4. 跟事件流到终态
    const final = await this.#follow(attempt, sink, signal);
    if (final.state === 'failed') {
      const error = final.error ?? { code: 'INTERNAL', message: NC.remoteTaskFailed().text };
      throw new ProviderFailure('remote-failed', error.message, {
        code: error.code,
        node: nodeId,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
    }
    if (final.state === 'interrupted' || final.state === 'cancelled') {
      throw lost('node-restarted', nodeId, final.state === 'cancelled' ? NC.cancelledBySharingOff().text : NC.nodeRestarted().text);
    }
    if (!final.output) throw new ProviderFailure('protocol', NC.completedWithoutOutput().text, { node: nodeId });

    // 5. 取回结果并核对
    const dest = path.join(run.staging, RESULT_FILE);
    const fetched = await this.#retrying(attempt, signal, () =>
      client.download(token, attempt.remoteJobId!, dest, { idleMs: t.transferIdleMs, signal }),
    );
    if (fetched.sha256 !== final.output.sha256 || fetched.byteLength !== final.output.byteLength) {
      throw new ProviderFailure('protocol', NC.resultMismatch().text, { node: nodeId });
    }
    await this.#forget(attempt);
    this.#log.info('Remote job completed', { jobId: run.jobId, node: nodeId, remoteJobId: attempt.remoteJobId, attempt: final.attempt });
    return {
      outcome: 'completed',
      output: { path: RESULT_FILE, sha256: fetched.sha256, byteLength: fetched.byteLength },
      workerVersion: await workerVersionOf(dest),
      // 节点上 Worker 崩溃重试过时，结果回填的是节点的尝试序号。
      runGeneration: final.attempt,
    };
  }

  /** 预检：版本、身份、能力开关、模型包（规范 §9）。 */
  #precheck(health: NodeHealth, nodeId: string, bundleId: string): void {
    if (!health || typeof health !== 'object' || !health.capabilities?.transcribe) {
      throw lost('unreachable', nodeId, NC.badHealth().text);
    }
    if (!versionCompatible(health)) {
      throw rejected('version', nodeId, NC.versionIncompatible().text, {
        nodeProtocolVersion: health.nodeProtocolVersion,
        minNodeProtocolVersion: health.minNodeProtocolVersion,
      });
    }
    // 这个地址上已经不是配对时的那台节点：令牌对它没有意义。
    if (health.nodeId !== nodeId) throw rejected('unpaired', nodeId, NC.otherNodeAtAddress().text);
    const transcribe = health.capabilities.transcribe;
    if (!transcribe.enabled) throw this.#capabilityDisabled(nodeId);
    const bundle = transcribe.bundles.find((b) => b.bundleId === bundleId);
    if (!bundle || bundle.state === 'not-installed' || bundle.state === 'error') {
      throw rejected('model-not-ready', nodeId, NC.bundleNotReady().text, { bundleId, state: bundle?.state ?? 'unknown' });
    }
  }

  /** 节点关闭了转写的共享（`REMOTE_NODE_REJECTED` / `capability-disabled`）：说明里给出是哪台节点与怎么补救。 */
  #capabilityDisabled(nodeId: string): ProviderFailure {
    const name = this.#nodes.get(nodeId)?.alias ?? nodeId;
    return rejected(
      'capability-disabled',
      nodeId,
      NC.capabilityDisabled({ name }).text,
      { capability: 'transcribe' },
    );
  }

  /** 任务创建之前的失败：连不上就是 `unreachable`，节点的拒绝按错误码归类。 */
  #mapBeforeJob(error: unknown, nodeId: string, client: NodeClient): unknown {
    if (error instanceof NodeRequestAborted) return error;
    if (error instanceof NodeConnectionError) return lost('unreachable', nodeId, NC.labelUnreachable({ label: client.label }).text, { cause: error.code });
    if (error instanceof NodeResponseError) return this.#mapResponse(error, nodeId);
    return error;
  }

  #mapResponse(error: NodeResponseError, nodeId: string): ProviderFailure {
    const reason = rejectReason(error);
    // 预检之后节点才关掉开关（创建时 403）：与预检的说明一样带上补救办法。
    if (reason === 'capability-disabled') return this.#capabilityDisabled(nodeId);
    if (reason) {
      return rejected(reason, nodeId, error.message, {
        ...(error.code === NODE_ERROR.PROTOCOL_VERSION_UNSUPPORTED && error.details ? { required: error.details.required } : {}),
        ...(error.code === NODE_ERROR.MODEL_NOT_READY && error.details ? { state: error.details.state } : {}),
      });
    }
    if (error.code === NODE_ERROR.JOB_NOT_FOUND || error.code === NODE_ERROR.RESULT_EXPIRED) {
      return lost('node-restarted', nodeId, NC.taskGone().text);
    }
    // 上表之外的拒绝（例如 400 INVALID_REQUEST、409 IDEMPOTENCY_CONFLICT）：节点的错误码原样。
    return new ProviderFailure('remote-failed', error.message, { code: error.code, node: nodeId, details: { status: error.status } });
  }

  /** 上传。连接中断时看任务的状态：还在等上传就重传，已经收到了就继续（节点按 `Content-Length` 整体接收，没有续传）。 */
  async #upload(attempt: Attempt, file: string, byteLength: number, signal: AbortSignal): Promise<void> {
    const { client, token } = attempt;
    const jobId = attempt.remoteJobId!;
    await this.#retrying(attempt, signal, async () => {
      const current = await client.getJob(token, jobId, { timeoutMs: this.timing.requestTimeoutMs, signal });
      if (current.state !== 'awaiting-input') return;
      try {
        await client.upload(token, jobId, file, byteLength, { idleMs: this.timing.transferIdleMs, signal });
      } catch (error) {
        // 摘要不符时任务已在节点上失败；状态不对（例如节点刚把它取消）：都交给事件流给出终态。
        const settled =
          error instanceof NodeResponseError && (error.code === NODE_ERROR.INPUT_HASH_MISMATCH || error.code === NODE_ERROR.INVALID_STATE);
        if (!settled) throw error;
      }
    });
  }

  /**
   * 跟事件流到终态。断开（含心跳超时）就带 `since` 重连；收到任何一行（心跳也算）就清零连续失败的计时。
   * 已经见过的 `seq` 不再处理（重连后不会重复转发进度）。
   */
  async #follow(attempt: Attempt, sink: TranscribeSink, signal: AbortSignal): Promise<NodeJob> {
    const { client, token, nodeId } = attempt;
    const jobId = attempt.remoteJobId!;
    let since = 0;
    let phase: string | null = null;
    let failingSince: number | null = null;
    let backoff = this.timing.backoffMinMs;
    for (;;) {
      try {
        const response = await client.events(token, jobId, since, { timeoutMs: this.timing.requestTimeoutMs, signal });
        for await (const event of readEventStream(response, this.timing.heartbeatTimeoutMs)) {
          failingSince = null;
          backoff = this.timing.backoffMinMs;
          if (event.type === 'heartbeat') continue;
          if (!Number.isInteger(event.seq) || event.seq <= since) continue;
          since = event.seq;
          if (event.type === 'warning') sink.warning(event.warning as AsrWarning);
          else if (event.type === 'language') sink.language(event.tag, event.confidence);
          else if (event.type === 'job') {
            const job = event.job;
            if (isNodeJobTerminal(job.state)) return job;
            if (job.phase === 'loading') sink.loading();
            else if (WORKER_PHASES.has(job.phase)) {
              const workerPhase = job.phase as TranscribeJobPhase;
              if (workerPhase !== phase) sink.phase(workerPhase);
              if (job.progress) sink.progress({ phase: workerPhase, ...job.progress });
            }
            phase = job.phase;
          }
        }
        // 流结束却没有终态：当作断开。
        throw new NodeConnectionError('NETWORK', NC.streamEndedEarly().text);
      } catch (error) {
        if (signal.aborted || error instanceof NodeRequestAborted) throw new NodeRequestAborted();
        if (error instanceof NodeResponseError) throw this.#mapResponse(error, nodeId);
        if (!(error instanceof NodeConnectionError)) throw error;
        failingSince ??= Date.now();
        if (Date.now() - failingSince >= this.timing.lostAfterMs) {
          throw lost(
            'stream-lost',
            nodeId,
            NC.reconnectFailed({ label: client.label, seconds: Math.round(this.timing.lostAfterMs / 1000) }).text,
          );
        }
        this.#log.warn('Remote job event stream dropped; reconnecting', { node: nodeId, remoteJobId: jobId, since });
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, this.timing.backoffMaxMs);
      }
    }
  }

  /** 任务创建之后的请求：连接问题按同样的退避与失联期限重试；节点的拒绝立即归类。 */
  async #retrying<T>(attempt: Attempt, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    let failingSince: number | null = null;
    let backoff = this.timing.backoffMinMs;
    for (;;) {
      try {
        return await task();
      } catch (error) {
        if (signal.aborted || error instanceof NodeRequestAborted) throw new NodeRequestAborted();
        if (error instanceof NodeResponseError) throw this.#mapResponse(error, attempt.nodeId);
        if (!(error instanceof NodeConnectionError)) throw error;
        failingSince ??= Date.now();
        if (Date.now() - failingSince >= this.timing.lostAfterMs) {
          throw lost(
            'stream-lost',
            attempt.nodeId,
            NC.retryFailed({ label: attempt.client.label, seconds: Math.round(this.timing.lostAfterMs / 1000) }).text,
          );
        }
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, this.timing.backoffMaxMs);
      }
    }
  }

  /** 取消（规范 §9）：发 `cancel` 等确认，再 `DELETE`。节点不可达时仍以 `cancelled` 兑现并带警告。 */
  async #cancel(attempt: Attempt, jobId: string): Promise<TranscribeAttempt> {
    const remoteJobId = attempt.remoteJobId;
    if (!remoteJobId) return { outcome: 'cancelled', workerVersion: null };
    const { client, token, nodeId } = attempt;
    let confirmed = false;
    try {
      const job = await client.cancelJob(token, remoteJobId, { timeoutMs: this.timing.cancelTimeoutMs });
      confirmed = isNodeJobTerminal(job.state);
    } catch (error) {
      if (error instanceof NodeResponseError && error.code === NODE_ERROR.JOB_NOT_FOUND) confirmed = true;
    }
    try {
      await client.deleteJob(token, remoteJobId, { timeoutMs: this.timing.cancelTimeoutMs });
      confirmed = true;
    } catch (error) {
      if (error instanceof NodeResponseError && error.code === NODE_ERROR.JOB_NOT_FOUND) confirmed = true;
    }
    this.#log.info(confirmed ? 'Remote job cancelled' : 'Remote job cancellation was not confirmed by the node', { jobId, node: nodeId, remoteJobId });
    return confirmed
      ? { outcome: 'cancelled', workerVersion: null }
      : { outcome: 'cancelled', workerVersion: null, warnings: [{ code: 'remote-cancel-unconfirmed' }] };
  }

  /** 结束后让节点删掉任务（尽力：失败只记日志，节点按保留期限自己清理）。 */
  async #forget(attempt: Attempt): Promise<void> {
    const remoteJobId = attempt.remoteJobId;
    if (!remoteJobId) return;
    try {
      await attempt.client.deleteJob(attempt.token, remoteJobId, { timeoutMs: this.timing.deleteTimeoutMs });
    } catch (error) {
      if (error instanceof NodeResponseError && error.code === NODE_ERROR.JOB_NOT_FOUND) return;
      this.#log.warn('Could not delete the job on the node', { node: attempt.nodeId, remoteJobId });
    }
  }
}

function rejected(reason: RemoteNodeRejectReason, node: string, message: string, extra: Record<string, unknown> = {}): ProviderFailure {
  return new ProviderFailure('node-rejected', message, { reason, node, ...extra });
}

function lost(reason: RemoteNodeLostReason, node: string, message: string, extra: Record<string, unknown> = {}): ProviderFailure {
  return new ProviderFailure('node-lost', message, { reason, node, ...extra });
}

/** 结果里的 Worker 版本（读不出来时给一个占位，JobManager 的校验会指出结果本身的问题）。 */
async function workerVersionOf(file: string): Promise<string> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { provenance?: { workerVersion?: unknown } };
    const version = parsed.provenance?.workerVersion;
    return typeof version === 'string' && version ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new NodeRequestAborted());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new NodeRequestAborted());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
