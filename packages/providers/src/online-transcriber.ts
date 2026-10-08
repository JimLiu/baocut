import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ProviderFailure,
  type AsrResult,
  type AsrWarning,
  type TranscribeAttempt,
  type TranscribeProvider,
  type TranscribeRun,
  type TranscribeSink,
} from '@baocut/models';
import type { AdapterConfig, AdapterHttp, TranscribeAdapter } from './adapter.ts';
import {
  CHUNK_FORMATS,
  RANGE_CLAMP_TOLERANCE_SEC,
  detectSilences,
  encodeChunk,
  extractAudio,
  type FfmpegResolver,
} from './audio/audio-prep.ts';
import { chunkLimitSec, planChunks } from './audio/chunk-plan.ts';
import { ProviderAborted, redact } from './http/provider-fetch.ts';
import type { CallReporter } from './usage-reporter.ts';
import { buildAsrResult, noAudioResult, type ChunkResult, type ResultContext } from './transcript.ts';
import { ProvidersConfig as PC, ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

/**
 * 在线 Provider 的转写执行者（架构设计 §6.4）：一个 `providerId` 一个实例。
 *
 * 解码（ffmpeg → staging 里的母带）→ 超过单次请求的上限时在静音处切片 → 按顺序逐块提交（进度按秒）→ 时间换回素材时钟、
 * 拼成 `baocut.asr-result/v1` 写进 staging。取消时中止在途的 HTTP 请求与 ffmpeg，以 `cancelled` 兑现。
 * 中间文件（母带与切片）在这一次尝试结束时删掉；staging 本身由 JobManager 在任务终结时删除。
 */

export interface OnlineTranscriberOptions {
  providerId: string;
  label: string;
  adapter: TranscribeAdapter;
  /** 此刻的配置（含从凭据存储取出的密钥）；停用或缺密钥时 null，凭据存储不可用时抛 `ProviderFailure`。 */
  config: () => Promise<AdapterConfig | null>;
  ffmpeg: FfmpegResolver;
  http?: AdapterHttp;
  /** 调用结束时的报告（用量账本与账号状态，§6.10）：一次尝试一条，切片合在一起，用量是已经转写的秒数。 */
  report?: CallReporter;
}

interface CallState {
  sent: { accountId: string | null; startedAt: number } | null;
  audioSeconds: number;
}

const WORK_DIR = 'online';
const RESULT_FILE = 'result.json';
/** 解出来的音频短于这个长度就不提交，直接是 `no-speech`。 */
const MIN_AUDIO_SEC = 0.05;

export class OnlineTranscriber implements TranscribeProvider {
  readonly id: string;
  readonly #options: OnlineTranscriberOptions;
  readonly #inflight = new Set<AbortController>();

  constructor(options: OnlineTranscriberOptions) {
    this.#options = options;
    this.id = options.providerId;
  }

  async transcribe(run: TranscribeRun, sink: TranscribeSink, signal: AbortSignal): Promise<TranscribeAttempt> {
    const { adapter } = this.#options;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort();
    this.#inflight.add(controller);
    const work = path.join(run.staging, WORK_DIR);
    // 这次尝试用的密钥：出错时据此去掉错误文本里的密钥，不在错误处理里再取一次。
    let secret: string | null = null;
    const call: CallState = { sent: null, audioSeconds: 0 };
    const report = (error?: unknown) => {
      if (!call.sent || !this.#options.report || !run.modelId) return;
      this.#options.report({
        capability: 'transcribe',
        modelId: run.modelId,
        source: 'job',
        ref: { jobId: run.jobId },
        accountId: call.sent.accountId,
        startedAt: call.sent.startedAt,
        units: { audioSeconds: Math.round(call.audioSeconds * 1000) / 1000 },
        ...(error !== undefined ? { error } : {}),
      });
    };
    try {
      const config = await this.#options.config();
      if (!config) throw new ProviderFailure('unavailable', PC.notEnabledOrNoKey({ label: this.#options.label }).text, { providerId: this.id });
      secret = config.credential;
      const result = await this.#run(run, sink, controller.signal, work, config, call);
      report();
      const bytes = Buffer.from(`${JSON.stringify(result)}\n`, 'utf8');
      await fs.writeFile(path.join(run.staging, RESULT_FILE), bytes);
      return {
        outcome: 'completed',
        output: { path: RESULT_FILE, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length },
        workerVersion: adapter.version,
      };
    } catch (error) {
      if (controller.signal.aborted || error instanceof ProviderAborted) return { outcome: 'cancelled', workerVersion: adapter.version };
      if (error instanceof ProviderFailure) {
        report(error);
        throw error;
      }
      // 意料之外的错误：文本可能来自供应商的响应，去掉密钥再报告。
      const message = error instanceof Error ? error.message : String(error);
      const failure = new ProviderFailure('protocol', redact(PC.transcribeFailed({ label: this.#options.label, message }).text, secret ? [secret] : []));
      report(failure);
      throw failure;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.#inflight.delete(controller);
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  async #run(
    run: TranscribeRun,
    sink: TranscribeSink,
    signal: AbortSignal,
    work: string,
    config: AdapterConfig,
    call: CallState,
  ): Promise<AsrResult> {
    const { adapter, label, ffmpeg } = this.#options;
    const modelId = run.modelId;
    const model = adapter.models(config).find((m) => m.modelId === modelId);
    if (!modelId || !model)
      throw new ProviderFailure('unavailable', PC.noModel({ label, model: modelId ?? PC.modelUnspecified() }).text, { providerId: this.id });

    const timescale = run.options.timescale;
    const range = run.input.range;
    const offsetSec = range ? range.start / range.timescale : 0;
    const requestedSec = range ? (range.end - range.start) / range.timescale : null;
    const context: ResultContext = {
      providerId: this.id,
      modelId,
      workerVersion: adapter.version,
      contentHash: run.input.contentHash,
      runGeneration: run.runGeneration,
      timescale,
      language: run.options.language,
      offsetSec,
    };

    sink.phase('decoding');
    const master = path.join(work, 'master.wav');
    const extracted = await extractAudio({
      ffmpeg,
      file: run.input.file,
      track: run.input.track,
      ...(range ? { range: { startSec: offsetSec, durationSec: requestedSec } } : {}),
      out: master,
      signal,
    });
    if (extracted === 'no-audio-track') {
      sink.phase('finalizing');
      return noAudioResult(context);
    }
    const decodedSec = extracted.durationSec;
    const warnings: AsrWarning[] = [];
    if (requestedSec !== null && requestedSec - decodedSec > RANGE_CLAMP_TOLERANCE_SEC) {
      const warning: AsrWarning = {
        code: 'range-clamped',
        detail: PH.rangeClamped({ decoded: decodedSec.toFixed(3), requested: requestedSec.toFixed(3) }).text,
      };
      warnings.push(warning);
      sink.warning(warning);
    }
    if (decodedSec < MIN_AUDIO_SEC) {
      sink.phase('finalizing');
      return buildAsrResult({ chunks: [], context, decodedSec, warnings });
    }

    const format = adapter.chunkFormat(model);
    const spec = CHUNK_FORMATS[format];
    const maxChunkSec = chunkLimitSec({
      maxDurationSec: model.maxDurationSec,
      maxInputBytes: model.maxInputBytes,
      bytesPerSec: spec.bytesPerSec,
      overheadBytes: spec.overheadBytes,
      preferredSec: adapter.preferredChunkSec(model),
    });
    const silences = decodedSec > maxChunkSec ? await detectSilences({ ffmpeg, master, durationSec: decodedSec, signal }) : [];
    const plan = Number.isFinite(maxChunkSec)
      ? planChunks({ durationSec: decodedSec, maxChunkSec, silences })
      : [{ start: 0, end: decodedSec }];

    sink.phase('transcribing');
    sink.progress({ phase: 'transcribing', done: 0, total: round(decodedSec), unit: 'seconds' });
    const chunks: ChunkResult[] = [];
    let languageReported = false;
    for (const [index, planned] of plan.entries()) {
      const encoded = await encodeChunk({
        ffmpeg,
        master,
        startSec: planned.start,
        endSec: planned.end,
        format,
        out: path.join(work, `chunk-${String(index).padStart(4, '0')}.${spec.extension}`),
        signal,
      });
      call.sent ??= { accountId: config.accountId ?? null, startedAt: Date.now() };
      const transcript = await adapter.transcribeChunk({
        config,
        model,
        file: encoded.path,
        byteLength: encoded.byteLength,
        format,
        durationSec: planned.end - planned.start,
        language: run.options.language,
        ...(run.options.hint ? { hint: run.options.hint } : {}),
        signal,
        http: this.#options.http ?? {},
      });
      call.audioSeconds += planned.end - planned.start;
      await fs.rm(encoded.path, { force: true });
      chunks.push({ startSec: planned.start, endSec: planned.end, transcript });
      if (!languageReported && transcript.language && run.options.language.mode !== 'assert') {
        languageReported = true;
        sink.language(transcript.language, null);
      }
      sink.progress({ phase: 'transcribing', done: round(planned.end), total: round(decodedSec), unit: 'seconds' });
    }

    sink.phase('finalizing');
    const result = buildAsrResult({ chunks, context, decodedSec, warnings });
    for (const segment of result.segments) sink.segment(segment);
    return result;
  }

  /** 停止：中止所有在途的请求。 */
  async close(): Promise<void> {
    for (const controller of this.#inflight) controller.abort();
  }
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
