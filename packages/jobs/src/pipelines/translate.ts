import { invalid } from './params.ts';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import path from 'node:path';
import {
  RpcError,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type MediaTime,
  type TextModelInfo,
  type TranslateParams,
  type TranslateSummary,
} from '@baocut/protocol';
import type { TextGenerator } from '@baocut/models';
import { JobsTranslate as J } from '@baocut/protocol/messages/jobs/translate.ts';
import type { WorkerCommand } from '@baocut/process-host';
import type { ArtifactStore } from '../artifact-store.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { asLocalized } from '../job-text.ts';
import { videoSelection } from '../library-selection.ts';
import { readCaptionStyle, captionsStep, captionsSummary, type CaptionLayerOutput, type CaptionVideos } from './caption-layer.ts';
import { ParamReader } from './params.ts';
import {
  PipelineStepError,
  type PipelineDefinition,
  type PipelinePrepareOptions,
  type PipelineStepContext,
  type StepResult,
} from './pipeline.ts';
import { PIPELINE_ACTOR_ID } from './pipeline-runner.ts';
import { targetSchema, targetStep } from './video-target.ts';
import { MAX_LIBRARY_GLOSSARIES, glossaryRefOf, promptTerms, type GlossaryLibrary } from './translation-glossary.ts';
import {
  GLOSSARIES_SCHEMA,
  GLOSSARY_SCHEMA,
  freezeGlossaryUse,
  glossarySummary,
  loadGlossaries,
  parseGlossaryRefs,
  parseInlineGlossary,
  readArtifact,
  type FrozenGlossaryUse,
} from './translation-batches.ts';
import { sourceSentences, translationProblems, type FrozenSource, type TranslationBody } from './translation-document.ts';
import { SPEECH_WORKER_PROTOCOL, runSpeechTranslate, type SpeechTranslateInput } from './speech-worker.ts';

// 抽到 translation-batches.ts 的部分，原样从这里导出（翻译配音与测试从这里引用）。
export {
  GLOSSARIES_SCHEMA,
  checkBatch,
  glossarySummary,
  parseGlossaryRefs,
  readArtifact,
  type FrozenGlossaryUse,
} from './translation-batches.ts';

/**
 * 翻译（架构设计 §7.9）：视频里一份 `speech` 文档 → 一份新的 `translation` 文档（视频格式规范 §5.3）。
 * 从工具入口发起，由流程调用文本模型，不启动智能体；文本模型没有配置时启动就以 `CAPABILITY_NOT_CONFIGURED`
 * 拒绝，不改交智能体。
 *
 * 步骤：读取原文（冻结源文档的当前版本与正文、按字幕与翻译核心的规则切好句子，发布为产物）→ 翻译（在 Speech Worker 里由
 * 字幕与翻译核心完成：译向简报、分页翻译、对齐与收尾，每一次模型调用经这里的 `generateText` 发出；检查点在这一步的 staging
 * 里，中断或失败之后重试从检查点继续；产出译文正文与目标语言的字幕条，`speech-worker.ts`）→ 组装（核对 Worker 的译文与冻结的
 * 原文逐句对应、按 §5.3 校验）→ 写入视频（以 `system:pipeline` 经 Application 提交 `putDocument`，受版本校验）→ 建立目标语言的
 * 字幕层（`caption-layer.ts`，字幕条用 Worker 切好的；只在 `captions: true` 时建，不给时这一步跳过，同一份译文已有字幕层时也跳过；
 * 工具入口、CLI 与编辑器的「翻译成…」都带上 `captions: true`。`bilingual` 时与原文共用样式双语显示，默认只显示
 * 译文、配对的原文字幕层从画面上拿下）。
 *
 * 重新执行：每次都新增一份译文文档，不替换已有的（它们可能有手工修改，架构设计 §10.3；与转写一致，§7.3）。
 * 执行期间源文档改了（或删了）：写入这一步以 `STALE_JOB_INPUT` 失败，视频不变，产物保留；重试时读取原文这一步
 * 的产出不再可用，从当前版本重新读取、重新翻译。
 */

