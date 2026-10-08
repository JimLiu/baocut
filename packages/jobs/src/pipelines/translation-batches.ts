import fs from 'node:fs/promises';
import { RpcError, type GlossaryEntry, type Id, type JobCallCounts, type TranslateSummary } from '@baocut/protocol';
import { TextGenerationError, type TextGenerator } from '@baocut/models';
import type { ArtifactStore } from '../artifact-store.ts';
import { JobsTranslationBatches as J } from '@baocut/protocol/messages/jobs/translation-batches.ts';
import { joinList } from '../job-text.ts';
import { CallCounter, PipelineStepError, type PipelinePrepareOptions, type ProgressReporter } from './pipeline.ts';
import { translationMessages, translationSchema } from './translation-prompts.ts';
import {
  MAX_LIBRARY_GLOSSARIES,
  glossarySnapshot,
  resolveGlossaries,
  selectTerms,
  type FrozenGlossary,
  type GlossaryLibrary,
  type GlossarySnapshot,
  type PromptTerm,
} from './translation-glossary.ts';

/**
 * 逐批翻译（架构设计 §7.9）：`translate`（视频里的文稿）与 `translate-subtitles`（字幕文件）共用的部分——分批、带前文、
 * 每批只带相关的术语、结构化输出按 ID 一一核对、不合时有限次重发、并发与调用计数；以及术语表参数的校验、冻结与读取。
 * 两个流程各自决定原文从哪来、译文写到哪去。
 */

/** 每批带几句前文作参考。 */
const CONTEXT_SENTENCES = 3;

/** `glossary` 参数：调用时直接给的术语。 */
export const GLOSSARY_SCHEMA = {
  type: 'array',
  maxItems: 500,
  items: {
    type: 'object',
    properties: { source: { type: 'string' }, target: { type: 'string' }, note: { type: 'string' } },
    required: ['source', 'target'],
    additionalProperties: false,
  },
};

/** `glossaries` 参数（翻译、翻译配音与字幕文件的翻译共用）。 */
export const GLOSSARIES_SCHEMA = {
  type: 'array',
  maxItems: MAX_LIBRARY_GLOSSARIES,
  // i18n-ignore: 参数说明（给智能体的 JSON Schema）
  description: '用户库里翻译用术语表的 ID（可以指定版本）；与视频里启用的合在一起用',
  items: {
    type: 'object',
    properties: { id: { type: 'string' }, version: { type: 'integer', minimum: 1 } },
    required: ['id'],
    additionalProperties: false,
  },
};

/** `glossary`：每一项要有非空的原文与译法。 */
export function parseInlineGlossary(raw: unknown[] | undefined): GlossaryEntry[] | undefined {
  if (raw === undefined) return undefined;
  return raw.map((entry) => {
    const e = entry as Partial<GlossaryEntry> | null;
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string' || e.source.trim() === '' || e.target.trim() === '') {
      throw new RpcError('invalid-request', J.glossaryItemInvalid());
    }
    if (e.note !== undefined && typeof e.note !== 'string') throw new RpcError('invalid-request', J.glossaryNoteInvalid());
    return { source: e.source, target: e.target, ...(e.note ? { note: e.note } : {}) };
  });
}

/** `glossaries`：库里术语表的 ID 与可选的版本。 */
export function parseGlossaryRefs(raw: unknown[] | undefined): Array<{ id: Id; version?: number }> | undefined {
  if (raw === undefined) return undefined;
  return raw.map((item) => {
    const ref = item as { id?: unknown; version?: unknown } | null;
    if (!ref || typeof ref !== 'object' || typeof ref.id !== 'string' || ref.id === '' || ref.id.length > 100) {
      throw new RpcError('invalid-request', J.glossariesItemInvalid());
    }
    const extra = Object.keys(ref).filter((k) => k !== 'id' && k !== 'version');
    if (extra.length > 0) throw new RpcError('invalid-request', J.glossariesUnknownFields({ fields: joinList(extra) }));
    if (ref.version !== undefined && !(Number.isInteger(ref.version) && (ref.version as number) >= 1)) {
      throw new RpcError('invalid-request', J.glossariesVersionInvalid());
    }
    return { id: ref.id, ...(ref.version !== undefined ? { version: ref.version as number } : {}) };
  });
}

/** 冻结的术语表：库里的条目与版本、视频启用而没用的，以及内容的产物。 */
export interface FrozenGlossaryUse {
  entries: FrozenGlossary[];
  skipped: Array<{ id: Id; reason: 'removed' | 'language' }>;
  /** `GlossarySnapshot` 的产物；没有库里的条目时 null（只用调用时给的术语）。 */
  artifactId: string | null;
}

