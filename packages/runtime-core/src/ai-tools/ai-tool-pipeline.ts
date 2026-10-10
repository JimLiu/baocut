import fs from 'node:fs/promises';
import {
  AI_TOOL_APPLY_KINDS,
  AI_TOOL_PIPELINE,
  RpcError,
  type AiToolContext,
  type AiToolKind,
  type AiToolParams,
  type AiToolSummary,
  type AttachmentRef,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type TextModelInfo,
} from '@baocut/protocol';
import { aiToolParamsSchema } from '@baocut/protocol/schemas';
import { RcAiTools as M } from '@baocut/protocol/messages/runtime-core';
import {
  PipelineStepError,
  canonicalJson,
  sha256Hex,
  type ArtifactStore,
  type PipelineDefinition,
  type PipelineStepContext,
  type StepResult,
} from '@baocut/jobs';
import type { TextGenerator } from '@baocut/models';
import type { SkillSystemPrompt } from '../skills/skill-brief.ts';
import {
  aiToolMessages,
  chapterDrafts,
  outputSchema,
  polishBatches,
  polishEdits,
  type ContextAttachment,
  type ContextWord,
} from './ai-tool-prompt.ts';

/**
 * AI 工具的「直接调模型」（产品设计 §5.10，`ai-tool`）：不启动智能体、不经对话，把工具页提示词框里的文字与这个视频的
 * 上下文直接交给一个文本模型。与翻译同一套固定流程：后台任务、进度、取消（`jobs.cancel`）、从停下的那步重试
 * （`pipelines.retry`），每次调用经授权与预算（`withPipelineGrants`）。
 *
 * - 启动时冻结：选定的文本模型、挂着的 skill 合成的系统提示词（只带 `SKILL.md` 与它用到的 `references/`）、附件
 *   （文本文件附全文，图片与别的文件不发、计数）。重试沿用冻结的这些，不再读 skill 与附件。
 * - 收集上下文：与导出文稿同一份写法的 Markdown 文稿（带时间码、说话人与章节，按范围），润色另取范围里编了号的词。
 * - 调用模型：润色按段落分批、每批一次结构化输出（只能一词对一词地改）；章节一次结构化输出；其余工具一次正文输出。
 * - 写进视频（只有润色与章节）：润色把改过的词写回同一份转写（`putDocument`），章节整份替换（`setChapters`）；都是一笔
 *   以 `system:pipeline` 提交的事务，受版本校验，界面一键撤销。执行期间文稿改了时以 `STALE_JOB_INPUT` 失败，不写。
 */

/** 文稿外发：润色与写作都把文稿交给模型；附件按文档计。 */
export const AI_TOOL_DATA_KINDS = ['transcript', 'document'] as const;

const POLISH_BATCH_WORDS = 800;
const APPLY_ATTEMPTS = 3;
/** 文本附件的上限（字符）：超出的部分截掉、在正文末尾说明。 */
const ATTACHMENT_CHARS = 100_000;
const TEXT_MIME = /^(text\/|application\/json$)/;

export interface AiToolVideos {
  state(videoId: Id): { revision: string; rootSequenceId: Id; documents: Record<Id, DocumentRecord> } | null;
  /** 视频根序列的时长（秒）与已有章节数；没打开时 null。 */
  sequence(videoId: Id): { duration: number; chapters: number } | null;
  document(videoId: Id, documentId: Id, revision?: string): Promise<{ revision: string; body: unknown }>;
  apply(
    videoId: Id,
    request: { commandId: Id; expectedRevision: string; operations: EditOperation[]; label: string; run?: { runId: Id; runGeneration: string } },
  ): Promise<{ refs?: Record<string, Id>; transactionId?: Id }>;
}

export interface AiToolDeps {
  videos: AiToolVideos;
  text: Pick<TextGenerator, 'generate'>;
  selectText(target: { provider?: string; model?: string }): Promise<{ providerId: string; modelId: string; model: TextModelInfo }>;
  /** 与导出文稿同一份写法的 Markdown（`exports.renderText`）：正文、段数与字数。 */
  transcript(videoId: Id, request: { documentId: Id; range?: { start: number; end: number } }): Promise<{ content: string; paragraphs: number; characters: number }>;
  /** 范围里（时间线上）转写的词，按顺序；同一个词只出现一次。 */
  words(videoId: Id, request: { documentId: Id; range?: { start: number; end: number } }): Promise<ContextWord[]>;
  skills(refs: { id: string }[]): Promise<SkillSystemPrompt>;
  attachments(ids: Id[]): Promise<{ ref: AttachmentRef; path: string }[]>;
  artifacts: Pick<ArtifactStore, 'put' | 'read'>;
}

