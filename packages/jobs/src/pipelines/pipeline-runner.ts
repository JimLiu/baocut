import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  newId,
  nowIso,
  type Id,
  type JobError,
  type JobPhase,
  type JobProgress,
  type JobRecord,
  type JobSubmitter,
  type JobWait,
  type PipelineInfo,
  type PipelineRun,
  type PipelineStepState,
} from '@baocut/protocol';
import { JobsPipelineRunner as J } from '@baocut/protocol/messages/jobs/pipeline-runner.ts';
import type { VideoPlace } from '../application-ledger.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { errorRef, errorText, jobError, resolveText, textParts, type JobText, type LazyText } from '../job-text.ts';
import type { JobLibrary } from '../job-library.ts';
import type { HostedJob, HostedJobControl, JobManager } from '../job-manager.ts';
import { silentLog, type JobsLogger } from '../jobs-logger.ts';
import { ResourceExceedsCapacity, type ResourceLease } from '../resource-scheduler.ts';
import {
  PipelineStepError,
  type PipelineDefinition,
  type PipelineStep,
  type PipelineStepContext,
  type StepOutput,
  type StepOutputs,
} from './pipeline.ts';
import { TARGET_STEP, readVideoTarget, type PipelineTargets, type VideoLease } from './video-target.ts';

/**
 * 固定流程的编排（架构设计 §7.9）。执行主体是 `system:pipeline`，不创建智能体会话：
 *
 * - 一次执行是一个父任务（`kind: 'pipeline'`，提交者是发起它的连接或服务），每一步是一个子任务
 *   （`kind: 'pipeline-step'`，`parentJobId` 指向父任务，提交者 `{ kind: 'pipeline', id: <父任务> }`）。
 *   父任务的进度按步骤计（`unit: 'steps'`），阶段与调用计数跟着正在执行的那一步。
 * - 步骤按顺序执行，只经产出（记在父任务的 `pipeline.steps[].output`）传递结果。
 * - 一步失败时停在这一步：之前完成的步骤保留，父任务 `failed`，`pipeline.stoppedAt` 记下这一步。
 *   `pipelines.retry` 从这一步重新执行（同一个父任务 `attempt` 加一，这一步换一个新的子任务），复用之前各步的产出；
 *   产出已经不能用的（`reusable` 为 false，例如 staging 里的文件没了）从那一步重来。
 * - 取消父任务：先挡住新步骤的开始，再中止正在执行的那一步；取消任何一个子任务等于取消整个流程。
 * - Runtime 停止时中止正在执行的步骤，父任务与子任务标为 `interrupted`；重启后没有终结的流程同样标为 `interrupted`，
 *   都可以重试。
 * - 视频目标（§7.9）：接受 `target` 的流程，`{ entryId }` 在提交时解析并以 Runtime 的租约打开（条目不对、被别的进程锁着时
 *   `pipelines.start` 直接拒绝，不建任务），记成第一步 `target`。流程持有的租约（解析目标、新建视频的步骤交来的）在这次执行
 *   结束、取消或失败时放下；租约只在内存里，Runtime 重启之后流程是 `interrupted`，重试时按记下的位置重新取得。新建视频的步骤
 *   完成之后重试不再重做。
 */

/** 固定流程写视频时的行为者（架构设计 §7.3、§7.9）。 */
export const PIPELINE_ACTOR_ID = 'system:pipeline';

export interface PipelineRunnerOptions {
  jobs: JobManager;
  /** Runtime Home 的 staging 目录；流程用 `<stagingDir>/pipelines/<父任务>`。 */
  stagingDir: string;
  /** 各流程的参数类型各不相同。 */
  definitions: Array<PipelineDefinition<any, any>>;
  /** 用户库：固定流程用到的条目的版本（`PipelinePlan.library`）。与 JobManager 用同一个。 */
  library?: Pick<JobLibrary, 'pin' | 'unpin'>;
  /** 视频目标的解析、打开与新建（Runtime 给出）。不给时 `{ entryId }` 的目标被拒绝。 */
  targets?: PipelineTargets;
  log?: JobsLogger;
}

