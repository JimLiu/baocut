import {
  RpcError,
  itemRangeSeconds,
  type CaptionItem,
  type DocumentRecord,
  type EditOperation,
  type Id,
  type PipelineCaptionsSummary,
  type Sequence,
  type SequenceItem,
} from '@baocut/protocol';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { invalid } from './params.ts';
import { JobsCaptionLayer as J } from '@baocut/protocol/messages/jobs/caption-layer.ts';
import type { ArtifactStore } from '../artifact-store.ts';
import { jobWarning } from '../job-text.ts';
import {
  captionBody,
  deriveCues,
  readSpeechWords,
  translationCues,
  workerCaptionBody,
  type CueTranslationUnit,
  type CueWords,
} from './caption-cues.ts';
import { PipelineStepError, type PipelineStep, type PipelineStepContext, type StepOutputs } from './pipeline.ts';
import { PIPELINE_ACTOR_ID } from './pipeline-runner.ts';
import type { SpeechWorkerCues } from './speech-worker.ts';
import { readArtifact } from './translation-batches.ts';
import type { PipelineVideos } from './translate.ts';

/**
 * 固定流程的「建立字幕层」一步（架构设计 §7.9，产品设计 S01、S02）：给一份文稿（`speech`）或一份译文（`translation`）
 * 在根序列上建一层可编辑的字幕，一笔事务（视频格式规范 §3.8、§4.6）：
 *
 * - 写一份 `caption` 文档（`baocut.caption/1`，素材时钟，派生自那份文稿或译文，记下素材与来源的版本，
 *   `extensions.pipeline` 记下这次运行），放一个字幕实例：作用实例是时间线上取用这个素材的实例，区间盖住它们；之后剪切、
 *   移动媒体，字幕跟着走。文稿的字幕条与编辑器的「生成字幕」切法相同（`caption-cues.ts`）；译文的字幕条是翻译时 Speech Worker
 *   按字幕与翻译核心的对齐切好的（产物 `baocut.speech-worker.cues/1`），原样写进去。智能体自己写的译文没有 Worker 的字幕条
 *   （`captions_create`，§3.5）：按句级对齐取原句的时间、按显示宽度切条，与编辑器的「放到画面上」相同（`translationCues`）。
 * - 「字幕层」是根序列上引用这种字幕文档的字幕实例（§3.8：字幕显示靠实例）；只有文档、没有实例的不算。
 *   同一份文稿（译文）已经有字幕层时这一步记为 `skipped`，不建第二条字幕轨（S01 的通过标准）；只看派生关系
 *   （`sourceDocumentId`），编辑器建的与流程建的一视同仁。
 * - 时间线上没有取用这个素材的实例时不建（字幕投不到画面上），这一步照样完成并告警 `CAPTIONS_NOT_ON_TIMELINE`；
 *   切不出字幕条（没有词、译文全空）时告警 `CAPTIONS_EMPTY`。
 *
 * 显示（§3.8「各自启用或停用」）：
 * - 文稿：放在第一条空着、没锁的字幕轨上，没有就新建一条。这个素材已经有别的原文字幕层显示在画面上时，新的一层
 *   以停用（`enabled: false`，编辑器里是「拿下来」的虚线 chip）放上去，不动已有的那层——同一种语言叠两层字是重复，
 *   选用哪一份是编辑器里的决定（§7.9「不覆盖」）；没有时直接显示。
 * - 译文：与编辑器的「放到画面上」相同。新建一条这门语言的字幕轨；只看译文（默认）时把配对的原文字幕层从画面上拿下
 *   （`enabled: false`，不删）；双语时两层共用一份字幕样式（预览按样式文档叠成两行，§5.6），原文没有样式时新建一份默认样式，
 *   原文被拿下的放回来。配对的原文锁住时不动它，只在它有样式时共用。
 * - 双语而时间线上没有这份转写的原文字幕层时（`pairOriginal`，智能体的 `captions_create`）：同一笔事务里先给转写建原文字幕层
 *   （与「文稿」的切法与放置相同，用自己的 ref），再建译文的一层，两层共用新建的样式；一次调用就是双语，撤销时两层一起撤。
 *   新的译文层本来就要停用着放上去（同一份译文已有一层显示着）时不顺带建原文。
 */

type Json = Record<string, unknown>;

/** 写字幕要读根序列（轨道与实例）。 */
export interface CaptionVideos extends PipelineVideos {
  /** 根序列此刻的轨道与实例；视频没打开时 null。 */
  rootSequence(videoId: Id): Sequence | null;
}

/** 编辑器的 Studio 字幕样式（`packages/ui/src/render/text-style.ts` 的 `STUDIO_STYLE`）；双语时新建的默认样式用它。 */
const STUDIO_STYLE = 'baocut.legacy-studio-style/0.1';
/**
 * 双语时新建的字幕样式：默认预设（视频格式规范 §5.6「默认预设」），与编辑器的 `DEFAULT_CAPTION_STYLE`
 * （`packages/ui/src/model/property-values.ts`，「经典」涂装加 `punct: true`）和渲染内核没有样式文档时的
 * `video_model::caption_style::default_studio_style` 逐字段相同；jobs 不能依赖 UI，所以这里各留一份，三处一起改。
 */