/** 启动时冻结的部分。 */
export interface FrozenAiToolParams extends AiToolParams {
  provider: string;
  model: string;
  /** 用到的转写（没有转写的写作工具为 null）。 */
  transcriptId: Id | null;
  frozen: {
    /** `{ system, attachments }` 的产物。 */
    artifactId: string;
    skills: string[];
    references: number;
    attachments: number;
    skippedAttachments: number;
  };
}

interface FrozenInputs {
  system: string;
  attachments: ContextAttachment[];
}

interface ContextOutput extends Record<string, unknown> {
  artifactId: string;
  documentId: Id | null;
  revision: string | null;
  paragraphs: number;
  characters: number;
  chapters: number;
}

interface ContextBody {
  transcript: string | null;
  words: ContextWord[];
  duration: number;
}

interface GenerateOutput extends Record<string, unknown> {
  artifactId: string;
  text: string | null;
  finishReason: 'stop' | 'length';
  /** 润色：词 id → 新文本；章节：草稿。 */
  edits?: Record<string, string>;
  chapters?: Array<{ at: number; title: string; summary: string }>;
}

interface ApplyOutput extends Record<string, unknown> {
  transactionId: Id | null;
  changes: number;
}

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    videoId: { type: 'string', description: '已打开的视频' },
    tool: { type: 'string', enum: ['polish', 'chapters', 'summary', 'blog', 'title', 'desc'], description: '哪个 AI 工具' },
    prompt: { type: 'string', description: '提示词' },
    range: {
      type: 'object',
      properties: { start: { type: 'number' }, end: { type: 'number' } },
      required: ['start', 'end'],
      description: '时间线上的一段（秒）；不给时整篇。chapters 不接受',
    },
    documentId: { type: 'string', description: '用哪份 speech 文档；只有一份时可以不给' },
    attachments: { type: 'array', items: { type: 'string' }, description: '附件 ID（attachments.prepare）' },
    skills: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, description: '作为系统提示词的 skill，按顺序' },
    provider: { type: 'string', description: '文本模型的 Provider；不给时用默认值' },
    model: { type: 'string' },
    // i18n-ignore-end
  },
  required: ['videoId', 'tool', 'prompt'],
  additionalProperties: false,
};

export function parseAiToolParams(raw: Record<string, unknown>): AiToolParams {
  const parsed = aiToolParamsSchema.safeParse(raw);
  if (!parsed.success) {
    const key = parsed.error.issues[0]?.path.map(String).join('.') || 'params';
    throw new RpcError('invalid-request', M.paramsInvalid({ key }), { key });
  }
  return parsed.data as AiToolParams;
}

const writes = (tool: AiToolKind) => AI_TOOL_APPLY_KINDS.includes(tool);
const structured = (tool: AiToolKind) => outputSchema(tool) !== null;

