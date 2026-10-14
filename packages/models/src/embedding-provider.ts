import crypto from 'node:crypto';
import fs from 'node:fs/promises';

/**
 * 本机 embedding 的执行接口（EmbeddingGemma 2 检索集成方案 v0.1 §3.1、§4、§5）。Provider 只处理已冻结的输入与配置，返回向量与
 * 诊断，不知道「项目」「短视频」「B-roll」，也不访问检索库。检索库（`runtime-core/src/space/semantic/`）只经这个接口要向量。
 *
 * 身份（§5.3）：`embeddingSpaceId` 标识可比较的向量空间（模型权重系列、pooling、tokenizer、前缀配对、维度、归一化、量化兼容组）；
 * `encoderProfileId` 标识实际编码实现（空间 + 输入模态 + SDK 版本 + 模型文件校验和 + 预处理）。两者都不同于模型包 ID：换了量化包、
 * 前缀或维度就是新空间，旧索引不能与新查询向量直接比较（§4.4）。
 */

/** 输入在任务里的角色：检索的查询与文档用一对前缀（`retrieval` profile），对称相似用同一个前缀（`symmetric` profile，§15.3）。 */
export type EmbeddingRole = 'query' | 'document' | 'symmetric';

/** profile 的用途（创作辅助集成设计 §3.10）。 */
export type EmbeddingPurpose = 'retrieval' | 'symmetric' | 'text-to-visual';

export interface EmbeddingProfile {
  embeddingSpaceId: string;
  encoderProfileId: string;
  /** 前缀配对的版本（§5.2）：决定 `formatEmbeddingInput` 怎么拼。 */
  promptPairId: string;
  /** 存储与比较的维度（Matryoshka 截断后重新归一化）。 */
  dims: number;
  /** 单条输入的上限（token，估计）；超出时 Provider 报 `INPUT_TOO_LONG`，不静默截断（§6）。 */
  maxInputTokens: number;
  /** 实际后端设备（`cpu` / `gpu`），还没加载时 null。 */
  device: string | null;
  /** `text-to-visual` 才有：关键帧怎么取（长边像素、格式）与一批至多几张。取法进 `encoderProfileId`。 */
  frames?: EmbeddingFrames;
}

export interface EmbeddingFrames {
  edge: number;
  format: 'jpeg';
  maxBatch: number;
}

/** 一批关键帧（检索规格 §6.2）：Runtime 媒体分析缓存里的图片文件，绝对路径。图片不加前缀。 */
export interface EmbeddingImageRequest {
  images: readonly string[];
}

export interface EmbeddingInput {
  /** 原文（不清洗，§6.1）。 */
  text: string;
  /** 文档标题（`document` 角色）；没有时按模型卡写 `none`。 */
  title?: string | null;
}

export interface EmbeddingRequest {
  role: EmbeddingRole;
  inputs: readonly EmbeddingInput[];
}

export interface EmbeddingResult {
  /** 与输入一一对应、按顺序；L2 归一化、维度 = `profile.dims`。 */
  vectors: Float32Array[];
  /** 实际送进模型的文字（含前缀）摘要：`embeddingKey` 的输入（§5.3）。图片是文件内容的摘要。 */
  payloadDigests: string[];
}

/**
 * 不可用、不兼容、超长都以 `EmbeddingError` 抛出，`reason` 是 `SemanticReason`（`@baocut/protocol` 的 semantic.ts）。
 */
export class EmbeddingError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = 'EmbeddingError';
    this.reason = reason;
  }
}