export const DEFAULT_CAPTION_STYLE_BODY: Json = {
  schema: STUDIO_STYLE,
  style: {
    fontStyle: 'normal',
    underline: false,
    textAlign: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    textTransform: 'none',
    background: false,
    backgroundColor: '#000000B3',
    backgroundStyle: 'wrap',
    backgroundPadding: 10,
    borderRadius: 15,
    fontFamily: 'system',
    fontWeight: 700,
    bold: true,
    italic: false,
    fontColor: '#FFFFFF',
    textOutline: { on: true, color: '#000000', width: 14 },
    dropShadow: { on: true, blur: 0.12, distance: 0.08, rotation: 45, color: '#000000', opacity: 0.9 },
    outline: true,
    glow: { on: false },
    punct: true,
  },
};
/** 可选的新字幕样式文档；未知 schema 不进入渲染器，已有样式不会被它覆盖。 */
export function readCaptionStyle(value: unknown): Json | undefined {
  if (value === undefined) return undefined;
  const object = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!object(value) || value.schema !== STUDIO_STYLE || !object(value.style)) {
    throw invalid('captionStyle', JobsParams.mustBeOneOf({ values: '{ schema: "baocut.legacy-studio-style/0.1", style: {…} }' }));
  }
  return value;
}

function withCaptionStyle(operations: EditOperation[], body: Json): EditOperation[] {
  const freshStyle = operations.find((op) => op.type === 'putDocument' && op.kind === 'caption-style' && !op.documentId);
  if (freshStyle) return operations.map((op) => (op === freshStyle ? { ...op, body } : op));
  const needsStyle = operations.some(
    (op) => op.type === 'insertItems' && op.items.some((item) => item.type === 'caption' && !item.styleDocumentId && !item.styleDocumentRef),
  );
  if (!needsStyle) return operations;
  const ref = 'caption-preferences-style';
  return [
    { type: 'putDocument', ref, kind: 'caption-style', name: J.styleName().text, body },
    ...operations.map((op): EditOperation => {
      if (op.type !== 'insertItems') return op;
      return {
        ...op,
        items: op.items.map((item) =>
          item.type === 'caption' && !item.styleDocumentId && !item.styleDocumentRef
            ? { ...item, styleDocumentId: undefined, styleDocumentRef: ref }
            : item,
        ),
      };
    }),
  ];
}

/** 文稿字幕的来源记录（与编辑器 speech-cues.ts 的 `SPEECH_CAPTION_EXTENSION` 相同）。 */
export const SPEECH_CAPTION_EXTENSION = 'baocut.speechCues';
/** 译文字幕的来源记录（与编辑器 translation-cues.ts 的 `TRANSLATION_CAPTION_EXTENSION` 相同）。 */
export const TRANSLATION_CAPTION_EXTENSION = 'baocut.translationCues';
const APPLY_ATTEMPTS = 3;

/** 这一步的产出：建了的字幕文档与显示状态；没建时 `documentId` 为 null、`reason` 说明为什么。 */
export interface CaptionLayerOutput {
  documentId: Id | null;
  cueCount: number;
  /** 新建的一层是否显示在画面上。 */
  enabled: boolean;
  bilingual?: boolean;
  /** 建字幕层的那笔事务（编辑器的「撤销」按它撤）；没建或 Runtime 没给时没有。 */
  transactionId?: Id;
  /** 没建：已经有了（执行期间别处建的）、素材不在时间线上、没有可显示的字幕条。 */
  reason?: 'existing' | 'not-on-timeline' | 'empty';
}

/**
 * 字幕层从哪来：一份文稿；一份译文，连同翻译时 Speech Worker 切好的字幕条（产物）；或一份没有 Worker 字幕条的译文
 * （智能体自己写的），字幕条按单元的句级对齐（`alignment.sourceWordIds`）取原句的时间、按显示宽度切（`translationCues`）。
 */
export type CaptionSource =
  | { kind: 'speech'; documentId: Id }
  | { kind: 'translation'; documentId: Id; bilingual: boolean; cuesArtifactId: string }
  | { kind: 'translation'; documentId: Id; bilingual: boolean; cues: 'sentence-alignment' };

/** 算字幕层只读文档的正文。 */
export type CaptionDocumentReader = Pick<PipelineVideos, 'document'>;

/** 建字幕层的那笔事务（还没提交）。 */
export interface CaptionLayerPlan {
  operations: EditOperation[];
  cueCount: number;
  /** 新建的一层是否显示在画面上。 */
  enabled: boolean;
  /** 同一份文档已有的字幕层；新的一层照样建（§7.9「不覆盖」）。没有时 null。 */
  existing: { documentId: Id; itemIds: Id[] } | null;
  /** 译文：和它配对的、已有的原文字幕层（双语时共用样式、放回画面）；没有时 null。文稿没有这一项。 */
  paired?: { documentId: Id; itemIds: Id[] } | null;
  /**
   * 译文双语而时间线上没有原文字幕层（`pairOriginal`）：同一笔事务里顺带建的原文字幕层。`documentRef` 是它的字幕文档在事务里的
   * `ref`（回执的 `refs` 按它给出文档 ID）。没有顺带建时没有这一项。
   */
  original?: { documentRef: string; cueCount: number };
}