export function aiToolPipeline(deps: AiToolDeps): PipelineDefinition<FrozenAiToolParams, AiToolParams> {
  return {
    name: AI_TOOL_PIPELINE,
    label: () => M.label(),
    description: () => M.description(),
    paramsSchema: PARAMS_SCHEMA,
    parse: parseAiToolParams,
    async prepare(params, options) {
      const state = deps.videos.state(params.videoId);
      if (!state) throw new RpcError('not-found', M.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
      const documentId = pickTranscript(state.documents, params.documentId, params.tool);
      const selection = await deps.selectText({
        ...(params.provider !== undefined ? { provider: params.provider } : {}),
        ...(params.model !== undefined ? { model: params.model } : {}),
      });
      if (structured(params.tool) && !selection.model.structuredOutput) {
        throw new RpcError('invalid-request', M.noStructuredOutput({ model: selection.modelId }), {
          providerId: selection.providerId,
          modelId: selection.modelId,
        });
      }
      const frozen =
        'frozen' in params || options.retry ? (params as FrozenAiToolParams).frozen : await freezeInputs(deps, params);
      const plan: FrozenAiToolParams = { ...params, provider: selection.providerId, model: selection.modelId, transcriptId: documentId, frozen };
      const revision = documentId ? state.documents[documentId]!.currentRevision : null;
      return {
        params: plan,
        providerId: selection.providerId,
        modelId: selection.modelId,
        videoId: params.videoId,
        contentHash: `sha256:${sha256Hex(
          canonicalJson({ videoId: params.videoId, tool: params.tool, prompt: params.prompt, range: params.range ?? null, documentId, revision, inputs: frozen.artifactId }),
        )}`,
      };
    },
    steps: [
      {
        name: 'context',
        label: () => M.stepPrepare(),
        run: (context) => gatherContext(deps, context),
        // 文稿有了新版本：重试时重新收集。
        reusable: async (output, { params }) => {
          const o = output as Partial<ContextOutput>;
          return o.documentId === null || deps.videos.state(params.videoId)?.documents[o.documentId ?? '']?.currentRevision === o.revision;
        },
      },
      {
        name: 'generate',
        label: () => M.stepGenerate(),
        run: (context) => generate(deps, context),
      },
      {
        name: 'apply',
        label: () => M.stepApply(),
        when: (params) => writes(params.tool),
        run: (context) => apply(deps, context),
      },
    ],
    async complete({ params, outputs }) {
      const ctx = outputs.context as ContextOutput;
      const generated = outputs.generate as GenerateOutput;
      const applied = outputs.apply as ApplyOutput | undefined;
      const context: AiToolContext = {
        paragraphs: ctx.paragraphs,
        characters: ctx.characters,
        chapters: ctx.chapters,
        attachments: params.frozen.attachments,
        skippedAttachments: params.frozen.skippedAttachments,
        skills: params.frozen.skills,
        references: params.frozen.references,
      };
      const summary: AiToolSummary = {
        videoId: params.videoId,
        tool: params.tool,
        providerId: params.provider,
        modelId: params.model,
        context,
        applied: applied ? { transactionId: applied.transactionId, changes: applied.changes } : null,
        text: writes(params.tool) ? null : generated.text,
        artifactId: generated.artifactId,
        finishReason: generated.finishReason,
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: generated.artifactId } };
    },
  };
}

/** 用哪份转写：给了就核对；不给时取视频里唯一的一份。写作工具没有转写也能跑（只有提示词）；润色与章节要有。 */
function pickTranscript(documents: Record<Id, DocumentRecord>, requested: Id | undefined, tool: AiToolKind): Id | null {
  if (requested !== undefined) {
    const doc = documents[requested];
    if (!doc) throw new RpcError('not-found', M.notSpeech({ documentId: requested }), { code: 'ENTITY_NOT_FOUND', documentId: requested });
    if (doc.kind !== 'speech') throw new RpcError('invalid-request', M.notSpeech({ documentId: requested }));
    return requested;
  }
  const speech = Object.values(documents).filter((d) => d.kind === 'speech');
  if (speech.length === 1) return speech[0]!.id;
  if (speech.length > 1) throw new RpcError('invalid-request', M.multipleTranscripts(), { documentIds: speech.map((d) => d.id) });
  if (writes(tool)) throw new RpcError('invalid-request', M.noTranscript());
  return null;
}

/** 启动时冻结 skill 与附件：合成系统提示词、读出文本附件，写成一个产物。 */
async function freezeInputs(deps: AiToolDeps, params: AiToolParams): Promise<FrozenAiToolParams['frozen']> {
  const skills = await deps.skills(params.skills ?? []);
  const resolved = params.attachments?.length ? await deps.attachments([...new Set(params.attachments)]) : [];
  const attachments: ContextAttachment[] = [];
  let skipped = 0;
  for (const { ref, path } of resolved) {
    if (ref.kind === 'image' || !TEXT_MIME.test(ref.mimeType)) {
      skipped += 1;
      continue;
    }
    const content = await fs.readFile(path, 'utf8');
    attachments.push({
      name: ref.fileName,
      content: content.length > ATTACHMENT_CHARS ? `${content.slice(0, ATTACHMENT_CHARS)}\n[… ${content.length - ATTACHMENT_CHARS} more characters not included]` : content,
    });
  }
  const inputs: FrozenInputs = { system: skills.text, attachments };
  const { artifactId } = await deps.artifacts.put(Buffer.from(JSON.stringify(inputs)), 'json');
  return { artifactId, skills: skills.skills, references: skills.references, attachments: attachments.length, skippedAttachments: skipped };
}

