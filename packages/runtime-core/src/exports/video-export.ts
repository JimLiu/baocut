import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  refOf,
  type ExportFontFace,
  type ExportValidation,
  type GeneratedOutput,
  type Id,
  type Localized,
  type MessageRef,
  type VideoExportCodec,
  type VideoExportFormat,
} from '@baocut/protocol';
import { RcCommon, RcExport } from '@baocut/protocol/messages/runtime-core';
import { executableName, findBundledBinary } from '@baocut/process-host';
import { ToolFailure, runTool, type MasterRunner, type ToolCommand } from './audio-export.ts';
import type { AudioPlan, PlanRange, PlannedAsset } from './export-plan.ts';

/**
 * 成片导出（架构设计 §9.13）：画面由 Render Worker（`crates/export-worker`，独立进程）逐帧求计划、合成、交给 ffmpeg 编码；
 * 声音先按音频导出混成 WAV，由 Worker 一并封装。这里是 Runtime 这一侧：Worker 的位置、输入文件、进程的启停与取消、
 * 发布前用 ffprobe 校验输出（流、帧数、尺寸、帧率、时长）。
 */

/** 引擎 `exports.plan` 的 `video` 计划。`document` 是逐帧求计划用的那部分视频（这条序列与它引用的素材记录）。 */
export interface VideoPlanResult {
  videoId: Id;
  videoName: string;
  videoRevision: string;
  sequenceId: Id;
  sequenceRevision: string;
  fps: { num: number; den: number };
  canvas: { width: number; height: number };
  document: unknown;
  documents: FrozenDocument[];
  assets: Array<PlannedAsset & { video?: unknown }>;
  parts: Array<{ video: VideoPlan; audio: AudioPlan }>;
  /** 定下的输出尺寸与画面在其中的位置（`render_graph::video_plan::output_geometry`）。 */
  output: OutputGeometry;
  /** 序列上有写了 `speaker` 的声波、视频里又有转写时：各说话人在序列上说话的区间（秒）。原样交给 Worker。 */
  speakers?: Record<string, Array<[number, number]>>;
}

/** 画面在输出里的一块（像素）。 */
export interface PictureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 输出尺寸：画面与输出同尺寸时铺满，宽高比与画布不同时画面居中、其余是黑边；`adjusted` 是取偶数时调过。 */
export interface OutputGeometry {
  width: number;
  height: number;
  picture: PictureRect;
  adjusted: boolean;
}

export interface FrozenDocument {
  documentId: Id;
  kind: string | null;
  revision: string | null;
  schema: string | null;
  lineKind: 'original' | 'translation';
  /** 文档头的 `sourceDocumentId`（字幕取词）；字幕的词所在的转写也在冻结的文档里。 */
  sourceDocumentId?: Id | null;
  sourceAssetId?: Id | null;
  body: unknown;
}

/** 范围里的画面概览（`render-graph` 的 `video_plan`）。 */
export interface VideoPlan {
  sequenceId: Id;
  range: PlanRange & { start: MediaTimeJson; end: MediaTimeJson };
  fps: { num: number; den: number };
  canvas: { width: number; height: number; background: string; backgroundAlpha: number };
  layers: unknown[];
  transitions: Array<{ id: Id; kind: string; unsupported?: string }>;
  assets: Array<{ id: Id; revision: string }>;
  documents: Id[];
}

export interface MediaTimeJson {
  ticks: string;
  timescale: number;
}

/** 画不出来的一项（Worker 的 `UnsupportedItem`）。 */
export interface UnsupportedItem {
  itemId: Id;
  scope: 'layer' | 'effect' | 'transition' | 'asset';
  layerKind: string;
  effectId?: string;
  transitionId?: string;
  kind?: string;
  reason: string;
  message: string;
}

export interface VideoOutput {
  format: VideoExportFormat;
  codec: VideoExportCodec;
  width: number;
  height: number;
  /** 画面在输出里的一块；与输出同尺寸时铺满。 */
  picture: PictureRect;
  fps: { num: number; den: number };
  crf: number | null;
  bitrateKbps: number | null;
  audioBitrateKbps: number;
}

