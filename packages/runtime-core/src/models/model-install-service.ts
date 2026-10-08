import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '@baocut/harness';
import {
  TaskFailure,
  canonicalJson,
  isTerminal,
  localImageResources,
  localTranscribeResources,
  modelDownloadDemand,
  sha256Hex,
  type JobManager,
  type LocalTranscribeProvider,
  type TaskRun,
} from '@baocut/jobs';
import {
  APP_FILE_MISSING,
  DEFAULT_TIMESCALE,
  DownloadError,
  IMAGE_SELF_TEST,
  ModelInstaller,
  ProviderFailure,
  TRANSCRIBE_SELF_TEST,
  appFileMissing,
  builtinReferenceFile,
  bundleUsable,
  freezeReferenceFile,
  imageSelfTestParameters,
  imageSelfTestVerdict,
  inspectWav,
  localSpeechModelInfo,
  normalizeTranscript,
  planLocalVoice,
  resolveModelsEndpoint,
  selfTestMatches,
  selfTestSampleFile,
  separationSelfTestVerdict,
  sha256File,
  speechParameters,
  speechSelfTestRequest,
  speechSelfTestVerdict,
  validateAsrResult,
  type BundleDefinition,
  type InstallPlanDetail,
  type LocalVoicePlan,
  type ModelCatalog,
  type ModelInstallerOptions,
  type ModelChoice,
  type SelfTestSample,
  type TranscribeSink,
} from '@baocut/models';
import {
  RpcError,
  refOf,
  type FrozenSpeechReference,
  type Localized,
  type MessageRef,
  type Id,
  type JobPhase,
  type JobRecord,
  type JobSubmitter,
  type ModelBundleStatus,
  type ModelCheckCode,
  type ModelInstallResult,
  type ModelRemoveResult,
  type ModelSelfTestResult,
} from '@baocut/protocol';
import { RcModels } from '@baocut/protocol/messages/runtime-core';
import { localizedOf, taskFailure } from '../localized.ts';

/**
 * 本地模型包的安装管理（架构设计 §6.3、§7.9）：`models.install` / `repair` / `cancelInstall` / `remove` / `test`。
 *
 * - 安装与检查都是普通的任务（`kind: 'modelInstall'` / `'modelTest'`），不属于任何智能体任务：进度在 `jobs` 主题，模型包的
 *   状态（`downloading`、进度、`selfTest`）由模型目录经 `models` 主题的 `bundle.updated` 送出。
 * - 安装是两步：先返回计划与 `confirmBytes`，调用方原样交回才提交任务。安装任务排在一个串行队列里（一次装一个）；检查与
 *   这个模型包的转写排同一个队列（同一个 Worker）。
 * - 取消安装就是取消它的任务：暂存区保留（暂停），再次安装续传；`discard` 时删掉暂存区。
 * - 删除前确认没有任务在用这个模型包（排队或进行中的转写、检查、安装），Worker 空闲时先卸载；删除后没有出厂默认的能力里
 *   指向它的默认值一并清掉。
 */

const INSTALL_QUEUE = { key: 'models:install', concurrency: 1 };
/** 下载进度最多每这么久报一次（`jobs` 与 `models` 主题）。 */
const PROGRESS_INTERVAL_MS = 250;

export interface ModelInstallServiceOptions {
  catalog: ModelCatalog;
  provider: LocalTranscribeProvider;
  jobs: JobManager;
  log: Logger;
  /** 设置里的下载来源与严格离线。 */
  settings: () => { downloadEndpoint: string | null; offlineStrict: boolean };
  /** 读 `BAOCUT_MODELS_ENDPOINT` 的环境，默认 `process.env`。 */
  env?: NodeJS.ProcessEnv;
  /** 下载器的调节项（测试注入本机的假服务、可用空间与内置清单）。 */
  installer?: Omit<ModelInstallerOptions, 'catalog' | 'endpoint'>;
  /** 检查样本（测试可换）。 */
  selfTestSample?: SelfTestSample;
  /** 模型包变化之后重算能力视图。 */
  refresh: () => void;
  /** 删除模型包之后清掉没有出厂默认的能力里指向它的默认值（§6.8）。 */
  clearDefaults?: (bundleId: string) => Promise<unknown>;
}

export class ModelInstallService {
  readonly installer: ModelInstaller;
  readonly #options: ModelInstallServiceOptions;
  readonly #catalog: ModelCatalog;
  readonly #jobs: JobManager;
  readonly #log: Logger;
  readonly #sample: SelfTestSample;

