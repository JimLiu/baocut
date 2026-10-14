import fs from 'node:fs/promises';
import {
  AI_TOOL_APPLY_KINDS,
  AI_TOOL_PIPELINE,
  AI_TOOL_SECTION_CHUNKS,
  AI_TOOL_SECTION_CITE_PREFIX,
  AI_TOOL_TOPIC_DEFAULT_CHUNKS,
  CITATIONS_SCHEMA,
  RpcError,
  type AiToolContext,
  type AiToolKind,
  type AiToolParams,
  type AiToolSummary,
  type AttachmentRef,
  type CitationsFile,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type SemanticReason,
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
import {
  checkCitations,
  joinSeries,
  materialInstructions,
  numberExcerpts,
  numberSentences,
  outlineOf,
  replaceParagraph,
  stamp,
  withSentences,
  type ExcerptSentence,
  type NumberedSentence,
  type NumberedTranscript,
} from './ai-tool-citations.ts';
import type { RelevantChunkSet } from '../space/semantic/context.ts';
import { topicBoundaries, type TopicBoundaryDeps } from './topic-boundaries.ts';

/**
 * AI 工具的「直接调模型」（产品设计 §5.10，`ai-tool`）：不启动智能体、不经对话，把工具页提示词框里的文字与这个视频的
 * 上下文直接交给一个文本模型。与翻译同一套固定流程：后台任务、进度、取消（`jobs.cancel`）、从停下的那步重试
 * （`pipelines.retry`），每次调用经授权与预算（`withPipelineGrants`）。
 *
 * - 启动时冻结：选定的文本模型、挂着的 skill 合成的系统提示词（只带 `SKILL.md` 与它用到的 `references/`）、附件
 *   （文本文件附全文，图片与别的文件不发、计数）。重试沿用冻结的这些，不再读 skill 与附件。
 * - 收集上下文：与导出文稿同一份写法的 Markdown 文稿（带时间码、说话人与章节，按范围），润色另取范围里编了号的词。
 * - 调用模型：润色按段落分批、每批一次结构化输出（只能一词对一词地改）；章节一次结构化输出；其余工具一次正文输出。
 * - 写作类工具（总结、博客、标题、简介）的文稿是编了号的句子，模型在段末回引编号；校验后正文去掉编号，出处写成
 *   `baocut.citations/1` 旁文件（创作辅助集成设计 §3.4）。正文与出处都是产物，正文在 Space 里列成一份文档条目。
 * - 按主题选材（`selection.mode: 'topic'`）：用意图句在这几部视频的语义索引里挑句群（`SemanticContext.findRelevantChunks`，
 *   没有模型时退回字面匹配），挑中的句群 ID 与实际走的路（`effectiveMode`）冻结在收集上下文这一步的输出里；什么也没挑出来
 *   时发整篇。系列文章（`videoIds`）每部视频各自编号、带 `v2:` 前缀；只有用户本人（界面、终端）能发起。
 * - 写进视频（只有润色与章节）：润色把改过的词写回同一份转写（`putDocument`），章节整份替换（`setChapters`）；都是一笔
 *   以 `system:pipeline` 提交的事务，受版本校验，界面一键撤销。执行期间文稿改了时以 `STALE_JOB_INPUT` 失败，不写。
 */

/** 文稿外发：润色与写作都把文稿交给模型；附件按文档计。 */
export const AI_TOOL_DATA_KINDS = ['transcript', 'document'] as const;

const POLISH_BATCH_WORDS = 800;
const APPLY_ATTEMPTS = 3;
/** 能选几部视频写系列文章的发起方：用户本人（界面、终端、Runtime 自己）。智能体与对外服务只写它们打开的这一部。 */
const SERIES_SUBMITTERS: ReadonlySet<string> = new Set(['connection', 'system', 'node']);
/** 文本附件的上限（字符）：超出的部分截掉、在正文末尾说明。 */
const ATTACHMENT_CHARS = 100_000;
const TEXT_MIME = /^(text\/|application\/json$)/;

export interface AiToolVideos {
  state(videoId: Id): { revision: string; rootSequenceId: Id; documents: Record<Id, DocumentRecord> } | null;
  /** 视频根序列的时长（秒）、已有章节数与章节（起点秒、标题）；没打开时 null。 */
  sequence(videoId: Id): { duration: number; chapters: number; chapterMarks?: Array<{ at: number; title: string }> } | null;
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
  /** 转写这一版的句子：词 id → 稳定句子身份（`s-<首词 ID>`，`speech-doc` 的同一套规则）。读不了时空表（不发出处）。 */
  sentenceOf(videoId: Id, documentId: Id, revision: string): Promise<ReadonlyMap<string, string>>;
  skills(refs: { id: string }[]): Promise<SkillSystemPrompt>;
  attachments(ids: Id[]): Promise<{ ref: AttachmentRef; path: string }[]>;
  artifacts: Pick<ArtifactStore, 'put' | 'read'>;
  /**
   * 按主题选材（创作辅助集成设计 §3.4）：在这几部视频里按意图找讲话句群（`SemanticContext.findRelevantChunks`，按时间排、
   * 前后各带一句）。没接线时按主题退回整篇。
   */
  relevant?(request: { videoIds: Id[]; intent: string; limit: number; signal: AbortSignal }): Promise<RelevantChunkSet>;
  /**
   * 章节按话题找边界（创作辅助集成设计 §3.6）：本机语义模型给一组文字算文档向量（L2 归一化）。没接线或模型不可用时抛带
   * 原因码的错误，章节退回由模型决定边界。
   */
  embed?: TopicBoundaryDeps['embed'];
  /** 章节按话题找边界：这一版转写已建好语义索引时直接用索引里的句群与向量（不重新编码）。 */
  topicUnits?: TopicBoundaryDeps['topicUnits'];
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
  /** 系列文章取材的视频数（多于一部时）。 */
  videos?: number;
  /** 按主题选材时实际怎么选的（冻结：重试不再挑）。 */
  selection?: NonNullable<AiToolContext['selection']>;
  /** 章节按话题找边界时：实际用的方式与候选数。 */
  boundaries?: NonNullable<AiToolContext['boundaries']>;
}

interface ContextBody {
  transcript: string | null;
  words: ContextWord[];
  duration: number;
  /** 写作类工具发出的编号句子（出处的对照表）；没有时空。 */
  sentences?: NumberedSentence[];
  /** 文稿的来历（几部视频、节选），附在系统提示词里。 */
  material?: string;
  /** 重写一段：上一次的出处（整份）、哪一段、大纲与这一段原文。 */
  section?: { previous: CitationsFile; index: number; outline: string; paragraph: string };
  /** 章节按话题找边界时：允许的章节起点（时间线上的秒，含第一段）与发给模型的候选说明。 */
  boundaries?: { starts: number[]; text: string };
}

interface GenerateOutput extends Record<string, unknown> {
  artifactId: string;
  text: string | null;
  finishReason: 'stop' | 'length';
  /** 润色：词 id → 新文本；章节：草稿。 */
  edits?: Record<string, string>;
  chapters?: Array<{ at: number; title: string; summary: string }>;
  /** 写作类工具：出处与它的产物。 */
  citations?: CitationsFile | null;
  citationsArtifactId?: string | null;
  /** 重写一段：重写的是第几段、换成了几段。 */
  section?: { index: number; paragraphs: number };
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
    uiLanguage: { type: 'string', description: '用户的界面语言（BCP 47，如 zh-Hans、en），写进系统提示词' },
    selection: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['topic'] },
        intent: { type: 'string', description: '意图句；不给时用提示词' },
        limit: { type: 'integer', minimum: 1, maximum: 60, description: '最多挑几个句群（默认 24）' },
        exclude: { type: 'array', items: { type: 'string' }, description: '不要的句群（space.relevantChunks 给的 chunkId）' },
      },
      required: ['mode'],
      description: '写作类工具按主题选材：用意图句在本机语义索引里挑相关的讲话；没有模型时退回字面，再不行发整篇。不与 range 同用',
    },
    videoIds: { type: 'array', items: { type: 'string' }, description: '系列文章：一起取材的另几部视频（最多 7 部，只有写作类工具）' },
    boundaries: { type: 'string', enum: ['topic', 'model'], description: '只有 chapters：topic 先按话题转折找候选边界，模型只在候选处分章' },
    section: {
      type: 'object',
      properties: {
        citationsArtifactId: { type: 'string', description: '上一次写作结果的出处旁文件（summary 的 citationsArtifactId）' },
        index: { type: 'integer', minimum: 0, description: '要重写的正文段（出处里的 index）' },
        exclude: { type: 'array', items: { type: 'string' }, description: '不要的句群（chunkId）' },
      },
      required: ['citationsArtifactId', 'index'],
      description: '写作类工具：只重写上一次结果的一段，其余段落原样；不与 range、selection、videoIds 同用',
    },
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
      if (params.section) {
        const previous = await readCitationsFile(deps.artifacts, params.section.citationsArtifactId);
        if (!previous) {
          throw new RpcError('not-found', M.sectionMissing(), { code: 'CITATIONS_NOT_FOUND', artifactId: params.section.citationsArtifactId });
        }
        if (previous.paragraphs[params.section.index]?.role !== 'body') {
          throw new RpcError('invalid-request', M.sectionNotParagraph({ index: params.section.index + 1 }), { index: params.section.index });
        }
      }
      if (params.videoIds?.length) {
        if (options.submitter && !SERIES_SUBMITTERS.has(options.submitter.kind)) {
          throw new RpcError('forbidden', M.seriesUserOnly(), { code: 'SERIES_USER_ONLY' });
        }
        // 整篇时另几部也要打开着、各有一份转写；按主题时直接用语义索引里的句子。
        if (!params.selection) {
          for (const videoId of params.videoIds) {
            const other = deps.videos.state(videoId);
            if (!other) throw new RpcError('not-found', M.videoNotOpen(), { code: 'VIDEO_NOT_OPEN', videoId });
            pickTranscript(other.documents, undefined, params.tool);
          }
        }
      }
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
          canonicalJson({
            videoId: params.videoId,
            tool: params.tool,
            prompt: params.prompt,
            range: params.range ?? null,
            documentId,
            revision,
            inputs: frozen.artifactId,
            ...(params.uiLanguage ? { uiLanguage: params.uiLanguage } : {}),
            ...(params.selection ? { selection: params.selection } : {}),
            ...(params.videoIds?.length ? { videoIds: params.videoIds } : {}),
            ...(params.boundaries ? { boundaries: params.boundaries } : {}),
            ...(params.section ? { section: params.section } : {}),
          }),
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
        ...(ctx.videos ? { videos: ctx.videos } : {}),
        ...(ctx.selection ? { selection: ctx.selection } : {}),
        ...(ctx.boundaries ? { boundaries: ctx.boundaries } : {}),
        ...(generated.section ? { section: generated.section } : {}),
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
        citations: generated.citations ?? null,
        citationsArtifactId: generated.citationsArtifactId ?? null,
      };
      return { summary: { ...summary }, result: { documentId: null, artifactId: generated.artifactId } };
    },
  };
}