interface ActiveRun {
  jobId: Id;
  def: PipelineDefinition<unknown>;
  params: unknown;
  parent: HostedJob;
  abort: AbortController;
  /** 停下来的原因：先到的为准（取消之后又停止 Runtime 仍算取消）。 */
  stop: 'cancelled' | 'interrupted' | null;
  staging: string;
  /** 这次执行持有的视频租约：执行结束（完成、失败、取消、中断）时放下。 */
  leases: VideoLease[];
  /** 提交时解析的目标（`entryId`）：记成 `target` 这一步的产出；别的目标时 null（这一步跳过）。 */
  target: StepOutput | null;
  /** 这次执行（含终结之后的收尾）结束。 */
  done?: Promise<void>;
}

const RETRYABLE = new Set(['failed', 'cancelled', 'interrupted']);

export class PipelineRunner {
  readonly #jobs: JobManager;
  readonly #defs = new Map<string, PipelineDefinition<unknown>>();
  readonly #staging: string;
  readonly #log: JobsLogger;
  readonly #library: PipelineRunnerOptions['library'];
  readonly #targets: PipelineTargets | null;
  readonly #runs = new Map<Id, ActiveRun>();
  readonly #done = new Set<Promise<void>>();

  constructor(options: PipelineRunnerOptions) {
    this.#jobs = options.jobs;
    this.#staging = path.join(options.stagingDir, 'pipelines');
    this.#log = options.log ?? silentLog;
    this.#library = options.library;
    this.#targets = options.targets ?? null;
    for (const def of options.definitions) {
      if (def.target && def.steps[0]?.name !== TARGET_STEP) throw new Error(`Pipeline "${def.name}" accepts a target, so its first step must be targetStep()`);
      this.#defs.set(def.name, def);
    }
  }

