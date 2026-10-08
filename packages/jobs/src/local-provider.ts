import path from 'node:path';
import { JobsLocalProvider as L } from '@baocut/protocol/messages/jobs/local-provider.ts';
import { errorText, jobWarning, type JobText } from './job-text.ts';

import {
  BUILTIN_REFERENCE_LABEL,
  CRASH_CODES,
  IMAGE_OUTPUT_FILE,
  IMAGE_PNG_CONTRACT,
  OUTPUT_WRITE_FAILED,
  ProviderFailure,
  appFileMissing,
  referenceUnreadableMessage,
  SPEAKERS_CONTRACT,
  SPEAKERS_OUTPUT_FILE,
  SPEECH_COMPONENTS,
  SPEECH_OUTPUT_FILE,
  SPEECH_WAV_CONTRACT,
  STEM_OUTPUT_FILES,
  STEMS_WAV_CONTRACT,
  WORKER_CONTRACT_VERSION,
  ASR_RESULT_SCHEMA,
  imageRunOf,
  sha256File,
  synthesizeRunOf,
  type DroppedReading,
  type GenerationAttempt,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSink,
  type DiarizeRunResult,
  type ImageRunResult,
  type JobOutput,
  type JobRunParams,
  type JobRunResult,
  type ModelCatalog,
  type ModelLoadResult,
  type SeparateRunResult,
  type SynthesizeRunResult,
  type TranscribeAttempt,
  type TranscribeJobPhase,
  type TranscribeProvider,
  type TranscribeRun,
  type TranscribeSink,
  type WorkerEventParams,
  type WorkerHello,
} from '@baocut/models';
import {
  JsonLineWorker,
  WorkerExitedError,
  WorkerRequestError,
  WorkerSpawnError,
  WorkerTimeoutError,
  type WorkerEvent,
  type WorkerExit,
} from '@baocut/process-host';
import type { JobWarning } from '@baocut/protocol';
import { silentLog, type JobsLogger } from './jobs-logger.ts';
import { modelWorkerHolder } from './resource-profiles.ts';

/**
 * 本地 Provider：按模型包管理 Model Worker 进程（架构设计 §6.5）。
 *
 * - 一个模型包最多一个进程，按需启动：`worker.hello`（5 秒）→ `model.load`（不限时）→ `job.run`；
 *   一个进程一次只跑一个任务（排队在 JobManager）。
 * - 空闲 `idleMs`（默认 10 分钟）后 `model.unload` 再关 stdin；下一个任务等它真的退出后再起新进程。
 * - 取消：`job.cancel`，期限（默认 5 秒）内 `job.run` 没有以 `cancelled` 返回就结束进程；进程下次按需再起。
 * - 崩溃：任务进行中进程退出，或 `job.run` 返回 `WORKER_PANIC` / `INFERENCE_FAILED` / `DECODE_FAILED`，
 *   计一次崩溃；`crashWindowMs` 内达到 `crashLimit` 次就停用模型包（`error` / `resource`），直到 `enable`。
 *   输出写不进 staging（`OUTPUT_WRITE_FAILED`）是磁盘的问题，是 `output-unwritable`，不计崩溃。
 * - 加载失败（`MODEL_NOT_INSTALLED` / `MODEL_UNSUPPORTED` / `MODEL_RESOURCE`）记到模型目录，不重试。
 * - 资源（§7.7）：进程从启动起持有这个模型包在调度里的 holder 的一份，进程真的退出后才归还；空闲时被要求让位就卸载模型包。
 * - 识别（`transcribe`）、本地语音合成（`synthesize`，经 `speechGenerator()`）与本地文生图（`image`，经 `imageGenerator()`）
 *   共用同一套进程管理。识别的模型包要求 `worker.hello` 报告 `transcribe` 且 `transcribeFamilies` 列出它的 `asr` family，
 *   合成的模型包要求报告 `synthesize` 且 `synthesizeFamilies` 列出它的 `tts` family，文生图的模型包要求报告 `image` 且
 *   `imageFamilies` 列出它的 `image` family，否则是 `load-failed`（`unsupported` / `capability-missing`），不发
 *   `model.load`，也不停用模型包（换了 Worker 就能用）。
 * - 人声分离（`separate`，经 `separate()`，翻译配音的分离一步直接调用）同样共用：分离的模型包（只带 `separator` 组件）要求
 *   报告 `separate` 且 `separateFamilies` 列出它的 family，规则同上。
 * - 已有转写的说话人区分（`diarize`，经 `diarize()`，识别说话人的流程直接调用）同样共用：「说话人区分」模型包单独加载（只带
 *   `segmentation` 与 `speaker` 组件），要求报告 `diarize`，规则同上。
 * - 合成结果的 `readingsDropped`（念不了的读音标注）逐条转成任务的 `reading-dropped` 警告，不静默丢弃。
 */

/** 进程持有资源调度里的 holder（`ResourceScheduler.retain`）。 */
export interface ProcessResources {
  retain(holder: string, evict?: () => void): (() => void) | null;
}

