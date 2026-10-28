import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProviderFailure, sha256File, type ModelCatalog, type SeparateRunResult } from '@baocut/models';
import { killProcessTree } from '@baocut/process-host';
import { ModelsModelCatalog as MC } from '@baocut/protocol/messages/models/model-catalog.ts';
import { JobsLocalProvider as L } from '@baocut/protocol/messages/jobs/local-provider.ts';
import { audioCppExitFailure, runAudioCppEngine } from './audio-cpp-process.ts';
import { silentLog, type JobsLogger } from './jobs-logger.ts';
import type { LocalSeparateOutcome, LocalSeparateRun } from './local-provider.ts';
import { runFfmpeg, type MediaToolResolver } from './pipelines/ffmpeg.ts';
import { PipelineStepError } from './pipelines/pipeline.ts';

/**
 * audio.cpp 的人声与背景分离（架构设计 §6.1 `separateAudio`、§6.3「添加 audio.cpp 模型」）：添加的 HTDemucs 与 Mel-Band RoFormer
 * 模型包（`BundleDefinition.separation`）不经 Model Worker，每次分离起一个内置引擎进程（`audiocpp_cli --task sep`），与本地音乐
 * 生成一样不常驻。交出的结果与 Model Worker 的 `separate`（Model Worker 协议规范 §2.5.4）同一个形状，翻译配音与模型检查不分来源：
 *
 * 1. ffmpeg 把输入的第 `track` 条音轨解成 44.1 kHz 立体声 32 位浮点 WAV（引擎不重采样，别的采样率直接报错；单声道复制成两路、
 *    多声道混成两路，与 Worker 相同）；
 * 2. 引擎把每一轨写成 32 位浮点 WAV（HTDemucs：人声、鼓、贝斯、其他；Mel-Band RoFormer：人声、伴奏）；
 * 3. ffmpeg 把登记的几轨相加（`amix` 不做归一化）成人声与背景，换算到 `sampleRate`（null 时 44.1 kHz），写成 staging 里的
 *    16 位 PCM 立体声 `vocals.wav` 与 `background.wav`（换成 16 位时裁到 [−1, 1]）；中间文件随后删掉。
 *
 * 进度：引擎不报告进度，只有不定进度。取消、失败的报法与本地音乐生成相同（`audio-cpp-process.ts`）；解不了输入是
 * `input-unreadable`，引擎退出了却缺某一轨是 `protocol`。
 */

export interface LocalAudioCppSeparatorOptions {
  catalog: ModelCatalog;
  /** 内置引擎 `audiocpp_cli` 的路径；null 表示找不到。每次分离重新解析。 */
  engine: () => string | null;
  /** 启动引擎的环境（与本地音乐生成相同）。 */
  env: () => Promise<NodeJS.ProcessEnv>;
  ffmpeg: MediaToolResolver;
  /** 引擎后端（`metal` / `cuda` / `vulkan` / `cpu`）；null 时由引擎按构建自己选。 */
  backend?: string | null;
  threads?: number;
  log?: JobsLogger;
  cancelGraceMs?: number;
  /** 测试用：换掉 `spawn`。 */
  spawn?: typeof spawn;
}

/** 引擎的工作采样率（HTDemucs 与 Mel-Band RoFormer 都是 44.1 kHz）。 */
const ENGINE_SAMPLE_RATE = 44_100;
/** 引擎的输入与各轨输出放在 staging 的这个子目录里，交出结果前删掉。 */
const WORK_DIR = 'audio-cpp';

export class LocalAudioCppSeparator {
  readonly #catalog: ModelCatalog;
  readonly #engine: () => string | null;
  readonly #env: () => Promise<NodeJS.ProcessEnv>;
  readonly #ffmpeg: MediaToolResolver;
  readonly #backend: string | null;
  readonly #threads: number;
  readonly #log: JobsLogger;
  readonly #cancelGraceMs: number;
  readonly #spawn: typeof spawn;
  readonly #active = new Set<ChildProcess>();
  #closed = false;