  /**
   * 对账（JobManager 已经把没有终结的任务标为 `interrupted`）：把这些流程里还在执行的那一步标为中断、记下停在哪一步；
   * 删掉不再需要的 staging 目录（只有可以重试的流程保留）。
   */
  async open(): Promise<void> {
    await fs.mkdir(this.#staging, { recursive: true });
    const retryable = new Set<Id>();
    for (const record of this.#jobs.list()) {
      const run = record.pipeline;
      if (record.kind !== 'pipeline' || !run) continue;
      if (RETRYABLE.has(record.state) && record.state !== 'cancelled') retryable.add(record.jobId);
      // JobManager 只给了通用的「中断」：补上停在哪一步（正在执行的，或在两步之间时下一步）。
      if (record.state !== 'interrupted' || record.error?.details) continue;
      const step = run.steps.find((s) => s.status === 'running') ?? run.steps.find((s) => s.status === 'pending');
      const stoppedAt = step?.name ?? run.stoppedAt;
      const steps = run.steps.map((s): PipelineStepState => (s.status === 'running' ? { ...s, status: 'interrupted' } : s));
      await this.#jobs.amend(record.jobId, { pipeline: { ...run, steps, current: null, stoppedAt }, error: interruptedError(stoppedAt) });
    }
    for (const name of await fs.readdir(this.#staging)) {
      if (!retryable.has(name)) await fs.rm(path.join(this.#staging, name), { recursive: true, force: true });
    }
  }

  list(): PipelineInfo[] {
    return [...this.#defs.values()].map((def) => ({
      name: def.name,
      label: String(resolveText(def.label)),
      description: String(resolveText(def.description)),
      steps: def.steps.map((s) => ({ name: s.name, label: String(resolveText(s.label)), optional: s.when !== undefined })),
      paramsSchema: structuredClone(def.paramsSchema),
    }));
  }

  /** 启动一个流程：校验并冻结参数、做启动前的检查，立即返回父任务。同一个 `commandId` 只启动一次。 */
  async start(
    request: { pipeline: string; params: Record<string, unknown>; commandId?: Id },
    submitter: JobSubmitter,
  ): Promise<{ jobId: Id }> {
    const def = this.#defs.get(request.pipeline);
    if (!def) throw new RpcError('not-found', J.unknownPipeline({ name: request.pipeline }));
    if (request.commandId) {
      const existing = this.#jobs.jobForCommand(request.commandId);
      if (existing) return { jobId: existing };
    }
    // 目标的租约：交给这次执行之前出错时放下。
    const leases: VideoLease[] = [];
    let handed = false;
    try {
      const { raw, target } = await this.#resolveTarget(def, request.params, leases);
      const plan = await def.prepare(def.parse(raw), { retry: false, submitter });
      if (request.commandId) {
        const existing = this.#jobs.jobForCommand(request.commandId);
        if (existing) return { jobId: existing };
      }
      const jobId = this.#host(def, plan, request.commandId, submitter, leases, target);
      handed = true;
      return { jobId };
    } finally {
      if (!handed) for (const lease of leases) lease.release();
    }
  }

  /**
   * 读视频目标（§7.9）：`{ entryId }` 解析成视频并以租约打开（租约放进 `leases`），交给 `parse` 的参数换成 `videoId`；
   * `{ videoId }` 换成顶层的 `videoId`；`{ create }` 原样交给流程。不接受目标的流程原样交参数。
   */
  async #resolveTarget(
    def: PipelineDefinition<unknown>,
    params: Record<string, unknown>,
    leases: VideoLease[],
  ): Promise<{ raw: Record<string, unknown>; target: StepOutput | null }> {
    if (!def.target) return { raw: params, target: null };
    const target = readVideoTarget(params, def.target);
    const { target: _, videoId: given, ...rest } = params;
    if (!target) return { raw: given === undefined ? rest : { ...rest, videoId: given }, target: null };
    if ('videoId' in target) return { raw: { ...rest, videoId: target.videoId }, target: null };
    if ('create' in target) return { raw: { ...rest, target }, target: null };
    if (!this.#targets)
      throw new RpcError('invalid-request', J.entryTargetUnsupported(), { code: 'PIPELINE_TARGET_UNSUPPORTED' });
    const place = await this.#targets.entry(target.entryId);
    const lease = await this.#targets.lease(place);
    leases.push(lease);
    if (given !== undefined && given !== lease.videoId) {
      throw new RpcError('invalid-request', J.targetMismatch());
    }
    return {
      raw: { ...rest, videoId: lease.videoId },
      target: { entryId: target.entryId, videoId: lease.videoId, place: lease.place },
    };
  }

  /** 登记父任务并开始执行；目标的租约交给这次执行。 */
  #host(
    def: PipelineDefinition<unknown>,
    plan: Awaited<ReturnType<PipelineDefinition<unknown>['prepare']>>,
    commandId: Id | undefined,
    submitter: JobSubmitter,
    leases: VideoLease[],
    target: StepOutput | null,
  ): Id {
    const now = nowIso();
    const params = structuredClone(plan.params) as Record<string, unknown>;
    const jobId = newId('job');
    // 用到的库条目：以父任务为持有者固定版本（解析时已经冻结；这之间被删了时这里抛 not-found，不建任务）。
    let library: JobRecord['library'];
    if (plan.library?.length) {
      if (!this.#library) throw new RpcError('invalid-request', J.noLibrary());
      library = { entries: this.#library.pin(jobId, plan.library) };
    }
    const record: JobRecord = {
      jobId,
      kind: 'pipeline',
      state: 'running',
      phase: 'starting',
      progress: { done: 0, total: def.steps.length, unit: 'steps' },
      videoId: plan.videoId,
      assetId: null,
      assetRevision: null,
      contentHash: plan.contentHash,
      providerId: plan.providerId,
      modelId: plan.modelId,
      bundleId: null,
      inputHash: `sha256:${sha256Hex(canonicalJson({ pipeline: def.name, params }))}`,
      submitter,
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
      ...(library ? { library } : {}),
      pipeline: {
        name: def.name,
        params,
        steps: def.steps.map((s): PipelineStepState => ({ name: s.name, ...stepLabel(s.label), status: 'pending', jobId: null, attempts: 0, output: null })),
        current: null,
        stoppedAt: null,
        summary: null,
      },
    };
    const run = this.#newRun(record.jobId, def, params);
    try {
      run.parent = this.#jobs.host(record, {
        hosted: 'pipeline',
        control: this.#control(run),
        commandId: commandId ?? null,
        leaseVideo: true,
      });
    } catch (error) {
      if (library) void this.#library!.unpin(jobId).catch(() => {});
      throw error;
    }
    run.leases = leases;
    run.target = target;
    this.#log.info('Pipeline started', { jobId: record.jobId, pipeline: def.name });
    this.#launch(run, 0);
    return record.jobId;
  }

  /** 从停下的那一步重新执行（复用之前各步的产出）。还在执行或已经完成时 `conflict`（`JOB_NOT_RETRYABLE`）。 */
  async retry(jobId: Id): Promise<{ jobId: Id }> {
    // 父任务已经终结、执行还在收尾（终态先发事件再落盘）：等它收完，免得刚看到失败就重试时被拒。
    const finishing = this.#runs.get(jobId);
    if (finishing && RETRYABLE.has(this.#jobs.inspect(jobId).state)) await finishing.done;
    const record = this.#jobs.inspect(jobId);
    const run0 = record.pipeline;
    if (record.kind !== 'pipeline' || !run0) throw new RpcError('invalid-request', J.notPipeline());
    if (this.#runs.has(jobId) || !RETRYABLE.has(record.state)) {
      throw new RpcError('conflict', J.notRetryable(), { code: 'JOB_NOT_RETRYABLE', state: record.state });
    }
    const def = this.#defs.get(run0.name);
    if (!def) throw new RpcError('conflict', J.pipelineMissing({ name: run0.name }), { code: 'JOB_NOT_RETRYABLE' });
    // 按步骤名对齐记录（之前的版本没有的步骤：解析目标记为跳过，别的从头执行）。
    const states = def.steps.map(
      (step): PipelineStepState =>
        run0.steps.find((s) => s.name === step.name) ?? {
          name: step.name,
          ...stepLabel(step.label),
          status: step.name === TARGET_STEP ? 'skipped' : 'pending',
          jobId: null,
          attempts: 0,
          output: null,
        },
    );
    const leases: VideoLease[] = [];
    let handed = false;
    try {
      // 先重新取得流程持有的视频（之前的租约在 Runtime 重启后不在了），再做启动前的检查：检查要读这个视频。
      await this.#reacquire(def, states, leases);
      await def.prepare(run0.params, { retry: true, submitter: record.submitter });
      if (this.#runs.has(jobId)) throw new RpcError('conflict', J.alreadyRetrying(), { code: 'JOB_NOT_RETRYABLE' });
      const staging = path.join(this.#staging, jobId);
      let from = 0;
      for (; from < def.steps.length; from++) {
        const state = states[from]!;
        if (state.status === 'skipped') continue;
        if (state.status !== 'completed' || !state.output) break;
        const reusable = def.steps[from]!.reusable;
        if (reusable && !(await reusable(state.output, { params: run0.params, staging, artifacts: this.#jobs.artifacts }))) break;
      }
      if (this.#runs.has(jobId)) throw new RpcError('conflict', J.alreadyRetrying(), { code: 'JOB_NOT_RETRYABLE' });
      // 持有视频的步骤（解析目标、新建视频）完成过就不再重做：之后的步骤照常从 `from` 重来。
      const steps = states.map((s, i): PipelineStepState =>
        i < from || (def.steps[i]!.holdsVideo && s.status === 'completed') ? s : { ...s, status: 'pending', output: null },
      );
      this.#reopen(jobId, record, def, steps, from, leases);
      handed = true;
      return { jobId };
    } finally {
      if (!handed) for (const lease of leases) lease.release();
    }
  }

  /** 重试时按完成的 `holdsVideo` 步骤记下的位置重新取得租约；打开的不是原来的视频时拒绝重试。 */
  async #reacquire(def: PipelineDefinition<unknown>, states: PipelineStepState[], leases: VideoLease[]): Promise<void> {
    for (const [index, step] of def.steps.entries()) {
      const state = states[index]!;
      if (!step.holdsVideo || state.status !== 'completed' || !state.output) continue;
      const { videoId, place } = state.output as { videoId?: unknown; place?: unknown };
      if (typeof videoId !== 'string' || !place || typeof place !== 'object') continue;
      if (!this.#targets) throw new RpcError('conflict', J.cannotOpenTarget(), { code: 'JOB_NOT_RETRYABLE' });
      const lease = await this.#targets.lease(place as VideoPlace);
      leases.push(lease);
      if (lease.videoId !== videoId) {
        throw new RpcError('conflict', J.targetReplaced(), { code: 'STALE_JOB_INPUT', videoId });
      }
    }
  }

  #reopen(
    jobId: Id,
    record: JobRecord,
    def: PipelineDefinition<unknown>,
    steps: PipelineStepState[],
    from: number,
    leases: VideoLease[],
  ): void {
    const run0 = record.pipeline!;
    // 重新固定冻结的版本（Runtime 重启之后之前的固定不在了）；已经不在的版本跳过：内容在启动时已经写进产物。
    for (const entry of record.library?.entries ?? []) {
      try {
        this.#library?.pin(jobId, [entry]);
      } catch (error) {
        this.#log.warn('Could not pin library versions on retry', {
          jobId,
          entry: `${entry.library}/${entry.id}@${entry.version}`,
          error: String(error),
        });
      }
    }

    const run = this.#newRun(jobId, def, run0.params);
    run.leases = leases;
    run.parent = this.#jobs.reopen(jobId, {
      control: this.#control(run),
      leaseVideo: true,
      patch: {
        phase: 'starting',
        progress: { done: from, total: def.steps.length, unit: 'steps' },
        pipeline: { ...run0, steps, current: null, stoppedAt: null, summary: null },
      },
    });
    this.#log.info('Pipeline retry', { jobId, pipeline: def.name, from: def.steps[from]?.name ?? null });
    this.#launch(run, from);
  }

  /** 等所有在途的流程停下（测试与停止时用）。 */
  async idle(): Promise<void> {
    while (this.#done.size > 0) await Promise.allSettled([...this.#done]);
  }

  #newRun(jobId: Id, def: PipelineDefinition<unknown>, params: unknown): ActiveRun {
    // `parent` 在登记之后补上。
    return {
      jobId,
      def,
      params,
      parent: null as unknown as HostedJob,
      abort: new AbortController(),
      stop: null,
      staging: path.join(this.#staging, jobId),
      leases: [],
      target: null,
    };
  }

  #control(run: ActiveRun): HostedJobControl {
    return {
      cancel: () => {
        run.stop ??= 'cancelled';
        run.abort.abort();
      },
      interrupt: () => {
        run.stop ??= 'interrupted';
        run.abort.abort();
      },
    };
  }

  #launch(run: ActiveRun, from: number): void {
    this.#runs.set(run.jobId, run);
    const done: Promise<void> = this.#drive(run, from)
      .catch(async (error: unknown) => {
        this.#log.error('Pipeline failed', { jobId: run.jobId, error: String(error) });
        await run.parent.finish('failed', { error: jobError('INTERNAL', J.pipelineFailed()) });
      })
      .finally(() => {
        // 解除这次执行固定的库版本（JobManager 终结任务时也会解除；重复解除没有影响）。
        void this.#library?.unpin(run.jobId).catch(() => {});
        // 放下这次执行持有的视频（没有别的打开者时按宽限期关闭）。
        for (const lease of run.leases.splice(0)) lease.release();
        if (this.#runs.get(run.jobId) === run) this.#runs.delete(run.jobId);
        this.#done.delete(done);
      });
    run.done = done;
    this.#done.add(done);
  }

  async #drive(run: ActiveRun, from: number): Promise<void> {
    const { def } = run;
    await fs.mkdir(run.staging, { recursive: true });
    for (let index = from; index < def.steps.length; index++) {
      // 取消的屏障：停下之后不再开始新的步骤。
      if (run.stop) return this.#end(run, run.stop, index, null);
      const step = def.steps[index]!;
      if (def.target && step.name === TARGET_STEP) {
        if ((await this.#recordTarget(run, index, step)) !== 'completed') return;
        continue;
      }
      // 持有视频的步骤完成过（重试时保留的）：不重做。
      if (step.holdsVideo && run.parent.record().pipeline!.steps[index]?.status === 'completed') continue;
      const outputs = this.#outputs(run);
      if (step.when && !step.when(run.params, outputs)) {
        this.#setStep(run, index, { status: 'skipped', output: null }, true);
        continue;
      }
      const outcome = await this.#runStep(run, index, step, outputs);
      if (outcome !== 'completed') return;
    }
    if (run.stop) return this.#end(run, run.stop, def.steps.length, null);
    let completion: Awaited<ReturnType<PipelineDefinition<unknown>['complete']>>;
    try {
      completion = await def.complete({ params: run.params, outputs: this.#outputs(run), artifacts: this.#jobs.artifacts });
    } catch (error) {
      return this.#end(run, 'failed', def.steps.length, jobErrorOf(error, this.#log));
    }
    const current = run.parent.record().pipeline!;
    run.parent.update({
      pipeline: { ...current, current: null, summary: completion.summary },
      phase: 'done',
      progress: this.#stepProgress(run, def.steps.length),
    });
    await fs.rm(run.staging, { recursive: true, force: true }).catch(() => {});
    this.#log.info('Pipeline completed', { jobId: run.jobId, pipeline: def.name });
    await run.parent.finish('completed', { result: completion.result });
  }

  /** 解析目标这一步：提交时已经解析（`entryId`）的记为完成并开一个子任务记下来；别的目标记为跳过。 */
  async #recordTarget(run: ActiveRun, index: number, step: PipelineStep<unknown>): Promise<'completed' | 'stopped'> {
    if (!run.target) {
      this.#setStep(run, index, { status: 'skipped', output: null }, true);
      return 'completed';
    }
    let child: HostedJob;
    try {
      child = this.#child(run, index, resolveText(step.label), 1);
    } catch {
      run.stop ??= 'interrupted';
      await this.#end(run, run.stop, index, null);
      return 'stopped';
    }
    await child.finish('completed');
    this.#setStep(run, index, { status: 'completed', jobId: child.jobId, attempts: 1, output: run.target }, true, {
      progress: this.#stepProgress(run, index + 1),
    });
    return 'completed';
  }

  /** 执行一步：开子任务、执行、按结果终结子任务并记下产出。 */
  async #runStep(run: ActiveRun, index: number, step: PipelineStep<unknown>, outputs: StepOutputs): Promise<'completed' | 'stopped'> {
    const attempts = (run.parent.record().pipeline!.steps[index]?.attempts ?? 0) + 1;
    let child: HostedJob;
    try {
      child = this.#child(run, index, resolveText(step.label), attempts);
    } catch {
      // Runtime 正在停止。
      run.stop ??= 'interrupted';
      await this.#end(run, run.stop, index, null);
      return 'stopped';
    }
    this.#setStep(run, index, { status: 'running', jobId: child.jobId, attempts }, true, { phase: 'starting' });

    const report = (job: HostedJob) => (progress: JobProgress | null, phase?: JobPhase) => {
      job.update({ progress, ...(phase ? { phase } : {}) });
      const base = this.#stepProgress(run, index);
      run.parent.update({ ...(phase ? { phase } : {}), progress: progress?.calls ? { ...base, calls: progress.calls } : base });
    };
    const context: PipelineStepContext<unknown> = {
      params: run.params,
      parentJobId: run.jobId,
      jobId: child.jobId,
      attempt: attempts,
      run: { runId: run.jobId, runGeneration: String(run.parent.record().attempt) },
      signal: run.abort.signal,
      outputs,
      staging: run.staging,
      artifacts: this.#jobs.artifacts,
      progress: report(child),
      warn: (warning) => {
        child.update({ warnings: [...child.record().warnings, warning] }, { persist: true });
        run.parent.update({ warnings: [...run.parent.record().warnings, warning] }, { persist: true });
      },
      spawn: async (label, fn) => {
        const extra = this.#child(run, index, J.subtask({ step: resolveText(step.label), label }), attempts);
        try {
          const value = await fn({ jobId: extra.jobId, progress: report(extra) });
          await extra.finish('completed');
          return value;
        } catch (error) {
          await extra.finish(run.stop ?? 'failed', this.#stopError(run, step.name, error));
          throw error;
        }
      },
      hold: (lease) => {
        run.leases.push(lease);
        run.parent.update({ videoId: lease.videoId }, { persist: true });
      },
    };

    let lease: ResourceLease | null = null;
    try {
      lease = await this.#admit(run, child, step, outputs);
      const { output, result } = await step.run(context);
      lease?.release();
      lease = null;
      await child.finish('completed', result ? { result } : {});
      this.#setStep(run, index, { status: 'completed', output }, true, { progress: this.#stepProgress(run, index + 1) });
      return 'completed';
    } catch (error) {
      lease?.release();
      const state = run.stop ?? 'failed';
      const patch = this.#stopError(run, step.name, error);
      await child.finish(state, patch);
      this.#setStep(run, index, { status: state }, false);
      await this.#end(run, state, index, patch.error ?? null);
      return 'stopped';
    }
  }

  /**
   * 声明了峰值需求的步骤先经资源调度准入（§7.6、§7.7）：等的时候子任务与父任务上记着在等什么；取消与停止撤回请求。
   * 这台机器永远放不下时这一步以 `RESOURCE_ADMISSION_UNSATISFIABLE` 失败。
   */
  async #admit(run: ActiveRun, child: HostedJob, step: PipelineStep<unknown>, outputs: StepOutputs): Promise<ResourceLease | null> {
    if (!step.resources) return null;
    const onWait = (wait: JobWait | null) => {
      for (const job of [child, run.parent]) {
        const record = job.record();
        if (wait) job.update({ wait });
        else if (record.wait) job.update({ wait: undefined });
      }
    };
    try {
      return await this.#jobs.resources.acquire(
        { owner: child.jobId, label: `${run.def.name}:${step.name}`, ...step.resources(run.params, outputs) },
        { signal: run.abort.signal, onWait },
      );
    } catch (error) {
      if (error instanceof ResourceExceedsCapacity) {
        throw new PipelineStepError(error.code, errorText(error), { dimensions: error.dimensions });
      }
      throw error;
    } finally {
      onWait(null);
    }
  }

  #child(run: ActiveRun, index: number, labelText: JobText, attempts: number): HostedJob {
    const parent = run.parent.record();
    const step = run.def.steps[index]!;
    const now = nowIso();
    const { text: label, ref: labelRef } = textParts(labelText);
    const record: JobRecord = {
      jobId: newId('job'),
      kind: 'pipeline-step',
      state: 'running',
      phase: 'starting',
      progress: null,
      videoId: parent.videoId,
      assetId: null,
      assetRevision: null,
      contentHash: parent.contentHash,
      providerId: parent.providerId,
      modelId: parent.modelId,
      bundleId: null,
      inputHash: `sha256:${sha256Hex(canonicalJson({ parent: run.jobId, step: step.name, attempt: attempts, label }))}`,
      submitter: { kind: 'pipeline', id: run.jobId },
      attempt: attempts,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      endedAt: null,
      error: null,
      result: null,
      warnings: [],
      parentJobId: run.jobId,
      step: { pipeline: run.def.name, name: step.name, label, ...(labelRef ? { labelRef } : {}), index },
    };
    // 取消或中断任何一个子任务等于取消或中断整个流程。
    return this.#jobs.host(record, { hosted: 'pipeline-step', control: this.#control(run) });
  }

  /** 停下的错误：取消没有错误，中断是 `JOB_INTERRUPTED`，失败是步骤的错误。 */
  #stopError(run: ActiveRun, stepName: string, error: unknown): { error?: JobError } {
    if (run.stop === 'cancelled') return {};
    if (run.stop === 'interrupted') return { error: interruptedError(stepName) };
    return { error: jobErrorOf(error, this.#log) };
  }

  /** 父任务停下：记下停在哪一步；完成与取消时删掉 staging，失败与中断时保留供重试。 */
  async #end(run: ActiveRun, state: 'failed' | 'cancelled' | 'interrupted', index: number, error: JobError | null): Promise<void> {
    const current = run.parent.record().pipeline!;
    const stoppedAt = run.def.steps[index]?.name ?? null;
    run.parent.update({ pipeline: { ...current, current: null, stoppedAt } }, { persist: true });
    if (state === 'cancelled') await fs.rm(run.staging, { recursive: true, force: true }).catch(() => {});
    const parentError: JobError | undefined =
      state === 'cancelled'
        ? undefined
        : state === 'interrupted'
          ? interruptedError(stoppedAt)
          : error
            ? withStep(error, stoppedAt)
            : undefined;
    this.#log.info('Pipeline stopped', { jobId: run.jobId, state, step: stoppedAt, code: parentError?.code });
    await run.parent.finish(state, parentError ? { error: parentError } : {});
  }

  #setStep(
    run: ActiveRun,
    index: number,
    patch: Partial<PipelineStepState>,
    persist: boolean,
    extra: { phase?: JobPhase; progress?: JobProgress } = {},
  ): void {
    const current = run.parent.record().pipeline!;
    const steps = current.steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    const pipeline: PipelineRun = { ...current, steps, current: patch.status === 'running' ? index : current.current };
    run.parent.update(
      { pipeline, ...(extra.phase ? { phase: extra.phase } : {}), progress: extra.progress ?? this.#stepProgress(run, index) },
      { persist },
    );
  }

  #stepProgress(run: ActiveRun, done: number): JobProgress {
    return { done, total: run.def.steps.length, unit: 'steps' };
  }

  #outputs(run: ActiveRun): StepOutputs {
    const steps = run.parent.record().pipeline!.steps;
    const outputs: Record<string, StepOutput | null> = {};
    for (const step of steps) if (step.status === 'completed' || step.status === 'skipped') outputs[step.name] = step.output;
    return outputs;
  }
}

