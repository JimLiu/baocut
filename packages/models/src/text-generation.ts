import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  TEXT_EFFORTS,
  type GenerateTextRequest,
  type MessageRef,
  type GenerationParameters,
  type TextCapabilityParameters,
  type TextEffort,
  type TextFinishReason,
  type TextModelInfo,
  type TextUsage,
  type UsageRecord,
  type UsageSource,
} from '@baocut/protocol';
import { compileJsonSchema, JsonSchemaError } from '@baocut/protocol/json-schema';
import { ModelsTextGeneration as M } from '@baocut/protocol/messages/models/text-generation.ts';
import { codePointLength } from './generation-options.ts';
import type { GenerationAttempt, GenerationProvider, GenerationRun, GenerationSink } from './generation-provider.ts';
import type { ModelChoice } from './model-selection.ts';
import { ProviderFailure } from './transcribe-provider.ts';
import { modelTextRef, type ModelText } from './model-text.ts';

/**
 * `generateText`（架构设计 §6.1、§6.4）：文本模型的一次调用。两个入口共用一条执行路径：
 *
 * - **任务**：`models.generateText` 提交一个 Job，执行者是 `TextJobGenerator`，全文写进 staging，由 JobManager 校验、发布为产物；
 * - **进程内**：流程（翻译、润色、分章……）经 `TextGenerator.generate()` 直接拿结果，不建 Job。
 *
 * 两者都经同一个 `TextRunner`：每个 Provider 一个并发上限（能力参数 `concurrency`，默认 4，任务与进程内调用共用）、
 * 调用计数，以及 `finishText` 的结果检查（结构化输出按 schema 校验，`length` 不算完整的成功）。
 * 连不上、超时、5xx 与带 `Retry-After` 的 429 由在线 Provider 的 HTTP 层有界重试（§6.4）；这里不再重试，
 * 不换 Provider 或模型；输出不合 schema 不重试（§6.2）。
 */

export type TextParameters = Extract<GenerationParameters, { capability: 'generateText' }>;

/** 提交时冻结的一次调用。 */
export interface TextRun {
  providerId: string;
  modelId: string;
  parameters: TextParameters;
  /** 用量账本（§6.10）的来源：任务是 `job`，进程内调用默认 `inline`。 */
  source?: UsageSource;
  ref?: UsageRecord['ref'];
}

/** 适配器读出的一次响应：原样的文本、结束原因与用量。检查在 `finishText` 里。 */
export interface TextReply {
  text: string;
  finishReason: TextFinishReason;
  usage: TextUsage | null;
  /** 供应商报告的模型版本；没有时 null。 */
  modelVersion: string | null;
  /** 适配器版本。 */
  workerVersion: string;
}

/** 执行过程中的回调（计数用）。 */
export interface TextCallHooks {
  /** HTTP 层每退避重试一次调用一次。 */
  retry(): void;
}

/** 一个 Provider 的文本执行者：按冻结的参数发一次请求。失败抛 `ProviderFailure`；`signal` 中止时尽快抛出。 */
export interface TextProvider {
  readonly id: string;
  generateText(run: TextRun, signal: AbortSignal, hooks: TextCallHooks): Promise<TextReply>;
}

/** 一次调用的结果（进程内入口直接拿到；任务把全文发布为产物，摘要写进 `result.text`）。 */
export interface TextResult {
  providerId: string;
  modelId: string;
  /** 模型输出的全文。结构化输出时是 JSON 文本。 */
  text: string;
  /** 结构化输出：校验过的值。 */
  json?: unknown;
  /** `length` 只出现在纯文本：结构化输出被截断一律失败。 */
  finishReason: 'stop' | 'length';
  usage: TextUsage | null;
  modelVersion: string | null;
  effort: { requested: TextEffort | null; applied: TextEffort | null };
  notes: string[];
  workerVersion: string;
}

// ---- 提交时：检查并冻结参数 ----

/** 最接近的一档；一样近时取高的。`supported` 为空时 null。 */
export function nearestEffort(requested: TextEffort, supported: readonly TextEffort[]): TextEffort | null {
  if (supported.includes(requested)) return requested;
  const rank = (e: TextEffort) => TEXT_EFFORTS.indexOf(e);
  let best: TextEffort | null = null;
  for (const candidate of supported) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const d = Math.abs(rank(candidate) - rank(requested));
    const bestD = Math.abs(rank(best) - rank(requested));
    if (d < bestD || (d === bestD && rank(candidate) > rank(best))) best = candidate;
  }
  return best;
}