export const TRANSLATE_PIPELINE = 'translate';

/** 翻译流程需要的视频能力；由 Runtime 用 VideoService 实现，写入的行为者是 `system:pipeline`。 */
export interface PipelineVideos {
  /** 视频此刻的版本、根序列与文档记录；没打开时 null。 */
  state(videoId: Id): { revision: string; rootSequenceId: Id; documents: Record<Id, DocumentRecord> } | null;
  /** 一份文档某个版本（不给时当前版本）的正文。 */
  document(videoId: Id, documentId: Id, revision?: string): Promise<{ revision: string; body: unknown }>;
  /** 素材当前版本的事实（内容指纹、时长、采样率）；素材不在时 null。不给时翻译按转写里最后一个词的终点当素材时长。 */
  asset?(videoId: Id, assetId: Id): { contentHash: string; duration?: MediaTime; sampleRate?: number } | null;
  /** 以 `system:pipeline` 的身份提交一笔编辑；`run` 是这次执行（引擎据此执行停止屏障，§7.4）。 */
  apply(
    videoId: Id,
    request: {
      commandId: Id;
      expectedRevision: string;
      operations: EditOperation[];
      label: string;
      run?: { runId: Id; runGeneration: string };
    },
  ): Promise<{ refs?: Record<string, Id>; transactionId?: Id }>;
}

export interface TranslateDeps {
  videos: CaptionVideos;
  /** 进程内的文本生成（与 `models.generateText` 共用并发与计数）。 */
  text: Pick<TextGenerator, 'generate'>;
  /** 启动时选定 Provider 与模型（§6.2）；没有配置时抛 `CAPABILITY_NOT_CONFIGURED`。 */
  selectText(target: { provider?: string; model?: string }): Promise<{ providerId: string; modelId: string; model: TextModelInfo }>;
  /** Speech Worker 的命令（`resolveSpeechWorkerCommand`）；没有构建时 null，翻译这一步以 `WORKER_FAILED` 失败。 */
  speechWorker(): string | WorkerCommand | null;
  /** 字幕与翻译核心退避时长的倍数（默认 1；测试调小）。 */
  backoffScale?: number;
  /** 用户库（翻译用术语表）；没有时只能用调用时直接给的术语。 */
  library?: GlossaryLibrary;
  /** 产物库：启动时把用到的库里术语表的内容写成产物（之后只读它，不再读库）。用到库里的术语表时必须有。 */
  artifacts?: Pick<ArtifactStore, 'put'>;
}

/** 冻结的参数：源文档、Provider 与模型、批大小都已确定。 */
export interface FrozenTranslateParams extends TranslateParams {
  documentId: Id;
  provider: string;
  model: string;
  batchSize: number;
  /** 启动时冻结的术语表；调用时没给、视频里也没启用时没有。 */
  glossaryUse?: FrozenGlossaryUse;
}

const DEFAULT_BATCH = 20;
const APPLY_ATTEMPTS = 3;

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    videoId: { type: 'string', description: '已打开的视频（等同 target: { videoId }）' },
    target: targetSchema('要翻译的视频：已打开的，或 Space 里的视频条目（流程期间由 Runtime 打开）；与 videoId 给一个', null),
    documentId: { type: 'string', description: '源 speech 文档；视频里只有一份时可以不给' },
    targetLanguage: { type: 'string', description: '目标语言（BCP 47）' },
    style: { type: 'string', maxLength: 500, description: '风格提示' },
    glossary: GLOSSARY_SCHEMA,
    glossaries: GLOSSARIES_SCHEMA,
    provider: { type: 'string', description: '文本模型的 Provider；不给时用默认值' },
    model: { type: 'string' },
    batchSize: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: DEFAULT_BATCH,
      description: '照旧接受；字幕与翻译核心按自己的预算分页，这个值不再影响翻译',
    },
    captionStyle: {
      type: 'object',
      properties: { schema: { const: 'baocut.legacy-studio-style/0.1' }, style: { type: 'object' } },
      required: ['schema', 'style'],
      description: '新建字幕的 Studio 样式文档；共用已有样式时保留原样',
    },
    captions: { type: 'boolean', default: false, description: '写入译文之后建立目标语言的字幕层（默认不建）；同一份译文已有字幕层时跳过' },
    bilingual: {
      type: 'boolean',
      default: false,
      description: '字幕层双语显示：原文与译文两层字幕共用一份样式；只在 captions 为 true 时可以给',
    },
    // i18n-ignore-end
  },
  required: ['targetLanguage'],
  additionalProperties: false,
};