  constructor(options: ModelInstallServiceOptions) {
    this.#options = options;
    this.#catalog = options.catalog;
    this.#jobs = options.jobs;
    this.#log = options.log.child('model-install');
    this.#sample = options.selfTestSample ?? TRANSCRIBE_SELF_TEST;
    this.installer = new ModelInstaller({
      ...options.installer,
      catalog: options.catalog,
      endpoint: () => this.#endpoint(),
    });
    // 安装任务结束（含排队时就被取消、Runtime 停止时中断）：回到按文件判断的状态。
    options.jobs.onChange((job) => {
      if (job.kind !== 'modelInstall' || !job.bundleId || !isTerminal(job.state)) return;
      if (this.#catalog.installState(job.bundleId)?.jobId === job.jobId) this.#catalog.setInstallState(job.bundleId, null);
      if (job.state === 'completed') this.#reloadAfterInstall(job.bundleId);
    });
  }

  /** 安装或修复：没有 `confirmBytes` 时只返回计划；交回的字节数与计划一致才提交任务。 */
  async install(
    params: { bundleId: string; confirmBytes?: number; commandId?: Id },
    submitter: JobSubmitter,
    options: { repair?: boolean } = {},
  ): Promise<ModelInstallResult> {
    const repair = options.repair ?? false;
    this.#definition(params.bundleId);
    if (params.commandId) {
      const existing = this.#jobs.jobForCommand(params.commandId);
      if (existing) return { plan: (await this.#plan(params.bundleId, repair)).plan, jobId: existing };
    }
    if (this.#options.settings().offlineStrict) {
      throw new RpcError('conflict', RcModels.offlineStrict(), { code: 'OFFLINE_STRICT' });
    }
    await this.#guardDir(true);
    const active = this.#activeInstall(params.bundleId);
    const detail = await this.#plan(params.bundleId, repair);
    if (active) return { plan: detail.plan, jobId: active.jobId };
    if (detail.plan.upToDate || params.confirmBytes === undefined) return { plan: detail.plan, jobId: null };
    if (params.confirmBytes !== detail.plan.confirmBytes) {
      throw new RpcError('conflict', RcModels.sizeChanged(), { code: 'MODEL_INSTALL_SIZE_CHANGED', plan: detail.plan });
    }
    const spec = { task: 'modelInstall' as const, bundleId: params.bundleId, repair, confirmBytes: detail.plan.confirmBytes };
    const hash = `sha256:${sha256Hex(canonicalJson({ ...spec, components: detail.plan.components }))}`;
    let jobId = '';
    ({ jobId } = this.#jobs.submitTask(
      {
        kind: 'modelInstall',
        spec,
        videoId: null,
        contentHash: hash,
        inputHash: hash,
        providerId: 'local',
        modelId: params.bundleId,
        bundleId: params.bundleId,
        ...(params.commandId ? { commandId: params.commandId } : {}),
        queue: INSTALL_QUEUE,
        // 峰值需求（§7.7）：还要下载的字节数进 staging。
        resources: { demand: modelDownloadDemand(detail.plan.confirmBytes) },
        run: (run) => this.#runInstall(run, detail),
      },
      submitter,
    ));
    if (this.#activeInstall(params.bundleId)?.jobId === jobId) {
      this.#catalog.setInstallState(params.bundleId, {
        jobId,
        state: 'queued',
        receivedBytes: detail.plan.resumedBytes,
        totalBytes: detail.totalBytes,
      });
    }
    this.#log.info('Model install submitted', { bundleId: params.bundleId, jobId, repair, confirmBytes: detail.plan.confirmBytes });
    return { plan: detail.plan, jobId };
  }

