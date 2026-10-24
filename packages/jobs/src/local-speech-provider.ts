import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  AUDIO_CPP_SPEECH_MODEL_ID,
  ProviderFailure,
  SPEECH_OUTPUT_FILE,
  appFileMissing,
  audioCppServerBackend,
  audioCppServerOf,
  audioCppSpeechRequestOf,
  BUILTIN_REFERENCE_LABEL,
  inspectWav,
  limitSpeechPeak,
  parseAudioCppVersion,
  referenceUnreadableMessage,
  sha256File,
  type DroppedReading,
  type GenerationAttempt,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSink,
  type ModelCatalog,
  type SpeechBundleProfile,
} from '@baocut/models';
import { ffmpegMissingRemedy, killProcessTree } from '@baocut/process-host';
import { JobsFfmpeg } from '@baocut/protocol/messages/jobs/ffmpeg.ts';
import { ModelsModelCatalog as MC } from '@baocut/protocol/messages/models/model-catalog.ts';
import { JobsLocalProvider as L } from '@baocut/protocol/messages/jobs/local-provider.ts';
import { errorText, jobWarning, type JobText } from './job-text.ts';
import { silentLog, type JobsLogger } from './jobs-logger.ts';
import { modelWorkerHolder } from './resource-profiles.ts';

/**
 * 本地语音合成的 Provider（架构设计 §6.1、§6.3、§6.5）：`synthesizeSpeech` 的 `local` 执行者。合成交给随应用分发的 audio.cpp
 * 引擎的常驻服务（`audiocpp_server`，与本地音乐共用一个引擎）：每个用到的模型包一个服务进程，只监听 127.0.0.1 的随机端口，配置里
 * 只有这一个模型、启动时就加载（第一次请求不再等加载）；空闲 `idleMs` 后退出，下次用时再起。
 *
 * - 引擎找不到时 `unavailable`（`MC.engineMissing`）：这台主机没有内置引擎（平台没有发布，或开发时还没下载）。
 * - 参考录音：执行前按提交时的摘要再核对一次，变了就失败（不换声音）；读不出来时内置音色的录音是安装不完整（`APP_FILE_MISSING`），
 *   请求给出的文件说出文件名。核对过的录音经 ffmpeg 转成 staging 里的单声道 16 位 WAV 再交给引擎（引擎只读 WAV）；模型对带原文的
 *   参考有时长上限（Fish S2 Pro 30 秒）时在这里检查。ffmpeg 找不到或起不来是 `tool-unavailable`（`MEDIA_TOOL_UNAVAILABLE`，
 *   带安装修法）：那是这台机器的外部工具问题，不是录音读不出来，也不说成安装不完整。
 * - 进度：引擎不报告进度，服务就绪、请求发出后只有不定进度；完成时报 1/1。
 * - 取消：服务不能中途停下一次合成，取消就结束这个服务进程（整个进程组），下次再起。
 * - 输出：引擎的 WAV 过一遍峰值上限（−1 dBFS，`limitSpeechPeak`）写成 staging 里的 `speech.wav`；读音标注按模型包的能力渲染，
 *   没念的逐条记 `reading-dropped` 警告。
 * - 失败：服务起不来、启动时退出是 `load-failed`（带输出的尾巴）；合成时退出是 `crashed`；服务拒绝请求（HTTP 4xx/5xx）是
 *   `rejected`，带引擎给的原因；返回的不是 WAV 是 `protocol`。
 * - 资源（§7.7）：服务从启动起持有这个模型包在调度里的 holder（与 Model Worker 同一个，量只计一次），进程真的退出后才归还；
 *   空闲时被要求让位就退出。同一个模型包的请求排队，一次一个。
 */

/** 参考录音转 WAV 用的 ffmpeg（与在线 Provider 的同一个解析结果）。 */
export interface SpeechFfmpeg {
  command: string;
  env: NodeJS.ProcessEnv;
}