/** 新建的字幕文档在事务里的 `ref`：回执的 `refs` 按它给出文档 ID。 */
export const CAPTION_DOCUMENT_REF = 'caption';
/** 双语时顺带建的原文字幕层：它的字幕文档在事务里的 `ref`。 */
export const ORIGINAL_CAPTION_DOCUMENT_REF = 'original-caption';

/** 根序列上派生自这份文档的字幕层（字幕实例引用的 `caption` 文档的 `sourceDocumentId` 是它）；没有时 null。 */
export function existingCaptionLayer(
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
  sourceDocumentId: Id,
): { documentId: Id; itemIds: Id[] } | null {
  const items = sequence.items.filter(
    (item): item is CaptionItem =>
      item.type === 'caption' &&
      documents[item.documentId]?.kind === 'caption' &&
      documents[item.documentId]?.sourceDocumentId === sourceDocumentId,
  );
  if (!items.length) return null;
  const documentId = items[0]!.documentId;
  return { documentId, itemIds: items.filter((item) => item.documentId === documentId).map((item) => item.id) };
}

/**
 * 「建立字幕层」这一步。`source` 从参数与之前的产出读出要建字幕的文档（没有时不建）；`videoId` 同理。
 * 关掉（`enabled` 返回 false）或已有字幕层时记为 `skipped`。
 */
export function captionsStep<P>(
  videos: CaptionVideos,
  options: {
    pipeline: string;
    enabled(params: P): boolean;
    videoId(params: P, outputs: StepOutputs): Id | null;
    source(params: P, outputs: StepOutputs): CaptionSource | null;
    captionStyle?(params: P): Json | undefined;
  },
): PipelineStep<P> {
  return {
    name: 'captions',
    label: () => J.label(),
    when: (params, outputs) => {
      if (!options.enabled(params)) return false;
      const videoId = options.videoId(params, outputs);
      const source = options.source(params, outputs);
      if (!videoId || !source) return true;
      const state = videos.state(videoId);
      const sequence = videos.rootSequence(videoId);
      // 视频没开着时照常执行，由这一步报出来。
      if (!state || !sequence) return true;
      return existingCaptionLayer(sequence, state.documents, source.documentId) === null;
    },
    run: async (context) => {
      const videoId = options.videoId(context.params, context.outputs);
      const source = options.source(context.params, context.outputs);
      if (!videoId || !source) throw new PipelineStepError('INTERNAL', J.noSource(), {});
      const output = await buildCaptionLayer(videos, context, { pipeline: options.pipeline, videoId, source, captionStyle: options.captionStyle?.(context.params) });
      return { output: { ...output } };
    },
  };
}

/** 父任务摘要里的 `captions`：这一步的产出，或跳过的原因（关掉了、已有字幕层）。 */
export function captionsSummary(
  videos: CaptionVideos,
  enabled: boolean,
  output: CaptionLayerOutput | null,
  videoId: Id,
  sourceDocumentId: Id,
): PipelineCaptionsSummary {
  if (!enabled) return { status: 'disabled', documentId: null, cueCount: null, enabled: null };
  if (output) {
    if (output.reason) return { status: output.reason, documentId: output.documentId, cueCount: null, enabled: null };
    return {
      status: 'created',
      documentId: output.documentId,
      cueCount: output.cueCount,
      enabled: output.enabled,
      ...(output.bilingual !== undefined ? { bilingual: output.bilingual } : {}),
      ...(output.transactionId !== undefined ? { transactionId: output.transactionId } : {}),
    };
  }
  const state = videos.state(videoId);
  const sequence = videos.rootSequence(videoId);
  const existing = state && sequence ? existingCaptionLayer(sequence, state.documents, sourceDocumentId) : null;
  return { status: 'existing', documentId: existing?.documentId ?? null, cueCount: null, enabled: null };
}