  /** 停下安装（取消它的任务）；`discard` 时删掉暂存区。 */
  async cancelInstall(params: { bundleId: string; discard?: boolean }): Promise<{ bundle: ModelBundleStatus }> {
    this.#definition(params.bundleId);
    const active = this.#activeInstall(params.bundleId);
    if (active) {
      await this.#jobs.cancel(active.jobId);
      await this.#jobs.settled(active.jobId).catch(() => {});
    }
    if (params.discard) {
      // 别的模型包正在安装、共用的组件不删。
      const busy = new Set(
        this.#jobs
          .list()
          .filter((j) => j.kind === 'modelInstall' && !isTerminal(j.state) && j.bundleId && j.bundleId !== params.bundleId)
          .flatMap((j) => Object.values(this.#catalog.definition(j.bundleId!)?.components ?? {}).map((s) => `${s.repo}@${s.revision}`)),
      );
      await this.installer.discard(params.bundleId, (source) => busy.has(`${source.repo}@${source.revision}`));
    }
    this.#options.refresh();
    return { bundle: (await this.#catalog.status(params.bundleId))! };
  }

  /** 删除模型包：在用时 `MODEL_IN_USE`；空闲的 Worker 先卸载；删除后清掉没有出厂默认的能力里指向它的默认值。 */
  async remove(bundleId: string): Promise<ModelRemoveResult> {
    this.#definition(bundleId);
    await this.#guardDir(false);
    const refuse = (jobIds: Id[]) => {
      throw new RpcError('conflict', RcModels.bundleInUse(), { code: 'MODEL_IN_USE', bundleId, jobIds });
    };
    // 「说话人区分」模型包的组件由用它的识别模型包的 Worker 加载：这些 Worker 也要空闲、先卸载。
    const holders = [bundleId, ...this.#catalog.diarizationUsers(bundleId)];
    const inUse = () => this.#jobs.list().filter((j) => holders.includes(j.bundleId ?? '') && !isTerminal(j.state));
    if (inUse().length > 0) refuse(inUse().map((j) => j.jobId));
    for (const holder of holders) if (!(await this.#options.provider.unload(holder))) refuse([]);
    if (inUse().length > 0) refuse(inUse().map((j) => j.jobId));
    const { removed, kept } = await this.installer.remove(bundleId);
    this.#log.info('Model package deleted', { bundleId, removed, kept: kept.map((k) => k.repo) });
    await this.#options.clearDefaults?.(bundleId);
    this.#options.refresh();
    return { removed, kept, bundle: (await this.#catalog.status(bundleId))! };
  }

  /**
   * 检查：固定样本走一遍完整的 Worker 流程。识别的模型包识别一段固定录音、核对文字；合成的模型包用默认声音合成一句固定的短句，
   * 核对输出能解码、时长合理、不是静音；文生图的模型包用固定的提示词与 seed 少步数生成一张小图，核对 PNG 能解码、尺寸对、
   * 不是纯色；分离的模型包把识别用的同一段录音（只有人声）分成两路，核对等长、人声明显比背景响（Model Worker 协议规范 §4.3）。
   */
  async test(params: { bundleId: string; commandId?: Id }, submitter: JobSubmitter): Promise<{ jobId: Id }> {
    const def = this.#definition(params.bundleId);
    if (def.capability === 'diarize') {
      throw new RpcError('unsupported', RcModels.diarizationNoCheck(), { bundleId: params.bundleId });
    }
    if (params.commandId) {
      const existing = this.#jobs.jobForCommand(params.commandId);
      if (existing) return { jobId: existing };
    }
    await this.#guardDir(false);
    const status = (await this.#catalog.status(params.bundleId))!;
    if (!bundleUsable(status)) throw new RpcError('conflict', RcModels.bundleUnavailable(), { code: 'MODEL_UNAVAILABLE', bundle: status });
    // 随应用分发的输入（识别与分离的样本、合成默认声音的内置音色录音）先在这里读一遍：缺了是安装不完整，以 `APP_FILE_MISSING` 拒绝，不建任务。
    let sampleFile: string | null = null;
    let contentHash: string;
    if (def.capability === 'synthesize') {
      await this.#speechTestInput(def);
      contentHash = `sha256:${sha256Hex(canonicalJson(speechSelfTestRequest(def)))}`;
    } else if (def.capability === 'image') {
      contentHash = `sha256:${sha256Hex(canonicalJson(IMAGE_SELF_TEST))}`;
    } else {
      sampleFile = selfTestSampleFile(this.#sample);
      const hex = sampleFile ? await sha256File(sampleFile).catch(() => null) : null;
      if (hex === null) throw appFileMissing(selfTestSampleLabel(), this.#sample.asset, sampleFile);
      contentHash = `sha256:${hex}`;
    }
    // 识别、分离与 candle 的合成按装好的组件估计 Model Worker 加载后的常驻量；MLX 的合成是 null（固定的需求）；文生图按模型包登记的实测峰值。
    const resources =
      def.capability === 'image'
        ? localImageResources(params.bundleId, this.#catalog.imagePeak(params.bundleId))
        : localTranscribeResources(params.bundleId, await this.#catalog.workerFootprint(params.bundleId));
    const spec = { task: 'modelTest' as const, bundleId: params.bundleId };
    return this.#jobs.submitTask(
      {
        kind: 'modelTest',
        spec,
        videoId: null,
        contentHash,
        inputHash: `sha256:${sha256Hex(canonicalJson({ ...spec, contentHash }))}`,
        providerId: 'local',
        modelId: params.bundleId,
        bundleId: params.bundleId,
        ...(params.commandId ? { commandId: params.commandId } : {}),
        // 与这个模型包的转写排同一个队列：同一个 Worker，一次一个任务。
        queue: { key: params.bundleId, concurrency: 1 },
        // 用这个模型包的 Model Worker（与转写共用 holder）；用户在界面上等着结果，按交互优先。
        resources: { ...resources, priority: 'interactive' },
        run: (run) =>
          def.capability === 'image'
            ? this.#runImageTest(run, def)
            : sampleFile === null
              ? this.#runSpeechTest(run, def)
              : def.capability === 'separate'
                ? this.#runSeparateTest(run, params.bundleId, sampleFile, contentHash)
                : this.#runTest(run, params.bundleId, sampleFile, contentHash),
      },
      submitter,
    );
  }

  /** Runtime 启动时：上次没跑完的安装任务已经标为 `interrupted`，暂存区留着（报告为暂停）。 */
  activeInstall(bundleId: string): JobRecord | null {
    return this.#activeInstall(bundleId);
  }

  async #runInstall(run: TaskRun, detail: InstallPlanDetail): Promise<NonNullable<JobRecord['result']>> {
    const bundleId = detail.plan.bundleId;
    let last = 0;
    let lastPhase: JobPhase | null = null;
    const report = (phase: JobPhase, received: number, total: number | null, force = false) => {
      const now = Date.now();
      if (!force && phase === lastPhase && now - last < PROGRESS_INTERVAL_MS) return;
      last = now;
      lastPhase = phase;
      run.phase(phase, { done: received, total, unit: 'bytes' });
      this.#catalog.setInstallState(bundleId, {
        jobId: run.jobId,
        state: phase === 'downloading' ? 'downloading' : 'verifying',
        receivedBytes: received,
        totalBytes: total,
      });
    };
    try {
      report('downloading', detail.plan.resumedBytes, detail.totalBytes, true);
      const outcome = await this.installer.install(detail, {
        signal: run.signal,
        onProgress: (p) =>
          report(p.phase === 'publishing' ? 'publishing' : 'downloading', p.receivedBytes, p.totalBytes, p.phase === 'publishing'),
      });
      run.phase('publishing', null);
      const { artifactId } = await this.#jobs.artifacts.put(
        Buffer.from(
          canonicalJson({
            schema: 'baocut.model-install/1',
            bundleId,
            repair: detail.repair,
            source: detail.endpoint,
            downloadedBytes: outcome.downloadedBytes,
            repos: outcome.published,
          }),
        ),
      );
      this.#log.info('Model install finished', { bundleId, jobId: run.jobId, downloadedBytes: outcome.downloadedBytes });
      return { documentId: null, artifactId };
    } catch (error) {
      if (run.signal.aborted) throw error;
      if (error instanceof DownloadError) {
        this.#log.warn('Model install failed', { bundleId, jobId: run.jobId, code: error.code });
        throw new TaskFailure(error.code, error.message, { ...error.details, remedy: error.remedy });
      }
      this.#log.error('Model install errored', { bundleId, jobId: run.jobId, error: String(error) });
      throw taskFailure('MODEL_INSTALL_FAILED', RcModels.installFailed(), { reason: String(error) });
    } finally {
      this.#catalog.setInstallState(bundleId, null);
      // 新的文件：清掉旧的校验结果与停用记录，重算能力视图。
      this.#catalog.enable(bundleId);
      this.#jobs.enable(bundleId);
      this.#options.refresh();
    }
  }

  async #runTest(run: TaskRun, bundleId: string, sampleFile: string, contentHash: string): Promise<NonNullable<JobRecord['result']>> {
    const { record, fail } = this.#verdicts(run, bundleId);
    const sink: TranscribeSink = {
      loading: () => run.phase('loading'),
      phase: (phase) => run.phase(phase),
      progress: (p) => run.phase(p.phase, { done: p.done, total: p.total, unit: p.unit }),
      segment: () => {},
      warning: () => {},
      language: () => {},
    };
    const staging = path.join(run.staging, 'attempt-1');
    await fs.mkdir(staging, { recursive: true });
    let attempt;
    try {
      attempt = await this.#options.provider.transcribe(
        {
          jobId: run.jobId,
          runGeneration: 1,
          providerId: 'local',
          modelId: bundleId,
          bundleId,
          input: { file: sampleFile, contentHash, track: 0 },
          options: { language: { mode: 'prefer', tag: this.#sample.language }, diarize: false, timescale: DEFAULT_TIMESCALE },
          staging,
        },
        sink,
        run.signal,
      );
    } catch (error) {
      // Worker 读不了随应用分发的样本：安装的问题，不记成模型检查没通过。
      if (error instanceof ProviderFailure && error.kind === 'input-unreadable') {
        throw appFileTaskFailure(appFileMissing(selfTestSampleLabel(), this.#sample.asset, sampleFile));
      }
      if (error instanceof ProviderFailure) return fail(providerCheckCode(error), RcModels.workerFailed({ reason: localizedOf(error) }), providerDetails(error));
      throw error;
    }
    if (attempt.outcome === 'cancelled') {
      run.signal.throwIfAborted();
      return fail('MODEL_WORKER_FAILED', RcModels.workerCancelledCheck());
    }
    run.phase('validating');
    const file = path.resolve(staging, attempt.output.path);
    const bytes = await fs.readFile(file).catch(() => null);
    if (!bytes) return fail('MODEL_OUTPUT_WRONG', RcModels.outputMissing());
    if (bytes.length !== attempt.output.byteLength || sha256Hex(bytes) !== attempt.output.sha256.replace(/^sha256:/, '')) {
      return fail('MODEL_OUTPUT_WRONG', RcModels.outputMismatch());
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      return fail('MODEL_OUTPUT_WRONG', RcModels.outputNotJson());
    }
    const validation = validateAsrResult(parsed, { runGeneration: 1 });
    if (!validation.ok) return fail('MODEL_OUTPUT_WRONG', RcModels.outputNotAsrResult(), { problems: validation.problems });
    const text = normalizeTranscript(validation.result.segments.map((s) => s.text).join(' '));
    if (!selfTestMatches(text, this.#sample)) {
      return fail('MODEL_OUTPUT_WRONG', RcModels.transcriptMissingExpected({ expected: this.#sample.expected }), {
        expected: this.#sample.expected,
        text: text.slice(0, 200),
      });
    }
    run.phase('publishing');
    const { artifactId } = await this.#jobs.artifacts.put(bytes);
    await record('passed', text.slice(0, 200));
    this.#log.info('Model check passed', { bundleId, jobId: run.jobId });
    return { documentId: null, artifactId };
  }

  async #runSeparateTest(
    run: TaskRun,
    bundleId: string,
    sampleFile: string,
    contentHash: string,
  ): Promise<NonNullable<JobRecord['result']>> {
    const { record, fail } = this.#verdicts(run, bundleId);
    const sample = inspectWav(await fs.readFile(sampleFile).catch(() => Buffer.alloc(0)));
    if (!sample.ok) throw appFileTaskFailure(appFileMissing(selfTestSampleLabel(), this.#sample.asset, sampleFile));
    const staging = path.join(run.staging, 'attempt-1');
    await fs.mkdir(staging, { recursive: true });
    run.phase('loading');
    let attempt;
    try {
      attempt = await this.#options.provider.separate(
        { bundleId, jobId: run.jobId, input: { file: sampleFile, contentHash, track: 0 }, sampleRate: null, staging },
        run.signal,
        (done, total) => run.phase('generating', { done, total, unit: 'steps' }),
      );
    } catch (error) {
      // Worker 读不了随应用分发的样本：安装的问题，不记成模型检查没通过。
      if (error instanceof ProviderFailure && error.kind === 'input-unreadable') {
        throw appFileTaskFailure(appFileMissing(selfTestSampleLabel(), this.#sample.asset, sampleFile));
      }
      if (error instanceof ProviderFailure) return fail(providerCheckCode(error), RcModels.workerFailed({ reason: localizedOf(error) }), providerDetails(error));
      throw error;
    }
    if (attempt.outcome === 'cancelled') {
      run.signal.throwIfAborted();
      return fail('MODEL_WORKER_FAILED', RcModels.workerCancelledCheck());
    }
    run.phase('validating');
    const stems = attempt.result.stems!;
    const bytes = { vocals: Buffer.alloc(0), background: Buffer.alloc(0) };
    for (const name of ['vocals', 'background'] as const) {
      const read = await fs.readFile(attempt[name]).catch(() => null);
      if (!read) return fail('MODEL_OUTPUT_WRONG', RcModels.namedOutputMissing({ file: path.basename(attempt[name]) }));
      if (read.length !== stems[name].byteLength || sha256Hex(read) !== stems[name].sha256.replace(/^sha256:/, '')) {
        return fail('MODEL_OUTPUT_WRONG', RcModels.namedOutputMismatch({ file: path.basename(attempt[name]) }));
      }
      bytes[name] = read;
    }
    const verdict = separationSelfTestVerdict(bytes, sample.wav.durationSec);
    if (!verdict.passed) return fail('MODEL_OUTPUT_WRONG', verdict.problem);
    run.phase('publishing');
    const { artifactId } = await this.#jobs.artifacts.put(bytes.vocals, 'wav');
    const ratio = verdict.background.rms > 0 ? 20 * Math.log10(verdict.vocals.rms / verdict.background.rms) : Infinity;
    const detail = RcModels.separationPassed({
      duration: verdict.vocals.durationSec.toFixed(2),
      sampleRate: verdict.vocals.sampleRate,
      ratio: Number.isFinite(ratio) ? ratio.toFixed(0) : '',
      finite: Number.isFinite(ratio),
    });
    await record('passed', detail);
    this.#log.info('Model check passed', { bundleId, jobId: run.jobId, detail: detail.text });
    return { documentId: null, artifactId };
  }

  async #runSpeechTest(run: TaskRun, def: BundleDefinition): Promise<NonNullable<JobRecord['result']>> {
    const bundleId = def.bundleId;
    const { record, fail } = this.#verdicts(run, bundleId);
    let input: SpeechTestInput;
    try {
      input = await this.#speechTestInput(def);
    } catch (error) {
      // 内置音色的录音在提交之后不见了：与提交时同样是 `APP_FILE_MISSING`，不记成模型检查没通过、也不算内部错误。
      if (error instanceof RpcError && (error.details as { code?: unknown } | undefined)?.code === APP_FILE_MISSING) {
        throw appFileTaskFailure(error);
      }
      throw error;
    }
    const { choice, request, plan, reference } = input;
    const parameters = speechParameters(choice, request, { plan, reference });

    const staging = path.join(run.staging, 'attempt-1');
    await fs.mkdir(staging, { recursive: true });
    run.phase('loading');
    let attempt;
    try {
      attempt = await this.#options.provider.synthesize(
        { jobId: run.jobId, attempt: 1, providerId: 'local', modelId: bundleId, parameters, staging },
        {
          generating: () => run.phase('generating'),
          progress: (done, total, unit = 'outputs') => run.phase('generating', { done, total, unit }),
        },
        run.signal,
      );
    } catch (error) {
      // 读不了内置音色的录音（本地 Provider 已经按 `APP_FILE_MISSING` 说明）：安装的问题，不记成模型检查没通过。
      if (error instanceof ProviderFailure && error.details.code === APP_FILE_MISSING) {
        throw new TaskFailure(APP_FILE_MISSING, error.message, { kind: error.kind, ...error.details, check: APP_FILE_MISSING });
      }
      if (error instanceof ProviderFailure) return fail(providerCheckCode(error), RcModels.workerFailed({ reason: localizedOf(error) }), providerDetails(error));
      throw error;
    }
    if (attempt.outcome === 'cancelled') {
      run.signal.throwIfAborted();
      return fail('MODEL_WORKER_FAILED', RcModels.workerCancelledCheck());
    }
    run.phase('validating');
    const output = attempt.outputs[0];
    if (!output) return fail('MODEL_OUTPUT_WRONG', RcModels.noWorkerOutput());
    const bytes = await fs.readFile(path.resolve(staging, output.path)).catch(() => null);
    if (!bytes) return fail('MODEL_OUTPUT_WRONG', RcModels.outputMissing());
    if (bytes.length !== output.byteLength || sha256Hex(bytes) !== output.sha256) {
      return fail('MODEL_OUTPUT_WRONG', RcModels.outputMismatch());
    }
    const verdict = speechSelfTestVerdict(bytes);
    if (!verdict.passed) return fail('MODEL_OUTPUT_WRONG', verdict.problem, verdict.wav ? { wav: verdict.wav } : {});
    run.phase('publishing');
    const { artifactId } = await this.#jobs.artifacts.put(bytes, 'wav');
    const { durationSec, sampleRate } = verdict.wav;
    await record('passed', RcModels.speechPassed({ duration: durationSec.toFixed(2), sampleRate }));
    this.#log.info('Model check passed', { bundleId, jobId: run.jobId, durationSec, sampleRate });
    return { documentId: null, artifactId };
  }

  async #runImageTest(run: TaskRun, def: BundleDefinition): Promise<NonNullable<JobRecord['result']>> {
    const bundleId = def.bundleId;
    const { record, fail } = this.#verdicts(run, bundleId);
    const staging = path.join(run.staging, 'attempt-1');
    await fs.mkdir(staging, { recursive: true });
    run.phase('loading');
    let attempt;
    try {
      attempt = await this.#options.provider.generateImage(
        { jobId: run.jobId, attempt: 1, providerId: 'local', modelId: bundleId, parameters: imageSelfTestParameters(), staging },
        {
          generating: () => run.phase('generating'),
          progress: (done, total, unit = 'outputs') => run.phase('generating', { done, total, unit }),
        },
        run.signal,
        { steps: IMAGE_SELF_TEST.steps },
      );
    } catch (error) {
      if (error instanceof ProviderFailure) return fail(providerCheckCode(error), RcModels.workerFailed({ reason: localizedOf(error) }), providerDetails(error));
      throw error;
    }
    if (attempt.outcome === 'cancelled') {
      run.signal.throwIfAborted();
      return fail('MODEL_WORKER_FAILED', RcModels.workerCancelledCheck());
    }
    run.phase('validating');
    const output = attempt.outputs[0];
    if (!output) return fail('MODEL_OUTPUT_WRONG', RcModels.noWorkerOutput());
    const bytes = await fs.readFile(path.resolve(staging, output.path)).catch(() => null);
    if (!bytes) return fail('MODEL_OUTPUT_WRONG', RcModels.outputMissing());
    if (bytes.length !== output.byteLength || sha256Hex(bytes) !== output.sha256) {
      return fail('MODEL_OUTPUT_WRONG', RcModels.outputMismatch());
    }
    const verdict = imageSelfTestVerdict(bytes);
    if (!verdict.passed) return fail('MODEL_OUTPUT_WRONG', verdict.problem, verdict.png ? { png: verdict.png } : {});
    run.phase('publishing');
    const { artifactId } = await this.#jobs.artifacts.put(bytes, 'png');
    const { width, height } = verdict.png;
    await record('passed', RcModels.imagePassed({ width, height, steps: IMAGE_SELF_TEST.steps }));
    this.#log.info('Model check passed', { bundleId, jobId: run.jobId, width, height });
    return { documentId: null, artifactId };
  }

  /**
   * 检查的两种结论：`record` 记下通过；`fail` 记下没通过（`code` 与 `facts` 一并记进模型包的 `selfTest`），任务以
   * `MODEL_SELF_TEST_FAILED` 失败，`details.check` 是同一个代码（命令与协议规范 §11.3）。
   */
  #verdicts(run: TaskRun, bundleId: string) {
    const save = async (result: ModelSelfTestResult) => {
      await this.installer.recordSelfTest(bundleId, result).catch((error: unknown) => {
        this.#log.error('Writing the check result failed', { bundleId, error: String(error) });
      });
    };
    const record = (state: 'passed', detail: string | Localized) =>
      save({ state, jobId: run.jobId, at: new Date().toISOString(), ...detailFields(detail) });
    const fail = async (code: ModelCheckCode, message: string | Localized, details: Record<string, unknown> = {}): Promise<never> => {
      const facts = checkFacts(details);
      await save({
        state: 'failed',
        jobId: run.jobId,
        at: new Date().toISOString(),
        ...detailFields(message),
        code,
        ...(facts.length ? { facts } : {}),
      });
      const failure = new TaskFailure('MODEL_SELF_TEST_FAILED', String(message), { ...details, check: code, facts });
      throw typeof message === 'string' ? failure : Object.assign(failure, { messageRef: refOf(message) });
    };
    return { record, fail };
  }

  /** 合成检查的输入，与正式提交同一条冻结路径：模型的默认声音，内置音色的录音按摘要冻结（读不出来时 `APP_FILE_MISSING`）。 */
  async #speechTestInput(def: BundleDefinition): Promise<SpeechTestInput> {
    const request = speechSelfTestRequest(def);
    const status = (await this.#catalog.status(def.bundleId))!;
    const model = localSpeechModelInfo(def, status, true);
    const choice: ModelChoice<'synthesizeSpeech'> = {
      capability: 'synthesizeSpeech',
      providerId: 'local',
      modelId: def.bundleId,
      kind: 'local',
      label: model.label,
      source: 'explicit',
      model,
    };
    const plan = planLocalVoice(choice, request);
    const builtin = builtinReferenceFile(model, plan);
    const withTranscript = model.local?.reference?.acceptsTranscript ?? false;
    const reference = builtin ? await freezeReferenceFile({ ...builtin, transcript: withTranscript ? builtin.transcript : null }) : null;
    return { choice, request, plan, reference };
  }

  async #plan(bundleId: string, repair: boolean): Promise<InstallPlanDetail> {
    try {
      return await this.installer.plan(bundleId, { repair });
    } catch (error) {
      if (error instanceof DownloadError) {
        throw new RpcError('conflict', error.message, { code: error.code, remedy: error.remedy, ...error.details });
      }
      throw error;
    }
  }

  /**
   * 模型目录在移动时（`models.setDir` 的 `move`）不装、不删、不检查：`MODEL_IN_USE`。要写入时（安装、修复）目录还得在：
   * 外置盘没接上时不在别处凭空建出同名的目录（`MODELS_DIR_MISSING`）。
   */
  async #guardDir(write: boolean): Promise<void> {
    const move = this.#jobs.list().find((j) => j.kind === 'modelsMove' && !isTerminal(j.state));
    if (move) {
      throw new RpcError('conflict', RcModels.movingDirWait(), { code: 'MODEL_IN_USE', jobIds: [move.jobId] });
    }
    if (write && !(await fs.stat(this.#catalog.root).catch(() => null))?.isDirectory()) {
      throw new RpcError('conflict', RcModels.dirMissing(), {
        code: 'MODELS_DIR_MISSING',
      });
    }
  }

  #activeInstall(bundleId: string): JobRecord | null {
    return this.#jobs.list().find((j) => j.kind === 'modelInstall' && j.bundleId === bundleId && !isTerminal(j.state)) ?? null;
  }

  #endpoint(): string {
    try {
      return resolveModelsEndpoint(this.#options.env ?? process.env, this.#options.settings().downloadEndpoint).endpoint;
    } catch (error) {
      throw new RpcError('invalid-request', (error as Error).message, { code: 'MODEL_DOWNLOAD_SOURCE' });
    }
  }

  /**
   * 装好、补齐或修好之后，已经加载的 Worker 还是旧的组件：这个模型包自己的（补上的可选组件、换掉的坏文件都没读到），以及用这个「说话人区分」
   * 模型包的识别模型包（没有它的组件）。空闲的先卸载，下一个任务重新加载时带上。正在跑任务的不打断（按原来的组件跑完，缺「说话人区分」的
   * 报 `diarization-unavailable`），空闲后照常按超时卸载。
   */
  #reloadAfterInstall(bundleId: string): void {
    for (const id of [bundleId, ...this.#catalog.diarizationUsers(bundleId)]) {
      void this.#options.provider
        .unload(id)
        .catch((error: unknown) => this.#log.warn('Unloading the model package failed', { bundleId: id, error: String(error) }));
    }
  }

  #definition(bundleId: string): BundleDefinition {
    const def = this.#catalog.definition(bundleId);
    if (!def) throw new RpcError('not-found', RcModels.noSuchBundle({ bundleId }));
    return def;
  }
}

/** 检查样本在错误里叫什么（给人看，按当前语言）。 */
function selfTestSampleLabel(): string {
  return RcModels.selfTestSampleLabel().text;
}

/** 检查结论的说明：Runtime 的文案连同引用一起记下，别的（识别出的文字、模型包给的原因）只记文字。 */
function detailFields(detail: string | Localized): { detail: string; detailRef?: MessageRef } {
  return typeof detail === 'string' ? { detail } : { detail: detail.text, detailRef: refOf(detail) };
}

interface SpeechTestInput {
  choice: ModelChoice<'synthesizeSpeech'>;
  request: ReturnType<typeof speechSelfTestRequest>;
  plan: LocalVoicePlan;
  reference: FrozenSpeechReference | null;
}

/** 执行中发现随应用分发的文件读不出来：任务以 `APP_FILE_MISSING` 失败，说明与 `details` 照搬提交时的那句。 */
function appFileTaskFailure(error: RpcError): TaskFailure {
  const failure = new TaskFailure(APP_FILE_MISSING, error.message, {
    ...(error.details as Record<string, unknown> | undefined),
    check: APP_FILE_MISSING,
  });
  return error.messageRef ? Object.assign(failure, { messageRef: error.messageRef }) : failure;
}

/**
 * Worker 那一侧的失败 → 检查没通过的原因：加载时报文件缺失或损坏（`MODEL_NOT_INSTALLED`）是模型文件的问题，报资源不足
 * （`MODEL_RESOURCE`）是内存不够，响应不合协议按输出不对，其余（起不来、中途退出、不支持、被停用）是 Worker 的问题。
 */
export function providerCheckCode(error: ProviderFailure): ModelCheckCode {
  const reason = error.details.reason;
  if (error.kind === 'load-failed' && reason === 'not-installed') return 'MODEL_FILES_DAMAGED';
  if (error.kind === 'load-failed' && reason === 'resource') return 'MODEL_OUT_OF_MEMORY';
  if (error.kind === 'protocol') return 'MODEL_OUTPUT_WRONG';
  return 'MODEL_WORKER_FAILED';
}

function providerDetails(error: ProviderFailure): Record<string, unknown> {
  return { kind: error.kind, ...error.details };
}

/** 技术详情里不放的：进程的 stderr（可能带本机路径）与本机的绝对路径。 */
const FACT_SKIP = new Set(['stderrTail', 'staging']);
/** 值里夹着的本机路径：macOS / Linux 的常见根，或 Windows 的盘符路径。 */
const LOCAL_PATH = /(^|[\s"'(])(\/(Users|home|private|var|tmp|Volumes)\/|[A-Za-z]:\\)/;
const FACT_ORDER = ['kind', 'reason', 'workerCode', 'workerMessage', 'workerDetails', 'expected', 'text', 'problems', 'wav', 'png'];

/**
 * 失败的 `details` → 技术详情的几行（`key: value`）：给反馈问题用，记进安装记录，所以不放 stderr 与本机绝对路径；
 * 对象写成紧凑的 JSON，过长的截断。
 */
export function checkFacts(details: Record<string, unknown>): string[] {
  const keys = Object.keys(details)
    .filter((k) => !FACT_SKIP.has(k) && details[k] !== undefined && details[k] !== null)
    .sort((a, b) => rank(a) - rank(b));
  const lines: string[] = [];
  for (const key of keys) {
    const raw = details[key];
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (!value || path.isAbsolute(value) || LOCAL_PATH.test(value)) continue;
    lines.push(`${key}: ${value.length > 300 ? `${value.slice(0, 300)}…` : value}`);
  }
  return lines;
}

function rank(key: string): number {
  const i = FACT_ORDER.indexOf(key);
  return i < 0 ? FACT_ORDER.length : i;
}