/** 冻结的参数里与术语有关的两项。 */
export interface GlossaryParams {
  glossary?: GlossaryEntry[];
  glossaryUse?: FrozenGlossaryUse;
}

/**
 * 启动时解析库里的术语表：调用时给的（`explicit`）与视频里启用的（`enabled`，没有视频时为空）；用到库里的条目时把内容
 * 写成产物，之后的步骤只读产物。都没有时 undefined。
 */
export async function freezeGlossaryUse(
  deps: { library?: GlossaryLibrary; artifacts?: Pick<ArtifactStore, 'put'> },
  input: {
    explicit: Array<{ id: Id; version?: number }>;
    enabled: Id[];
    targetLanguage: string;
    sourceLanguage: string | null;
    submitter: PipelinePrepareOptions['submitter'];
  },
): Promise<FrozenGlossaryUse | undefined> {
  const resolved = resolveGlossaries({ library: deps.library, ...input });
  if (resolved.entries.length === 0 && resolved.skipped.length === 0) return undefined;
  let artifactId: string | null = null;
  if (resolved.entries.length > 0) {
    if (!deps.artifacts) throw new RpcError('invalid-request', J.cannotFreezeGlossaries());
    // 解析之后立即读出冻结的版本，写成产物；之后的步骤只读产物。
    const snapshot = glossarySnapshot(deps.library, [], resolved.entries);
    artifactId = (await deps.artifacts.put(Buffer.from(JSON.stringify(snapshot)), 'json')).artifactId;
  }
  return { entries: resolved.entries, skipped: resolved.skipped, artifactId };
}

/** 这次翻译用的术语：调用时直接给的，加上冻结的库里术语表的内容。 */
export async function loadGlossaries(artifacts: ArtifactStore, params: GlossaryParams): Promise<GlossarySnapshot> {
  const stored = params.glossaryUse?.artifactId ? await readArtifact<GlossarySnapshot>(artifacts, params.glossaryUse.artifactId) : null;
  return { inline: params.glossary ?? [], entries: stored?.entries ?? [] };
}

/** 摘要里的术语表：调用时没给、视频里也没启用时 undefined。 */
export function glossarySummary(
  params: GlossaryParams,
  translated: { glossaryTerms?: number; cappedBatches?: number } | null | undefined,
): TranslateSummary['glossary'] {
  const use = params.glossaryUse;
  if (!use && !params.glossary?.length) return undefined;
  return {
    entries: (use?.entries ?? []).map(({ id, version, contentHash, name, origin }) => ({ id, version, contentHash, name, origin })),
    skipped: use?.skipped ?? [],
    terms: translated?.glossaryTerms ?? 0,
    cappedBatches: translated?.cappedBatches ?? 0,
  };
}

