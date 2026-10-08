import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RpcError, type Id, type JobCallCounts, type TextModelInfo } from '@baocut/protocol';
import { TextCallCancelled, TextGenerationError, type TextGenerateRequest, type TextGenerator } from '@baocut/models';
import {
  JsonLineWorker,
  WorkerRequestError,
  executableName,
  findBundledBinary,
  type WorkerCommand,
  type WorkerEvent,
} from '@baocut/process-host';
import { JobsSpeechWorker } from '@baocut/protocol/messages/jobs/speech-worker.ts';
import { CallCounter, PipelineStepError, type ProgressReporter } from './pipeline.ts';
import { translationShapeProblems, type TranslationBody } from './translation-document.ts';
import type { GlossaryRef } from './translation-glossary.ts';

/**
 * Speech Worker 的 Runtime 一侧（架构设计 §7.9、§13.1；协议见命令协议规范 §4.5）：字幕与翻译核心
 * （`speech-doc`）跑在这个独立进程里，一步一个进程，跑完关掉。
 *
 * - 冻结的输入写进 staging 的 `input.json`，产出（`baocut.translation/2` 正文、目标语言的字幕条、报告）也写在 staging，
 *   Worker 不联网、不写视频目录；
 * - Worker 的每一次模型调用以 `llm.request` 事件交回来，这里经流程既有的 `generateText`（`text.generate`：选 Provider、
 *   授权与任务预算、账本、停止屏障都在它那边）发出，把文本或分类过的失败以 `llm.reply` 交回；密钥只在 Provider 的认证头里，
 *   不进 Worker 的环境、事件或请求；
 * - 失败的分类：输出不合约定（含被截断）是 `malformed`，由核心自己重发；取消是 `cancelled`；其余（授权、预算、停止屏障、
 *   Provider 拒绝或在 HTTP 层有界重试之后仍不可用，§6.4）是 `terminal`：核心停下，已完成的页留在检查点里，这一步以原样的
 *   错误对象失败（`pendingGrants` 等细节不丢）；
 * - 中止（取消、Runtime 停止）时发 `cancel`，在途的调用随 `signal` 中止，进程随后关掉。
 */

export const SPEECH_WORKER_PROTOCOL = 'speech-worker/1';
export const SPEECH_TRANSLATE_INPUT_SCHEMA = 'baocut.speech-worker.translate/1';
export const SPEECH_WORKER_CUES_SCHEMA = 'baocut.speech-worker.cues/1';

const INPUT_FILE = 'input.json';
const CLOSE_GRACE_MS = 2_000;
const HELLO_TIMEOUT_MS = 10_000;
const MESSAGE_LIMIT = 300;

/**
 * Speech Worker 的位置：`BAOCUT_SPEECH_WORKER` 环境变量；引擎宿主旁边的 `speech-worker`（同一次 cargo 构建的产物，或打包后同在
 * `<resources>/bin`）；随应用分发的原生程序目录；或者从本模块往上找 cargo 产物目录（开发时由 `npm run build:engine` 构建）。找不到时 null。
 */
export function resolveSpeechWorkerCommand(engineHost: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BAOCUT_SPEECH_WORKER) return env.BAOCUT_SPEECH_WORKER;
  if (engineHost && path.isAbsolute(engineHost)) {
    const sibling = path.join(path.dirname(engineHost), executableName('speech-worker'));
    if (existsSync(sibling)) return sibling;
  }
  return findBundledBinary('speech-worker', path.dirname(fileURLToPath(import.meta.url)), env);
}

/** `translate` 的冻结输入（`baocut.speech-worker.translate/1`，`schema` 由这里填）。 */
export interface SpeechTranslateInput {
  media: {
    assetId: Id | null;
    path?: string;
    contentHash: string;
    duration: { ticks: string; timescale: number };
    sampleRate?: number;
  };
  sourceLanguage: string | null;
  speechRef: { id: Id; revision: string };
  sequenceId: Id;
  /** `baocut.speech/1` 正文。 */
  speech: unknown;
  targetLanguage: string;
  glossary: Array<{ source: string; target: string; note?: string }>;
  glossaryRef: GlossaryRef | null;
  params?: { instructions?: string; backoffScale?: number };
}

/** Worker 写出的译文正文（`baocut.translation/2`；单元带核心的对齐块与显示改写）。 */
export type SpeechWorkerTranslation = Omit<TranslationBody, 'units'> & {
  units: Array<{ id: Id; sourceSentenceId: Id; sourceFingerprint: string; naturalText: string } & Record<string, unknown>>;
};

/** 目标语言的一条字幕：时间是 `timescale` 下的整数刻度（原文转写的时钟）。 */
export interface SpeechWorkerCue {
  unitId: Id | null;
  sentenceId: Id;
  text: string;
  start: number;
  end: number;
  /** 对齐不可用、按句时长摊开的那几条。 */
  fallback: boolean;
}