export interface LocalProviderOptions {
  catalog: ModelCatalog;
  /** Worker 可执行文件；null 表示本地推理不可用。 */
  command: () => { command: string; args?: readonly string[] } | null;
  /** 启动 Worker 的环境（登录 shell 的 PATH，与 Engine Host 相同）。 */
  env: () => Promise<NodeJS.ProcessEnv>;
  log?: JobsLogger;
  idleMs?: number;
  cancelGraceMs?: number;
  helloTimeoutMs?: number;
  closeGraceMs?: number;
  crashLimit?: number;
  crashWindowMs?: number;
  /** 资源调度：不给时进程不计入（单独使用、测试）。 */
  resources?: ProcessResources;
}

interface Loaded {
  worker: JsonLineWorker;
  hello: WorkerHello;
}

interface ActiveJob {
  jobId: string;
  /** 这个任务的 Worker 事件（`job.*`）。 */
  route(event: WorkerEventParams): void;
}

/** 一次 `job.run`：Worker 以 `cancelled` 返回或在途被取消，或者完成（输出已核对不为空）。 */
type RunOutcome<R, O = JobOutput> =
  { outcome: 'cancelled'; workerVersion: string | null } | { outcome: 'completed'; result: R; output: O; workerVersion: string };

/** 本地人声分离的一次调用（`job.run` 的 `separate`，Model Worker 协议规范 §2.5.4）。 */
export interface LocalSeparateRun {
  bundleId: string;
  jobId: string;
  /** 整段输入：文件的绝对路径与内容摘要，`track` 是第几条音轨。 */
  input: { file: string; contentHash: string; track: number };
  /** 输出的采样率；null 为模型的工作采样率。 */
  sampleRate: number | null;
  /** 输出写在这里（绝对路径，已存在的目录）。 */
  staging: string;
}

export type LocalSeparateOutcome =
  { outcome: 'cancelled' } | { outcome: 'completed'; vocals: string; background: string; result: SeparateRunResult; workerVersion: string };

/** 已有转写的说话人区分的一次调用（`job.run` 的 `diarize`，Model Worker 协议规范 §2.5.5）。 */
export interface LocalDiarizeRun {
  bundleId: string;
  jobId: string;
  input: { file: string; contentHash: string; track: number };
  /** 转写的词在素材时间上的起止（`timescale` 下的刻度），按转写里的次序。 */
  timescale: number;
  words: Array<[number, number]>;
  staging: string;
}

export type LocalDiarizeOutcome =
  { outcome: 'cancelled' } | { outcome: 'completed'; file: string; sha256: string; result: DiarizeRunResult; workerVersion: string };

interface RunSpec {
  bundleId: string | null;
  jobId: string;
  route(event: WorkerEventParams): void;
  loading(): void;
  expectedWorkerVersion?: string | undefined;
  params: JobRunParams;
  /** `INPUT_UNREADABLE` 时的说明（识别的素材、合成的参考录音）。 */
  inputLabel: JobText;
  /** `INPUT_UNREADABLE` 时并进 `details` 的内容（内置音色的录音读不出来时带 `code: 'APP_FILE_MISSING'`）。 */
  inputDetails?: Record<string, unknown>;
}

interface Slot {
  bundleId: string;
  loaded: Loaded | null;
  acquiring: Promise<Loaded> | null;
  /** 空闲卸载或取消时结束的进程：新进程要等它真的退出。 */
  retiring: Promise<unknown> | null;
  job: ActiveJob | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  crashes: number[];
}

const LOAD_REASON: Record<string, { state: 'not-installed' | 'error'; reason: 'load-failed' | 'unsupported' | 'resource'; label: string }> =
  {
    MODEL_NOT_INSTALLED: { state: 'not-installed', reason: 'load-failed', label: 'not-installed' },
    MODEL_UNSUPPORTED: { state: 'error', reason: 'unsupported', label: 'unsupported' },
    MODEL_RESOURCE: { state: 'error', reason: 'resource', label: 'resource' },
  };

export class LocalTranscribeProvider implements TranscribeProvider {
  readonly id = 'local';
  readonly #options: LocalProviderOptions;
  readonly #catalog: ModelCatalog;
  readonly #log: JobsLogger;
  readonly #slots = new Map<string, Slot>();
  readonly #idleMs: number;
  readonly #cancelGraceMs: number;
  readonly #helloTimeoutMs: number;
  readonly #closeGraceMs: number;
  readonly #crashLimit: number;
  readonly #crashWindowMs: number;
  #closed = false;

  constructor(options: LocalProviderOptions) {
    this.#options = options;
    this.#catalog = options.catalog;
    this.#log = options.log ?? silentLog;
    this.#idleMs = options.idleMs ?? 10 * 60_000;
    this.#cancelGraceMs = options.cancelGraceMs ?? 5_000;
    this.#helloTimeoutMs = options.helloTimeoutMs ?? 5_000;
    this.#closeGraceMs = options.closeGraceMs ?? 5_000;
    this.#crashLimit = options.crashLimit ?? 3;
    this.#crashWindowMs = options.crashWindowMs ?? 5 * 60_000;
  }

  /** 测试与诊断：某个模型包的 Worker 进程号。 */
  workerPid(bundleId: string): number | null {
    return this.#slots.get(bundleId)?.loaded?.worker.pid ?? null;
  }

  enable(bundleId: string): void {
    const slot = this.#slots.get(bundleId);
    if (slot) slot.crashes = [];
  }

