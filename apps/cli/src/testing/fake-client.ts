import { PassThrough } from 'node:stream';
import type { BaoCutClient } from '@baocut/client';
import type { CatalogCallResult, JobRecord, JobsEvent, JobsSnapshot } from '@baocut/protocol';
import { Output } from '../envelope.ts';

/**
 * 测试用的 `BaoCutClient` 替身：只有 CLI 等任务与调工具用到的几样（`request`、`subscribeJobs`、`onState`、`state`）。
 * 网关方法与目录里的工具各自按名字给处理函数；`jobs` 主题的快照与事件由用例推。
 */
export class FakeClient {
  state: { status: string; reason?: string } = { status: 'connected' };
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];
  readonly methods: Record<string, (params: Record<string, unknown>) => unknown> = {};
  readonly tools: Record<string, (args: Record<string, unknown>) => CatalogCallResult> = {};
  #jobs: { snapshot: (snapshot: JobsSnapshot) => void; event: (event: JobsEvent) => void } | null = null;
  readonly #stateListeners = new Set<(state: { status: string; reason?: string }) => void>();

  get client(): BaoCutClient {
    return this as unknown as BaoCutClient;
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'catalog.call') {
      const tool = this.tools[params.name as string];
      if (!tool) throw new Error(`没有准备工具 ${String(params.name)}`);
      return tool((params.args ?? {}) as Record<string, unknown>);
    }
    const handler = this.methods[method];
    if (!handler) throw new Error(`没有准备方法 ${method}`);
    return handler(params);
  }

  /** 调过的工具名（`catalog.call`）。 */
  toolCalls(): string[] {
    return this.calls.filter((call) => call.method === 'catalog.call').map((call) => call.params.name as string);
  }

  subscribeJobs(handlers: { snapshot: (snapshot: JobsSnapshot) => void; event: (event: JobsEvent) => void }): () => void {
    this.#jobs = handlers;
    return () => {
      this.#jobs = null;
    };
  }

  onState(listener: (state: { status: string; reason?: string }) => void): () => void {
    this.#stateListeners.add(listener);
    return () => this.#stateListeners.delete(listener);
  }

  get subscribed(): boolean {
    return this.#jobs !== null;
  }

  snapshot(jobs: JobRecord[]): void {
    this.#jobs?.snapshot({ jobs });
  }

  emit(job: JobRecord): void {
    this.#jobs?.event({ type: 'job.updated', job });
  }

  disconnect(reason = '测试断开'): void {
    this.state = { status: 'disconnected', reason };
    for (const listener of this.#stateListeners) listener(this.state);
  }
}

/** 一条任务记录：只填 CLI 读的字段，其余给空值。 */
export function jobRecord(partial: Partial<JobRecord> & { jobId: string }): JobRecord {
  return {
    kind: 'pipeline',
    state: 'running',
    phase: 'running',
    progress: null,
    videoId: null,
    assetId: null,
    assetRevision: null,
    contentHash: 'sha256:0',
    providerId: 'local',
    modelId: 'm',
    bundleId: null,
    inputHash: 'sha256:0',
    submitter: { kind: 'connection', id: 'c' },
    attempt: 1,
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
    startedAt: null,
    endedAt: null,
    error: null,
    result: null,
    warnings: [],
    ...partial,
  } as JobRecord;
}

/** 收下 stdout / stderr 的输出（JSON 信封或给人读的文字）。 */
export function captureOutput(json = true) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (chunk) => (out += String(chunk)));
  stderr.on('data', (chunk) => (err += String(chunk)));
  return {
    output: new Output({ json, stdout, stderr }),
    stdout,
    stderr,
    out: () => out,
    err: () => err,
    /** stdout 上最后一个 JSON 信封。 */
    envelope: () => JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as Record<string, any>,
  };
}