export async function readArtifact<T>(artifacts: ArtifactStore, artifactId: string): Promise<T> {
  const file = await artifacts.locate(artifactId);
  if (!file) throw new PipelineStepError('ARTIFACT_NOT_FOUND', J.artifactGone({ artifactId }));
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

/** 一次逐批翻译的输入：原文（按 ID）、语言、风格、冻结的模型与批大小，以及去重之后的术语。 */
export interface BatchTranslationInput {
  sentences: Array<{ id: Id; text: string }>;
  targetLanguage: string;
  sourceLanguage: string | null;
  style?: string;
  provider: string;
  model: string;
  batchSize: number;
  terms: PromptTerm[];
}

export interface BatchTranslationOptions {
  /** 一批的输出不合约定时再发几次。 */
  retries: number;
  /** 同时在途的批数。 */
  concurrency: number;
  signal: AbortSignal;
  progress: ProgressReporter;
  /** 原文的一项是什么（错误信息里用）：文稿是句子（缺省），字幕文件是一条字幕。 */
  unit?: 'sentence' | 'cue';
}

export interface BatchTranslationResult {
  /** 与输入一一对应、顺序相同。 */
  translations: Array<{ id: Id; text: string }>;
  calls: JobCallCounts;
  modelVersion: string | null;
  /** 相关术语超过上限的批数。 */
  cappedBatches: number;
}

/** 按句分批翻译。每批的输出必须与这一批一一对应；不合时重发，仍不合则抛出（不留半份译文）。 */
export async function translateInBatches(
  text: Pick<TextGenerator, 'generate'>,
  input: BatchTranslationInput,
  options: BatchTranslationOptions,
): Promise<BatchTranslationResult> {
  const { sentences, terms } = input;
  const { retries, signal, progress } = options;
  const unit = options.unit ?? 'sentence';
  const batches: Array<{ start: number; end: number }> = [];
  for (let start = 0; start < sentences.length; start += input.batchSize)
    batches.push({ start, end: Math.min(sentences.length, start + input.batchSize) });

  const counter = new CallCounter();
  const texts = new Map<Id, string>();
  let modelVersion: string | null = null;
  const report = () => progress({ done: texts.size, total: sentences.length, unit: 'units', calls: counter.snapshot() }, 'generating');
  report();

  // 一批失败时停下其余的批。
  const local = new AbortController();
  const stop = () => local.abort();
  signal.addEventListener('abort', stop, { once: true });
  let cappedBatches = 0;
  const baseInstructions = {
    targetLanguage: input.targetLanguage,
    sourceLanguage: input.sourceLanguage,
    ...(input.style !== undefined ? { style: input.style } : {}),
  };

  const runBatch = async ({ start, end }: { start: number; end: number }) => {
    const items = sentences.slice(start, end).map((s) => ({ id: s.id, text: s.text }));
    const ids = items.map((i) => i.id);
    const context = sentences.slice(Math.max(0, start - CONTEXT_SENTENCES), start).map((s) => s.text);
    // 术语：每批只带相关的，有上限（见 translation-glossary.ts）。
    const selected = selectTerms(terms, [...context, ...items.map((i) => i.text)].join('\n'));
    if (selected.capped > 0) cappedBatches++;
    const instructions = {
      ...baseInstructions,
      ...(selected.terms.length > 0
        ? { glossary: selected.terms.map((t) => ({ source: t.source, target: t.target, ...(t.note ? { note: t.note } : {}) })) }
        : {}),
    };
    for (let attempt = 0; ; attempt++) {
      local.signal.throwIfAborted();
      counter.calls++;
      report();
      let problem: string;
      try {
        const result = await text.generate(
          {
            messages: translationMessages({ sentences: items, context }, instructions),
            responseFormat: { type: 'json', schema: translationSchema(ids), name: 'translations' },
            provider: input.provider,
            model: input.model,
          },
          { signal: local.signal },
        );
        const checked = checkBatch(result.json, ids);
        if (Array.isArray(checked)) {
          for (const t of checked) texts.set(t.id, t.text);
          modelVersion ??= result.modelVersion;
          report();
          return;
        }
        problem = checked.problem;
      } catch (error) {
        if (!(error instanceof TextGenerationError && error.code === 'MODEL_OUTPUT_INVALID')) {
          counter.failures++;
          report();
          throw error;
        }
        problem = error.message;
      }
      if (attempt >= retries) {
        counter.failures++;
        report();
        const range = { first: start + 1, last: end, retries };
        throw new PipelineStepError('MODEL_OUTPUT_INVALID', unit === 'cue' ? J.batchFailedCues(range) : J.batchFailedSentences(range), {
          reason: 'schema',
          problem,
          sentences: { first: ids[0], last: ids[ids.length - 1] },
          calls: counter.snapshot(),
        });
      }
      counter.retries++;
    }
  };

  try {
    let next = 0;
    let failure: unknown = null;
    const worker = async () => {
      while (next < batches.length && failure === null) {
        const batch = batches[next++]!;
        try {
          await runBatch(batch);
        } catch (error) {
          failure ??= error;
          local.abort();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency, batches.length) }, worker));
    if (failure !== null) throw failure;
  } finally {
    signal.removeEventListener('abort', stop);
  }
  return {
    translations: sentences.map((s) => ({ id: s.id, text: texts.get(s.id)! })),
    calls: counter.snapshot(),
    modelVersion,
    cappedBatches,
  };
}

/** 核对一批的输出：与输入同样多、ID 一一对应、文本非空。 */
export function checkBatch(json: unknown, ids: Id[]): Array<{ id: Id; text: string }> | { problem: string } {
  const list = (json as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(list)) return { problem: J.outputNoTranslations().text };
  if (list.length !== ids.length) return { problem: J.outputCountMismatch({ output: list.length, input: ids.length }).text };
  const byId = new Map<string, string>();
  for (const item of list as Array<{ id?: unknown; text?: unknown }>) {
    if (typeof item?.id !== 'string' || typeof item.text !== 'string' || item.text.trim() === '')
      return { problem: J.outputIncompleteItem().text };
    if (byId.has(item.id)) return { problem: J.outputDuplicateId({ id: item.id }).text };
    byId.set(item.id, item.text.trim());
  }
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length > 0) return { problem: J.outputMissingIds({ ids: joinList(missing) }).text };
  return ids.map((id) => ({ id, text: byId.get(id)! }));
}