  /**
   * 卸载一个模型包（删除模型包之前，架构设计 §6.3）：空闲的 Worker 按 `model.unload` 正常退出，等它真的退出。
   * 正在执行任务时不动它，返回 false；没有任务、只是还在加载（任务在加载时被取消）时等加载结束再卸载。
   */
  async unload(bundleId: string): Promise<boolean> {
    const slot = this.#slots.get(bundleId);
    if (!slot) return true;
    if (slot.job) return false;
    if (slot.acquiring) await slot.acquiring.catch(() => {});
    if (slot.job) return false;
    this.#clearIdle(slot);
    const loaded = slot.loaded;
    if (loaded) await this.#retire(slot, loaded.worker, 'unload');
    await slot.retiring;
    return true;
  }

  async transcribe(run: TranscribeRun, sink: TranscribeSink, signal: AbortSignal): Promise<TranscribeAttempt> {
    const outcome = await this.#run<JobRunResult>(
      {
        bundleId: run.bundleId,
        jobId: run.jobId,
        loading: () => sink.loading(),
        route: (event) => routeTranscribe(sink, event),
        expectedWorkerVersion: run.expectedWorkerVersion,
        params: {
          jobId: run.jobId,
          runGeneration: run.runGeneration,
          capability: 'transcribe',
          input: run.input,
          options: run.options,
          staging: run.staging,
          outputContract: ASR_RESULT_SCHEMA,
        },
        inputLabel: L.assetUnreadable(),
      },
      signal,
    );
    if (outcome.outcome === 'cancelled') return outcome;
    return { outcome: 'completed', output: outcome.output, workerVersion: outcome.workerVersion };
  }

  /**
   * 本地语音合成的一次尝试（架构设计 §6.1、§6.5）：冻结的参数换成 `job.run`（`synthesize`），输出是 staging 里的 WAV，
   * 由 JobManager 按生成任务的规则校验与发布。参考录音在执行前按提交时的摘要再核对一次，变了就不合成（不换声音）。
   */
  async synthesize(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    const parameters = run.parameters;
    if (parameters.capability !== 'synthesizeSpeech') {
      throw new ProviderFailure('protocol', L.notHandled({ capability: parameters.capability }));
    }
    if (signal.aborted) return { outcome: 'cancelled' };
    const { input, options } = synthesizeRunOf(parameters);
    // 读不出来时：内置音色的录音是安装不完整（`APP_FILE_MISSING`），请求给出的文件说出文件名。
    const unreadable = input
      ? parameters.reference?.source === 'builtin'
        ? builtinUnreadable(input.file)
        : { message: referenceUnreadableMessage(input.file), details: { file: input.file } }
      : null;
    if (input && unreadable) {
      const actual = await sha256File(input.file).catch(() => null);
      if (actual === null) throw new ProviderFailure('input-unreadable', unreadable.message, unreadable.details);
      if (`sha256:${actual}` !== input.contentHash) {
        throw new ProviderFailure('input-unreadable', L.referenceChanged(), { file: input.file, expected: input.contentHash });
      }
    }
    const outcome = await this.#run<SynthesizeRunResult>(
      {
        bundleId: run.modelId,
        jobId: run.jobId,
        loading: () => {},
        route: (event) => routeSynthesize(sink, event),
        params: {
          jobId: run.jobId,
          runGeneration: run.attempt,
          capability: 'synthesize',
          input,
          options,
          staging: run.staging,
          outputContract: SPEECH_WAV_CONTRACT,
        },
        inputLabel: unreadable?.message ?? L.referenceUnreadable(),
        ...(unreadable ? { inputDetails: unreadable.details } : {}),
      },
      signal,
    );
    if (outcome.outcome === 'cancelled') return { outcome: 'cancelled' };
    for (const dropped of outcome.result.readingsDropped ?? []) sink.warning?.(readingDropped(dropped));
    const output = outcome.output;
    // Worker 报告绝对路径（与识别相同）；生成任务的输出是相对 staging 的路径，且只能是 `speech.wav`。
    const relative = path.relative(run.staging, path.resolve(run.staging, output.path));
    if (relative !== SPEECH_OUTPUT_FILE) {
      throw new ProviderFailure('protocol', L.speechOutputWrong({ file: SPEECH_OUTPUT_FILE }), { path: output.path });
    }
    return {
      outcome: 'completed',
      outputs: [{ path: relative, sha256: output.sha256.replace(/^sha256:/, ''), byteLength: output.byteLength, mediaType: 'audio/wav' }],
      workerVersion: outcome.workerVersion,
    };
  }

  /**
   * 本地人声分离（架构设计 §6.1 `separateAudio`）：整段输入分成人声与背景，两个 WAV 写在 `run.staging` 里。
   * 输出必须正好是 staging 里的 `vocals.wav` 与 `background.wav`，否则是协议错误。
   */
  async separate(
    run: LocalSeparateRun,
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<LocalSeparateOutcome> {
    const outcome = await this.#runWith<SeparateRunResult, NonNullable<SeparateRunResult['stems']>>(
      {
        bundleId: run.bundleId,
        jobId: run.jobId,
        loading: () => {},
        route: (event) => {
          if (event.event === 'job.progress' && event.params.phase === 'separating' && event.params.total !== null) {
            onProgress?.(event.params.done, event.params.total);
          }
        },
        params: {
          jobId: run.jobId,
          runGeneration: 1,
          capability: 'separate',
          input: run.input,
          options: { sampleRate: run.sampleRate },
          staging: run.staging,
          outputContract: STEMS_WAV_CONTRACT,
        },
        inputLabel: L.assetUnreadable(),
        inputDetails: { file: run.input.file },
      },
      signal,
      (result) => result.stems,
    );
    if (outcome.outcome === 'cancelled') return { outcome: 'cancelled' };
    const files = { vocals: '', background: '' };
    for (const name of ['vocals', 'background'] as const) {
      const file = path.resolve(run.staging, outcome.output[name].path);
      if (path.relative(run.staging, file) !== STEM_OUTPUT_FILES[name]) {
        throw new ProviderFailure('protocol', L.stemOutputWrong({ file: STEM_OUTPUT_FILES[name] }), {
          path: outcome.output[name].path,
        });
      }
      files[name] = file;
    }
    return { outcome: 'completed', ...files, result: outcome.result, workerVersion: outcome.workerVersion };
  }

  /**
   * 给已有转写区分说话人（架构设计 §6.6）：加载「说话人区分」模型包本身，词时间交给 Worker，结果是 staging 里的
   * `speakers.json`；不是它时是协议错误。`onProgress` 报告区分的窗口进度。
   */
  async diarize(
    run: LocalDiarizeRun,
    signal: AbortSignal,
    onProgress?: (done: number, total: number | null, phase: 'decoding' | 'diarizing' | 'finalizing') => void,
  ): Promise<LocalDiarizeOutcome> {
    const outcome = await this.#runWith<DiarizeRunResult, JobOutput>(
      {
        bundleId: run.bundleId,
        jobId: run.jobId,
        loading: () => {},
        route: (event) => {
          if (event.event === 'job.phase' && isDiarizePhase(event.params.phase)) onProgress?.(0, null, event.params.phase);
          if (event.event === 'job.progress' && isDiarizePhase(event.params.phase)) {
            onProgress?.(event.params.done, event.params.total, event.params.phase);
          }
        },
        params: {
          jobId: run.jobId,
          runGeneration: 1,
          capability: 'diarize',
          input: run.input,
          options: { timescale: run.timescale, words: run.words },
          staging: run.staging,
          outputContract: SPEAKERS_CONTRACT,
        },
        inputLabel: L.assetUnreadable(),
        inputDetails: { file: run.input.file },
      },
      signal,
      (result) => result.output,
    );
    if (outcome.outcome === 'cancelled') return { outcome: 'cancelled' };
    const file = path.resolve(run.staging, outcome.output.path);
    if (path.relative(run.staging, file) !== SPEAKERS_OUTPUT_FILE) {
      throw new ProviderFailure('protocol', L.speakersOutputWrong({ file: SPEAKERS_OUTPUT_FILE }), { path: outcome.output.path });
    }
    return {
      outcome: 'completed',
      file,
      sha256: outcome.output.sha256.replace(/^sha256:/, ''),
      result: outcome.result,
      workerVersion: outcome.workerVersion,
    };
  }

  /** 生成类能力的门面：`local` Provider 的 `synthesizeSpeech`。进程由识别的 Provider 一起关闭。 */
  speechGenerator(): GenerationProvider {
    return {
      id: this.id,
      generate: (run, sink, signal) => this.synthesize(run, sink, signal),
      close: async () => {},
    };
  }

  /**
   * 本地文生图的一次尝试（架构设计 §6.1、§6.5）：冻结的参数（尺寸与 seed 都在提交时决定）换成 `job.run`（`image`），输出是
   * staging 里的 `image.png`，由 JobManager 按生成任务的规则校验与发布。`steps` 只有模型包自检会给。
   */
  async generateImage(
    run: GenerationRun,
    sink: GenerationSink,
    signal: AbortSignal,
    options: { steps?: number | null } = {},
  ): Promise<GenerationAttempt> {
    const parameters = run.parameters;
    if (parameters.capability !== 'generateImage') {
      throw new ProviderFailure('protocol', L.notHandled({ capability: parameters.capability }));
    }
    if (signal.aborted) return { outcome: 'cancelled' };
    const outcome = await this.#run<ImageRunResult>(
      {
        bundleId: run.modelId,
        jobId: run.jobId,
        loading: () => {},
        route: (event) => routeImage(sink, event),
        params: {
          jobId: run.jobId,
          runGeneration: run.attempt,
          capability: 'image',
          options: imageRunOf(parameters, options.steps ?? null),
          staging: run.staging,
          outputContract: IMAGE_PNG_CONTRACT,
        },
        inputLabel: L.imageNoInput(),
      },
      signal,
    );
    if (outcome.outcome === 'cancelled') return { outcome: 'cancelled' };
    const output = outcome.output;
    const relative = path.relative(run.staging, path.resolve(run.staging, output.path));
    if (relative !== IMAGE_OUTPUT_FILE) {
      throw new ProviderFailure('protocol', L.imageOutputWrong({ file: IMAGE_OUTPUT_FILE }), { path: output.path });
    }
    return {
      outcome: 'completed',
      outputs: [{ path: relative, sha256: output.sha256.replace(/^sha256:/, ''), byteLength: output.byteLength, mediaType: 'image/png' }],
      workerVersion: outcome.workerVersion,
    };
  }

  /** 生成类能力的门面：`local` Provider 的 `generateImage`。进程由识别的 Provider 一起关闭。 */
  imageGenerator(): GenerationProvider {
    return {
      id: this.id,
      generate: (run, sink, signal) => this.generateImage(run, sink, signal),
      close: async () => {},
    };
  }

  async #run<R extends { outcome: 'completed' | 'cancelled'; output: JobOutput | null }>(
    spec: RunSpec,
    signal: AbortSignal,
  ): Promise<RunOutcome<R>> {
    return this.#runWith<R, JobOutput>(spec, signal, (result) => result.output);
  }

  /** `#run` 的一般形式：`outputOf` 取出完成结果里的输出，为 null 时是协议错误。 */
  async #runWith<R extends { outcome: 'completed' | 'cancelled' }, O>(
    spec: RunSpec,
    signal: AbortSignal,
    outputOf: (result: R) => O | null,
  ): Promise<RunOutcome<R, O>> {
    if (signal.aborted) return { outcome: 'cancelled', workerVersion: null };
    if (this.#closed) throw new ProviderFailure('unavailable', L.runtimeStopping());
    const bundleId = spec.bundleId;
    if (bundleId === null) throw new ProviderFailure('unavailable', L.bundleRequired());
    if (this.#catalog.blocked(bundleId)) {
      const status = await this.#catalog.status(bundleId);
      throw new ProviderFailure('unavailable', L.bundleDisabled(), { reason: status?.reason ?? 'resource', state: status?.state });
    }
    const slot = this.#slot(bundleId);
    if (slot.job) throw new ProviderFailure('crashed', L.workerBusy(), { reason: 'worker-busy' });
    this.#clearIdle(slot);
    slot.job = { jobId: spec.jobId, route: spec.route };

    let loaded: Loaded;
    try {
      const acquiring = this.#acquire(slot, spec.loading);
      const raced = await raceAbort(acquiring, signal);
      if (raced === ABORTED) {
        // 加载在后台继续：模型留在内存里，下一个任务直接用。
        slot.job = null;
        acquiring.then(
          () => this.#scheduleIdle(slot),
          () => {},
        );
        return { outcome: 'cancelled', workerVersion: null };
      }
      loaded = raced;
    } catch (error) {
      slot.job = null;
      throw error;
    }

    const { worker, hello } = loaded;
    if (spec.expectedWorkerVersion && hello.workerVersion !== spec.expectedWorkerVersion) {
      slot.job = null;
      this.#scheduleIdle(slot);
      throw new ProviderFailure('version-changed', L.workerVersionChanged(), {
        expected: spec.expectedWorkerVersion,
        actual: hello.workerVersion,
      });
    }

    this.#catalog.setRuntimeState(slot.bundleId, 'busy');
    let killedForCancel = false;
    let cancelTimer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      worker.request('job.cancel', { jobId: spec.jobId }, { timeoutMs: this.#cancelGraceMs }).catch(() => {});
      cancelTimer = setTimeout(() => {
        killedForCancel = true;
        this.#log.warn('Cancellation timed out; killing Model Worker', { bundleId: slot.bundleId, jobId: spec.jobId });
        this.#retire(slot, worker, 'kill');
      }, this.#cancelGraceMs);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const result = await worker.request<R>('job.run', spec.params);
      if (result.outcome === 'cancelled') return { outcome: 'cancelled', workerVersion: hello.workerVersion };
      const output = outputOf(result);
      if (!output) throw new ProviderFailure('protocol', L.noOutput());
      return { outcome: 'completed', result, output, workerVersion: hello.workerVersion };
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      if (killedForCancel || (signal.aborted && error instanceof WorkerExitedError)) {
        return { outcome: 'cancelled', workerVersion: hello.workerVersion };
      }
      if (error instanceof WorkerExitedError) {
        this.#recordCrash(slot);
        throw new ProviderFailure('crashed', L.workerExitedDuringJob(), {
          exitCode: error.exit?.code ?? null,
          signal: error.exit?.signal ?? null,
          stderrTail: worker.stderrTail(),
          workerVersion: hello.workerVersion,
        });
      }
      if (error instanceof WorkerRequestError) {
        const details = { workerCode: error.code, workerMessage: error.body.message, workerVersion: hello.workerVersion };
        if ((CRASH_CODES as readonly string[]).includes(error.code)) {
          this.#recordCrash(slot);
          throw new ProviderFailure('crashed', L.inferenceFailed({ code: error.code }), { ...details, stderrTail: worker.stderrTail() });
        }
        if (error.code === 'INPUT_UNREADABLE') {
          throw new ProviderFailure('input-unreadable', spec.inputLabel, { ...details, ...spec.inputDetails });
        }
        if (error.code === OUTPUT_WRITE_FAILED) {
          const file = (error.body.details as { file?: unknown } | undefined)?.file;
          throw new ProviderFailure('output-unwritable', L.stagingUnwritable(), {
            ...details,
            ...(typeof file === 'string' ? { file } : {}),
          });
        }
        const workerDetails = error.body.details !== undefined ? { workerDetails: error.body.details } : {};
        // 加载过的模型包却不支持这次任务（例如合成还没接上推理）：与加载失败同类，不重试，也不停用模型包。
        if (error.code === 'MODEL_UNSUPPORTED') {
          throw new ProviderFailure('load-failed', L.workerUnsupported({ message: error.body.message }), {
            reason: 'unsupported',
            ...details,
            ...workerDetails,
          });
        }
        throw new ProviderFailure('protocol', L.jobRunReturned({ code: error.code }), { ...details, ...workerDetails });
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (cancelTimer) clearTimeout(cancelTimer);
      slot.job = null;
      if (slot.loaded?.worker === worker && worker.alive) {
        this.#catalog.setRuntimeState(slot.bundleId, 'ready');
        this.#scheduleIdle(slot);
      }
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all(
      [...this.#slots.values()].map(async (slot) => {
        this.#clearIdle(slot);
        const loaded = slot.loaded ?? (await slot.acquiring?.catch(() => null)) ?? null;
        if (loaded) await this.#retire(slot, loaded.worker, 'close');
        await slot.retiring;
      }),
    );
  }

  // ---- 进程 ----

  #slot(bundleId: string): Slot {
    let slot = this.#slots.get(bundleId);
    if (!slot) {
      slot = { bundleId, loaded: null, acquiring: null, retiring: null, job: null, idleTimer: null, crashes: [] };
      this.#slots.set(bundleId, slot);
    }
    return slot;
  }

  #acquire(slot: Slot, loading: () => void): Promise<Loaded> {
    if (slot.loaded?.worker.alive) return Promise.resolve(slot.loaded);
    loading();
    slot.acquiring ??= this.#spawnAndLoad(slot).finally(() => {
      slot.acquiring = null;
    });
    return slot.acquiring;
  }

  async #spawnAndLoad(slot: Slot): Promise<Loaded> {
    // 在任何 await 之前、任务还拿着租约时持有 holder 的一份：任务在加载时被取消、先归还了租约，正在启动的进程照样计入。
    const share = this.#options.resources?.retain(modelWorkerHolder(slot.bundleId), () => void this.unload(slot.bundleId)) ?? null;
    let started = false;
    try {
      const loaded = await this.#startAndLoad(slot, (worker) => {
        started = true;
        // 进程真的退出（`close`）之后才归还。
        void worker.exited.then(() => share?.());
      });
      return loaded;
    } finally {
      if (!started) share?.();
    }
  }

  async #startAndLoad(slot: Slot, onStarted: (worker: JsonLineWorker) => void): Promise<Loaded> {
    await slot.retiring;
    const resolved = this.#options.command();
    if (!resolved) {
      throw new ProviderFailure('load-failed', L.workerNotFound(), { reason: 'worker-missing' });
    }
    this.#catalog.setRuntimeState(slot.bundleId, 'loading');
    let worker: JsonLineWorker;
    try {
      worker = await JsonLineWorker.start({
        command: resolved.command,
        args: [...(resolved.args ?? []), '--parent-pid', String(process.pid)],
        env: await this.#options.env(),
      });
    } catch (error) {
      this.#catalog.setRuntimeState(slot.bundleId, null);
      throw new ProviderFailure('load-failed', error instanceof WorkerSpawnError ? error.message : L.workerCannotStart(), {
        reason: 'worker-missing',
      });
    }
    onStarted(worker);
    const log = this.#log;
    worker.onEvent((event) => this.#onEvent(slot, event));
    worker.onExit((exit) => this.#onExit(slot, worker, exit));

    const fail = async (failure: ProviderFailure): Promise<never> => {
      await worker.kill().catch(() => {});
      if (!this.#catalog.blocked(slot.bundleId)) this.#catalog.setRuntimeState(slot.bundleId, null);
      throw failure;
    };

    let hello: WorkerHello;
    try {
      hello = await worker.request<WorkerHello>(
        'worker.hello',
        { contractVersion: WORKER_CONTRACT_VERSION },
        { timeoutMs: this.#helloTimeoutMs },
      );
    } catch (error) {
      if (error instanceof WorkerExitedError) {
        return fail(new ProviderFailure('crashed', L.workerExitedOnStart(), { stderrTail: worker.stderrTail() }));
      }
      const detail =
        error instanceof WorkerTimeoutError ? 'hello-timeout' : error instanceof WorkerRequestError ? error.code : 'hello-failed';
      return fail(new ProviderFailure('load-failed', L.handshakeFailed(), { reason: 'unsupported', detail }));
    }
    if (hello.contractVersion !== WORKER_CONTRACT_VERSION) {
      return fail(
        new ProviderFailure('load-failed', L.contractMismatch(), {
          reason: 'unsupported',
          detail: 'CONTRACT_MISMATCH',
          workerContract: hello.contractVersion,
        }),
      );
    }

    // 后端与设备以握手为准（架构设计 §6.5）：Worker 没编进或用不了这个后端时不去加载（也不停用模型包，换了 Worker 就能用）；
    // candle 与 GGML 用 Worker 报告的首选设备（有 CUDA 时是 `cuda`；GGML 另可能是 `vulkan`），并记进模型目录给状态显示。
    const def = this.#catalog.definition(slot.bundleId);
    const backend = def ? hello.backends?.find((b) => b.id === def.backend) : undefined;
    if (def && backend) this.#catalog.setWorkerDevice(def.backend, backend.available ? (backend.devices[0] ?? null) : null);
    if (def && backend && !backend.available) {
      return fail(
        new ProviderFailure('load-failed', L.backendUnavailable({ backend: def.backend }), {
          reason: 'unsupported',
          detail: 'backend-unavailable',
          backend: def.backend,
          ...(backend.reason ? { backendReason: backend.reason } : {}),
        }),
      );
    }
    const device = backend?.available ? backend.devices[0] : undefined;

    try {
      const bundle = await this.#catalog.bundleFor(
        slot.bundleId,
        device && (def?.backend === 'candle' || def?.backend === 'ggml') ? { device } : {},
      );
      // 合成的模型包要 Worker 声明 `synthesize` 且列出这个 family，分离的要声明 `separate` 且列出 `separator` 的 family，文生图的
      // 要声明 `image` 且列出 `image` 的 family，识别的要声明 `transcribe` 且列出 `asr` 的 family：不认识的 Worker 不去试
      // （`model.load` 的 `MODEL_UNSUPPORTED` 会停用模型包），也不停用模型包（换了 Worker 就能用）。
      if (bundle.components.separator) {
        const family = bundle.components.separator.family;
        const families = hello.separateFamilies ?? [];
        if (!hello.capabilities.includes('separate') || !families.includes(family)) {
          return fail(
            new ProviderFailure('load-failed', L.cannotSeparate(), {
              reason: 'unsupported',
              detail: 'capability-missing',
              family,
              capabilities: hello.capabilities,
              separateFamilies: families,
            }),
          );
        }
      } else if (bundle.components.image) {
        const family = bundle.components.image.family;
        const families = hello.imageFamilies ?? [];
        if (!hello.capabilities.includes('image') || !families.includes(family)) {
          return fail(
            new ProviderFailure('load-failed', L.cannotGenerateImage(), {
              reason: 'unsupported',
              detail: 'capability-missing',
              family,
              capabilities: hello.capabilities,
              imageFamilies: families,
            }),
          );
        }
      } else if (!bundle.components.asr && bundle.components.segmentation) {
        // 「说话人区分」模型包单独加载（给已有转写区分说话人，§2.5.5）。
        if (!hello.capabilities.includes('diarize')) {
          return fail(
            new ProviderFailure('load-failed', L.cannotDiarize(), {
              reason: 'unsupported',
              detail: 'capability-missing',
              family: bundle.components.segmentation.family,
              capabilities: hello.capabilities,
            }),
          );
        }
      } else if (!SPEECH_COMPONENTS.some((c) => bundle.components[c])) {
        const family = bundle.components.asr?.family ?? null;
        const families = hello.transcribeFamilies ?? [];
        if (!hello.capabilities.includes('transcribe') || family === null || !families.includes(family)) {
          return fail(
            new ProviderFailure('load-failed', L.cannotTranscribe(), {
              reason: 'unsupported',
              detail: 'capability-missing',
              family,
              capabilities: hello.capabilities,
              transcribeFamilies: families,
            }),
          );
        }
      } else {
        const family = bundle.components.tts?.family ?? null;
        const families = hello.synthesizeFamilies ?? [];
        if (!hello.capabilities.includes('synthesize') || family === null || !families.includes(family)) {
          return fail(
            new ProviderFailure('load-failed', L.cannotSynthesize(), {
              reason: 'unsupported',
              detail: 'capability-missing',
              family,
              capabilities: hello.capabilities,
              synthesizeFamilies: families,
            }),
          );
        }
      }
      const loadResult = await worker.request<ModelLoadResult>('model.load', { bundle });
      log.info('Model Worker loaded model bundle', {
        bundleId: slot.bundleId,
        pid: worker.pid,
        workerVersion: hello.workerVersion,
        ...loadResult,
      });
    } catch (error) {
      if (error instanceof WorkerRequestError) {
        const mapped = LOAD_REASON[error.code];
        if (mapped) this.#catalog.block(slot.bundleId, mapped.state, mapped.reason, error.body.message);
        return fail(
          new ProviderFailure('load-failed', L.loadFailed({ reason: error.code }), {
            reason: mapped?.label ?? 'error',
            workerCode: error.code,
            ...(error.body.details !== undefined ? { workerDetails: error.body.details } : {}),
          }),
        );
      }
      if (error instanceof WorkerExitedError) {
        this.#recordCrash(slot);
        return fail(new ProviderFailure('crashed', L.workerExitedOnLoad(), { stderrTail: worker.stderrTail() }));
      }
      return fail(new ProviderFailure('load-failed', L.loadFailed({ reason: errorText(error) }), { reason: 'not-installed' }));
    }

    this.#catalog.setRuntimeState(slot.bundleId, 'ready');
    const loaded = { worker, hello };
    slot.loaded = loaded;
    return loaded;
  }

  #onEvent(slot: Slot, event: WorkerEvent): void {
    const typed = event as WorkerEventParams;
    if (typed.event === 'model.phase') return;
    const job = slot.job;
    const params = typed.params as { jobId?: unknown };
    if (!job || params.jobId !== job.jobId) return;
    job.route(typed);
  }

  #onExit(slot: Slot, worker: JsonLineWorker, exit: WorkerExit): void {
    if (slot.loaded?.worker !== worker) return;
    slot.loaded = null;
    this.#clearIdle(slot);
    if (!this.#catalog.blocked(slot.bundleId)) this.#catalog.setRuntimeState(slot.bundleId, null);
    if (!exit.expected && !slot.job) this.#log.warn('Idle Model Worker exited', { bundleId: slot.bundleId, ...exit });
  }

  /** 让一个进程退出：先从槽位上摘下来，新任务等它真的退出后再起新进程（架构设计 §6.5「加载新的模型包之前」）。 */
  #retire(slot: Slot, worker: JsonLineWorker, how: 'kill' | 'unload' | 'close'): Promise<unknown> {
    if (slot.loaded?.worker === worker) slot.loaded = null;
    this.#clearIdle(slot);
    const done = (async () => {
      if (how === 'kill') return worker.kill();
      if (how === 'unload') {
        this.#catalog.setRuntimeState(slot.bundleId, 'unloading');
        await worker.request('model.unload', {}, { timeoutMs: this.#closeGraceMs }).catch(() => {});
      }
      return worker.close(this.#closeGraceMs);
    })().finally(() => {
      if (slot.retiring === done) slot.retiring = null;
      if (!slot.loaded && !slot.acquiring && !this.#catalog.blocked(slot.bundleId)) this.#catalog.setRuntimeState(slot.bundleId, null);
    });
    slot.retiring = done;
    return done;
  }

  #scheduleIdle(slot: Slot): void {
    this.#clearIdle(slot);
    if (this.#closed || slot.job || !slot.loaded) return;
    const worker = slot.loaded.worker;
    slot.idleTimer = setTimeout(() => {
      slot.idleTimer = null;
      if (slot.job || slot.loaded?.worker !== worker) return;
      this.#log.info('Model Worker idle; unloading model bundle', { bundleId: slot.bundleId, pid: worker.pid });
      void this.#retire(slot, worker, 'unload');
    }, this.#idleMs);
    slot.idleTimer.unref?.();
  }

  #clearIdle(slot: Slot): void {
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    slot.idleTimer = null;
  }

  #recordCrash(slot: Slot): void {
    const now = Date.now();
    slot.crashes = slot.crashes.filter((t) => now - t < this.#crashWindowMs);
    slot.crashes.push(now);
    this.#log.warn('Model Worker crashed', { bundleId: slot.bundleId, recent: slot.crashes.length });
    if (slot.crashes.length >= this.#crashLimit) {
      this.#log.error('Model Worker crashed repeatedly; disabling model bundle', { bundleId: slot.bundleId });
      this.#catalog.block(
        slot.bundleId,
        'error',
        'resource',
        L.crashedRepeatedly({ minutes: Math.round(this.#crashWindowMs / 60_000), count: slot.crashes.length }),
      );
      const loaded = slot.loaded;
      if (loaded) void this.#retire(slot, loaded.worker, 'kill');
    }
  }
}

const TRANSCRIBE_PHASES = new Set<string>(['decoding', 'vad', 'transcribing', 'aligning', 'diarizing', 'finalizing']);

function routeTranscribe(sink: TranscribeSink, event: WorkerEventParams): void {
  switch (event.event) {
    case 'job.phase':
      if (TRANSCRIBE_PHASES.has(event.params.phase)) sink.phase(event.params.phase as TranscribeJobPhase);
      return;
    case 'job.progress': {
      const { phase, done, total, unit } = event.params;
      if (TRANSCRIBE_PHASES.has(phase) && unit !== 'steps') sink.progress({ phase: phase as TranscribeJobPhase, done, total, unit });
      return;
    }
    case 'job.segment':
      return sink.segment(event.params.segment);
    case 'job.warning':
      return sink.warning(event.params.warning);
    case 'job.language':
      return sink.language(event.params.tag, event.params.confidence);
  }
}

/** 念不了的读音标注 → 任务警告。`detail` 只说位置与读音，不带文字本身。 */
function readingDropped(dropped: DroppedReading): JobWarning {
  const { reading, origin } = dropped;
  const detail =
    dropped.start + 1 === dropped.end
      ? L.readingDroppedOne({ at: dropped.end, reading, origin })
      : L.readingDroppedRange({ from: dropped.start + 1, to: dropped.end, reading, origin });
  return jobWarning('reading-dropped', detail);
}

/** 合成的事件：进入 `synthesizing` 就是生成阶段；合成阶段有总数的进度（步数）转给生成任务。 */
function routeSynthesize(sink: GenerationSink, event: WorkerEventParams): void {
  if (event.event === 'job.phase' && event.params.phase === 'synthesizing') sink.generating();
  else if (
    event.event === 'job.progress' &&
    event.params.phase === 'synthesizing' &&
    event.params.unit === 'steps' &&
    event.params.total !== null
  ) {
    sink.progress(event.params.done, event.params.total, 'steps');
  }
}

function routeImage(sink: GenerationSink, event: WorkerEventParams): void {
  if (event.event === 'job.phase' && event.params.phase === 'encoding-prompt') sink.generating();
  else if (
    event.event === 'job.progress' &&
    event.params.phase === 'denoising' &&
    event.params.unit === 'steps' &&
    event.params.total !== null
  ) {
    sink.progress(event.params.done, event.params.total, 'steps');
  }
}

const ABORTED = Symbol('aborted');

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** 内置音色的录音读不出来（提交之后被删、或在 Worker 读不到的位置）：与提交时同一句话与错误码（`APP_FILE_MISSING`）。 */
function builtinUnreadable(file: string): { message: JobText; details: Record<string, unknown> } {
  const error = appFileMissing(BUILTIN_REFERENCE_LABEL, null, file);
  return { message: errorText(error), details: error.details as Record<string, unknown> };
}

function isDiarizePhase(phase: string): phase is 'decoding' | 'diarizing' | 'finalizing' {
  return phase === 'decoding' || phase === 'diarizing' || phase === 'finalizing';
}