export const DEFAULT_VIDEO_AUDIO_KBPS: Record<VideoExportFormat, number> = { mp4: 192, webm: 128 };

/**
 * Render Worker 的位置：`BAOCUT_EXPORT_WORKER` 环境变量；引擎宿主旁边的 `export-worker`（同一次 cargo 构建的产物，或打包后同在
 * `<resources>/bin`）；随应用分发的原生程序目录；或者从本模块往上找 cargo 产物目录（开发时由 `npm run build:engine` 构建）。
 */
export function resolveExportWorkerCommand(engineHost: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BAOCUT_EXPORT_WORKER) return env.BAOCUT_EXPORT_WORKER;
  if (engineHost && path.isAbsolute(engineHost)) {
    const sibling = path.join(path.dirname(engineHost), executableName('export-worker'));
    if (fs.existsSync(sibling)) return sibling;
  }
  return findBundledBinary('export-worker', path.dirname(fileURLToPath(import.meta.url)), env);
}

/** Worker 报的失败：`code` 是协议的错误码，`details.items` 是画不出来的项。 */
export class WorkerFailure extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly messageRef: MessageRef | undefined;
  constructor(code: string, message: string | Localized, details: Record<string, unknown> = {}) {
    super(String(message));
    this.code = code;
    this.details = details;
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }
}

/** Worker 的一行输出。 */
export type WorkerEvent =
  | {
      event: 'preflight';
      frames: number;
      items: UnsupportedItem[];
      warnings: Array<{ code: string; detail: string }>;
      missingEncoders: string[];
      /** 要用到的本机字体 face（随渲染内核的字体里没有的族）：Runtime 按它冻结字体。 */
      faces?: Array<{ family: string; weight: number; italic: boolean }>;
    }
  | {
      /** `census`：视频用到的全部 face（`bundled` 是随渲染内核发布的族）与内核的回退族（`fonts.usage`）。 */
      event: 'census';
      faces: Array<{ family: string; weight: number; italic: boolean; bundled: boolean }>;
      fallback: string;
    }
  | { event: 'progress'; frame: number; total: number }
  | {
      event: 'done';
      frames: number;
      skipped: UnsupportedItem[];
      warnings: Array<{ code: string; detail: string }>;
      decoderRestarts: number;
      renderSeconds: number;
    }
  | { event: 'mastered'; frames: number; inputLufs: number; lufs: number; truePeak: number; staticGainDb: number }
  | { event: 'cancelled'; frame: number; total: number }
  | { event: 'error'; code: string; message: string; details: Record<string, unknown> | null };

/** 取消之后等 Worker 自己收尾（杀掉 ffmpeg、删掉没写完的输出）多久，过了就强杀。 */
const CANCEL_GRACE_MS = 5_000;

/** POSIX 上 Worker 自成一个进程组，它启动的 ffmpeg 都在组里；Windows 没有进程组，只能杀 Worker 本身。 */
const PROCESS_GROUPS = process.platform !== 'win32';

/** 杀掉 Worker 的整个进程组（Worker 已经退出时，只剩它留下的 ffmpeg）。组已经不在时什么也不做。 */
function killGroup(pid: number | undefined): void {
  if (!PROCESS_GROUPS || pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // ESRCH：组里已经没有进程
  }
}

/** 强杀之后最多等进程组消失多久（SIGKILL 不能被忽略，正常在几毫秒内结束；这只是不让异常情况挂住任务）。 */
const GROUP_EXIT_WAIT_MS = 5_000;
const GROUP_POLL_MS = 20;

/**
 * 等进程组里的进程真的都退出（`kill(-pid, 0)` 返回 ESRCH）：发出 SIGKILL 不等于资源已经归还（架构设计 §7.7），
 * 任务的租约要等这之后才归还。有上限，超过时照样结束。Windows 没有进程组，Worker 本身已经退出就算结束。
 */