async function readJson<T>(artifacts: Pick<ArtifactStore, 'read'>, artifactId: string): Promise<T> {
  const bytes = await artifacts.read(artifactId);
  if (!bytes) throw new PipelineStepError('STALE_JOB_INPUT', M.sourceChanged(), { artifactId });
  return JSON.parse(bytes.toString('utf8')) as T;
}

async function gatherContext(deps: AiToolDeps, context: PipelineStepContext<FrozenAiToolParams>): Promise<StepResult> {
  const { params, artifacts, progress } = context;
  progress(null, 'loading');
  const state = deps.videos.state(params.videoId);
  if (!state) throw new PipelineStepError('STALE_JOB_INPUT', M.videoClosed());
  const sequence = deps.videos.sequence(params.videoId) ?? { duration: 0, chapters: 0 };
  const documentId = params.transcriptId;
  const range = params.range;
  let body: ContextBody = { transcript: null, words: [], duration: sequence.duration };
  let paragraphs = 0;
  let characters = 0;
  let revision: string | null = null;
  if (documentId) {
    revision = state.documents[documentId]?.currentRevision ?? null;
    if (revision === null) throw new PipelineStepError('STALE_JOB_INPUT', M.sourceChanged(), { documentId });
    const request = { documentId, ...(range ? { range } : {}) };
    const needsWords = params.tool === 'polish' || params.tool === 'chapters';
    // 范围里没有文稿：导出以 `EXPORT_NOTHING_TO_EXPORT` 拒绝，原样记进任务。
    const [rendered, words] = await Promise.all([
      deps.transcript(params.videoId, request),
      needsWords ? deps.words(params.videoId, request) : Promise.resolve([]),
    ]);
    if (needsWords && words.length === 0) throw new PipelineStepError('EXPORT_NOTHING_TO_EXPORT', M.nothingInRange());
    paragraphs = rendered.paragraphs;
    characters = rendered.characters;
    body = { transcript: params.tool === 'polish' ? null : rendered.content, words, duration: sequence.duration };
  }
  const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify(body)), 'json');
  return {
    output: { artifactId, documentId, revision, paragraphs, characters, chapters: sequence.chapters } satisfies ContextOutput,
  };
}

async function generate(deps: AiToolDeps, context: PipelineStepContext<FrozenAiToolParams>): Promise<StepResult> {
  const { params, outputs, artifacts, signal, progress } = context;
  const ctx = outputs.context as ContextOutput;
  const body = await readJson<ContextBody>(artifacts, ctx.artifactId);
  const inputs = await readJson<FrozenInputs>(deps.artifacts, params.frozen.artifactId);
  const base = { tool: params.tool, system: inputs.system, prompt: params.prompt, attachments: inputs.attachments };
  const target = { provider: params.provider, model: params.model };
  const schema = outputSchema(params.tool);

  if (params.tool === 'polish') {
    const batches = polishBatches(body.words, POLISH_BATCH_WORDS);
    const edits: Record<string, string> = {};
    const replies: unknown[] = [];
    for (const [i, batch] of batches.entries()) {
      progress({ done: i, total: batches.length, unit: 'units' }, 'generating');
      const result = await deps.text.generate(
        {
          messages: aiToolMessages({ ...base, transcript: null, words: { items: batch.items, offset: batch.offset, total: body.words.length } }),
          responseFormat: { type: 'json', schema: schema!, name: 'edits' },
          ...target,
        },
        { signal },
      );
      const checked = polishEdits(result.json, batch);
      if ('problem' in checked) throw new PipelineStepError('MODEL_OUTPUT_INVALID', M.polishMismatch(), { batch: i, problem: checked.problem });
      for (const [id, text] of checked.edits) edits[id] = text;
      replies.push(result.json);
    }
    progress({ done: batches.length, total: batches.length, unit: 'units' }, 'generating');
    const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify({ batches: replies, edits })), 'json');
    return { output: { artifactId, text: null, finishReason: 'stop', edits } satisfies GenerateOutput };
  }

  progress(null, 'generating');
  const result = await deps.text.generate(
    {
      messages: aiToolMessages({ ...base, transcript: body.transcript }),
      ...(schema ? { responseFormat: { type: 'json' as const, schema, name: params.tool } } : { responseFormat: { type: 'text' as const } }),
      ...target,
    },
    { signal },
  );
  if (params.tool === 'chapters') {
    const starts = paragraphStarts(body.words);
    const chapters = chapterDrafts(result.json, starts, body.duration);
    if (chapters.length === 0) throw new PipelineStepError('MODEL_OUTPUT_INVALID', M.noChapters());
    const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify({ reply: result.json, chapters })), 'json');
    return { output: { artifactId, text: null, finishReason: result.finishReason, chapters } satisfies GenerateOutput };
  }
  const text = result.text.trim();
  if (!text) throw new PipelineStepError('MODEL_OUTPUT_INVALID', M.outputInvalid());
  const { artifactId } = await artifacts.put(Buffer.from(text), 'md');
  return { output: { artifactId, text, finishReason: result.finishReason } satisfies GenerateOutput, result: { documentId: null, artifactId } };
}