export interface SpeechWorkerCues {
  schema: typeof SPEECH_WORKER_CUES_SCHEMA;
  language: string;
  timescale: number;
  cues: SpeechWorkerCue[];
}

/** Worker 的事件里，调用方可能想看的那几种（进度另经 `progress` 交出）。 */
export type SpeechWorkerNotice =
  | { event: 'checkpoint'; phase: string; pages: number; translatedSentences: number }
  | { event: 'resumed'; phase: string; translatedSentences: number; totalSentences: number };

export interface SpeechTranslateOptions {
  /** 可执行文件，或带参数与环境的命令。只给路径时子进程只拿到 `PATH`、`TMPDIR` 与语言区域的环境变量。 */
  command: string | WorkerCommand;
  /** 这一步专用的 staging 目录：输入、检查点与产出都在这里，失败或中断后保留，重试时从检查点继续。 */
  staging: string;
  input: SpeechTranslateInput;
  text: Pick<TextGenerator, 'generate'>;
  provider: string;
  model: string;
  /** 冻结的模型的限制：输出上限按它夹，不接受温度时不带温度。 */
  modelInfo: Pick<TextModelInfo, 'maxOutputTokens' | 'acceptsTemperature'>;
  signal: AbortSignal;
  progress?: ProgressReporter;
  onNotice?: (notice: SpeechWorkerNotice) => void;
}

export interface SpeechTranslateResult {
  translation: SpeechWorkerTranslation;
  cues: SpeechWorkerCues;
  /** Worker 的报告（简报、分页、对齐、调用数……），原样。 */
  report: Record<string, unknown>;
  /** 这次执行发出的调用（续跑时不含之前那次的）。 */
  calls: JobCallCounts;
  /** 第一次成功的调用报出的模型版本；没有报出时 null。 */
  modelVersion: string | null;
}

interface LlmRequestParams {
  requestId: number;
  kind: string;
  attempt: number;
  system: string;
  user: string;
  temperature: number | null;
  maxOutputTokens: number | null;
}

type ErrorClass = 'retryable' | 'malformed' | 'terminal' | 'cancelled';

type Outcome = { ok: true; value: unknown } | { ok: false; error: unknown };

function progressOf(params: unknown): { stage: string; done: number; total: number | null } {
  const p = (params ?? {}) as { stage?: unknown; done?: unknown; total?: unknown };
  return {
    stage: typeof p.stage === 'string' ? p.stage : '',
    done: typeof p.done === 'number' ? p.done : 0,
    total: typeof p.total === 'number' ? p.total : null,
  };
}