/** 用哪份转写：给了就核对；不给时取视频里唯一的一份。写作工具没有转写也能跑（只有提示词）；润色与章节要有。 */
export function pickTranscript(documents: Record<Id, DocumentRecord>, requested: Id | undefined, tool: AiToolKind): Id | null {
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
  const { params, artifacts, progress, signal } = context;
  progress(null, 'loading');
  const state = deps.videos.state(params.videoId);
  if (!state) throw new PipelineStepError('STALE_JOB_INPUT', M.videoClosed());
  const sequence = deps.videos.sequence(params.videoId) ?? { duration: 0, chapters: 0 };
  const documentId = params.transcriptId;
  const range = params.range;
  const writing = params.tool !== 'polish' && params.tool !== 'chapters';
  let body: ContextBody = { transcript: null, words: [], duration: sequence.duration };
  let paragraphs = 0;
  let characters = 0;
  let revision: string | null = null;
  let videos: number | undefined;
  let selection: ContextOutput['selection'];
  let boundaries: ContextOutput['boundaries'];
  if (documentId) {
    revision = state.documents[documentId]?.currentRevision ?? null;
    if (revision === null) throw new PipelineStepError('STALE_JOB_INPUT', M.sourceChanged(), { documentId });
  }
  let picked = false;
  if (writing && params.section) {
    const section = await sectionMaterial(deps, params, signal);
    picked = true;
    selection = section.selection;
    body = { ...section.body, duration: sequence.duration };
    paragraphs = section.selection.chunks;
    characters = (section.body.sentences ?? []).reduce((n, s) => n + s.text.length, 0);
    if (section.body.section!.previous.videoIds.length > 1) videos = section.body.section!.previous.videoIds.length;
  } else if (writing && params.selection) {
    const topic = await topicMaterial(deps, params, signal);
    selection = topic.selection;
    if (topic.numbered) {
      picked = true;
      body = {
        transcript: topic.numbered.text,
        words: [],
        sentences: topic.numbered.sentences,
        material: materialInstructions({ videos: topic.videos, excerpts: true }),
        duration: sequence.duration,
      };
      paragraphs = topic.selection.chunks;
      characters = topic.numbered.sentences.reduce((n, s) => n + s.text.length, 0);
      if (topic.videos > 1) videos = topic.videos;
    }
  }
  if (!picked && documentId && revision !== null) {
    const request = { documentId, ...(range ? { range } : {}) };
    // 范围里没有文稿：导出以 `EXPORT_NOTHING_TO_EXPORT` 拒绝，原样记进任务。
    const [rendered, words] = await Promise.all([
      deps.transcript(params.videoId, request),
      // 写作类工具也要词：按句子编号发出（出处）。
      deps.words(params.videoId, request),
    ]);
    if (words.length === 0) throw new PipelineStepError('EXPORT_NOTHING_TO_EXPORT', M.nothingInRange());
    paragraphs = rendered.paragraphs;
    characters = rendered.characters;
    if (!writing) {
      body = { transcript: params.tool === 'polish' ? null : rendered.content, words, duration: sequence.duration };
      if (params.tool === 'chapters' && params.boundaries === 'topic') {
        const topic = await chapterBoundaries(deps, { videoId: params.videoId, documentId, words }, signal);
        boundaries = topic.facts;
        if (topic.allowed) body = { ...body, boundaries: topic.allowed };
      }
    } else {
      const sentenceOf = await deps.sentenceOf(params.videoId, documentId, revision);
      const series = params.videoIds?.length ? params.videoIds : null;
      const numbered = numberedContext(params.videoId, documentId, words, sentenceOf, sequence.chapterMarks ?? [], rendered.content, series ? 'v1:' : '');
      body = { ...numbered, duration: sequence.duration };
      if (series) {
        const more = await seriesMaterial(deps, series, numbered);
        body = { ...body, ...more.body };
        paragraphs += more.paragraphs;
        characters += more.characters;
        if (more.videos > 1) videos = more.videos;
      }
    }
  }
  const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify(body)), 'json');
  return {
    output: {
      artifactId,
      documentId,
      revision,
      paragraphs,
      characters,
      chapters: sequence.chapters,
      ...(videos ? { videos } : {}),
      ...(selection ? { selection } : {}),
      ...(boundaries ? { boundaries } : {}),
    } satisfies ContextOutput,
  };
}