async function groupGone(pid: number | undefined): Promise<void> {
  if (!PROCESS_GROUPS || pid === undefined) return;
  const deadline = performance.now() + GROUP_EXIT_WAIT_MS;
  for (;;) {
    try {
      process.kill(-pid, 0);
    } catch {
      return;
    }
    if (performance.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS));
  }
}

/** 一次 Worker 子命令正常结束时的最后一行。 */
type FinalEvent<C extends WorkerCommand> = Extract<
  WorkerEvent,
  { event: { preflight: 'preflight'; census: 'census'; render: 'done'; master: 'mastered' }[C] }
>;
type WorkerCommand = 'preflight' | 'census' | 'render' | 'master';
const FINAL_EVENT: Record<WorkerCommand, WorkerEvent['event']> = {
  preflight: 'preflight',
  census: 'census',
  render: 'done',
  master: 'mastered',
};

/**
 * 跑一次 Worker（`preflight`、清点字体的 `census`、`render` 或响度母带 `master`），返回最后一行（`preflight`、`census`、`done` 或 `mastered`）。取消时在标准输入写 `cancel` 并关掉，
 * 等它退出（超时强杀）之后才以 `ToolFailure('aborted')` 结束：调用方随后删 staging，不能和 Worker 抢文件。
 *
 * Worker 以自己为首建一个进程组（`detached`），解码与编码的 ffmpeg 随之在组里。Worker 没有正常结束时（崩溃、被强杀、
 * 取消超时）在结束这个 Promise 之前杀掉整个组：Worker 被 SIGKILL 时它来不及停下子进程，这样 ffmpeg 不会留成孤儿，
 * 也不会在 staging 删掉之后还往里写。
 */
export function runWorker<C extends WorkerCommand>(
  worker: ToolCommand,
  command: C,
  inputFile: string,
  options: { signal?: AbortSignal; onProgress?: (frame: number, total: number) => void } = {},
): Promise<FinalEvent<C>> {
  const { signal } = options;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ToolFailure('aborted', RcCommon.cancelled()));
    const child = spawn(worker.command, [command, inputFile], {
      env: worker.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: PROCESS_GROUPS,
    });
    let final: WorkerEvent | null = null;
    let buffer = '';
    let stderr = '';
    let killTimer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      child.stdin.end('cancel\n');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
        killGroup(child.pid);
      }, CANCEL_GRACE_MS);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let event: WorkerEvent;
        try {
          event = JSON.parse(line) as WorkerEvent;
        } catch {
          continue;
        }
        if (event.event === 'progress') options.onProgress?.(event.frame, event.total);
        else final = event;
      }
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_384);
    });
    child.once('error', (error: NodeJS.ErrnoException) => {
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      reject(new ToolFailure(error.code === 'ENOENT' ? 'missing' : 'failed', RcExport.toolStartFailed({ tool: 'export-worker', error: error.message }), 'export-worker'));
    });
    child.once('close', (code, sig) => {
      signal?.removeEventListener('abort', onAbort);
      if (killTimer) clearTimeout(killTimer);
      const event = final as WorkerEvent | null;
      const clean = code === 0 && event?.event === FINAL_EVENT[command];
      const settle = () => {
        if (signal?.aborted) return reject(new ToolFailure('aborted', RcCommon.cancelled()));
        if (clean) return resolve(event as FinalEvent<C>);
        if (event?.event === 'error') return reject(new WorkerFailure(event.code, event.message, event.details ?? {}));
        // 没有说明就退出了（崩溃、被杀）：合成在独立进程里，Runtime 不受影响，这一个输出算失败。
        const tail = stderr.trim().split('\n').slice(-3).join('\n');
        reject(new WorkerFailure('EXPORT_RENDER_FAILED', RcExport.workerExitedUnexpectedly({ signal: sig ?? null, code: String(code), output: tail })));
      };
      // 正常结束的 Worker 已经等过它的 ffmpeg；其余情况（含取消）收掉组里可能剩下的进程，等它们真的退出再结束。
      if (clean) return settle();
      killGroup(child.pid);
      void groupGone(child.pid).then(settle);
    });
    child.stdin.write('');
  });
}