function interruptedError(step: string | null): JobError {
  return jobError('JOB_INTERRUPTED', J.interrupted(), step ? { step } : undefined);
}

function withStep(error: JobError, step: string | null): JobError {
  if (!step) return error;
  const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : {};
  return { ...error, details: { ...details, step } };
}

/** 步骤抛出的错误 → 任务错误（命令与协议规范 §11.3）。认不出的记为 `INTERNAL`，原文只进日志。 */
export function jobErrorOf(error: unknown, log: JobsLogger = silentLog): JobError {
  if (error instanceof RpcError) {
    const details = error.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>) : undefined;
    const code = typeof details?.code === 'string' ? details.code : error.code.toUpperCase().replace(/-/g, '_');
    return withRef({ code, message: error.message, ...(details ? { details } : {}) }, error);
  }
  if (error instanceof Error) {
    const coded = error as Error & { code?: unknown; details?: unknown };
    if (typeof coded.code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(coded.code)) {
      const details =
        coded.details && typeof coded.details === 'object' && Object.keys(coded.details).length > 0 ? coded.details : undefined;
      return withRef({ code: coded.code, message: error.message, ...(details ? { details } : {}) }, error);
    }
  }
  log.error('Step failed', { error: String(error) });
  return jobError('INTERNAL', J.stepFailed());
}

/** 错误带着消息引用时记进任务错误（`messageRef`）。 */
function withRef(jobErr: JobError, error: unknown): JobError {
  const ref = errorRef(error);
  return ref ? { ...jobErr, messageRef: ref } : jobErr;
}

/** 步骤名与它的引用（记进 `PipelineStepState`）。 */
function stepLabel(label: LazyText): Pick<PipelineStepState, 'label' | 'labelRef'> {
  const { text, ref } = textParts(resolveText(label));
  return ref ? { label: text, labelRef: ref } : { label: text };
}