/**
 * 章节按话题找边界（创作辅助集成设计 §3.6，`topicBoundaries`）：模型只能在第一段与这些候选处分章（可以合并，不能新增）。
 * 没有语义模型时退回由模型决定，原因写进 `boundaries`；没找到转折时也由模型决定（候选 0）。
 */
async function chapterBoundaries(
  deps: AiToolDeps,
  input: { videoId: Id; documentId: Id; words: readonly ContextWord[] },
  signal: AbortSignal,
): Promise<{ facts: NonNullable<ContextOutput['boundaries']>; allowed: ContextBody['boundaries'] | null }> {
  const topic = await topicBoundaries(deps, input, signal);
  const facts = { mode: topic.mode, candidates: topic.candidates.length, reason: topic.reason };
  if (topic.mode !== 'topic' || topic.first === null) return { facts, allowed: null };
  const lines = topic.candidates.map((c) => `[${stamp(c.at)}] … ${c.before} ‖ ${c.after} …`);
  return { facts, allowed: { starts: [topic.first, ...topic.candidates.map((c) => c.at)], text: lines.join('\n') } };
}

/** 重写一段时再挑几个句群（以这一段的文字为意图）。 */

/** 出处旁文件的产物：读不出或不是 `baocut.citations/1` 时 null。 */
async function readCitationsFile(artifacts: Pick<ArtifactStore, 'read'>, artifactId: string): Promise<CitationsFile | null> {
  const bytes = await artifacts.read(artifactId).catch(() => null);
  if (!bytes) return null;
  try {
    const file = JSON.parse(bytes.toString('utf8')) as CitationsFile;
    return file?.schema === CITATIONS_SCHEMA && Array.isArray(file.paragraphs) && Array.isArray(file.videoIds) ? file : null;
  } catch {
    return null;
  }
}