/**
 * 请求与模型的特性是否相容，相容时给出冻结的参数（§6.2）。不合的一律 `invalid-request`，`details` 带上模型的限制：
 * 输出上限超过模型的、模型不接受的 `temperature` / `seed` / 结构化输出、编译不过的 JSON Schema。
 * 推理强度不拒绝：没给时用能力参数的默认值，模型没有那一档时换成最接近的一档，不能调节时忽略（都在结果里注明）。
 */
export function textParameters(
  choice: ModelChoice<'generateText'>,
  request: GenerateTextRequest,
  defaults: TextCapabilityParameters,
): TextParameters {
  const model: TextModelInfo = choice.model;
  const where = { providerId: choice.providerId, modelId: choice.modelId };
  const messages = request.messages.map((m) => ({ role: m.role, content: m.content }));
  if (!messages.some((m) => m.role !== 'system' && m.content.trim().length > 0)) {
    throw new RpcError('invalid-request', M.noMessage());
  }
  if (messages.some((m) => !['system', 'user', 'assistant'].includes(m.role))) {
    throw new RpcError('invalid-request', M.badRole());
  }
  // 粗查：按字符数估的输入明显超过上下文时在提交时拒绝（一个 token 至少一个字符）。精确的检查在供应商那里（`INPUT_TOO_LONG`）。
  const chars = messages.reduce((sum, m) => sum + codePointLength(m.content), 0);
  if (chars > model.contextTokens * 8) {
    throw new RpcError('invalid-request', M.inputTooLong({ chars, modelId: choice.modelId, contextTokens: model.contextTokens }), {
      ...where,
      code: 'INPUT_TOO_LONG',
      contextTokens: model.contextTokens,
    });
  }

  const maxOutputTokens = request.maxOutputTokens ?? model.maxOutputTokens;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > model.maxOutputTokens) {
    throw new RpcError('invalid-request', M.maxOutput({ modelId: choice.modelId, max: model.maxOutputTokens }), {
      ...where,
      maxOutputTokens: model.maxOutputTokens,
    });
  }

  let temperature: number | null = null;
  if (request.temperature !== undefined) {
    if (!model.acceptsTemperature) throw new RpcError('invalid-request', M.noTemperature({ modelId: choice.modelId }), where);
    if (!(request.temperature >= 0 && request.temperature <= 2))
      throw new RpcError('invalid-request', M.temperatureRange(), where);
    temperature = request.temperature;
  }

  let seed: number | null = null;
  if (request.seed !== undefined) {
    if (!model.acceptsSeed) throw new RpcError('invalid-request', M.noSeed({ modelId: choice.modelId }), where);
    seed = request.seed;
  }

  const format = request.responseFormat ?? { type: 'text' as const };
  let responseFormat: TextParameters['responseFormat'];
  if (format.type === 'json') {
    if (!model.structuredOutput) throw new RpcError('invalid-request', M.noStructured({ modelId: choice.modelId }), where);
    try {
      compileJsonSchema(format.schema);
    } catch (error) {
      if (error instanceof JsonSchemaError) throw new RpcError('invalid-request', error.message, where);
      throw error;
    }
    responseFormat = { type: 'json', schema: structuredClone(format.schema), ...(format.name ? { name: format.name } : {}) };
  } else {
    responseFormat = { type: 'text' };
  }

  const requestedEffort = request.effort ?? defaults.effort;
  const effort = requestedEffort === null ? null : nearestEffort(requestedEffort, model.efforts);
  return { capability: 'generateText', messages, responseFormat, maxOutputTokens, temperature, requestedEffort, effort, seed };
}

/** 推理强度被换档或忽略时的说明。 */
export function effortNotes(parameters: TextParameters, modelId: string): string[] {
  const { requestedEffort, effort } = parameters;
  if (requestedEffort === null || requestedEffort === effort) return [];
  if (effort === null) return [M.effortIgnored({ modelId, requested: requestedEffort }).text];
  return [M.effortChanged({ modelId, requested: requestedEffort, applied: effort }).text];
}

// ---- 响应：检查 ----

