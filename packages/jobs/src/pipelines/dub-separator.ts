import path from 'node:path';
import { ProviderFailure, sha256File } from '@baocut/models';
import { JobsDubSeparator as J } from '@baocut/protocol/messages/jobs/dub-separator.ts';
import type { LocalSeparateOutcome, LocalSeparateRun } from '../local-provider.ts';
import type { DubSeparator } from './dub.ts';
import { probeMedia, runFfmpeg, type MediaToolResolver } from './ffmpeg.ts';
import { errorText } from '../job-text.ts';
import { PipelineStepError } from './pipeline.ts';

/** 分离的输出与输入的时长容差（与 `stemProblems` 相同，一帧音频 20 毫秒）。 */
const DURATION_TOLERANCE_SEC = 0.02;
/** Model Worker 接受的输出采样率（Model Worker 协议规范 §2.5.4）。 */
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 192_000;

export interface LocalDubSeparatorOptions {
  provider: { separate(run: LocalSeparateRun, signal: AbortSignal): Promise<LocalSeparateOutcome> };
  /** 执行分离的本地模型包。 */
  bundleId: string;
  /** 它的 Model Worker 要加载的权重（字节）；不知道时 null。 */
  workerWeightBytes?: number | null;
  ffmpeg: MediaToolResolver;
  ffprobe: MediaToolResolver;
}

/**
 * 翻译配音的人声与背景分离（架构设计 §6.1 `separateAudio`、§7.9）由本机的分离模型包执行：素材的第一条音轨整段交给
 * Model Worker（`job.run` 的 `separate`），输出的采样率取输入音轨的。Worker 按音轨的长度写输出，容器时长（ffprobe 的
 * `format.duration`，`stemProblems` 拿它比）与音轨差出容差时，两路输出都用 ffmpeg 补静音或截到容器时长。
 */
export function localDubSeparator(options: LocalDubSeparatorOptions): DubSeparator {
  const { provider, bundleId, ffmpeg, ffprobe } = options;
  return {
    providerId: 'local',
    modelId: bundleId,
    workerWeightBytes: options.workerWeightBytes ?? null,
    async separate({ file, staging, jobId, signal }) {
      const input = await probeMedia(ffprobe, file, signal);
      if (!input.audio) throw new PipelineStepError('INPUT_UNREADABLE', J.noAudio(), { file });
      const rate = input.audio.sampleRate;
      const sampleRate = rate >= MIN_SAMPLE_RATE && rate <= MAX_SAMPLE_RATE ? rate : null;
      const hex = await sha256File(file).catch(() => null);
      if (hex === null) throw new PipelineStepError('INPUT_UNREADABLE', J.unreadable(), { file });
      let outcome: LocalSeparateOutcome;
      try {
        outcome = await provider.separate(
          { bundleId, jobId, input: { file, contentHash: `sha256:${hex}`, track: 0 }, sampleRate, staging },
          signal,
        );
      } catch (error) {
        throw providerStepError(error);
      }
      if (outcome.outcome === 'cancelled') throw signal.reason ?? new DOMException('aborted', 'AbortError');
      const stems = { vocals: outcome.vocals, background: outcome.background };
      const durationSec = outcome.result.audio?.durationSec ?? null;
      if (durationSec === null || Math.abs(durationSec - input.durationSec) <= DURATION_TOLERANCE_SEC) return stems;
      return {
        vocals: await fitDuration(ffmpeg, stems.vocals, input.durationSec, signal),
        background: await fitDuration(ffmpeg, stems.background, input.durationSec, signal),
      };
    },
  };
}

/** 补静音或截断到 `seconds` 秒，写在原文件旁边（`<名>.fit.wav`），格式不变（16-bit PCM WAV）。 */
async function fitDuration(ffmpeg: MediaToolResolver, file: string, seconds: number, signal: AbortSignal): Promise<string> {
  const out = path.join(path.dirname(file), `${path.basename(file, '.wav')}.fit.wav`);
  const args = ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-i', `file:${file}`];
  args.push('-af', 'apad', '-t', seconds.toFixed(6), '-c:a', 'pcm_s16le', `file:${out}`);
  await runFfmpeg(ffmpeg, args, { signal });
  return out;
}

/** Provider 的失败 → 流程这一步的错误码（与转写、生成任务的映射相同；识别说话人的区分一步同样用它）。 */
export function providerStepError(error: unknown): unknown {
  if (!(error instanceof ProviderFailure)) return error;
  const details = { ...error.details, providerId: 'local' };
  // 供应商错误带着消息引用时一并记下。
  const message = errorText(error);
  switch (error.kind) {
    case 'crashed':
    case 'version-changed':
      return new PipelineStepError('MODEL_WORKER_CRASHED', message, details);
    case 'load-failed':
    case 'unavailable':
      return new PipelineStepError('MODEL_LOAD_FAILED', message, details);
    case 'input-unreadable':
      return new PipelineStepError('INPUT_UNREADABLE', message, details);
    case 'output-unwritable':
      return new PipelineStepError('STAGING_WRITE_FAILED', message, details);
    case 'protocol':
      return new PipelineStepError('MODEL_OUTPUT_INVALID', message, details);
    default:
      return new PipelineStepError('INTERNAL', message, details);
  }
}