interface FreezeOutput extends Record<string, unknown> {
  artifactId: string;
  /** 冻结的转写正文（Speech Worker 的输入）。 */
  speechArtifactId: string;
  /** 转写所属素材的事实（Speech Worker 把字幕条夹在素材时长之内）。 */
  media: SpeechTranslateInput['media'];
  documentId: Id;
  revision: string;
  sentenceCount: number;
}

interface TranslateOutput extends Record<string, unknown> {
  /** Worker 写出的译文正文。 */
  artifactId: string;
  /** Worker 切好的目标语言字幕条（`baocut.speech-worker.cues/1`）。 */
  cuesArtifactId: string;
  calls: { calls: number; retries: number; failures: number };
  modelVersion: string | null;
  /** 去重之后的术语条数；`cappedBatches` 是摘要里沿用的字段，字幕与翻译核心不截断术语，总是 0。 */
  glossaryTerms?: number;
  cappedBatches?: number;
}

interface AssembleOutput extends Record<string, unknown> {
  artifactId: string;
  unitCount: number;
}

interface WriteOutput extends Record<string, unknown> {
  documentId: Id;
}

export function translatePipeline(deps: TranslateDeps): PipelineDefinition<FrozenTranslateParams, TranslateParams> {
  return {
    name: TRANSLATE_PIPELINE,
    label: () => J.label(),
    description: () => J.description(),
    paramsSchema: PARAMS_SCHEMA,
    target: { create: false },
    parse: parseTranslateParams,
    async prepare(params, options) {
      const state = deps.videos.state(params.videoId);
      if (!state) throw new RpcError('not-found', J.videoNotOpen());
      const documentId = pickSource(state.documents, params.documentId);
      sameLanguageCheck(state.documents[documentId]?.language ?? null, params.targetLanguage);
      // 重试沿用冻结的术语表；第一次启动时解析调用时给的与视频启用的，冻结版本、内容写成产物。
      const glossaryUse =
        'glossaryUse' in params || options.retry
          ? (params as FrozenTranslateParams).glossaryUse
          : await freezeGlossaries(deps, params, state.documents, documentId, options.submitter);
      const selection = await deps.selectText({
        ...(params.provider !== undefined ? { provider: params.provider } : {}),
        ...(params.model !== undefined ? { model: params.model } : {}),
      });
      if (!selection.model.structuredOutput) {
        throw new RpcError('invalid-request', J.noStructuredOutput({ model: selection.modelId }), {
          providerId: selection.providerId,
          modelId: selection.modelId,
        });
      }
      const frozen: FrozenTranslateParams = {
        ...params,
        documentId,
        provider: selection.providerId,
        model: selection.modelId,
        batchSize: params.batchSize ?? DEFAULT_BATCH,
        ...(glossaryUse ? { glossaryUse } : {}),
      };
      const revision = state.documents[documentId]!.currentRevision;
      return {
        params: frozen,
        providerId: selection.providerId,
        modelId: selection.modelId,
        videoId: params.videoId,
        contentHash: `sha256:${sha256Hex(canonicalJson({ videoId: params.videoId, documentId, revision }))}`,
        ...(glossaryUse?.entries.length
          ? { library: glossaryUse.entries.map(({ library, id, version, contentHash }) => ({ library, id, version, contentHash })) }
          : {}),
      };
    },
    steps: [
      targetStep(),
      {
        name: 'freeze-source',
        label: () => J.stepFreezeSource(),
        run: (context) => freezeSource(deps.videos, context),
        // 源文档有了新版本：冻结的原文过期，重试时从当前版本重新读取。没有冻结正文的旧产出也重新读取。
        reusable: async (output, { params, artifacts }) => {
          const o = output as Partial<FreezeOutput>;
          return (
            deps.videos.state(params.videoId)?.documents[params.documentId]?.currentRevision === o.revision &&
            typeof o.speechArtifactId === 'string' &&
            (await artifacts.locate(o.speechArtifactId)) !== null
          );
        },
      },
      {
        name: 'translate',
        label: () => J.stepTranslate(),
        run: (context) => translateWithWorker(deps, context),
        reusable: async (output, { artifacts }) => {
          const o = output as Partial<TranslateOutput>;
          return (
            typeof o.artifactId === 'string' &&
            typeof o.cuesArtifactId === 'string' &&
            (await artifacts.locate(o.artifactId)) !== null &&
            (await artifacts.locate(o.cuesArtifactId)) !== null
          );
        },
      },
      {
        name: 'assemble',
        label: () => J.stepAssemble(),
        run: async ({ outputs, artifacts, progress }) => {
          progress(null, 'validating');
          const source = await readArtifact<FrozenSource>(artifacts, (outputs['freeze-source'] as FreezeOutput).artifactId);
          const translated = outputs.translate as TranslateOutput;
          const body = await readArtifact<TranslationBody>(artifacts, translated.artifactId);
          // Worker 的句子与这里冻结的句子出自同一套规则：逐句的 ID、指纹与 editViewHash 都要对得上。
          const problems = translationProblems(body, source);
          if (problems.length > 0) {
            throw new PipelineStepError('WORKER_OUTPUT_INVALID', J.workerMismatch(), {
              problems: problems.slice(0, 20),
            });
          }
          return {
            output: { artifactId: translated.artifactId, unitCount: body.units.length } satisfies AssembleOutput,
            result: { documentId: null, artifactId: translated.artifactId },
          };
        },
        reusable: async (output, { artifacts }) => (await artifacts.locate((output as AssembleOutput).artifactId)) !== null,
      },
      {
        name: 'write',
        label: () => J.stepWrite(),
        run: (context) => writeTranslation(deps.videos, context),
      },
      captionsStep<FrozenTranslateParams>(deps.videos, {
        captionStyle: (params) => params.captionStyle,
        pipeline: TRANSLATE_PIPELINE,
        enabled: (params) => params.captions === true,
        videoId: (params) => params.videoId,
        source: (params, outputs) => {
          const written = outputs.write as WriteOutput | undefined;
          const translated = outputs.translate as TranslateOutput | undefined;
          return written && translated
            ? {
                kind: 'translation',
                documentId: written.documentId,
                bilingual: params.bilingual === true,
                cuesArtifactId: translated.cuesArtifactId,
              }
            : null;
        },
      }),
    ],
    async complete({ params, outputs }) {
      const frozen = outputs['freeze-source'] as FreezeOutput;
      const translated = outputs.translate as TranslateOutput;
      const assembled = outputs.assemble as AssembleOutput;
      const written = outputs.write as WriteOutput;
      const glossary = glossarySummary(params, translated);
      const summary: TranslateSummary = {
        videoId: params.videoId,
        documentId: written.documentId,
        source: { documentId: frozen.documentId, revision: frozen.revision },
        targetLanguage: params.targetLanguage,
        unitCount: assembled.unitCount,
        providerId: params.provider,
        modelId: params.model,
        ...(glossary ? { glossary } : {}),
        captions: captionsSummary(
          deps.videos,
          params.captions === true,
          (outputs.captions as CaptionLayerOutput | undefined) ?? null,
          params.videoId,
          written.documentId,
        ),
      };
      return { summary: { ...summary }, result: { documentId: written.documentId, artifactId: assembled.artifactId } };
    },
  };
}