/**
 * 检查一次响应（§6.4 的输出合同）：
 * - `content-filter` → `PROVIDER_REJECTED`（`reason: 'content-filter'`）；
 * - 结构化输出：被截断（`length`）、不是 JSON、不合 schema → `MODEL_OUTPUT_INVALID`（`reason`：`length`、`schema`）；
 * - 纯文本：空输出 → `MODEL_OUTPUT_INVALID`（`reason: 'empty'`）；`length` 照样返回，由调用方当作不完整的结果。
 */
export function finishText(run: TextRun, reply: TextReply, label: string): TextResult {
  const { parameters } = run;
  if (reply.finishReason === 'content-filter') {
    throw new ProviderFailure('rejected', M.contentFiltered({ provider: label }), {
      code: 'PROVIDER_REJECTED',
      reason: 'content-filter',
      finishReason: 'content-filter',
    });
  }
  const base = {
    providerId: run.providerId,
    modelId: run.modelId,
    finishReason: reply.finishReason,
    usage: reply.usage,
    modelVersion: reply.modelVersion,
    effort: { requested: parameters.requestedEffort, applied: parameters.effort },
    notes: effortNotes(parameters, run.modelId),
    workerVersion: reply.workerVersion,
  };
  if (parameters.responseFormat.type === 'json') {
    if (reply.finishReason === 'length') {
      throw invalidOutput('length', M.truncatedJson({ provider: label, max: parameters.maxOutputTokens }), [
        M.truncatedProblem({ max: parameters.maxOutputTokens }).text,
      ]);
    }
    let value: unknown;
    try {
      value = JSON.parse(reply.text);
    } catch {
      throw invalidOutput('schema', M.notJson({ provider: label }), [M.notJsonProblem().text]);
    }
    const problems = compileJsonSchema(parameters.responseFormat.schema).validate(value);
    if (problems.length > 0) throw invalidOutput('schema', M.schemaMismatch({ provider: label }), problems);
    return { ...base, finishReason: 'stop', text: reply.text, json: value };
  }
  if (reply.text.trim().length === 0) {
    const truncated = reply.finishReason === 'length';
    throw invalidOutput(
      truncated ? 'length' : 'empty',
      truncated ? M.limitBeforeText({ provider: label }) : M.emptyOutput({ provider: label }),
      [truncated ? M.limitBeforeTextProblem({ max: parameters.maxOutputTokens }).text : M.emptyProblem().text],
    );
  }
  return { ...base, finishReason: reply.finishReason, text: reply.text };
}

function invalidOutput(reason: 'length' | 'schema' | 'empty', message: ModelText, problems: string[]): ProviderFailure {
  return new ProviderFailure('protocol', message, { reason, problems });
}

// ---- 共用的执行：并发上限与计数 ----

export interface TextCallStats {
  /** 发出的调用（每次 `generate` 或任务的一次执行算一次）。 */
  calls: number;
  /** HTTP 层的退避重试次数。 */
  retries: number;
  /** 以失败结束的调用（不含取消）。 */
  failures: number;
}

export interface TextRunnerOptions {
  /** 一个 Provider 同时进行的调用数；每次排队时读一次（改了配置立即生效）。 */
  concurrency(providerId: string): number;
  /** 给人看的 Provider 名字。 */
  label?(providerId: string): string;
}

/** 调用被取消（`signal` 中止）。 */
export class TextCallCancelled extends Error {
  constructor() {
    super('Call cancelled');
    this.name = 'TextCallCancelled';
  }
}

interface Gate {
  active: number;
  waiting: Array<() => void>;
}

export class TextRunner {
  readonly #options: TextRunnerOptions;
  readonly #gates = new Map<string, Gate>();
  readonly #stats = new Map<string, TextCallStats>();

  constructor(options: TextRunnerOptions) {
    this.#options = options;
  }