/** 在 Speech Worker 里跑一次翻译。产出不合约定时以 `WORKER_OUTPUT_INVALID` 失败。 */
export async function runSpeechTranslate(options: SpeechTranslateOptions): Promise<SpeechTranslateResult> {
  const { staging, input, signal } = options;
  signal.throwIfAborted();
  await fs.mkdir(staging, { recursive: true });
  const inputPath = path.join(staging, INPUT_FILE);
  await fs.writeFile(inputPath, JSON.stringify({ schema: SPEECH_TRANSLATE_INPUT_SCHEMA, ...input }));

  const command: WorkerCommand = typeof options.command === 'string' ? { command: options.command, env: workerEnv() } : options.command;
  const worker = await JsonLineWorker.start(command);
  const counter = new CallCounter();
  const report = (done: number, total: number | null) =>
    options.progress?.({ done, total, unit: 'units', calls: counter.snapshot() }, 'generating');
  const onAbort = () => void worker.request('cancel', {}).catch(() => {});
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const hello = await worker.request<{ protocol?: unknown; methods?: unknown }>('hello', {}, { timeoutMs: HELLO_TIMEOUT_MS });
    if (hello?.protocol !== SPEECH_WORKER_PROTOCOL || !Array.isArray(hello.methods) || !hello.methods.includes('translate')) {
      throw new PipelineStepError('WORKER_INCOMPATIBLE', JobsSpeechWorker.incompatible({ protocol: SPEECH_WORKER_PROTOCOL }), {
        protocol: hello?.protocol ?? null,
      });
    }

    const events: WorkerEvent[] = [];
    let wake: (() => void) | null = null;
    worker.onEvent((event) => {
      events.push(event);
      wake?.();
    });
    const state: { outcome: Outcome | null } = { outcome: null };
    void worker.request('translate', { input: inputPath, staging }).then(
      (value) => {
        state.outcome = { ok: true, value };
        wake?.();
      },
      (error: unknown) => {
        state.outcome = { ok: false, error };
        wake?.();
      },
    );

    // 第一个终止性失败的原样错误：Worker 停下之后，这一步照它失败。
    let terminal: unknown = null;
    let modelVersion: string | null = null;
    let done = 0;
    let total: number | null = null;
    report(done, total);
    for (;;) {
      while (events.length > 0) {
        const event = events.shift()!;
        if (event.event === 'llm.request') {
          const params = event.params as LlmRequestParams;
          counter.calls++;
          if (params.attempt > 0) counter.retries++;
          report(done, total);
          const reply = await answer(options, params, signal);
          if ('text' in reply) modelVersion ??= reply.modelVersion;
          if ('error' in reply) {
            counter.failures++;
            if (reply.error.class === 'terminal' || reply.error.class === 'cancelled') terminal ??= reply.cause;
          }
          const wire =
            'error' in reply ? { requestId: reply.requestId, error: reply.error } : { requestId: reply.requestId, text: reply.text };
          void worker.request('llm.reply', wire).catch(() => {});
        } else if (event.event === 'progress') {
          const progress = progressOf(event.params);
          if (progress.stage === 'translate') {
            done = progress.done;
            total = progress.total;
            report(done, total);
          }
        } else if (event.event === 'checkpoint' || event.event === 'resumed') {
          options.onNotice?.({ event: event.event, ...(event.params as object) } as SpeechWorkerNotice);
        }
      }
      if (state.outcome !== null) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (events.length > 0 || state.outcome !== null) resolve();
      });
      wake = null;
    }

    const settled = state.outcome;
    if (!settled.ok) {
      signal.throwIfAborted();
      const error = settled.error;
      if (terminal !== null && error instanceof WorkerRequestError) throw terminal;
      if (error instanceof WorkerRequestError) {
        const details = error.body.details;
        throw new PipelineStepError(
          error.code,
          error.body.message,
          typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : undefined,
        );
      }
      throw new PipelineStepError('WORKER_FAILED', JobsSpeechWorker.exited(), { exit: worker.alive ? null : await worker.exited });
    }
    const outputs = await readOutputs(staging, settled.value);
    const problems = [
      ...translationShapeProblems(outputs.translation, input.speechRef),
      ...((outputs.translation as { language?: unknown }).language === input.targetLanguage ? [] : [JobsSpeechWorker.translationLanguage().text]),
      ...cueProblems(outputs.cues, input),
    ];
    if (problems.length > 0) {
      throw new PipelineStepError('WORKER_OUTPUT_INVALID', JobsSpeechWorker.outputInvalid(), { problems: problems.slice(0, 20) });
    }
    report(total ?? done, total);
    return {
      translation: outputs.translation as SpeechWorkerTranslation,
      cues: outputs.cues as SpeechWorkerCues,
      report: outputs.report,
      calls: counter.snapshot(),
      modelVersion,
    };
  } finally {
    signal.removeEventListener('abort', onAbort);
    await worker.close(CLOSE_GRACE_MS);
  }
}

type Reply =
  | { requestId: number; text: string; modelVersion: string | null }
  | { requestId: number; error: { code: string; message: string; class: ErrorClass }; cause: unknown };

/** 经 `generateText` 发出一次调用，交回文本或分类过的失败。 */
async function answer(options: SpeechTranslateOptions, params: LlmRequestParams, signal: AbortSignal): Promise<Reply> {
  const { requestId } = params;
  const request: TextGenerateRequest = {
    messages: [
      ...(params.system.trim() !== '' ? [{ role: 'system' as const, content: params.system }] : []),
      { role: 'user' as const, content: params.user },
    ],
    provider: options.provider,
    model: options.model,
    ...(params.maxOutputTokens !== null ? { maxOutputTokens: Math.min(params.maxOutputTokens, options.modelInfo.maxOutputTokens) } : {}),
    ...(params.temperature !== null && options.modelInfo.acceptsTemperature ? { temperature: params.temperature } : {}),
  };
  try {
    const result = await options.text.generate(request, { signal });
    if (result.finishReason === 'length') {
      const cause = new TextGenerationError('MODEL_OUTPUT_INVALID', JobsSpeechWorker.outputTruncated().text);
      return { requestId, error: { code: cause.code, message: cause.message, class: 'malformed' }, cause };
    }
    return { requestId, text: result.text, modelVersion: result.modelVersion };
  } catch (error) {
    const errorClass = classify(error, signal);
    return {
      requestId,
      error: { code: codeOf(error, errorClass), message: messageOf(error), class: errorClass },
      cause: error,
    };
  }
}