export function parseTranslateParams(raw: Record<string, unknown>): TranslateParams {
  const reader = new ParamReader(raw, [
    'videoId',
    'documentId',
    'targetLanguage',
    'style',
    'glossary',
    'glossaries',
    'provider',
    'model',
    'batchSize',
    'captions',
    'captionStyle',
    'bilingual',
  ]);
  const targetLanguage = reader.string('targetLanguage', { max: 35 });
  if (!/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(targetLanguage)) throw new RpcError('invalid-request', J.targetLanguageInvalid());
  const glossary = parseInlineGlossary(reader.array('glossary', { max: 500, optional: true }));
  const glossaries = parseGlossaryRefs(reader.array('glossaries', { max: MAX_LIBRARY_GLOSSARIES, optional: true }));
  const optional = (key: string, max: number) => reader.string(key, { optional: true, max });
  const documentId = optional('documentId', 128);
  const style = optional('style', 500);
  const provider = optional('provider', 128);
  const model = optional('model', 256);
  const batchSize = reader.int('batchSize', 1, 100);
  const flag = (key: 'captions' | 'bilingual') => {
    const value = raw[key];
    if (value !== undefined && typeof value !== 'boolean') throw new RpcError('invalid-request', J.flagInvalid({ key }));
    return value as boolean | undefined;
  };
  const captionStyle = readCaptionStyle(raw.captionStyle);
  const captions = flag('captions');
  if (captionStyle && captions !== true) throw invalid('captionStyle', JobsParams.onlyOneOf({ other: 'captions: false' }));
  const bilingual = flag('bilingual');
  if (bilingual === true && captions !== true) throw new RpcError('invalid-request', J.bilingualNeedsCaptions());
  return {
    videoId: reader.string('videoId', { max: 128 }),
    targetLanguage,
    ...(documentId !== undefined ? { documentId } : {}),
    ...(style !== undefined ? { style } : {}),
    ...(glossary !== undefined ? { glossary } : {}),
    ...(glossaries !== undefined ? { glossaries } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(batchSize !== undefined ? { batchSize } : {}),
    ...(captions !== undefined ? { captions } : {}),
    ...(captionStyle !== undefined ? { captionStyle } : {}),
    ...(bilingual !== undefined ? { bilingual } : {}),
  };
}

/** 启动时解析术语表：调用时给的与视频里启用的；用到库里的条目时把内容写成产物。都没有时 undefined。 */
async function freezeGlossaries(
  deps: TranslateDeps,
  params: TranslateParams,
  documents: Record<Id, DocumentRecord>,
  documentId: Id,
  submitter: PipelinePrepareOptions['submitter'],
): Promise<FrozenGlossaryUse | undefined> {
  const enabled =
    submitter?.kind === 'service' || !deps.library
      ? []
      : (await videoSelection(documents, async (id, revision) => (await deps.videos.document(params.videoId, id, revision)).body)).selection
          .glossaries.translate;
  return freezeGlossaryUse(deps, {
    explicit: params.glossaries ?? [],
    enabled,
    targetLanguage: params.targetLanguage,
    sourceLanguage: documents[documentId]?.language ?? null,
    submitter,
  });
}

/** 源文档：指明的那份（必须是 `speech`），或视频里唯一的一份。 */
export function pickSource(documents: Record<Id, DocumentRecord>, documentId: Id | undefined): Id {
  if (documentId !== undefined) {
    const document = documents[documentId];
    if (!document) throw new RpcError('not-found', J.noDocument({ documentId }));
    if (document.kind !== 'speech') throw new RpcError('invalid-request', J.notSpeech({ documentId, kind: document.kind }));
    return documentId;
  }
  const speech = Object.values(documents).filter((d) => d.kind === 'speech');
  if (speech.length === 0) throw new RpcError('not-found', J.noTranscript());
  if (speech.length > 1) {
    throw new RpcError('invalid-request', J.multipleTranscripts(), {
      documents: speech.map((d) => ({ documentId: d.id, name: d.name })),
    });
  }
  return speech[0]!.id;
}

async function freezeSource(videos: PipelineVideos, context: PipelineStepContext<FrozenTranslateParams>): Promise<StepResult> {
  const { params, artifacts, progress } = context;
  progress(null, 'starting');
  const state = videos.state(params.videoId);
  if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosed());
  const record = state.documents[params.documentId];
  if (!record) throw new PipelineStepError('STALE_JOB_INPUT', J.sourceGone(), { documentId: params.documentId });
  const content = await videos.document(params.videoId, params.documentId, record.currentRevision);
  const read = sourceSentences(content.body);
  if ('problem' in read) throw new PipelineStepError('INPUT_UNREADABLE', asLocalized(read.problem, read.problemRef), { documentId: params.documentId });
  if (read.sentences.length === 0)
    throw new PipelineStepError('INPUT_UNREADABLE', J.noSentences(), { documentId: params.documentId });
  const source: FrozenSource = {
    derivation: read.derivation,
    speechRef: { id: params.documentId, revision: content.revision },
    sequenceId: state.rootSequenceId,
    language: record.language ?? null,
    editViewHash: read.editViewHash,
    timescale: read.timescale,
    sentences: read.sentences,
  };
  const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify(source)), 'json');
  const speech = await artifacts.put(Buffer.from(JSON.stringify(content.body)), 'json');
  const output: FreezeOutput = {
    artifactId,
    speechArtifactId: speech.artifactId,
    media: mediaFacts(videos, params.videoId, record.sourceAssetId ?? null, read),
    documentId: params.documentId,
    revision: content.revision,
    sentenceCount: read.sentences.length,
  };
  return { output, result: { documentId: null, artifactId } };
}