/** 服务持有资源调度里的 holder（`ResourceScheduler.retain`）。 */
export interface SpeechResources {
  retain(holder: string, evict?: () => void): (() => void) | null;
}

export interface LocalSpeechProviderOptions {
  catalog: ModelCatalog;
  /** 内置引擎 `audiocpp_cli` 的路径（服务取同目录的 `audiocpp_server`）；null 表示找不到。每次任务重新解析。 */
  engine: () => string | null;
  /** 启动引擎的环境（登录 shell 的 PATH，与 Model Worker 相同）。 */
  env: () => Promise<NodeJS.ProcessEnv>;
  ffmpeg: () => Promise<SpeechFfmpeg>;
  /** 引擎后端（`metal` / `cuda` / `vulkan` / `cpu`）；null 时按构建编进去的后端选（`audioCppServerBackend`）。 */
  backend?: string | null;
  threads?: number;
  resources?: SpeechResources;
  /** 服务空闲多久退出；默认 10 分钟（与 Model Worker 相同）。 */
  idleMs?: number;
  /** 等服务就绪（加载完模型）的上限；默认 5 分钟。 */
  startTimeoutMs?: number;
  cancelGraceMs?: number;
  log?: JobsLogger;
  /** 测试用：换掉 `spawn`、`fetch` 与取空闲端口。 */
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  freePort?: () => Promise<number>;
}

/** 服务输出留给失败说明的尾巴长度。 */
const OUTPUT_TAIL = 2000;
/** 就绪探测的间隔。 */
const HEALTH_INTERVAL_MS = 250;
/** 参考录音转码的上限。 */
const FFMPEG_TIMEOUT_MS = 5 * 60_000;
/** 与 Model Worker、在线 Provider 相同的解复用器白名单。 */
const DEMUXER_ALLOWLIST = 'mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,aac,mp3,wav,flac,ogg';
/** 参考录音转好的 WAV 在 staging 里的名字。 */
const REFERENCE_WAV = 'reference.wav';

interface Server {
  bundleId: string;
  child: ChildProcess;
  port: number;
  version: string;
  /** 进程退出后兑现。 */
  exited: Promise<void>;
  alive: boolean;
  busy: boolean;
  idleTimer: NodeJS.Timeout | null;
  tail: () => string;
}

/** 引擎的版本与合成服务用的后端（`--version` 读出来的）。 */
interface EngineBuild {
  version: string;
  backend: string;
}

interface Slot {
  server: Server | null;
  starting: Promise<Server> | null;
  /** 同一个模型包的请求排队：上一个请求结束后兑现。 */
  queue: Promise<void>;
  /** 排队或正在合成的任务数。 */
  jobs: number;
}

export class LocalSpeechProvider implements GenerationProvider {
  readonly id = 'local';
  readonly #catalog: ModelCatalog;
  readonly #engine: () => string | null;
  readonly #env: () => Promise<NodeJS.ProcessEnv>;
  readonly #ffmpeg: () => Promise<SpeechFfmpeg>;
  readonly #backend: string | null;
  readonly #threads: number;
  readonly #resources: SpeechResources | null;
  readonly #idleMs: number;
  readonly #startTimeoutMs: number;
  readonly #cancelGraceMs: number;
  readonly #log: JobsLogger;
  readonly #spawn: typeof spawn;
  readonly #fetch: typeof fetch;
  readonly #freePort: () => Promise<number>;
  readonly #slots = new Map<string, Slot>();
  readonly #builds = new Map<string, Promise<EngineBuild>>();
  #closed = false;

  constructor(options: LocalSpeechProviderOptions) {
    this.#catalog = options.catalog;
    this.#engine = options.engine;
    this.#env = options.env;
    this.#ffmpeg = options.ffmpeg;
    this.#backend = options.backend ?? null;
    this.#threads = options.threads ?? Math.max(1, Math.min(8, os.availableParallelism() - 2));
    this.#resources = options.resources ?? null;
    this.#idleMs = options.idleMs ?? 10 * 60_000;
    this.#startTimeoutMs = options.startTimeoutMs ?? 5 * 60_000;
    this.#cancelGraceMs = options.cancelGraceMs ?? 5000;
    this.#log = options.log ?? silentLog;
    this.#spawn = options.spawn ?? spawn;
    this.#fetch = options.fetch ?? fetch;
    this.#freePort = options.freePort ?? freeLoopbackPort;
  }