/** 响度母带（`renderAudio` 的 `master`）：在 Worker 里跑 `master` 子命令，取消与进程组的处理同 `render`。 */
export function masterRunner(worker: ToolCommand): MasterRunner {
  return (inputFile, signal, onProgress) => runWorker(worker, 'master', inputFile, { signal, ...(onProgress ? { onProgress } : {}) });
}

/** 一个成片的 ffprobe 读数。 */
export interface ProbedVideo {
  durationSec: number;
  frames: number;
  width: number;
  height: number;
  fps: string;
  codec: string;
  videoDurationSec: number;
  audio: { codec: string; durationSec: number } | null;
  colorSpace: string | null;
}

/** ffprobe 读成片：流、帧数（数包，不解码）、尺寸、帧率与时长。 */
export async function probeVideo(ffprobe: ToolCommand, file: string, signal: AbortSignal): Promise<ProbedVideo> {
  const { stdout } = await runTool(
    ffprobe,
    ['-v', 'error', '-count_packets', '-show_streams', '-show_format', '-of', 'json', `file:${file}`],
    signal,
  );
  const parsed = JSON.parse(stdout) as {
    streams?: Array<Record<string, unknown>>;
    format?: { duration?: string };
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video) throw new Error(RcExport.noVideoStream().text);
  const number = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? Number(v) : Number.NaN);
  // WebM（Matroska）的流没有 duration，时长在标签 `DURATION`（`HH:MM:SS.nnnnnnnnn`）里。
  const streamDuration = (stream: Record<string, unknown>) => {
    const direct = number(stream.duration);
    if (Number.isFinite(direct)) return direct;
    const tag = (stream.tags as Record<string, unknown> | undefined)?.DURATION;
    const match = typeof tag === 'string' ? /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(tag) : null;
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : Number.NaN;
  };
  return {
    durationSec: number(parsed.format?.duration),
    frames: number(video.nb_read_packets),
    width: number(video.width),
    height: number(video.height),
    fps: String(video.r_frame_rate ?? ''),
    codec: String(video.codec_name ?? ''),
    videoDurationSec: streamDuration(video),
    audio: audio ? { codec: String(audio.codec_name ?? ''), durationSec: streamDuration(audio) } : null,
    colorSpace: typeof video.color_space === 'string' ? video.color_space : null,
  };
}

const CODEC_NAMES: Record<VideoExportCodec, string> = { h264: 'h264', hevc: 'hevc', vp9: 'vp9' };

/** 发布前的校验：两条流都在、帧数与时长差不过一帧、尺寸与帧率符合设置。 */
export function checkVideo(
  probed: ProbedVideo,
  expected: { frames: number; output: VideoOutput; audio: boolean },
): { problems: string[]; media: Extract<GeneratedOutput['media'], { kind: 'video' }>; validation: ExportValidation } {
  const { output } = expected;
  const frameSec = output.fps.den / output.fps.num;
  const expectedDuration = expected.frames * frameSec;
  const problems: string[] = [];
  if (Math.abs(probed.frames - expected.frames) > 1) problems.push(RcExport.frameCountMismatch({ actual: probed.frames, expected: expected.frames }).text);
  if (probed.width !== output.width || probed.height !== output.height)
    problems.push(
      RcExport.sizeMismatch({ width: probed.width, height: probed.height, expectedWidth: output.width, expectedHeight: output.height }).text,
    );
  const [num, den] = probed.fps.split('/').map(Number);
  if (!num || !den || Math.abs(num / den - output.fps.num / output.fps.den) > 1e-6)
    problems.push(RcExport.fpsMismatch({ actual: probed.fps, expected: `${output.fps.num}/${output.fps.den}` }).text);
  if (probed.codec !== CODEC_NAMES[output.codec]) problems.push(RcExport.codecMismatch({ actual: probed.codec, expected: output.codec }).text);
  const duration = Number.isFinite(probed.videoDurationSec) ? probed.videoDurationSec : probed.durationSec;
  if (!(Math.abs(duration - expectedDuration) <= frameSec + 1e-3))
    problems.push(RcExport.videoDurationMismatch({ actual: duration, expected: expectedDuration }).text);
  // 声音按编码器的帧补齐（AAC 1024 个样本、Opus 20 ms），容差多给 50 ms。
  if (expected.audio && !probed.audio) problems.push(RcExport.noAudioInOutput().text);
  if (probed.audio && !(Math.abs(probed.audio.durationSec - expectedDuration) <= frameSec + 0.05))
    problems.push(RcExport.audioDurationMismatch({ actual: probed.audio.durationSec, expected: expectedDuration }).text);
  const streams = ['video', ...(probed.audio ? ['audio'] : [])];
  return {
    problems,
    media: {
      kind: 'video',
      durationSec: probed.durationSec,
      width: probed.width,
      height: probed.height,
      frames: probed.frames,
      fps: probed.fps,
      videoCodec: probed.codec,
      audioCodec: probed.audio?.codec ?? null,
    },
    validation: {
      checks: ['streams', 'frame-count', 'dimensions', 'frame-rate', 'codec', 'duration', ...(expected.audio ? ['audio-duration'] : [])],
      expectedDurationSec: expectedDuration,
      durationSec: duration,
      toleranceSec: frameSec,
      video: {
        expectedFrames: expected.frames,
        frames: probed.frames,
        width: probed.width,
        height: probed.height,
        fps: probed.fps,
        streams,
      },
    },
  };
}