  /** 按冻结的参数执行一次：排到这个 Provider 的并发名额，发请求，检查响应。失败抛 `ProviderFailure`，取消抛 `TextCallCancelled`。 */
  async run(provider: TextProvider, run: TextRun, signal: AbortSignal): Promise<TextResult> {
    if (signal.aborted) throw new TextCallCancelled();
    await this.#acquire(run.providerId, signal);
    const stats = this.#statsOf(run.providerId);
    stats.calls++;
    try {
      const reply = await provider.generateText(run, signal, { retry: () => stats.retries++ });
      if (signal.aborted) throw new TextCallCancelled();
      return finishText(run, reply, this.#options.label?.(run.providerId) ?? run.providerId);
    } catch (error) {
      if (signal.aborted || error instanceof TextCallCancelled) throw new TextCallCancelled();
      stats.failures++;
      throw error;
    } finally {
      this.#release(run.providerId);
    }
  }

  /** 各 Provider 的计数（拷贝）。 */
  stats(): Record<string, TextCallStats> {
    return Object.fromEntries([...this.#stats].map(([id, s]) => [id, { ...s }]));
  }

  /** 此刻在进行的调用数（测试与诊断用）。 */
  active(providerId: string): number {
    return this.#gates.get(providerId)?.active ?? 0;
  }

  #statsOf(providerId: string): TextCallStats {
    let stats = this.#stats.get(providerId);
    if (!stats) {
      stats = { calls: 0, retries: 0, failures: 0 };
      this.#stats.set(providerId, stats);
    }
    return stats;
  }

  #gate(providerId: string): Gate {
    let gate = this.#gates.get(providerId);
    if (!gate) {
      gate = { active: 0, waiting: [] };
      this.#gates.set(providerId, gate);
    }
    return gate;
  }

  #limit(providerId: string): number {
    return Math.max(1, Math.floor(this.#options.concurrency(providerId)));
  }

  #acquire(providerId: string, signal: AbortSignal): Promise<void> {
    const gate = this.#gate(providerId);
    if (gate.active < this.#limit(providerId) && gate.waiting.length === 0) {
      gate.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener('abort', onAbort);
        gate.active++;
        resolve();
      };
      const onAbort = () => {
        const index = gate.waiting.indexOf(grant);
        if (index >= 0) gate.waiting.splice(index, 1);
        reject(new TextCallCancelled());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      gate.waiting.push(grant);
    });
  }

  #release(providerId: string): void {
    const gate = this.#gate(providerId);
    gate.active--;
    while (gate.waiting.length > 0 && gate.active < this.#limit(providerId)) gate.waiting.shift()!();
  }
}

// ---- 任务入口的执行者 ----

/** 任务的一次执行：经 `TextRunner` 调用，把全文写进 staging（`output-1.txt` 或 `output-1.json`），交给 JobManager 校验与发布。 */
export class TextJobGenerator implements GenerationProvider {
  readonly id: string;
  readonly #runner: TextRunner;
  readonly #provider: TextProvider;
  readonly #inflight = new Set<AbortController>();

  constructor(runner: TextRunner, provider: TextProvider) {
    this.#runner = runner;
    this.#provider = provider;
    this.id = provider.id;
  }

  async generate(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    const parameters = run.parameters;
    if (parameters.capability !== 'generateText') {
      throw new ProviderFailure('unavailable', `The text runner can't run ${parameters.capability}`, { providerId: this.id });
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) controller.abort();
    this.#inflight.add(controller);
    try {
      sink.generating();
      const result = await this.#runner.run(
        this.#provider,
        { providerId: run.providerId, modelId: run.modelId, parameters, source: 'job', ref: { jobId: run.jobId } },
        controller.signal,
      );
      const json = parameters.responseFormat.type === 'json';
      const bytes = Buffer.from(json ? `${JSON.stringify(result.json, null, 2)}\n` : result.text, 'utf8');
      const name = `output-1.${json ? 'json' : 'txt'}`;
      await fs.writeFile(path.join(run.staging, name), bytes);
      sink.progress(1, 1);
      return {
        outcome: 'completed',
        outputs: [
          {
            path: name,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            byteLength: bytes.length,
            mediaType: json ? 'application/json' : 'text/plain',
          },
        ],
        workerVersion: result.workerVersion,
        ...(result.usage ? { usage: result.usage } : {}),
        text: result,
      };
    } catch (error) {
      if (error instanceof TextCallCancelled || controller.signal.aborted) return { outcome: 'cancelled' };
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.#inflight.delete(controller);
    }
  }

  async close(): Promise<void> {
    for (const controller of this.#inflight) controller.abort();
  }
}

// ---- 进程内入口 ----

