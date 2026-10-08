import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ProviderFailure,
  codePointLength,
  type GenerationAttempt,
  type GenerationOutputFile,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSink,
} from '@baocut/models';
import type { UsageUnits } from '@baocut/protocol';
import { IMAGE_MEDIA, SPEECH_MEDIA, type AdapterConfig, type AdapterHttp, type ImageAdapter, type SpeechAdapter } from './adapter.ts';
import { ProviderAborted, redact } from './http/provider-fetch.ts';
import type { CallReporter } from './usage-reporter.ts';
import { ProvidersConfig as PC, ProvidersHttp as PH } from '@baocut/protocol/messages/providers';

export interface OnlineGeneratorOptions {
  providerId: string;
  label: () => string;
  speech: SpeechAdapter | null;
  image: ImageAdapter | null;
  /** 执行时的配置（含从凭据存储取出的密钥）；没有启用或没有密钥时 null，凭据存储不可用时抛 `ProviderFailure`。 */
  config: () => Promise<AdapterConfig | null>;
  http?: AdapterHttp;
  /** 调用结束时的报告（用量账本与账号状态，§6.10）。 */
  report?: CallReporter;
}

/**
 * 在线 Provider 的生成执行者（架构设计 §6.4、§6.6）：执行时再读一次配置，按冻结的模型与参数发一次请求，
 * 把响应写成 staging 里的 `output-<n>.<ext>` 并算好摘要。不重试换模型，不截断文本；校验与发布在 JobManager 里。
 */
export class OnlineGenerator implements GenerationProvider {
  readonly id: string;
  readonly #options: OnlineGeneratorOptions;
  readonly #inflight = new Set<AbortController>();

  constructor(options: OnlineGeneratorOptions) {
    this.#options = options;
    this.id = options.providerId;
  }

  async generate(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort();
    this.#inflight.add(controller);
    // 这次尝试用的密钥：出错时据此去掉错误文本里的密钥，不在错误处理里再取一次。
    let secret: string | null = null;
    // 请求发出时记下（用量账本只记真的发出了请求的调用）。
    const call: { sent: { accountId: string | null; startedAt: number } | null } = { sent: null };
    const report = (units: UsageUnits, error?: unknown) => {
      if (!call.sent || !this.#options.report) return;
      this.#options.report({
        capability: run.parameters.capability,
        modelId: run.modelId,
        source: 'job',
        ref: { jobId: run.jobId },
        accountId: call.sent.accountId,
        startedAt: call.sent.startedAt,
        units,
        ...(error !== undefined ? { error } : {}),
      });
    };
    try {
      const config = await this.#options.config();
      if (!config) throw new ProviderFailure('unavailable', PC.notEnabledOrNoKey({ label: this.#options.label() }).text, { providerId: this.id });
      secret = config.credential;
      const attempt = await this.#run(run, sink, controller.signal, config, call);
      if (attempt.outcome === 'completed') report(unitsOf(run, attempt.outputs.length));
      return attempt;
    } catch (error) {
      if (controller.signal.aborted || error instanceof ProviderAborted) return { outcome: 'cancelled' };
      if (error instanceof ProviderFailure) {
        report({}, error);
        throw error;
      }
      // 意料之外的错误：文本可能来自供应商的响应，去掉密钥再报告。
      const message = error instanceof Error ? error.message : String(error);
      const failure = new ProviderFailure('protocol', redact(PC.generateFailed({ label: this.#options.label(), message }).text, secret ? [secret] : []));
      report({}, failure);
      throw failure;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.#inflight.delete(controller);
    }
  }

  async #run(
    run: GenerationRun,
    sink: GenerationSink,
    signal: AbortSignal,
    config: AdapterConfig,
    call: { sent: { accountId: string | null; startedAt: number } | null },
  ): Promise<GenerationAttempt> {
    const send = () => (call.sent = { accountId: config.accountId ?? null, startedAt: Date.now() });
    const label = this.#options.label();
    const http = this.#options.http ?? {};
    const parameters = run.parameters;

    if (parameters.capability === 'synthesizeSpeech') {
      const adapter = this.#options.speech;
      const model = adapter?.models(config).find((m) => m.modelId === run.modelId);
      if (!adapter || !model)
        throw new ProviderFailure('unavailable', PC.noSpeechModel({ label, model: run.modelId }).text, { providerId: this.id });
      sink.generating();
      send();
      const output = await adapter.synthesize({ config, model, parameters, signal, http });
      const media = SPEECH_MEDIA[parameters.format];
      const file = await writeOutput(run.staging, 0, media.extension, media.mediaType, output.bytes);
      sink.progress(1, 1);
      return {
        outcome: 'completed',
        outputs: [file],
        workerVersion: adapter.version,
        ...(output.usage !== undefined ? { usage: output.usage } : {}),
      };
    }

    // 文本生成走 `OnlineTextProvider`（经 `TextRunner`），不会派到这里。
    if (parameters.capability === 'generateText') {
      throw new ProviderFailure('unavailable', PC.noTextGeneration({ label }).text, { providerId: this.id });
    }

    const adapter = this.#options.image;
    const model = adapter?.models(config).find((m) => m.modelId === run.modelId);
    if (!adapter || !model) throw new ProviderFailure('unavailable', PC.noImageModel({ label, model: run.modelId }).text, { providerId: this.id });
    sink.generating();
    send();
    const output = await adapter.generate({
      config,
      model,
      parameters,
      signal,
      http,
      progress: (done) => sink.progress(done, parameters.count),
    });
    if (output.images.length !== parameters.count) {
      throw new ProviderFailure('protocol', PH.imageCount({ label, got: output.images.length, want: parameters.count }).text);
    }
    const media = IMAGE_MEDIA[parameters.format];
    const outputs: GenerationOutputFile[] = [];
    for (const [index, bytes] of output.images.entries()) {
      outputs.push(await writeOutput(run.staging, index, media.extension, media.mediaType, bytes));
    }
    return {
      outcome: 'completed',
      outputs,
      workerVersion: adapter.version,
      ...(output.usage !== undefined ? { usage: output.usage } : {}),
    };
  }

  async close(): Promise<void> {
    for (const controller of this.#inflight) controller.abort();
  }
}

/** 用量（§6.10）：语音合成是字符数（按 Unicode 码点），生图是张数。 */
function unitsOf(run: GenerationRun, outputs: number): UsageUnits {
  const parameters = run.parameters;
  if (parameters.capability === 'synthesizeSpeech') return { chars: codePointLength(parameters.text) };
  if (parameters.capability === 'generateImage') return { images: outputs };
  return {};
}

async function writeOutput(
  staging: string,
  index: number,
  extension: string,
  mediaType: string,
  bytes: Buffer,
): Promise<GenerationOutputFile> {
  if (bytes.length === 0) throw new ProviderFailure('protocol', PH.emptyOutput().text);
  const name = `output-${index + 1}.${extension}`;
  await fs.writeFile(path.join(staging, name), bytes);
  return { path: name, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, mediaType };
}
