import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MUSIC_OUTPUT_FILE,
  ProviderFailure,
  inspectWav,
  musicEngineRunOf,
  sha256File,
  type GenerationAttempt,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSink,
  type ModelCatalog,
} from '@baocut/models';
import { killProcessTree } from '@baocut/process-host';
import { ModelsModelCatalog as MC } from '@baocut/protocol/messages/models/model-catalog.ts';
import { JobsLocalProvider as L } from '@baocut/protocol/messages/jobs/local-provider.ts';
import { audioCppExitFailure, runAudioCppEngine } from './audio-cpp-process.ts';
import { jobWarning } from './job-text.ts';
import { silentLog, type JobsLogger } from './jobs-logger.ts';

/**
 * 本地音乐生成的 Provider（架构设计 §6.1、§6.3）：`generateMusic` 的 `local` 执行者。每个任务起一个内置 audio.cpp 引擎进程
 * （`audiocpp_cli`，与本地 TTS 的 `audiocpp_server` 同一份构建），读模型包目录里的 GGUF，把 WAV 写进这次尝试的 staging；
 * 没有 Model Worker 参与，也不常驻。
 *
 * - 引擎找不到时 `unavailable`，原因 `unsupported`（`MC.engineMissing`）：引擎随应用内置，找不到说明这台主机没有它的构建，
 *   或安装不完整；模型目录同样把 audio.cpp 的模型包标成 `unsupported`。
 * - 进度：引擎不报告步数，进入生成阶段后只有不定进度；完成时报 1/1。
 * - 取消：先 SIGTERM 整个进程组（Windows 上 taskkill 整棵树），宽限期后 SIGKILL；进程退出后以 `cancelled` 兑现。
 * - 输出撞上 `maxDurationSec` 换算的 token 上限（WAV 时长达到上限的 98%）时记 `output-truncated` 警告，任务照样完成。
 * - 失败：进程起不来 `unavailable`；非零退出 `crashed` 并带 stderr 的尾巴；退出了却没有 WAV `protocol`。
 */

export interface LocalMusicProviderOptions {
  catalog: ModelCatalog;
  /** 内置引擎 `audiocpp_cli` 的路径；null 表示找不到。每次任务重新解析。 */
  engine: () => string | null;
  /** 启动引擎的环境（登录 shell 的 PATH，与 Model Worker 相同）。 */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** 引擎后端（`metal` / `cuda` / `vulkan` / `cpu`）；null 时由引擎按构建自己选。 */
  backend?: string | null;
  threads?: number;
  log?: JobsLogger;
  cancelGraceMs?: number;
  /** 测试用：换掉 `spawn`。 */
  spawn?: typeof spawn;
}

/** WAV 时长达到上限的这个比例就算撞上限。 */
const TRUNCATED_RATIO = 0.98;

export class LocalMusicProvider implements GenerationProvider {
  readonly id = 'local';
  readonly #catalog: ModelCatalog;
  readonly #engine: () => string | null;
  readonly #env: () => Promise<NodeJS.ProcessEnv>;
  readonly #backend: string | null;
  readonly #threads: number;
  readonly #log: JobsLogger;
  readonly #cancelGraceMs: number;
  readonly #spawn: typeof spawn;
  readonly #active = new Set<ChildProcess>();
  #closed = false;

  constructor(options: LocalMusicProviderOptions) {
    this.#catalog = options.catalog;
    this.#engine = options.engine;
    this.#env = options.env;
    this.#backend = options.backend ?? null;
    this.#threads = options.threads ?? Math.max(1, Math.min(8, os.availableParallelism() - 2));
    this.#log = options.log ?? silentLog;
    this.#cancelGraceMs = options.cancelGraceMs ?? 5000;
    this.#spawn = options.spawn ?? spawn;
  }

  generate(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    return this.generateMusic(run, sink, signal);
  }

  /** 一次生成；`options.steps` 是自检给的少步数（正式提交由冻结参数决定）。 */
  async generateMusic(
    run: GenerationRun,
    sink: GenerationSink,
    signal: AbortSignal,
    options: { steps?: number | null } = {},
  ): Promise<GenerationAttempt> {
    const parameters = run.parameters;
    if (parameters.capability !== 'generateMusic') throw new ProviderFailure('protocol', L.notHandled({ capability: parameters.capability }));
    if (signal.aborted) return { outcome: 'cancelled' };
    if (this.#closed) throw new ProviderFailure('unavailable', L.runtimeStopping());
    const bundleId = run.modelId;
    const def = this.#catalog.definition(bundleId);
    if (!def?.music) throw new ProviderFailure('unavailable', L.musicNotMusicBundle({ bundleId }), { bundleId });
    const engine = this.#engine();
    if (engine === null) throw new ProviderFailure('unavailable', MC.engineMissing(), { reason: 'unsupported', bundleId });
    if (this.#catalog.blocked(bundleId)) {
      const status = await this.#catalog.status(bundleId);
      throw new ProviderFailure('unavailable', L.bundleDisabled(), { reason: status?.reason ?? 'resource', state: status?.state });
    }
    const bundle = await this.#catalog.bundleFor(bundleId);
    const modelDir = bundle.components.music?.dir;
    if (!modelDir) throw new ProviderFailure('load-failed', L.musicNotMusicBundle({ bundleId }), { bundleId });
    const plan = musicEngineRunOf(parameters, def.music, {
      modelDir,
      staging: run.staging,
      threads: this.#threads,
      backend: this.#backend,
      steps: options.steps ?? null,
    });

    sink.generating();
    const exit = await runAudioCppEngine({
      spawn: this.#spawn,
      engine,
      args: plan.args,
      cwd: run.staging,
      env: await this.#env(),
      signal,
      cancelGraceMs: this.#cancelGraceMs,
      active: this.#active,
      log: this.#log,
      jobId: run.jobId,
    });
    if (exit.cancelled) return { outcome: 'cancelled' };
    if (exit.code !== 0) throw audioCppExitFailure(exit);
    const output = await this.#findOutput(run.staging, plan.output);
    if (output === null) throw new ProviderFailure('protocol', L.musicNoOutput(), { tail: exit.tail });
    const bytes = await fs.readFile(output);
    const wav = inspectWav(bytes);
    if (wav.ok && wav.wav.durationSec >= parameters.maxDurationSec * TRUNCATED_RATIO) {
      sink.warning?.(jobWarning('output-truncated', L.musicTruncated({ seconds: parameters.maxDurationSec })));
    }
    sink.progress(1, 1);
    return {
      outcome: 'completed',
      outputs: [{ path: path.relative(run.staging, output), sha256: await sha256File(output), byteLength: bytes.length, mediaType: 'audio/wav' }],
      workerVersion: `audiocpp_cli@${path.basename(engine)}`,
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const child of this.#active) killProcessTree(child, 'SIGTERM');
  }

  /** 约定的输出文件；引擎按自己的规则改了名时退回 staging 里任意一个 WAV。 */
  async #findOutput(staging: string, expected: string): Promise<string | null> {
    if (await exists(expected)) return expected;
    const entries = await fs.readdir(staging).catch(() => []);
    const wav = entries.filter((name) => name.toLowerCase().endsWith('.wav')).sort();
    if (wav.length === 0) return null;
    const found = path.join(staging, wav[0]!);
    const target = path.join(staging, MUSIC_OUTPUT_FILE);
    if (found !== target) {
      await fs.rename(found, target).catch(() => {});
      return (await exists(target)) ? target : found;
    }
    return found;
  }
}

async function exists(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then((s) => s.isFile())
    .catch(() => false);
}