/**
 * 重写一段的材料（创作辅助集成设计 §3.4「局部改写」）：这一段原来的出处，加上以这一段文字为意图再挑的句群（去掉勾掉的），
 * 按视频、时间编号。出处旁文件在启动后没了时以 `STALE_JOB_INPUT` 失败。
 */
/** 重写一段时，那一段原有的第 `i` 处出处在材料里的编号（`section.exclude` 用它勾掉）。 */
const citeChunkId = (i: number) => `${AI_TOOL_SECTION_CITE_PREFIX}${i}`;

async function sectionMaterial(
  deps: AiToolDeps,
  params: FrozenAiToolParams,
  signal: AbortSignal,
): Promise<{ body: Omit<ContextBody, 'duration'>; selection: NonNullable<ContextOutput['selection']> }> {
  const { citationsArtifactId, index, exclude } = params.section!;
  const previous = await readCitationsFile(deps.artifacts, citationsArtifactId);
  if (!previous || previous.paragraphs[index]?.role !== 'body') throw new PipelineStepError('STALE_JOB_INPUT', M.sectionMissing(), { artifactId: citationsArtifactId });
  const target = previous.paragraphs[index]!;
  const videoIds = previous.videoIds.length > 0 ? previous.videoIds : [params.videoId];
  const excluded = new Set(exclude ?? []);
  // 换材料重写：用户勾掉的出处写成 `cite:<第几处>`，与勾掉的句群一起在 `exclude` 里。
  const kept = target.cites.filter((_, i) => !excluded.has(citeChunkId(i)));
  const sentences: ExcerptSentence[] = target.cites.flatMap((cite, i) =>
    !excluded.has(citeChunkId(i)) && cite.clock === 'sequence' && cite.documentId !== null && cite.sentenceIds.length > 0
      ? [
          {
            videoId: cite.videoId,
            documentId: cite.documentId,
            sentenceId: cite.sentenceIds[0]!,
            text: cite.text,
            start: cite.startSec,
            end: cite.endSec,
            speaker: null,
            chunkId: citeChunkId(i),
            chapter: null,
          },
        ]
      : [],
  );
  const cited = new Set(target.cites.flatMap((cite) => cite.sentenceIds));
  const set = deps.relevant ? await deps.relevant({ videoIds, intent: target.markdown, limit: AI_TOOL_SECTION_CHUNKS, signal }) : null;
  const used = new Set<string>();
  for (const chunk of set?.chunks ?? []) {
    if (excluded.has(chunk.chunkId) || chunk.documentKind !== 'speech') continue;
    for (const s of chunk.sentences) {
      if (s.clock !== 'sequence' || s.documentId === null || cited.has(s.sentenceId)) continue;
      used.add(chunk.chunkId);
      sentences.push({ videoId: chunk.videoId, documentId: s.documentId, sentenceId: s.sentenceId, text: s.text, start: s.start, end: s.end, speaker: s.speaker, chunkId: chunk.chunkId, chapter: chunk.chapter?.title ?? null });
    }
  }
  const numbered = numberExcerpts({ videos: videoIds, sentences });
  const chunks = (set?.chunks ?? []).filter((chunk) => used.has(chunk.chunkId));
  return {
    body: {
      transcript: numbered.text,
      words: [],
      sentences: numbered.sentences,
      material: materialInstructions({ videos: videoIds.length, excerpts: true }),
      section: { previous, index, outline: outlineOf(previous, index), paragraph: target.markdown },
    },
    selection: {
      effectiveMode: set ? set.effectiveMode : 'none',
      reason: set ? set.reason : 'MODEL_NOT_INSTALLED',
      chunks: chunks.length + kept.length,
      chunkIds: chunks.map((chunk) => chunk.chunkId),
      chapters: [...new Set(chunks.flatMap((chunk) => (chunk.chapter ? [chunk.chapter.title] : [])))],
      weak: chunks.filter((chunk) => chunk.weak).length,
    },
  };
}