/**
 * Speech Worker 要的素材事实：素材当前版本的内容指纹、时长与采样率。拿不到时（转写不属于素材、Runtime 没给）内容指纹留空，
 * 时长按转写里最后一个句子的终点（Worker 只用它把字幕条夹在素材之内）。
 */
function mediaFacts(
  videos: PipelineVideos,
  videoId: Id,
  assetId: Id | null,
  read: { timescale: number; sentences: Array<{ end: number }> },
): SpeechTranslateInput['media'] {
  const facts = assetId ? (videos.asset?.(videoId, assetId) ?? null) : null;
  const lastEnd = Math.max(0, ...read.sentences.map((s) => s.end));
  return {
    assetId,
    contentHash: facts?.contentHash ?? '',
    duration: facts?.duration ?? { ticks: String(lastEnd), timescale: read.timescale },
    ...(facts?.sampleRate !== undefined ? { sampleRate: facts.sampleRate } : {}),
  };
}

/** 原文与目标语言的主子标签相同时不翻译（Speech Worker 也会拒绝）：启动时就以 `invalid-request` 拒绝，不建任务。 */
function sameLanguageCheck(sourceLanguage: string | null, targetLanguage: string): void {
  const primary = (tag: string) => tag.split('-')[0]!.toLowerCase();
  if (sourceLanguage && primary(sourceLanguage) === primary(targetLanguage)) {
    throw new RpcError('invalid-request', J.sameLanguage({ source: sourceLanguage, target: targetLanguage }), {
      sourceLanguage,
      targetLanguage,
    });
  }
}