export interface EmbeddingProvider {
  /** 这个 Provider 当前的 profile；没有可用模型时抛 `EmbeddingError('MODEL_NOT_INSTALLED')`。 */
  profile(purpose: EmbeddingPurpose): Promise<EmbeddingProfile>;
  /** 一批输入编码。批大小由调用方控制（文字 batch 上限 16，§16.1）。 */
  embed(purpose: EmbeddingPurpose, request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResult>;
  /**
   * 一批关键帧编码（`text-to-visual`，与它的查询文字在同一个空间）；一批至多 `profile('text-to-visual').frames.maxBatch` 张。
   * 没有能编码图片的模型包时抛 `MODEL_NOT_INSTALLED`。不支持图片的 Provider 不实现它。
   */
  embedImages?(request: EmbeddingImageRequest, signal?: AbortSignal): Promise<EmbeddingResult>;
}

/**
 * 模型卡的前缀（§5.2，G0 选定的 `promptPairId`）。只在这里加一次：LiteRT-LM 的 C API 不自动加任务前缀（插入的只是特殊 token）。
 * 纯图片、声音不加文字前缀。
 */
export const PROMPT_PAIR_MODEL_CARD = 'model-card-v1';

export function formatEmbeddingInput(promptPairId: string, role: EmbeddingRole, input: EmbeddingInput): string {
  if (promptPairId !== PROMPT_PAIR_MODEL_CARD) throw new Error(`unknown prompt pair: ${promptPairId}`);
  // 首尾空白会改变向量（G0：同一句带不带结尾空白余弦低到 0.947）：编码前一律去掉。
  const text = input.text.trim();
  // i18n-ignore-start: 模型的任务前缀，原样交给模型
  switch (role) {
    case 'query':
      return `task: search result | query: ${text}`;
    case 'document':
      return `title: ${input.title?.trim() ? input.title.trim() : 'none'} | text: ${text}`;
    case 'symmetric':
      return `task: sentence similarity | query: ${text}`;
  }
  // i18n-ignore-end
}

/** 截到 `dims` 维并重新 L2 归一化（Matryoshka，§5.1）。零向量与非有限值抛错：不入库（§18.2）。 */
export function truncateAndNormalize(vector: ArrayLike<number>, dims: number): Float32Array {
  if (vector.length < dims) throw new EmbeddingError('PROFILE_INCOMPATIBLE', `vector has ${vector.length} dims, need ${dims}`);
  const out = new Float32Array(dims);
  let sum = 0;
  for (let i = 0; i < dims; i++) {
    const v = vector[i]!;
    if (!Number.isFinite(v)) throw new EmbeddingError('MODEL_UNAVAILABLE', 'embedding has a non-finite value');
    out[i] = v;
    sum += v * v;
  }
  const norm = Math.sqrt(sum);
  if (!(norm > 1e-12)) throw new EmbeddingError('MODEL_UNAVAILABLE', 'embedding is a zero vector');
  for (let i = 0; i < dims; i++) out[i]! /= norm;
  return out;
}

export function digestText(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * 测试与无模型开发用的确定性编码器：按字符 n-gram 哈希成稀疏向量再归一化。它只保证「字面相近 → 余弦高」，不是语义模型；
 * 它的空间 ID 以 `test-` 开头，与真实模型的索引不能混用。
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly #dims: number;
  readonly #synonyms: ReadonlyMap<string, string>;
  calls = 0;

  constructor(options: { dims?: number; synonyms?: Record<string, string> } = {}) {
    this.#dims = options.dims ?? 64;
    this.#synonyms = new Map(Object.entries(options.synonyms ?? {}));
  }

  async profile(purpose: EmbeddingPurpose): Promise<EmbeddingProfile> {
    return {
      embeddingSpaceId: `test-hashing-${this.#dims}-${purpose}`,
      encoderProfileId: `test-hashing-${this.#dims}-${purpose}@1`,
      promptPairId: PROMPT_PAIR_MODEL_CARD,
      dims: this.#dims,
      maxInputTokens: 2048,
      device: 'cpu',
      ...(purpose === 'text-to-visual' ? { frames: { edge: 512, format: 'jpeg' as const, maxBatch: 4 } } : {}),
    };
  }

  /** 测试用：把图片文件的内容当文字编码（测试里的「关键帧」是写着画面描述的文本文件）。 */
  async embedImages(request: EmbeddingImageRequest, signal?: AbortSignal): Promise<EmbeddingResult> {
    signal?.throwIfAborted();
    this.calls += 1;
    const vectors: Float32Array[] = [];
    const payloadDigests: string[] = [];
    for (const image of request.images) {
      const bytes = await fs.readFile(image);
      payloadDigests.push(crypto.createHash('sha256').update(bytes).digest('hex'));
      vectors.push(this.#vector(bytes.toString('utf8')));
    }
    return { vectors, payloadDigests };
  }

  async embed(purpose: EmbeddingPurpose, request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResult> {
    signal?.throwIfAborted();
    this.calls += 1;
    const profile = await this.profile(purpose);
    const vectors: Float32Array[] = [];
    const payloadDigests: string[] = [];
    for (const input of request.inputs) {
      const payload = formatEmbeddingInput(profile.promptPairId, request.role, input);
      payloadDigests.push(digestText(payload));
      vectors.push(this.#vector(input.text));
    }
    return { vectors, payloadDigests };
  }

  #vector(text: string): Float32Array {
    let normalized = text.normalize('NFKC').toLowerCase();
    for (const [from, to] of this.#synonyms) normalized = normalized.split(from).join(to);
    const chars = [...normalized.replace(/\s+/g, ' ').trim()];
    const v = new Float32Array(this.#dims);
    const add = (gram: string, weight: number) => {
      const h = crypto.createHash('md5').update(gram).digest();
      const index = h.readUInt32LE(0) % this.#dims;
      v[index]! += (h[4]! & 1 ? 1 : -1) * weight;
    };
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] !== ' ') add(chars[i]!, 0.5);
      if (i + 1 < chars.length) add(chars[i]! + chars[i + 1]!, 1);
    }
    if (chars.length === 0) v[0] = 1;
    try {
      return truncateAndNormalize(v, this.#dims);
    } catch {
      const fallback = new Float32Array(this.#dims);
      fallback[0] = 1;
      return fallback;
    }
  }
}