/**
 * 按主题挑材料：意图句（不给时是提示词）在这几部视频里找讲话句群，去掉用户勾掉的，只用时间线上、有句子身份的讲话。
 * 没接线、没有意图或什么也没挑出来时 `numbered` 为 null（发整篇），`selection` 照样写明。
 */
async function topicMaterial(
  deps: AiToolDeps,
  params: FrozenAiToolParams,
  signal: AbortSignal,
): Promise<{ numbered: NumberedTranscript | null; selection: NonNullable<ContextOutput['selection']>; videos: number }> {
  const choice = params.selection!;
  const videoIds = [params.videoId, ...(params.videoIds ?? [])];
  const intent = (choice.intent ?? params.prompt).trim();
  const none = (reason: SemanticReason | null) => ({
    numbered: null,
    selection: { effectiveMode: 'none' as const, reason, chunks: 0, chunkIds: [], chapters: [], weak: 0 },
    videos: 1,
  });
  if (!deps.relevant) return none('MODEL_NOT_INSTALLED');
  if (!intent) return none(null);
  const set = await deps.relevant({ videoIds, intent, limit: choice.limit ?? AI_TOOL_TOPIC_DEFAULT_CHUNKS, signal });
  const excluded = new Set(choice.exclude ?? []);
  const sentences: ExcerptSentence[] = [];
  for (const chunk of set.chunks) {
    if (excluded.has(chunk.chunkId) || chunk.documentKind !== 'speech') continue;
    for (const s of chunk.sentences) {
      if (s.clock !== 'sequence' || s.documentId === null) continue;
      sentences.push({
        videoId: chunk.videoId,
        documentId: s.documentId,
        sentenceId: s.sentenceId,
        text: s.text,
        start: s.start,
        end: s.end,
        speaker: s.speaker,
        chunkId: chunk.chunkId,
        chapter: chunk.chapter?.title ?? null,
      });
    }
  }
  const used = set.chunks.filter((chunk) => sentences.some((s) => s.chunkId === chunk.chunkId));
  if (used.length === 0) return none(set.reason);
  const chapters = [...new Set(used.flatMap((chunk) => (chunk.chapter ? [chunk.chapter.title] : [])))];
  return {
    numbered: numberExcerpts({ videos: videoIds, sentences }),
    selection: {
      effectiveMode: set.effectiveMode,
      reason: set.reason,
      chunks: used.length,
      chunkIds: used.map((chunk) => chunk.chunkId),
      chapters,
      weak: used.filter((chunk) => chunk.weak).length,
    },
    videos: new Set(used.map((chunk) => chunk.videoId)).size,
  };
}