/** 段落起点（时间线上的秒）：章节吸到这些时刻上。 */
export function paragraphStarts(words: readonly ContextWord[]): number[] {
  return words.filter((w, i) => i === 0 || w.paragraphStart).map((w) => w.start);
}

/** 润色：把改过的词写回冻结的那一版转写（只改 text）。 */
export function polishedBody(body: unknown, edits: Record<string, string>): { body: unknown; changes: number } {
  const source = body as { words?: Array<{ id?: unknown; text?: unknown }> } | null;
  if (!source || !Array.isArray(source.words)) return { body, changes: 0 };
  let changes = 0;
  const words = source.words.map((word) => {
    const next = typeof word.id === 'string' ? edits[word.id] : undefined;
    if (next === undefined || next === word.text) return word;
    changes += 1;
    return { ...word, text: next };
  });
  return { body: { ...source, words }, changes };
}

async function apply(deps: AiToolDeps, context: PipelineStepContext<FrozenAiToolParams>): Promise<StepResult> {
  const { params, outputs, jobId, run, progress } = context;
  progress(null, 'applying');
  const ctx = outputs.context as ContextOutput;
  const generated = outputs.generate as GenerateOutput;
  for (let attempt = 1; ; attempt++) {
    const state = deps.videos.state(params.videoId);
    if (!state) throw new PipelineStepError('STALE_JOB_INPUT', M.videoClosed());
    let operation: EditOperation;
    let changes: number;
    let label: string;
    if (params.tool === 'polish') {
      const documentId = ctx.documentId!;
      const current = state.documents[documentId];
      if (!current || current.currentRevision !== ctx.revision) {
        throw new PipelineStepError('STALE_JOB_INPUT', M.sourceChanged(), {
          documentId,
          frozenRevision: ctx.revision,
          currentRevision: current?.currentRevision ?? null,
        });
      }
      const { body } = await deps.videos.document(params.videoId, documentId, ctx.revision!);
      const polished = polishedBody(body, generated.edits ?? {});
      // 没有要改的：不提交空事务。
      if (polished.changes === 0) return { output: { transactionId: null, changes: 0 } satisfies ApplyOutput };
      operation = { type: 'putDocument', documentId, kind: current.kind, body: polished.body };
      changes = polished.changes;
      label = M.transactionPolish().text;
    } else {
      const chapters = generated.chapters ?? [];
      operation = {
        type: 'setChapters',
        sequenceId: state.rootSequenceId,
        chapters: chapters.map((c) => ({ at: { unit: 'seconds', value: c.at.toFixed(3) }, title: c.title, ...(c.summary ? { summary: c.summary } : {}) })),
        alignment: 'nearest-frame',
      };
      changes = chapters.length;
      label = M.transactionChapters().text;
    }
    try {
      const receipt = await deps.videos.apply(params.videoId, {
        commandId: `cmd_${jobId}_apply_${attempt}`,
        expectedRevision: state.revision,
        operations: [operation],
        label,
        run,
      });
      return { output: { transactionId: receipt.transactionId ?? null, changes } satisfies ApplyOutput };
    } catch (error) {
      if (error instanceof RpcError && error.code === 'conflict' && attempt < APPLY_ATTEMPTS) continue;
      if (error instanceof PipelineStepError) throw error;
      throw new PipelineStepError('APPLY_FAILED', M.rejected(), { cause: error instanceof Error ? error.message : String(error) });
    }
  }
}