  generate(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    return this.synthesize(run, sink, signal);
  }

  async synthesize(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    const parameters = run.parameters;
    if (parameters.capability !== 'synthesizeSpeech') throw new ProviderFailure('protocol', L.notHandled({ capability: parameters.capability }));
    if (signal.aborted) return { outcome: 'cancelled' };
    if (this.#closed) throw new ProviderFailure('unavailable', L.runtimeStopping());
    const bundleId = run.modelId;
    const profile = this.#catalog.definition(bundleId)?.speech;
    if (!profile) throw new ProviderFailure('protocol', L.notHandled({ capability: parameters.capability }), { bundleId });
    const engine = this.#engine();
    if (engine === null) throw new ProviderFailure('unavailable', MC.engineMissing(), { reason: 'unsupported', bundleId });
    if (this.#catalog.blocked(bundleId)) {
      const status = await this.#catalog.status(bundleId);
      throw new ProviderFailure('unavailable', L.bundleDisabled(), { reason: status?.reason ?? 'resource', state: status?.state });
    }
    const bundle = await this.#catalog.bundleFor(bundleId);
    const dir = bundle.components.tts?.dir;
    if (!dir) throw new ProviderFailure('load-failed', L.bundleRequired(), { bundleId });
    const model = path.join(dir, profile.engine.file);

    const referenceWav = parameters.reference ? await this.#prepareReference(parameters.reference, profile, run.staging, signal) : null;
    if (signal.aborted) return { outcome: 'cancelled' };
    const request = audioCppSpeechRequestOf(parameters, profile, referenceWav);

    const slot = this.#slot(bundleId);
    const previous = slot.queue;
    let release!: () => void;
    slot.queue = new Promise((resolve) => (release = resolve));
    slot.jobs += 1;
    try {
      await previous;
      if (signal.aborted) return { outcome: 'cancelled' };
      const server = await this.#acquire(slot, bundleId, engine, model, profile, signal);
      if (server === null) return { outcome: 'cancelled' };
      return await this.#request(server, request.body, request.dropped, run, sink, signal);
    } finally {
      slot.jobs -= 1;
      release();
    }
  }

  /**
   * 合成服务此刻会用的后端（模型描述据此在 `cpu` 时带耗时提示）：找不到引擎或服务时 null；给了 `backend` 就是它，否则按服务
   * 构建的 `--version` 选（与启动服务时同一个、按路径缓存的结果）。
   */
  async backend(): Promise<string | null> {
    const engine = this.#engine();
    if (engine === null) return null;
    const executable = audioCppServerOf(engine);
    if (!(await isFile(executable))) return null;
    return this.#backend ?? (await this.#build(executable)).backend;
  }

  /**
   * 卸载一个模型包（删除、搬动模型目录之前，装好之后，或空闲时被要求让位）：空闲的服务退出，等它真的退出。有任务排队或正在合成时
   * 不动它，返回 false；只是还在启动（任务在启动时被取消）时等启动结束再卸载。
   */
  async unload(bundleId: string): Promise<boolean> {
    const slot = this.#slots.get(bundleId);
    if (!slot) return true;
    if (slot.jobs > 0) return false;
    if (slot.starting) await slot.starting.catch(() => {});
    if (slot.jobs > 0) return false;
    const server = slot.server;
    if (server) {
      this.#stop(server);
      await server.exited;
    }
    return true;
  }

  async close(): Promise<void> {
    this.#closed = true;
    const exits: Promise<void>[] = [];
    for (const slot of this.#slots.values()) {
      if (slot.server) {
        exits.push(slot.server.exited);
        this.#stop(slot.server);
      }
    }
    await Promise.race([Promise.all(exits), delay(this.#cancelGraceMs + 1000)]);
  }

  #slot(bundleId: string): Slot {
    let slot = this.#slots.get(bundleId);
    if (!slot) {
      slot = { server: null, starting: null, queue: Promise.resolve(), jobs: 0 };
      this.#slots.set(bundleId, slot);
    }
    return slot;
  }

  /** 参考录音：核对摘要，转成 staging 里的 WAV，检查带原文时的时长上限。返回 WAV 的路径。 */
  async #prepareReference(
    reference: NonNullable<Extract<GenerationRun['parameters'], { capability: 'synthesizeSpeech' }>['reference']>,
    profile: SpeechBundleProfile,
    staging: string,
    signal: AbortSignal,
  ): Promise<string> {
    const unreadable = reference.source === 'builtin' ? builtinUnreadable(reference.path) : fileUnreadable(reference.path);
    const actual = await sha256File(reference.path).catch(() => null);
    if (actual === null) throw new ProviderFailure('input-unreadable', unreadable.message, unreadable.details);
    if (`sha256:${actual}` !== reference.sha256) {
      throw new ProviderFailure('input-unreadable', L.referenceChanged(), { file: reference.path, expected: reference.sha256 });
    }
    const out = path.join(staging, REFERENCE_WAV);
    const ok = await this.#toWav(reference.path, out, signal);
    if (signal.aborted) return out;
    const wav = ok ? inspectWav(await fs.readFile(out).catch(() => Buffer.alloc(0))) : null;
    if (!wav?.ok || wav.wav.durationSec <= 0) throw new ProviderFailure('input-unreadable', unreadable.message, unreadable.details);
    const limit = profile.reference?.withTranscriptSeconds;
    const seconds = wav.wav.durationSec;
    if (limit && reference.transcript?.trim() && seconds > limit[1]) {
      throw new ProviderFailure('rejected', L.referenceTooLong({ seconds: Math.round(seconds * 10) / 10, max: limit[1] }), {
        reason: 'reference-duration',
        seconds,
        range: limit,
      });
    }
    return out;
  }

  /**
   * ffmpeg 把参考录音的第一条音轨转成单声道 16 位 WAV（保留采样率，由引擎自己重采样）。不经 shell，只许读本地文件。
   * ffmpeg 起不来（没装、不可执行）时抛 `tool-unavailable`：这不是录音读不出来，不能算成安装不完整。
   */
  async #toWav(file: string, out: string, signal: AbortSignal): Promise<boolean> {
    const tool = await this.#ffmpeg();
    const args = [
      '-nostdin',
      '-hide_banner',
      '-protocol_whitelist',
      'file',
      '-v',
      'error',
      '-format_whitelist',
      DEMUXER_ALLOWLIST,
      '-i',
      `file:${file}`,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      '-y',
      `file:${out}`,
    ];
    return new Promise((resolve, reject) => {
      const child = this.#spawn(tool.command, args, { env: tool.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-OUTPUT_TAIL);
      });
      const onAbort = () => child.kill('SIGKILL');
      signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
      let settled = false;
      const settle = () => {
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };
      // 进程都没起来：这台机器上没有能用的 ffmpeg，按外部工具的问题报告。已经取消时照旧按取消处理。
      child.once('error', (error) => {
        if (settled) return;
        settle();
        if (signal.aborted) return resolve(false);
        this.#log.warn('ffmpeg unavailable', { command: tool.command, code: (error as NodeJS.ErrnoException).code ?? null });
        reject(ffmpegUnavailable(tool.command));
      });
      child.once('exit', (code) => {
        if (settled) return;
        settle();
        // ffmpeg 的输出里有路径，只记日志，不进错误信息。
        if (code !== 0 && !signal.aborted) this.#log.warn('reference conversion failed', { stderr: stderr.trim() });
        resolve(code === 0);
      });
    });
  }

  /** 这个模型包的服务：已在跑就用它，否则起一个并等它就绪。等待时被取消返回 null（正在起的服务照样起完，留给下次用）。 */
  async #acquire(
    slot: Slot,
    bundleId: string,
    engine: string,
    model: string,
    profile: SpeechBundleProfile,
    signal: AbortSignal,
  ): Promise<Server | null> {
    if (slot.server?.alive) return slot.server;
    slot.starting ??= this.#start(slot, bundleId, engine, model, profile).finally(() => {
      slot.starting = null;
    });
    const starting = slot.starting;
    const aborted = new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null);
      else signal.addEventListener('abort', () => resolve(null), { once: true });
    });
    return Promise.race([starting, aborted]);
  }

  async #start(slot: Slot, bundleId: string, engine: string, model: string, profile: SpeechBundleProfile): Promise<Server> {
    // 在任何 await 之前、任务还拿着租约时持有 holder 的一份：进程真的退出后才归还；没起成时马上归还。
    const share = this.#resources?.retain(modelWorkerHolder(bundleId), () => void this.unload(bundleId)) ?? null;
    let started = false;
    let dir: string | null = null;
    try {
      const executable = audioCppServerOf(engine);
      if (!(await isFile(executable))) throw new ProviderFailure('unavailable', MC.engineMissing(), { reason: 'unsupported', bundleId });
      const build = await this.#build(executable);
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-audiocpp-'));
      const port = await this.#freePort();
      const config = {
        host: '127.0.0.1',
        port,
        backend: this.#backend ?? build.backend,
        threads: this.#threads,
        lazy_load: false,
        max_loaded_models: 1,
        models: [
          {
            id: AUDIO_CPP_SPEECH_MODEL_ID,
            family: profile.engine.family,
            path: model,
            task: profile.engine.task ?? 'tts',
            mode: 'offline',
          },
        ],
      };
      const workDir = dir;
      const configFile = path.join(workDir, 'server.json');
      await fs.writeFile(configFile, JSON.stringify(config, null, 2));
      this.#catalog.setRuntimeState(bundleId, 'loading');
      let child: ChildProcess;
      try {
        child = this.#spawn(executable, ['--config', configFile, '--no-ui'], {
          cwd: workDir,
          env: await this.#env(),
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          windowsHide: true,
        });
      } catch (error) {
        throw new ProviderFailure('load-failed', L.audioCppSpawnFailed({ reason: String(error) }), { bundleId });
      }
      started = true;
      let tail = '';
      const collect = (chunk: Buffer) => {
        tail = (tail + chunk.toString('utf8')).slice(-OUTPUT_TAIL);
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      let spawnError: Error | null = null;
      const server: Server = {
        bundleId,
        child,
        port,
        version: build.version,
        alive: true,
        busy: false,
        idleTimer: null,
        tail: () => tail.trim(),
        exited: new Promise((resolve) => {
          child.once('error', (error) => {
            spawnError = error;
            resolve();
          });
          child.once('exit', () => resolve());
        }),
      };
      void server.exited.then(async () => {
        server.alive = false;
        if (server.idleTimer) clearTimeout(server.idleTimer);
        if (slot.server === server) slot.server = null;
        if (!slot.server) this.#catalog.setRuntimeState(bundleId, null);
        share?.();
        await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      });
      const ready = await this.#waitReady(server);
      if (ready !== 'ready') {
        this.#stop(server);
        const code = child.exitCode ?? child.signalCode;
        this.#log.warn('audio.cpp server failed to start', { bundleId, code, tail: server.tail() });
        if (ready === 'timeout') {
          throw new ProviderFailure('load-failed', L.audioCppNotReady({ seconds: Math.round(this.#startTimeoutMs / 1000) }), { bundleId });
        }
        if (spawnError) throw new ProviderFailure('load-failed', L.audioCppSpawnFailed({ reason: (spawnError as Error).message }), { bundleId });
        throw new ProviderFailure('load-failed', L.audioCppExited({ code: String(code), tail: server.tail() }), { bundleId, exitCode: code });
      }
      slot.server = server;
      this.#catalog.setRuntimeState(bundleId, 'ready');
      // 等它的任务在启动时被取消了也不会一直留着：空闲计时从就绪开始，请求开始时清掉。
      this.#idle(server);
      return server;
    } finally {
      if (!started) {
        share?.();
        this.#catalog.setRuntimeState(bundleId, null);
        if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /** 轮询 `/health` 直到服务回 200、进程退出或超时。 */
  async #waitReady(server: Server): Promise<'ready' | 'exited' | 'timeout'> {
    const deadline = Date.now() + this.#startTimeoutMs;
    while (server.alive) {
      if (Date.now() > deadline) return 'timeout';
      const ok = await this.#fetch(`http://127.0.0.1:${server.port}/health`, { signal: AbortSignal.timeout(2000) })
        .then((response) => response.ok)
        .catch(() => false);
      if (ok) return 'ready';
      await Promise.race([delay(HEALTH_INTERVAL_MS), server.exited]);
    }
    return 'exited';
  }

  /** 一次合成请求：写 `speech.wav`。取消时结束服务。 */
  async #request(
    server: Server,
    body: object,
    dropped: DroppedReading[],
    run: GenerationRun,
    sink: GenerationSink,
    signal: AbortSignal,
  ): Promise<GenerationAttempt> {
    if (server.idleTimer) clearTimeout(server.idleTimer);
    server.idleTimer = null;
    server.busy = true;
    this.#catalog.setRuntimeState(server.bundleId, 'busy');
    const controller = new AbortController();
    const onAbort = () => {
      controller.abort();
      this.#stop(server);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      sink.generating();
      let response: Response;
      try {
        response = await this.#fetch(`http://127.0.0.1:${server.port}/v1/audio/speech`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if (signal.aborted) return { outcome: 'cancelled' };
        await Promise.race([server.exited, delay(1000)]);
        this.#log.warn('audio.cpp server failed during synthesis', { jobId: run.jobId, error: String(error), tail: server.tail() });
        this.#stop(server);
        const code = server.child.exitCode ?? server.child.signalCode;
        throw new ProviderFailure('crashed', L.audioCppExited({ code: String(code), tail: server.tail() }), { exitCode: code });
      }
      const bytes = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (signal.aborted) return { outcome: 'cancelled' };
      if (!response.ok) {
        const message = serverMessage(bytes);
        this.#log.warn('audio.cpp server rejected the request', { jobId: run.jobId, status: response.status, message });
        throw new ProviderFailure('rejected', L.audioCppRequestFailed({ status: response.status, message }), {
          status: response.status,
        });
      }
      const wav = inspectWav(bytes);
      if (!wav.ok) throw new ProviderFailure('protocol', L.audioCppBadOutput({ problem: wav.problem }), { problem: wav.problem });
      limitSpeechPeak(bytes);
      const output = path.join(run.staging, SPEECH_OUTPUT_FILE);
      try {
        await fs.writeFile(output, bytes);
      } catch {
        throw new ProviderFailure('output-unwritable', L.stagingUnwritable());
      }
      await fs.rm(path.join(run.staging, REFERENCE_WAV), { force: true }).catch(() => {});
      for (const reading of dropped) sink.warning?.(readingDropped(reading));
      sink.progress(1, 1);
      return {
        outcome: 'completed',
        outputs: [{ path: SPEECH_OUTPUT_FILE, sha256: await sha256File(output), byteLength: bytes.length, mediaType: 'audio/wav' }],
        workerVersion: `audiocpp_server@${server.version}`,
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
      server.busy = false;
      if (server.alive) {
        this.#catalog.setRuntimeState(server.bundleId, 'ready');
        this.#idle(server);
      }
    }
  }

  /** 空闲 `idleMs` 后结束服务。 */
  #idle(server: Server): void {
    if (server.idleTimer) clearTimeout(server.idleTimer);
    server.idleTimer = setTimeout(() => this.#stop(server), this.#idleMs);
    server.idleTimer.unref?.();
  }

  /** 结束服务（整个进程组），宽限期后强杀。 */
  #stop(server: Server): void {
    if (!server.alive) return;
    if (server.idleTimer) clearTimeout(server.idleTimer);
    server.idleTimer = null;
    killProcessTree(server.child, 'SIGTERM');
    const timer = setTimeout(() => {
      if (server.alive) killProcessTree(server.child, 'SIGKILL');
    }, this.#cancelGraceMs);
    timer.unref?.();
  }

  /**
   * 引擎的构建（`audiocpp_server --version`）：版本取第一行，读不出时用文件名；后端按 `backends:` 行选（服务不给后端时默认 CUDA，
   * 见 `audioCppServerBackend`）。按路径缓存。
   */
  #build(executable: string): Promise<EngineBuild> {
    let build = this.#builds.get(executable);
    if (!build) {
      build = new Promise((resolve) => {
        execFile(executable, ['--version'], { timeout: 10_000, windowsHide: true }, (_error, stdout, stderr) => {
          const output = `${stdout}\n${stderr}`;
          resolve({ version: parseAudioCppVersion(output) ?? path.basename(executable), backend: audioCppServerBackend(output) });
        });
      });
      this.#builds.set(executable, build);
    }
    return build;
  }
}

/** 念不了的读音标注 → 任务警告。`detail` 只说位置与读音，不带文字本身。 */
export function readingDropped(dropped: DroppedReading) {
  const { reading, origin } = dropped;
  const detail =
    dropped.start + 1 === dropped.end
      ? L.readingDroppedOne({ at: dropped.end, reading, origin })
      : L.readingDroppedRange({ from: dropped.start + 1, to: dropped.end, reading, origin });
  return jobWarning('reading-dropped', detail);
}

/** 内置音色的录音读不出来（提交之后被删）：与提交时同一句话与错误码（`APP_FILE_MISSING`）。 */
function builtinUnreadable(file: string): { message: JobText; details: Record<string, unknown> } {
  const error = appFileMissing(BUILTIN_REFERENCE_LABEL, null, file);
  return { message: errorText(error), details: error.details as Record<string, unknown> };
}

/** 请求给出的参考录音读不出来：说出文件名，完整路径在 `details.file`。 */
function fileUnreadable(file: string): { message: JobText; details: Record<string, unknown> } {
  return { message: referenceUnreadableMessage(file), details: { file } };
}

/**
 * 这台机器上没有能用的 ffmpeg（找不到、不能执行）：参考录音没法转成引擎要的 WAV。按外部工具的问题报告
 * （`MEDIA_TOOL_UNAVAILABLE`，带按平台给的安装修法），不说成录音读不出来、也不说成安装不完整。
 */
function ffmpegUnavailable(command: string): ProviderFailure {
  const remedy = ffmpegMissingRemedy();
  return new ProviderFailure('tool-unavailable', JobsFfmpeg.notFound({ command, remedy }), { tool: 'ffmpeg', remedy });
}

/** 服务的错误回应：`{"error":{"message":…}}` 或纯文本；截短。 */
function serverMessage(bytes: Buffer): string {
  const text = bytes.toString('utf8');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof parsed.error === 'string' ? parsed.error : (parsed.error?.message ?? parsed.message);
    if (typeof message === 'string' && message.trim()) return message.trim().slice(0, OUTPUT_TAIL);
  } catch {
    // 不是 JSON：原样截短。
  }
  return text.trim().slice(0, OUTPUT_TAIL);
}

/** 127.0.0.1 上一个空闲端口（服务的配置不接受 0）。 */
function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

async function isFile(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then((s) => s.isFile())
    .catch(() => false);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