/**
 * 整篇的系列文章：另几部视频（打开着的）各自的转写按句编号（`v2:`、`v3:` …），接在这一部（`v1:`）后面。读不出句子的那部
 * 发导出文稿同一份写法的 Markdown（没有出处）；关掉了或没有转写的跳过。
 */
async function seriesMaterial(
  deps: AiToolDeps,
  videoIds: readonly Id[],
  first: Pick<ContextBody, 'transcript' | 'sentences'>,
): Promise<{ body: Pick<ContextBody, 'transcript' | 'sentences' | 'material'>; paragraphs: number; characters: number; videos: number }> {
  const parts: Array<{ index: number; numbered: NumberedTranscript }> = [
    { index: 0, numbered: { text: first.transcript ?? '', sentences: first.sentences ?? [] } },
  ];
  let paragraphs = 0;
  let characters = 0;
  for (const [i, videoId] of videoIds.entries()) {
    const state = deps.videos.state(videoId);
    const speech = state ? Object.values(state.documents).filter((d) => d.kind === 'speech') : [];
    if (!state || speech.length !== 1) continue;
    const documentId = speech[0]!.id;
    const [rendered, words, sentenceOf] = await Promise.all([
      deps.transcript(videoId, { documentId }),
      deps.words(videoId, { documentId }),
      deps.sentenceOf(videoId, documentId, speech[0]!.currentRevision),
    ]);
    paragraphs += rendered.paragraphs;
    characters += rendered.characters;
    const chapters = deps.videos.sequence(videoId)?.chapterMarks ?? [];
    const numbered = numberedContext(videoId, documentId, words, sentenceOf, chapters, rendered.content, `v${i + 2}:`);
    parts.push({ index: i + 1, numbered: { text: numbered.transcript ?? '', sentences: numbered.sentences ?? [] } });
  }
  const joined = joinSeries(parts);
  return {
    body: { transcript: joined.text, sentences: joined.sentences, material: materialInstructions({ videos: parts.length, excerpts: false }) },
    paragraphs,
    characters,
    videos: parts.length,
  };
}