/** Worker 的输入文件（`crates/export-worker/src/input.rs`）。 */
export function workerInput(options: {
  plan: VideoPlanResult;
  part: number;
  assets: Map<string, PlannedAsset>;
  output: VideoOutput;
  outputPath: string;
  audioPath: string | null;
  burnCaptions: boolean;
  onUnsupported: 'fail' | 'skip';
  /** 冻结的本机字体（只给找到的；预检时还没有）。 */
  fonts?: readonly ExportFontFace[];
  ffmpeg: string;
  ffprobe: string;
}): unknown {
  const { plan, output } = options;
  const video = plan.parts[options.part]!.video;
  return {
    document: plan.document,
    sequenceId: plan.sequenceId,
    range: { start: video.range.start, end: video.range.end },
    documents: plan.documents,
    ...(plan.speakers ? { speakers: plan.speakers } : {}),
    assets: [...options.assets.values()].map((a) => ({ assetId: a.assetId, revision: a.revision, path: a.path, mediaType: a.mediaType })),
    fonts: (options.fonts ?? []).flatMap((f) =>
      'path' in f
        ? [
            {
              family: f.family,
              weight: f.weight,
              italic: f.italic,
              path: f.path,
              faceIndex: f.faceIndex,
              contentHash: f.contentHash,
              byteLength: f.byteLength,
            },
          ]
        : [],
    ),
    output: {
      path: options.outputPath,
      format: output.format,
      codec: output.codec,
      width: output.width,
      height: output.height,
      picture: output.picture,
      fps: output.fps,
      ...(output.crf !== null ? { crf: output.crf } : {}),
      ...(output.bitrateKbps !== null ? { bitrateKbps: output.bitrateKbps } : {}),
      audio: options.audioPath ? { path: options.audioPath, bitrateKbps: output.audioBitrateKbps } : null,
    },
    burnCaptions: options.burnCaptions,
    onUnsupported: options.onUnsupported,
    tools: { ffmpeg: options.ffmpeg, ffprobe: options.ffprobe },
  };
}

/** 一项画不出来的内容写成任务警告。 */
export function skippedWarning(item: UnsupportedItem): { code: string; detail: string; detailRef: MessageRef } {
  const { message } = item;
  const detail =
    item.scope === 'effect'
      ? RcExport.contentSkippedEffect({ itemId: item.itemId, effectId: String(item.effectId), kind: String(item.kind), message })
      : item.scope === 'transition'
        ? RcExport.contentSkippedTransition({ transitionId: String(item.transitionId), kind: String(item.kind), message })
        : RcExport.contentSkippedItem({ itemId: item.itemId, layerKind: item.layerKind, message });
  return { code: 'EXPORT_CONTENT_SKIPPED', detail: detail.text, detailRef: refOf(detail) };
}