/** 进程内调用的错误：错误码与任务的同一个封闭集合（命令与协议规范 §11.3），另加 `CANCELLED`。 */
export type TextErrorCode =
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INPUT_TOO_LONG'
  | 'MODEL_OUTPUT_INVALID'
  | 'MODEL_LOAD_FAILED'
  | 'CANCELLED';

export class TextGenerationError extends Error {
  readonly code: TextErrorCode;
  readonly details: Record<string, unknown>;

  /** 用目录文字构造时的消息引用。 */
  readonly messageRef: MessageRef | undefined;

  constructor(code: TextErrorCode, message: ModelText, details: Record<string, unknown> = {}) {
    super(String(message));
    this.messageRef = modelTextRef(message);
    this.name = 'TextGenerationError';
    this.code = code;
    this.details = details;
  }
}

const REJECTION_CODES = new Set(['PROVIDER_AUTH_FAILED', 'PROVIDER_QUOTA_EXCEEDED', 'PROVIDER_REJECTED', 'INPUT_TOO_LONG']);

/** `ProviderFailure` → 封闭的错误码（与 JobManager 给任务的错误码相同）。 */
export function textErrorOf(failure: ProviderFailure, providerId: string): TextGenerationError {
  const { code, ...rest } = failure.details;
  switch (failure.kind) {
    case 'rejected':
      return new TextGenerationError(
        (typeof code === 'string' && REJECTION_CODES.has(code) ? code : 'PROVIDER_REJECTED') as TextErrorCode,
        failure.message,
        { ...rest, providerId },
      );
    case 'unavailable-remote':
      return new TextGenerationError('PROVIDER_UNAVAILABLE', failure.message, { ...rest, providerId });
    case 'protocol':
      return new TextGenerationError('MODEL_OUTPUT_INVALID', failure.message, { ...failure.details, providerId });
    default:
      return new TextGenerationError('MODEL_LOAD_FAILED', failure.message, { ...failure.details, providerId });
  }
}

/** 进程内的请求：同 `models.generateText` 的参数，没有 `commandId`。 */
export type TextGenerateRequest = Omit<GenerateTextRequest, 'commandId'>;

/**
 * 进程内的文本生成入口：选择（§6.2，同任务）→ 冻结参数 → 经共用的 `TextRunner` 执行。
 * 选择与参数的错误照提交时的样子抛 `RpcError`（`CAPABILITY_NOT_CONFIGURED`、`invalid-request`、`not-found`）；
 * 执行的错误抛 `TextGenerationError`。
 */
export interface TextGenerator {
  /** `source` 与 `ref` 写进用量账本（§6.10）：默认 `inline`；智能体工具直接发起的给 `agent-tool`。 */
  generate(
    request: TextGenerateRequest,
    options?: { signal?: AbortSignal; source?: 'inline' | 'agent-tool'; ref?: UsageRecord['ref'] },
  ): Promise<TextResult>;
  /** 各 Provider 的调用、重试与失败计数（任务与进程内调用合计）。 */
  stats(): Record<string, TextCallStats>;
}

/** 选择一次调用的 Provider 与模型，交出执行者与参数默认值（`ModelServices.selectText` 实现它）。 */
export interface TextSelection extends ModelChoice<'generateText'> {
  text: TextProvider;
  defaults: TextCapabilityParameters;
}

export function createTextGenerator(options: {
  select(target: { provider?: string; model?: string }): Promise<TextSelection>;
  runner: TextRunner;
}): TextGenerator {
  return {
    async generate(request, { signal, source, ref } = {}) {
      const selection = await options.select({
        ...(request.provider !== undefined ? { provider: request.provider } : {}),
        ...(request.model !== undefined ? { model: request.model } : {}),
      });
      const parameters = textParameters(selection, request, selection.defaults);
      try {
        return await options.runner.run(
          selection.text,
          {
            providerId: selection.providerId,
            modelId: selection.modelId,
            parameters,
            source: source ?? 'inline',
            ...(ref ? { ref } : {}),
          },
          signal ?? new AbortController().signal,
        );
      } catch (error) {
        if (error instanceof TextCallCancelled)
          throw new TextGenerationError('CANCELLED', M.cancelled(), { providerId: selection.providerId });
        if (error instanceof ProviderFailure) throw textErrorOf(error, selection.providerId);
        throw error;
      }
    },
    stats: () => options.runner.stats(),
  };
}