/**
 * 在 Speech Worker 里翻译（`speech-worker.ts`）：冻结的转写正文、素材事实、术语与风格提示交给字幕与翻译核心，每一次模型调用
 * 经 `deps.text`（授权、预算、账本与停止屏障都在那边）。staging 是这一步专用的子目录，检查点在里面：中断或失败之后重试，
 * 已经译好的页不再请求。产出的译文正文与字幕条发布为产物。
 */
async function translateWithWorker(deps: TranslateDeps, context: PipelineStepContext<FrozenTranslateParams>): Promise<StepResult> {
  const { params, outputs, artifacts, signal, progress, staging } = context;
  const command = deps.speechWorker();
  if (!command) {
    throw new PipelineStepError('WORKER_FAILED', J.workerMissing(), {
      reason: 'worker-missing',
    });
  }
  const frozen = outputs['freeze-source'] as FreezeOutput;
  const source = await readArtifact<FrozenSource>(artifacts, frozen.artifactId);
  const speech = await readArtifact<unknown>(artifacts, frozen.speechArtifactId);
  const snapshot = await loadGlossaries(artifacts, params);
  const terms = promptTerms(snapshot);
  const glossaryRef = glossaryRefOf(snapshot, source.sentences.map((s) => s.text).join('\n'));
  // 模型的限制（输出上限、是否接受温度）按冻结的 Provider 与模型取。
  const selection = await deps.selectText({ provider: params.provider, model: params.model });
  const result = await runSpeechTranslate({
    command,
    staging: path.join(staging, 'translate'),
    input: {
      media: frozen.media,
      sourceLanguage: source.language,
      speechRef: source.speechRef,
      sequenceId: source.sequenceId,
      speech,
      targetLanguage: params.targetLanguage,
      glossary: terms.map(({ source: from, target, note }) => ({ source: from, target, ...(note ? { note } : {}) })),
      glossaryRef,
      params: {
        ...(params.style !== undefined ? { instructions: params.style } : {}),
        ...(deps.backoffScale !== undefined ? { backoffScale: deps.backoffScale } : {}),
      },
    },
    text: deps.text,
    provider: params.provider,
    model: params.model,
    modelInfo: selection.model,
    signal,
    progress,
  });
  const translation = await artifacts.put(Buffer.from(JSON.stringify(result.translation)), 'json');
  const cues = await artifacts.put(Buffer.from(JSON.stringify(result.cues)), 'json');
  const output: TranslateOutput = {
    artifactId: translation.artifactId,
    cuesArtifactId: cues.artifactId,
    calls: result.calls,
    modelVersion: result.modelVersion,
    ...(terms.length > 0 ? { glossaryTerms: terms.length, cappedBatches: 0 } : {}),
  };
  return { output, result: { documentId: null, artifactId: translation.artifactId } };
}