  constructor(options: LocalAudioCppSeparatorOptions) {
    this.#catalog = options.catalog;
    this.#engine = options.engine;
    this.#env = options.env;
    this.#ffmpeg = options.ffmpeg;
    this.#backend = options.backend ?? null;
    this.#threads = options.threads ?? Math.max(1, Math.min(8, os.availableParallelism() - 2));
    this.#log = options.log ?? silentLog;
    this.#cancelGraceMs = options.cancelGraceMs ?? 5000;
    this.#spawn = options.spawn ?? spawn;
  }

  /** 这个模型包是不是由这里跑（audio.cpp 的分离模型包）。 */
  handles(bundleId: string): boolean {
    return this.#catalog.definition(bundleId)?.separation !== undefined;
  }

  async separate(run: LocalSeparateRun, signal: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<LocalSeparateOutcome> {
    void onProgress;
    if (signal.aborted) return { outcome: 'cancelled' };
    if (this.#closed) throw new ProviderFailure('unavailable', L.runtimeStopping());
    const { bundleId } = run;
    const profile = this.#catalog.definition(bundleId)?.separation;
    if (!profile) throw new ProviderFailure('unavailable', L.separateNotAudioCpp({ bundleId }), { bundleId });
    const engine = this.#engine();
    if (engine === null) throw new ProviderFailure('unavailable', MC.engineMissing(), { reason: 'unsupported', bundleId });
    if (this.#catalog.blocked(bundleId)) {
      const status = await this.#catalog.status(bundleId);
      throw new ProviderFailure('unavailable', L.bundleDisabled(), { reason: status?.reason ?? 'resource', state: status?.state });
    }
    const bundle = await this.#catalog.bundleFor(bundleId);
    const modelDir = bundle.components.separator?.dir;
    if (!modelDir) throw new ProviderFailure('load-failed', L.separateNotAudioCpp({ bundleId }), { bundleId });

    const work = path.join(run.staging, WORK_DIR);
    const out = path.join(work, 'stems');
    await fs.mkdir(out, { recursive: true });
    try {
      // 1. 解码
      const decodeStart = Date.now();
      const input = path.join(work, 'input.wav');
      try {
        await runFfmpeg(
          this.#ffmpeg,
          ['-y', '-v', 'error', '-nostdin', '-i', `file:${run.input.file}`, '-map', `0:a:${run.input.track}`, '-vn', '-ac', '2', '-ar', String(ENGINE_SAMPLE_RATE), '-c:a', 'pcm_f32le', `file:${input}`],
          { signal },
        );
      } catch (error) {
        if (signal.aborted) return { outcome: 'cancelled' };
        if (error instanceof PipelineStepError && error.code === 'TRANSCODE_FAILED') {
          throw new ProviderFailure('input-unreadable', L.assetUnreadable(), { file: run.input.file, ...error.details });
        }
        throw error;
      }
      const decodeMs = Date.now() - decodeStart;

      // 2. 分离
      const separateStart = Date.now();
      const args = [
        '--task',
        'sep',
        '--family',
        profile.family,
        '--model',
        path.join(modelDir, profile.file),
        '--threads',
        String(this.#threads),
        '--audio',
        input,
        '--out-dir',
        out,
        '--out-format',
        'float32',
        '--metrics',
      ];
      if (this.#backend) args.push('--backend', this.#backend);
      const exit = await runAudioCppEngine({
        spawn: this.#spawn,
        engine,
        args,
        cwd: work,
        env: await this.#env(),
        signal,
        cancelGraceMs: this.#cancelGraceMs,
        active: this.#active,
        log: this.#log,
        jobId: run.jobId,
      });
      if (exit.cancelled) return { outcome: 'cancelled' };
      if (exit.code !== 0) throw audioCppExitFailure(exit);
      for (const stem of [...profile.vocals, ...profile.background]) {
        if (!(await isFile(path.join(out, `${stem}.wav`)))) throw new ProviderFailure('protocol', L.separateNoStem({ stem }), { tail: exit.tail });
      }
      const separationMs = Date.now() - separateStart;

      // 3. 合成两路
      const encodeStart = Date.now();
      const rate = run.sampleRate ?? ENGINE_SAMPLE_RATE;
      const files = { vocals: path.join(run.staging, 'vocals.wav'), background: path.join(run.staging, 'background.wav') };
      try {
        await this.#mix(profile.vocals.map((s) => path.join(out, `${s}.wav`)), files.vocals, rate, signal);
        await this.#mix(profile.background.map((s) => path.join(out, `${s}.wav`)), files.background, rate, signal);
      } catch (error) {
        if (signal.aborted) return { outcome: 'cancelled' };
        if (error instanceof PipelineStepError && error.code === 'TRANSCODE_FAILED') {
          throw new ProviderFailure('output-unwritable', L.stagingUnwritable(), error.details);
        }
        throw error;
      }
      const encodeMs = Date.now() - encodeStart;

      const stems = { vocals: await outputOf(files.vocals), background: await outputOf(files.background) };
      const result: SeparateRunResult = {
        outcome: 'completed',
        stems: { vocals: stems.vocals.output, background: stems.background.output },
        audio: await wavHeader(files.vocals),
        stats: { decodeMs, separationMs, encodeMs },
      };
      return { outcome: 'completed', ...files, result, workerVersion: `audiocpp_cli@${path.basename(engine)}` };
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const child of this.#active) killProcessTree(child, 'SIGTERM');
  }

  /** 几轨相加（不归一化）、换算采样率，写成 16 位 PCM 立体声 WAV（先写临时文件再重命名）。 */
  async #mix(inputs: string[], file: string, rate: number, signal: AbortSignal): Promise<void> {
    const temp = `${file}.part.wav`;
    const args = ['-y', '-v', 'error', '-nostdin'];
    for (const input of inputs) args.push('-i', `file:${input}`);
    if (inputs.length > 1) args.push('-filter_complex', `amix=inputs=${inputs.length}:duration=longest:normalize=0`);
    args.push('-ac', '2', '-ar', String(rate), '-c:a', 'pcm_s16le', `file:${temp}`);
    await runFfmpeg(this.#ffmpeg, args, { signal });
    await fs.rename(temp, file);
  }
}

async function isFile(file: string): Promise<boolean> {
  return fs
    .stat(file)
    .then((s) => s.isFile())
    .catch(() => false);
}

/** 只读 WAV 头：采样率、声道数，时长按 `data` 块的长度算（输出是 ffmpeg 写的 16 位 PCM，不必扫整个文件）。 */
async function wavHeader(file: string): Promise<SeparateRunResult['audio']> {
  const handle = await fs.open(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const bytes = head.subarray(0, bytesRead);
    if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') return null;
    let fmt: { channels: number; sampleRate: number; blockAlign: number } | null = null;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const id = bytes.toString('ascii', offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      const body = offset + 8;
      if (id === 'fmt ' && body + 16 <= bytes.length) {
        fmt = { channels: bytes.readUInt16LE(body + 2), sampleRate: bytes.readUInt32LE(body + 4), blockAlign: bytes.readUInt16LE(body + 12) };
      } else if (id === 'data') {
        if (!fmt || fmt.blockAlign === 0 || fmt.sampleRate === 0) return null;
        const { size: fileSize } = await handle.stat();
        const length = Math.min(size, fileSize - body);
        return { sampleRate: fmt.sampleRate, channels: fmt.channels, durationSec: length / fmt.blockAlign / fmt.sampleRate };
      }
      offset = body + size + (size % 2);
    }
    return null;
  } finally {
    await handle.close();
  }
}

/** 一路输出的记录（与 Worker 的 `stems` 相同：绝对路径、摘要与字节数）。 */
async function outputOf(file: string): Promise<{ output: { path: string; sha256: string; byteLength: number } }> {
  const stat = await fs.stat(file);
  return { output: { path: file, sha256: `sha256:${await sha256File(file)}`, byteLength: stat.size } };
}

/** 本机分离的执行者（`LocalProvider` 与 `LocalAudioCppSeparator` 都是）。 */
export interface LocalSeparator {
  separate(run: LocalSeparateRun, signal: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<LocalSeparateOutcome>;
}

/** 按模型包分派：audio.cpp 的分离模型包交给内置引擎，别的交给 Model Worker。翻译配音与模型检查都经这里。 */
export function routeLocalSeparation(worker: LocalSeparator, audioCpp: LocalAudioCppSeparator): LocalSeparator {
  return {
    separate: (run, signal, onProgress) =>
      audioCpp.handles(run.bundleId) ? audioCpp.separate(run, signal, onProgress) : worker.separate(run, signal, onProgress),
  };
}