function classify(error: unknown, signal: AbortSignal): ErrorClass {
  if (signal.aborted || error instanceof TextCallCancelled || (error instanceof Error && error.name === 'AbortError')) return 'cancelled';
  if (error instanceof TextGenerationError && error.code === 'MODEL_OUTPUT_INVALID') return 'malformed';
  // 授权、预算、停止屏障（RpcError），Provider 拒绝、在 HTTP 层有界重试之后仍不可用（TextGenerationError），以及别的意外。
  return 'terminal';
}

function codeOf(error: unknown, errorClass: ErrorClass): string {
  if (errorClass === 'cancelled') return 'CANCELLED';
  // 授权与预算的拒绝是 `forbidden` / `conflict`，具体原因（`GRANT_REQUIRED`、`BUDGET_EXCEEDED`……）在 `details.code`。
  if (error instanceof RpcError) {
    const detail = (error.details as { code?: unknown } | null | undefined)?.code;
    return typeof detail === 'string' ? detail : error.code;
  }
  if (error instanceof TextGenerationError || error instanceof PipelineStepError) return String(error.code);
  return 'INTERNAL';
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT)}…` : message;
}

/** 子进程的环境：不带 Runtime 进程里的任何密钥或令牌。 */
function workerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'RUST_BACKTRACE']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function readOutputs(
  staging: string,
  result: unknown,
): Promise<{ translation: unknown; cues: unknown; report: Record<string, unknown> }> {
  const files = result as { translation?: unknown; cues?: unknown; report?: unknown } | null;
  const read = async (name: unknown, field: string): Promise<unknown> => {
    if (typeof name !== 'string' || name === '' || path.basename(name) !== name) {
      throw new PipelineStepError('WORKER_OUTPUT_INVALID', JobsSpeechWorker.resultMissing({ field }));
    }
    try {
      return JSON.parse(await fs.readFile(path.join(staging, name), 'utf8'));
    } catch (error) {
      throw new PipelineStepError('WORKER_OUTPUT_INVALID', JobsSpeechWorker.unreadableFile({ name }), { reason: messageOf(error) });
    }
  };
  const translation = await read(files?.translation, 'translation');
  const cues = await read(files?.cues, 'cues');
  const report = await read(files?.report, 'report');
  return { translation, cues, report: typeof report === 'object' && report !== null ? (report as Record<string, unknown>) : {} };
}

/** 字幕条的形状与时间：整数刻度、起点在终点之前、按时间排好且不重叠、不超出媒体时长。问题是按当前语言生成的文字。 */
export function cueProblems(value: unknown, input: Pick<SpeechTranslateInput, 'targetLanguage' | 'speech' | 'media'>): string[] {
  const J = JobsSpeechWorker;
  const problems: string[] = [];
  const doc = value as Partial<SpeechWorkerCues> | null;
  if (!doc || typeof doc !== 'object') return [J.cuesNotObject().text];
  if (doc.schema !== SPEECH_WORKER_CUES_SCHEMA) problems.push(J.cuesSchema({ schema: SPEECH_WORKER_CUES_SCHEMA }).text);
  if (doc.language !== input.targetLanguage) problems.push(J.cuesLanguage().text);
  const speechTimescale = (input.speech as { timescale?: unknown } | null)?.timescale;
  if (!Number.isSafeInteger(doc.timescale) || doc.timescale! <= 0 || doc.timescale !== speechTimescale) {
    problems.push(J.cuesTimescale().text);
  }
  if (!Array.isArray(doc.cues)) return [...problems, J.cuesMissing().text];
  const timescale = typeof doc.timescale === 'number' && doc.timescale > 0 ? doc.timescale : 1;
  const durationSec = Number(input.media.duration.ticks) / input.media.duration.timescale;
  let previousEnd = 0;
  doc.cues.forEach((cue, i) => {
    const n = i + 1;
    if (!cue || typeof cue !== 'object') {
      problems.push(J.cueNotObject({ n }).text);
      return;
    }
    if (typeof cue.text !== 'string' || cue.text.trim() === '') problems.push(J.cueNoText({ n }).text);
    if (typeof cue.sentenceId !== 'string' || (cue.unitId !== null && typeof cue.unitId !== 'string'))
      problems.push(J.cueNoSentence({ n }).text);
    if (typeof cue.fallback !== 'boolean') problems.push(J.cueFallback({ n }).text);
    if (!Number.isSafeInteger(cue.start) || !Number.isSafeInteger(cue.end)) {
      problems.push(J.cueTicks({ n }).text);
      return;
    }
    if (cue.start < 0 || cue.end <= cue.start) problems.push(J.cueRange({ n }).text);
    if (cue.start < previousEnd) problems.push(J.cueOverlap({ n }).text);
    if (Number.isFinite(durationSec) && cue.end / timescale > durationSec + 1 / timescale) problems.push(J.cueBeyond({ n }).text);
    previousEnd = Math.max(previousEnd, cue.end);
  });
  return problems;
}