async function buildCaptionLayer<P>(
  videos: CaptionVideos,
  context: PipelineStepContext<P>,
  request: { pipeline: string; videoId: Id; source: CaptionSource; captionStyle?: Json },
): Promise<CaptionLayerOutput> {
  const { jobId, parentJobId, run, progress, warn } = context;
  const { videoId, source } = request;
  progress(null, 'applying');
  const provenance = { name: request.pipeline, jobId: parentJobId, actor: PIPELINE_ACTOR_ID };
  for (let attempt = 1; ; attempt++) {
    const state = videos.state(videoId);
    const sequence = videos.rootSequence(videoId);
    if (!state || !sequence) throw new PipelineStepError('VIDEO_NOT_OPEN', J.videoClosed(), {});
    // 别处（编辑器）在这期间建了：不再建第二层。
    const existing = existingCaptionLayer(sequence, state.documents, source.documentId);
    if (existing) return { documentId: existing.documentId, cueCount: 0, enabled: false, reason: 'existing' };
    const plan = await planCaptionLayer(videos, {
      videoId,
      sequence,
      documents: state.documents,
      source,
      artifacts: context.artifacts,
      pipeline: provenance,
      captionStyle: request.captionStyle,
    });
    if ('reason' in plan) {
      warn(
        plan.reason === 'empty'
          ? jobWarning('CAPTIONS_EMPTY', J.empty())
          : jobWarning('CAPTIONS_NOT_ON_TIMELINE', J.notOnTimeline()),
      );
      return { documentId: null, cueCount: 0, enabled: false, reason: plan.reason };
    }
    try {
      const receipt = await videos.apply(videoId, {
        commandId: `cmd_${jobId}_captions_${attempt}`,
        expectedRevision: state.revision,
        operations: plan.operations,
        label: J.label().text,
        run,
      });
      const documentId = receipt.refs?.[DOCUMENT_REF];
      if (!documentId) throw new PipelineStepError('APPLY_FAILED', J.noDocumentId());
      return {
        documentId,
        cueCount: plan.cueCount,
        enabled: plan.enabled,
        ...(source.kind === 'translation' ? { bilingual: source.bilingual } : {}),
        ...(receipt.transactionId !== undefined ? { transactionId: receipt.transactionId } : {}),
      };
    } catch (error) {
      // 视频在读与写之间被改过：重新读、重新算，换一个命令再提交。
      if (error instanceof RpcError && error.code === 'conflict' && attempt < APPLY_ATTEMPTS) continue;
      if (error instanceof PipelineStepError) throw error;
      throw new PipelineStepError('APPLY_FAILED', J.rejected(), {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

type Plan = CaptionLayerPlan | { reason: 'not-on-timeline' | 'empty' };

const DOCUMENT_REF = CAPTION_DOCUMENT_REF;
const TRACK_REF = 'caption-track';
const ORIGINAL_TRACK_REF = 'original-caption-track';
const STYLE_REF = 'caption-style';

/**
 * 算出给一份文稿或译文建字幕层的一笔事务，不提交：固定流程的 `captions` 一步与智能体的 `captions_create`（§3.5）共用。
 * `pipeline` 是流程的运行记录（写进字幕文档的 `extensions.pipeline`），智能体的调用没有。
 *
 * 同一份文档已有字幕层时照样算出新的一层（§7.9「不覆盖」），`existing` 指出已有的那层；要不要建由调用方决定（流程跳过）。
 * 新的原文字幕层在同一素材已有原文字幕显示着时停用着放上去；新的译文字幕层在同一份译文已有的一层显示着时同样停用着放上去，
 * 也不去动配对的原文（不叠两层同一种语言的字）。`pairOriginal` 时双语的译文没有配对的原文字幕层就在同一笔事务里先给转写建一层
 * （`original`）。文档不在、种类不对或正文读不了时抛 `PipelineStepError`。
 */
async function planCaptionLayerBase(
  videos: CaptionDocumentReader,
  request: {
    videoId: Id;
    sequence: Sequence;
    documents: Record<Id, DocumentRecord>;
    source: CaptionSource;
    /** Worker 字幕条的产物库：带 `cuesArtifactId` 的译文要。 */
    artifacts?: ArtifactStore;
    pipeline?: Json;
    /** 双语的译文没有配对的原文字幕层时顺带建一层（智能体的 `captions_create`）；默认不建，只建译文的一层。 */
    pairOriginal?: boolean;
    captionStyle?: Json;
  },
): Promise<Plan> {
  const { videoId, sequence, documents, source, pipeline } = request;
  const record = documents[source.documentId];
  if (!record) throw new PipelineStepError('STALE_JOB_INPUT', J.documentGone(), { documentId: source.documentId });
  const existing = existingCaptionLayer(sequence, documents, source.documentId);
  if (source.kind === 'speech') return speechPlan(videos, videoId, record, sequence, documents, pipeline, existing);
  const options: TranslationOptions = { bilingual: source.bilingual, pairOriginal: request.pairOriginal === true, pipeline, existing };
  if ('cuesArtifactId' in source) {
    if (!request.artifacts) throw new PipelineStepError('INTERNAL', J.needsOutputStore(), {});
    return translationPlan(videos, request.artifacts, videoId, record, sequence, documents, source, options);
  }
  return sentenceTranslationPlan(videos, videoId, record, sequence, documents, options);
}

/** 新建时才套用传入的客户端偏好；字幕与样式同一笔事务，撤销时一起回去。 */
export async function planCaptionLayer(videos: CaptionDocumentReader, request: Parameters<typeof planCaptionLayerBase>[1]): Promise<Plan> {
  const plan = await planCaptionLayerBase(videos, request);
  return 'reason' in plan || !request.captionStyle ? plan : { ...plan, operations: withCaptionStyle(plan.operations, request.captionStyle) };
}

async function speechPlan(
  videos: CaptionDocumentReader,
  videoId: Id,
  record: DocumentRecord,
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
  pipeline: Json | undefined,
  existing: CaptionLayerPlan['existing'],
): Promise<Plan> {
  if (record.kind !== 'speech') throw new PipelineStepError('INPUT_UNREADABLE', J.notSpeech(), { documentId: record.id });
  // 先看投不投得到画面上（不是素材的转写、素材不在时间线上），再读正文。
  const assetId = record.sourceAssetId;
  const placement = assetId ? captionPlacement(sequence, assetId) : null;
  if (!assetId || !placement) return { reason: 'not-on-timeline' };
  const { span, scopeItemIds } = placement;
  const content = await videos.document(videoId, record.id, record.currentRevision);
  const speech = readSpeechWords(content.body);
  if (!speech) throw new PipelineStepError('INPUT_UNREADABLE', J.speechUnreadable(), { documentId: record.id });
  const made = speechOperations({ record, revision: content.revision, speech, assetId, placement }, sequence, documents, pipeline, {
    documentRef: DOCUMENT_REF,
    trackRef: TRACK_REF,
  });
  if (!made) return { reason: 'empty' };
  return { operations: made.operations, cueCount: made.cueCount, enabled: made.enabled, existing };
}

/**
 * 给一份转写建原文字幕层的操作：切条、挑空着的字幕轨（没有就新建一条，`refs.trackRef`）、写字幕文档（`refs.documentRef`）、
 * 放实例。切不出字幕条时 null。`styleDocumentRef` 是同一事务里前面新建的字幕样式（双语时与译文共用），放实例时直接带上。
 */
function speechOperations(
  source: { record: DocumentRecord; revision: string; speech: CueWords; assetId: Id; placement: CaptionPlacement },
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
  pipeline: Json | undefined,
  refs: { documentRef: string; trackRef: string },
  styleDocumentRef?: string,
): { operations: EditOperation[]; cueCount: number; enabled: boolean } | null {
  const { record, revision, speech, assetId } = source;
  const { span, scopeItemIds } = source.placement;
  const cues = deriveCues(speech.words);
  if (!cues.length) return null;
  const body = captionBody(cues, speech.speakers);
  // 这个素材已经有原文字幕显示着：新的一层停用着放上去，不叠两层同一种语言的字。
  const shown = sequence.items.some(
    (item) =>
      item.type === 'caption' &&
      item.enabled &&
      documents[item.documentId]?.kind === 'caption' &&
      documents[item.documentId]?.sourceAssetId === assetId &&
      captionKind(item.documentId, documents) === 'original',
  );
  const free = sequence.tracks
    .filter((track) => track.kind === 'subtitle' && !track.locked)
    .sort((a, b) => a.order - b.order)
    .find((track) => trackFree(sequence, track.id, span.fromFrame, span.fromFrame + span.durationFrames));
  const operations: EditOperation[] = [];
  if (!free) operations.push({ type: 'addTrack', sequenceId: sequence.id, kind: 'subtitle', ref: refs.trackRef, name: J.subtitlesName().text });
  operations.push({
    type: 'putDocument',
    ref: refs.documentRef,
    kind: 'caption',
    name: J.subtitlesName().text,
    ...(record.language ? { language: record.language } : {}),
    sourceAsset: { assetId },
    sourceDocument: { documentId: record.id },
    body,
    summary: { cueCount: cues.length },
    extensions: {
      [SPEECH_CAPTION_EXTENSION]: { speechDocumentId: record.id, speechRevision: revision, assetId },
      ...(pipeline ? { pipeline } : {}),
    },
  });
  operations.push({
    type: 'insertItems',
    sequenceId: sequence.id,
    items: [
      {
        type: 'caption',
        name: J.subtitlesName().text,
        span,
        documentRef: refs.documentRef,
        ...(scopeItemIds.length ? { scopeItemIds } : {}),
        ...(free ? { trackId: free.id } : { trackRef: refs.trackRef }),
        ...(styleDocumentRef ? { styleDocumentRef } : {}),
        ...(shown ? { enabled: false } : {}),
      },
    ],
  });
  return { operations, cueCount: cues.length, enabled: !shown };
}

/** 译文字幕层怎么建：双语与否、没有原文字幕层时顺不顺带建、流程的运行记录、同一份译文已有的一层。 */
interface TranslationOptions {
  bilingual: boolean;
  pairOriginal: boolean;
  pipeline: Json | undefined;
  existing: CaptionLayerPlan['existing'];
}

async function translationPlan(
  videos: CaptionDocumentReader,
  artifacts: ArtifactStore,
  videoId: Id,
  record: DocumentRecord,
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
  source: Extract<CaptionSource, { cuesArtifactId: string }>,
  options: TranslationOptions,
): Promise<Plan> {
  const read = await readTranslationSource(videos, videoId, record, sequence, documents);
  if ('reason' in read) return read;
  // 字幕条是翻译时切好的（转写时钟的整数刻度）；说话人的显示名取转写里的。
  const workerCues = await readArtifact<SpeechWorkerCues>(artifacts, source.cuesArtifactId);
  const body = workerCaptionBody(workerCues, sentenceSpeakers(read.speech.words), read.speech.speakers);
  return translationOperations(read, body, sequence, documents, options);
}

/**
 * 没有 Worker 字幕条的译文（智能体自己写的）：每个单元按句级对齐（`alignment.sourceWordIds`）取原句成员词的时间，按显示宽度
 * 切条（`translationCues`，与编辑器的「放到画面上」相同），不经 Worker 的模型对齐。没有对齐的单元（`alignment` 为 null）切不出
 * 时间：有这样的单元时以 `TRANSLATION_UNALIGNED` 拒绝，不悄悄少几句（重新写一次译文，Runtime 会按句子补上对齐）。
 */
async function sentenceTranslationPlan(
  videos: CaptionDocumentReader,
  videoId: Id,
  record: DocumentRecord,
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
  options: TranslationOptions,
): Promise<Plan> {
  const read = await readTranslationSource(videos, videoId, record, sequence, documents);
  if ('reason' in read) return read;
  const units = translationUnits(read.translation?.units);
  if (!units) throw new PipelineStepError('INPUT_UNREADABLE', J.translationUnreadable(), { documentId: record.id });
  const unaligned = units.filter((unit) => unit.status !== 'stale' && unit.alignment === null).map((unit) => unit.id);
  if (unaligned.length) {
    throw new PipelineStepError(
      'TRANSLATION_UNALIGNED',
      J.unaligned({ count: unaligned.length }),
      {
        documentId: record.id,
        unitIds: unaligned.slice(0, 20),
      },
    );
  }
  const cues = translationCues(read.speech, units);
  if (!cues.length) return { reason: 'empty' };
  return translationOperations(read, captionBody(cues, read.speech.speakers), sequence, documents, options);
}

/** 译文正文里的单元（只认切字幕要的几项）；不是数组时 null。 */
function translationUnits(value: unknown): CueTranslationUnit[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((raw): CueTranslationUnit[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const unit = raw as Record<string, unknown>;
    if (typeof unit.id !== 'string') return [];
    const rewrite = unit.displayRewrite as { text?: unknown } | undefined;
    const alignment = unit.alignment as { sourceWordIds?: unknown } | null | undefined;
    const ids = alignment && Array.isArray(alignment.sourceWordIds) ? alignment.sourceWordIds.filter((id) => typeof id === 'string') : null;
    return [
      {
        id: unit.id,
        naturalText: typeof unit.naturalText === 'string' ? unit.naturalText : '',
        ...(rewrite && typeof rewrite.text === 'string' ? { displayRewrite: { text: rewrite.text } } : {}),
        alignment: ids ? { sourceWordIds: ids } : null,
        status: typeof unit.status === 'string' ? unit.status : 'draft',
      },
    ];
  });
}

/** 字幕实例放在哪：盖住时间线上取用这个素材的实例的区间，与作用实例。 */
export interface CaptionPlacement {
  span: { fromFrame: number; durationFrames: number };
  scopeItemIds: Id[];
}

interface TranslationSource {
  record: DocumentRecord;
  content: { revision: string; body: unknown };
  translation: { language?: unknown; sourceBasis?: { speechRef?: { id?: unknown; revision?: unknown } }; units?: unknown } | null;
  speechRecord: DocumentRecord;
  /** 译文译自转写的哪个版本（译文记的 `sourceBasis`；没记时是读到的版本）。 */
  speechRevision: string;
  /** 转写此刻的版本（读正文用的）：顺带建的原文字幕层记它。 */
  speechCurrentRevision: string;
  speech: CueWords;
  assetId: Id;
  placement: CaptionPlacement;
}

/** 读译文与它译自的转写，并看投不投得到画面上（转写不是素材的、素材不在时间线上时不投）。 */
async function readTranslationSource(
  videos: CaptionDocumentReader,
  videoId: Id,
  record: DocumentRecord,
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
): Promise<TranslationSource | { reason: 'not-on-timeline' }> {
  const content = await videos.document(videoId, record.id, record.currentRevision);
  const translation = content.body as TranslationSource['translation'];
  const speechRef = translation?.sourceBasis?.speechRef?.id;
  const speechDocumentId = record.sourceDocumentId ?? (typeof speechRef === 'string' ? speechRef : null);
  const speechRecord = speechDocumentId ? documents[speechDocumentId] : undefined;
  if (record.kind !== 'translation' || !speechRecord) {
    throw new PipelineStepError('INPUT_UNREADABLE', J.noSourceSpeech(), { documentId: record.id });
  }
  // 先看投不投得到画面上（转写不是素材的、素材不在时间线上），再读正文。
  const assetId = speechRecord.sourceAssetId;
  const placement = assetId ? captionPlacement(sequence, assetId) : null;
  if (!assetId || !placement) return { reason: 'not-on-timeline' };
  const speechContent = await videos.document(videoId, speechRecord.id, speechRecord.currentRevision);
  const speech = readSpeechWords(speechContent.body);
  if (!speech) throw new PipelineStepError('INPUT_UNREADABLE', J.speechUnreadable(), { documentId: speechRecord.id });
  const speechRevision =
    typeof translation?.sourceBasis?.speechRef?.revision === 'string' ? translation.sourceBasis.speechRef.revision : speechContent.revision;
  return {
    record,
    content,
    translation,
    speechRecord,
    speechRevision,
    speechCurrentRevision: speechContent.revision,
    speech,
    assetId,
    placement,
  };
}

/**
 * 译文字幕层的一笔事务（与编辑器的 `translationCaptionOperations` 相同）：新建一条这门语言的字幕轨、写字幕文档、放字幕实例；
 * 只看译文时把配对的原文拿下（不删），双语时两层共用一份字幕样式、原文放回画面。同一份译文已有一层显示着时，新的一层停用着
 * 放上去，配对的原文不动。双语而没有配对的原文时（`pairOriginal`）排在前面先建原文的一层：新建的样式先写，原文的实例放上去时
 * 直接带上它，译文的实例也用它。
 */
function translationOperations(
  read: TranslationSource,
  body: Json,
  sequence: Sequence,
  documents: Record<Id, DocumentRecord>,
  options: TranslationOptions,
): Plan {
  const { bilingual, pipeline, existing } = options;
  const { record, content, translation, speechRecord, speechRevision, assetId, placement } = read;
  const cueCount = (body.cues as unknown[]).length;
  if (!cueCount) return { reason: 'empty' };
  const language = (typeof translation?.language === 'string' && translation.language) || record.language || '';
  const name = language ? languageName(language) : J.translationName().text;
  const paired = pairedOriginal(sequence, documents, speechRecord.id);
  const duplicateShown = existing !== null && existingShown(sequence, existing.itemIds);
  // 双语而时间线上没有原文字幕层：先给转写建一层，与译文共用新建的样式。
  const original =
    bilingual && options.pairOriginal && !paired && !duplicateShown
      ? speechOperations(
          { record: speechRecord, revision: read.speechCurrentRevision, speech: read.speech, assetId, placement },
          sequence,
          documents,
          pipeline,
          { documentRef: ORIGINAL_CAPTION_DOCUMENT_REF, trackRef: ORIGINAL_TRACK_REF },
          STYLE_REF,
        )
      : null;
  const operations: EditOperation[] = [];
  if (original) {
    const [first, ...rest] = original.operations;
    // 样式要先于原文的实例写入；原文的轨道（有时要新建）照样排在最前面。
    if (first!.type === 'addTrack') operations.push(first!);
    operations.push({
      type: 'putDocument',
      ref: STYLE_REF,
      kind: 'caption-style',
      name: J.styleName().text,
      body: DEFAULT_CAPTION_STYLE_BODY,
    });
    operations.push(...(first!.type === 'addTrack' ? rest : original.operations));
  }
  operations.push(
    { type: 'addTrack', sequenceId: sequence.id, kind: 'subtitle', ref: TRACK_REF, name },
    {
      type: 'putDocument',
      ref: DOCUMENT_REF,
      kind: 'caption',
      name,
      ...(language ? { language } : {}),
      sourceAsset: { assetId },
      sourceDocument: { documentId: record.id },
      body,
      summary: { cueCount },
      extensions: {
        [TRANSLATION_CAPTION_EXTENSION]: {
          translationDocumentId: record.id,
          translationRevision: content.revision,
          speechDocumentId: speechRecord.id,
          speechRevision,
          assetId,
        },
        ...(pipeline ? { pipeline } : {}),
      },
    },
  );
  const touch = paired && !paired.locked && !duplicateShown ? paired : null;
  let style: { styleDocumentId: Id } | { styleDocumentRef: string } | null = paired?.styleDocumentId
    ? { styleDocumentId: paired.styleDocumentId }
    : original
      ? { styleDocumentRef: STYLE_REF }
      : null;
  if (bilingual && touch) {
    if (!style) {
      operations.push({
        type: 'putDocument',
        ref: STYLE_REF,
        kind: 'caption-style',
        name: J.styleName().text,
        body: DEFAULT_CAPTION_STYLE_BODY,
      });
      for (const itemId of touch.itemIds) {
        operations.push({ type: 'setCaptionStyle', sequenceId: sequence.id, itemId, styleDocument: { ref: STYLE_REF } });
      }
      style = { styleDocumentRef: STYLE_REF };
    }
    if (touch.shelved) {
      for (const itemId of touch.itemIds) operations.push({ type: 'updateItem', sequenceId: sequence.id, itemId, enabled: true });
    }
  } else if (!bilingual && touch && !touch.shelved) {
    for (const itemId of touch.itemIds) operations.push({ type: 'updateItem', sequenceId: sequence.id, itemId, enabled: false });
  }
  operations.push({
    type: 'insertItems',
    sequenceId: sequence.id,
    items: [
      {
        type: 'caption',
        name,
        span: placement.span,
        documentRef: DOCUMENT_REF,
        trackRef: TRACK_REF,
        ...(placement.scopeItemIds.length ? { scopeItemIds: placement.scopeItemIds } : {}),
        ...(style ?? {}),
        ...(duplicateShown ? { enabled: false } : {}),
      },
    ],
  });
  return {
    operations,
    cueCount,
    enabled: !duplicateShown,
    existing,
    paired: paired ? { documentId: paired.documentId, itemIds: paired.itemIds } : null,
    ...(original ? { original: { documentRef: ORIGINAL_CAPTION_DOCUMENT_REF, cueCount: original.cueCount } } : {}),
  };
}

/** 已有的一层有实例显示在画面上。 */
function existingShown(sequence: Sequence, itemIds: readonly Id[]): boolean {
  return sequence.items.some((item) => itemIds.includes(item.id) && item.enabled);
}

/** 句子 ID（`s-<首词 ID>`）→ 首词的说话人：Worker 的字幕条按句子记，说话人跟着那一句。 */
function sentenceSpeakers(words: ReadonlyArray<{ id: string; speaker?: string }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const word of words) if (word.speaker !== undefined) out.set(`s-${word.id.replace(/~\d+$/, '')}`, word.speaker);
  return out;
}

// ---- 序列 ----

/** 字幕层是原文还是译文：看字幕文档派生自哪种文档（与编辑器 caption-tracks.ts 的 `captionKind` 相同）。 */
function captionKind(documentId: Id, documents: Record<Id, DocumentRecord>): 'original' | 'translation' {
  const record = documents[documentId];
  const parent = record?.sourceDocumentId ? documents[record.sourceDocumentId] : undefined;
  return parent?.kind === 'translation' ? 'translation' : 'original';
}

interface CaptionGroup {
  documentId: Id;
  itemIds: Id[];
  /** 全部实例都停用了（编辑器里「拿下来」的）。 */
  shelved: boolean;
  locked: boolean;
  styleDocumentId?: Id;
}

/**
 * 和译文配对的原文字幕层（编辑器 translation-cues.ts 的 `pairedOriginal`）：从同一份转写生成的那层；没有时画面上的
 * 第一层原文。一层是一条字幕轨上的一份字幕文档（实例被切开成几段时算同一层）。
 */
function pairedOriginal(sequence: Sequence, documents: Record<Id, DocumentRecord>, speechDocumentId: Id): CaptionGroup | null {
  const tracks = new Map(sequence.tracks.map((track) => [track.id, track]));
  const items = sequence.items
    .filter((item): item is CaptionItem => item.type === 'caption' && !!documents[item.documentId])
    .sort((a, b) => (tracks.get(a.trackId)?.order ?? 0) - (tracks.get(b.trackId)?.order ?? 0) || a.span.fromFrame - b.span.fromFrame);
  const groups = new Map<string, CaptionItem[]>();
  for (const item of items) {
    const key = `${item.trackId}:${item.documentId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const originals = [...groups.values()]
    .filter((members) => captionKind(members[0]!.documentId, documents) === 'original')
    .map((members): CaptionGroup => {
      const style = members.find((item) => item.styleDocumentId)?.styleDocumentId;
      return {
        documentId: members[0]!.documentId,
        itemIds: members.map((item) => item.id),
        shelved: members.every((item) => !item.enabled),
        locked: !!tracks.get(members[0]!.trackId)?.locked || members.some((item) => item.locked),
        ...(style ? { styleDocumentId: style } : {}),
      };
    });
  return (
    originals.find((group) => documents[group.documentId]?.sourceDocumentId === speechDocumentId) ??
    originals.find((group) => !group.shelved) ??
    null
  );
}

/** 实例取用的素材：视频与音频的素材，合成的预渲染替身（没有时是代码包）。 */
function sourceAsset(item: SequenceItem): Id | undefined {
  if (item.type === 'video' || item.type === 'audio') return item.assetRef.id;
  if (item.type === 'composition') return (item.prerender ?? (item.source.kind === 'bundle' ? item.source.assetRef : undefined))?.id;
  return undefined;
}

function linear(item: SequenceItem): boolean {
  if (item.type !== 'video' && item.type !== 'audio' && item.type !== 'composition') return false;
  if (item.timeMap.kind !== 'linear') return false;
  return item.timeMap.rate.num / item.timeMap.rate.den > 0;
}

/**
 * 素材时钟上的字幕实例放在哪（编辑器 speech-cues.ts 的 `captionPlacement`）：作用实例是时间线上取用这个素材的实例
 * （按起点排），区间盖住它们。时间线上没有这样的实例时 null。
 */
export function captionPlacement(sequence: Sequence, assetId: Id): CaptionPlacement | null {
  const perSecond = sequence.fps.num / sequence.fps.den;
  const scope = sequence.items
    .filter((item) => sourceAsset(item) === assetId && linear(item))
    .map((item) => {
      const range = itemRangeSeconds(item, sequence.fps);
      return { item, frames: { start: Math.floor(range.start * perSecond + 1e-6), end: Math.ceil(range.end * perSecond - 1e-6) } };
    })
    .sort((a, b) => a.frames.start - b.frames.start || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
  if (!scope.length) return null;
  const fromFrame = Math.min(...scope.map((s) => s.frames.start));
  return {
    span: { fromFrame, durationFrames: Math.max(1, Math.max(...scope.map((s) => s.frames.end)) - fromFrame) },
    scopeItemIds: scope.map((s) => s.item.id),
  };
}

/** 轨道在 [start, end) 帧里是空的（编辑器 editor-ops.ts 的 `trackFree`）。 */
function trackFree(sequence: Sequence, trackId: Id, start: number, end: number): boolean {
  const perSecond = sequence.fps.num / sequence.fps.den;
  return sequence.items.every((item) => {
    if (item.trackId !== trackId) return true;
    const range = itemRangeSeconds(item, sequence.fps);
    const from = item.type === 'audio' ? range.start * perSecond : item.span.fromFrame;
    const to = item.type === 'audio' ? range.end * perSecond : item.span.fromFrame + item.span.durationFrames;
    return to <= start + 1e-6 || from >= end - 1e-6;
  });
}

/** 语言标签 → 这门语言自己的叫法（`en` → English）；认不出时原样返回（与编辑器的字幕轨名相同）。 */
function languageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: 'language' }).of(tag);
    return name ? name.charAt(0).toLocaleUpperCase(tag) + name.slice(1) : tag;
  } catch {
    return tag;
  }
}