async function generate(deps: AiToolDeps, context: PipelineStepContext<FrozenAiToolParams>): Promise<StepResult> {
  const { params, outputs, artifacts, signal, progress } = context;
  const ctx = outputs.context as ContextOutput;
  const body = await readJson<ContextBody>(artifacts, ctx.artifactId);
  const inputs = await readJson<FrozenInputs>(deps.artifacts, params.frozen.artifactId);
  const base = {
    tool: params.tool,
    system: inputs.system,
    prompt: params.prompt,
    attachments: inputs.attachments,
    ...(params.uiLanguage ? { uiLanguage: params.uiLanguage } : {}),
  };
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
      messages: aiToolMessages({
        ...base,
        transcript: body.transcript,
        citations: (body.sentences?.length ?? 0) > 0,
        ...(body.material ? { material: body.material } : {}),
        ...(body.boundaries ? { boundaries: body.boundaries.text } : {}),
        ...(body.section ? { section: { outline: body.section.outline, paragraph: body.section.paragraph } } : {}),
      }),
      ...(schema ? { responseFormat: { type: 'json' as const, schema, name: params.tool } } : { responseFormat: { type: 'text' as const } }),
      ...target,
    },
    { signal },
  );
  if (params.tool === 'chapters') {
    // 按话题找了边界时只吸到第一段与候选处：模型给的别的时刻吸到最近的候选上，不新增边界。
    const starts = body.boundaries?.starts ?? paragraphStarts(body.words);
    const chapters = chapterDrafts(result.json, starts, body.duration);
    if (chapters.length === 0) throw new PipelineStepError('MODEL_OUTPUT_INVALID', M.noChapters());
    const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify({ reply: result.json, chapters })), 'json');
    return { output: { artifactId, text: null, finishReason: result.finishReason, chapters } satisfies GenerateOutput };
  }
  const raw = result.text.trim();
  if (!raw) throw new PipelineStepError('MODEL_OUTPUT_INVALID', M.outputInvalid());
  const sentences = body.sentences ?? [];
  if (sentences.length === 0) {
    const { artifactId } = await artifacts.put(Buffer.from(raw), 'md');
    return { output: { artifactId, text: raw, finishReason: result.finishReason, citations: null, citationsArtifactId: null } satisfies GenerateOutput, result: { documentId: null, artifactId } };
  }
  // 出处记下这次取材的视频（有句子发出的）与实际怎么选的（按主题时冻结在收集上下文的输出里）。
  const videoIds = [...new Set([params.videoId, ...sentences.map((s) => s.videoId)])];
  let checked = checkCitations({ output: raw, sentences, videoIds, effectiveMode: ctx.selection?.effectiveMode ?? 'none' });
  let section: GenerateOutput['section'];
  if (body.section) {
    // 重写一段：新写的几段换掉原来那段，其余段落与出处原样（出处的视频与选材方式沿用上一次）。
    const replacement = checkCitations({ output: raw, sentences, videoIds: body.section.previous.videoIds, effectiveMode: body.section.previous.effectiveMode });
    if (replacement.file.paragraphs.length === 0) throw new PipelineStepError('MODEL_OUTPUT_INVALID', M.outputInvalid());
    checked = replaceParagraph(body.section.previous, body.section.index, replacement.file);
    section = { index: body.section.index, paragraphs: replacement.file.paragraphs.length };
  }
  const text = checked.markdown || raw;
  // 模型的原样回复留作依据（出处有疑问时对照）；正文与出处各是一个产物。
  await artifacts.put(Buffer.from(raw), 'txt');
  const { artifactId } = await artifacts.put(Buffer.from(text), 'md');
  const citations = await artifacts.put(Buffer.from(JSON.stringify(checked.file)), 'json');
  return {
    output: {
      artifactId,
      text,
      finishReason: result.finishReason,
      citations: checked.file,
      citationsArtifactId: citations.artifactId,
      ...(section ? { section } : {}),
    } satisfies GenerateOutput,
    result: { documentId: null, artifactId },
  };
}

/**
 * 写作类工具的文稿：时间线上的词按句子编号（创作辅助集成设计 §3.4）。转写读不出句子时（没有词、正文不是 `baocut.speech/1`）
 * 退回与导出文稿同一份写法的 Markdown，不发出处。
 */
function numberedContext(
  videoId: Id,
  documentId: Id,
  words: readonly ContextWord[],
  sentenceOf: ReadonlyMap<string, string>,
  chapters: ReadonlyArray<{ at: number; title: string }>,
  rendered: string,
  prefix = '',
): Pick<ContextBody, 'transcript' | 'words' | 'sentences'> {
  if (words.length === 0 || sentenceOf.size === 0) return { transcript: rendered, words: [] };
  const numbered = numberSentences({
    videoId,
    documentId,
    words: withSentences(words, sentenceOf),
    chapters,
    prefix,
  });
  if (numbered.sentences.length === 0) return { transcript: rendered, words: [] };
  return { transcript: numbered.text, words: [], sentences: numbered.sentences };
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