async function writeTranslation(videos: PipelineVideos, context: PipelineStepContext<FrozenTranslateParams>): Promise<StepResult> {
  const { params, outputs, artifacts, progress, jobId, parentJobId, run } = context;
  progress(null, 'applying');
  const frozen = outputs['freeze-source'] as FreezeOutput;
  const translated = outputs.translate as TranslateOutput;
  const assembled = outputs.assemble as AssembleOutput;
  const body = await readArtifact<TranslationBody>(artifacts, assembled.artifactId);
  const operation: EditOperation = {
    type: 'putDocument',
    ref: 'translation',
    kind: 'translation',
    name: J.documentName({ language: params.targetLanguage }).text,
    language: params.targetLanguage,
    sourceDocument: { documentId: frozen.documentId },
    body,
    summary: { unitCount: body.units.length, sourceRevision: frozen.revision },
    extensions: {
      engine: {
        providerId: params.provider,
        modelId: params.model,
        modelVersion: translated.modelVersion,
        promptVersion: SPEECH_WORKER_PROTOCOL,
      },
      pipeline: { name: TRANSLATE_PIPELINE, jobId: parentJobId, actor: PIPELINE_ACTOR_ID, translationArtifactId: translated.artifactId },
    },
  };
  for (let attempt = 1; ; attempt++) {
    const state = videos.state(params.videoId);
    if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosedKept());
    const current = state.documents[frozen.documentId];
    if (!current || current.currentRevision !== frozen.revision) {
      throw new PipelineStepError('STALE_JOB_INPUT', J.sourceChanged(), {
        documentId: frozen.documentId,
        frozenRevision: frozen.revision,
        currentRevision: current?.currentRevision ?? null,
      });
    }
    try {
      const receipt = await videos.apply(params.videoId, {
        commandId: `cmd_${jobId}_write_${attempt}`,
        expectedRevision: state.revision,
        operations: [operation],
        label: J.transactionLabel({ language: params.targetLanguage }).text,
        run,
      });
      const documentId = receipt.refs?.translation;
      if (!documentId) throw new PipelineStepError('APPLY_FAILED', J.noDocumentId());
      return { output: { documentId } satisfies WriteOutput, result: { documentId, artifactId: assembled.artifactId } };
    } catch (error) {
      // 视频在读与写之间被改过：重新读、重新核对源文档，换一个命令再提交。
      if (error instanceof RpcError && error.code === 'conflict' && attempt < APPLY_ATTEMPTS) continue;
      if (error instanceof PipelineStepError) throw error;
      throw new PipelineStepError('APPLY_FAILED', J.rejected(), {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
