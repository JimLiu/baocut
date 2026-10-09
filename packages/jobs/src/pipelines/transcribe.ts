import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  type DocumentRecord,
  type Id,
  type PipelineCreateScope,
  type PipelineCreateTarget,
  type Sequence,
  type SequenceItem,
  type GeneratedOutput,
  type JobRecord,
  type TranscribeFileSummary,
  type TranscribeParams,
  type TranscribeSummary,
  type TranscriptReplace,
  type TranscriptSwitchImpact,
} from '@baocut/protocol';
import { EditorWasmError } from '@baocut/editor-wasm';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { JobsTranscribe } from '@baocut/protocol/messages/jobs/transcribe.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { withCause } from '../job-text.ts';
import { TRANSCRIPT_SWITCH_EXTENSION, asrStage, contentFingerprint } from '../transcript-switch.ts';
import { readCaptionStyle, captionsStep, captionsSummary, existingCaptionLayer, type CaptionLayerOutput, type CaptionVideos } from './caption-layer.ts';
import { downloadTranscript } from './download-transcript.ts';
import { fileInputSchema, rejectUnresolvedEntry } from './entry-input.ts';
import { ParamReader, invalid } from './params.ts';
import { PipelineStepError, type PipelineDefinition, type PipelineStepContext, type StepOutputs } from './pipeline.ts';
import { ensureSaveDirectory, ensureSaveDirectoryForStep } from './save-location.ts';
import { createHeldVideo, importMedia, transcribeInVideo, type MediaVideos, type PipelineTranscriber } from './video-create.ts';
import { createScopeOf, readCreateTarget, targetSchema, targetStep, type PipelineTargets } from './video-target.ts';

/**
 * 转录（架构设计 §7.9；转录工具的后端）：解析目标 →（新建视频时）新建视频、导入本机媒体并放上时间线 → 转写 → 建立字幕层。
 *
 * 与 `models.transcribe` 提交的转写 Job 同名、不是一回事：这里是父任务（`kind: 'pipeline'`，`pipeline.name: 'transcribe'`），
 * 它的「转写」一步提交一个 `transcribe` Job（提交者 `{ kind: 'pipeline', id: <父任务> }`）并等它完成。
 *
 * - 「应用」并在转写里：转写 Job 自己把语音文档应用到视频（§7.3，`putDocument` 一份新的 `speech`，`extensions.jobId`
 *   记着那个 Job），流程不再写一遍，所以没有单独的 `apply` 一步。
 * - 素材：给了 `assetId` 用它；不给时取根序列主轨（第一条有媒体实例的视频轨，没有时第一条有媒体实例的音频轨）上的素材，
 *   不止一个时以 `TRANSCRIBE_ASSET_AMBIGUOUS` 拒绝、没有时 `TRANSCRIBE_ASSET_NOT_FOUND`（要给出 `assetId`）。
 * - 落点（§7.9「转录」）：视频里已有这个素材的转写时不在这部视频里新增第二份。`destination: 'new-video'`（缺省）时 `create`
 *   一步在原视频所在的项目（或会话的来源目录）里新建视频、以链接素材导入同一份文件并放上主轨，之后的步骤都对新视频做；
 *   `replace` 时转写 Job 应用结果就是换用文稿的那笔事务（`transcript-switch.ts`：新版本、结转译文、字幕与配音），字幕层已在那里
 *   重新切过，`captions` 一步按已有字幕层的规则跳过。没有这个素材的转写时两种都直接写进它（摘要的 `target: 'first'`）。
 *   落点在提交时定下并冻结（重试不再改）。
 * - 手工修改闸门：`replace` 而当前文稿的全文指纹与 `stages.asr` 不符（用户改过原文）、又没给 `acceptEdited` 时，提交时以
 *   `TRANSCRIPT_EDITED` 拒绝、不建任务；提交时的指纹随请求冻结，应用前转写 Job 再核对一次。没有 `stages.asr` 的文稿当作没改过。
 * - 一个素材有几份转写（之前的版本允许）时，换用的是根序列上有字幕层的那份，都没有时取最近写过的那份。
 * - 新建视频（`target.create` 带 `media`）：在项目里新建（与 `videos.create` 同一条路径），`media` 以链接素材导入
 *   （文件留在原处），同一笔事务放上主轨；来源 `origin: 'file-import'` 记文件路径与这次运行。名字不给时取文件名。
 * - 重试：新建、导入、转写各自认回上次做了一半的（`video-create.ts`），不会多出视频、素材或转写；
 *   转写完成之后文档被删了时重新转写。
 * - 只给文件（`file`，不给 `videoId` / `target`）：不建视频，「转写」一步提交没有视频的转写 Job 并等它完成，再把
 *   `<源文件名>.txt` 与 `.srt` 写到保存位置（`outDir`，不给时是 Runtime 的保存位置，提交时冻结；与从链接下载的转录同一段
 *   代码，`download-transcript.ts`）；字幕层这一步跳过。`file` 是 Space 条目（`{ entryId }`）时由方法层先换成路径。
 */

export const TRANSCRIBE_PIPELINE = 'transcribe';

export interface TranscribeDeps {
  videos: CaptionVideos & MediaVideos;
  /** 转写：选定 Provider 与模型（没有配置时 `CAPABILITY_NOT_CONFIGURED`）、提交与等待。 */
  transcriber: PipelineTranscriber;
  /** 新建视频（`target.create`）。没有时 `create` 被拒绝。 */
  targets?: Pick<PipelineTargets, 'reserve' | 'create'>;
  /** 视频里启用、此刻还在库里的转写术语表（§5.9，按启用的顺序）；不给时不套术语表。 */
  enabledGlossaries?: (videoId: Id) => Promise<Id[]>;
  /** 只给文件时、不给 `outDir` 的保存位置（§7.9）；没有接线时（只在单测里）写在源文件旁边。 */
  saveDirectory?: () => string;
  /**
   * 落点 `new-video` 要的原视频事实：名字与所在的范围（项目或会话），以及素材当前版本的文件。没有接线时 `new-video` 被拒绝
   * （`PIPELINE_TARGET_UNSUPPORTED`）。
   */
  sources?: {
    video(videoId: Id): { name: string; scope: PipelineCreateScope } | null;
    assetFile(videoId: Id, assetId: Id): Promise<string | null>;
  };
}

/** 提交时定下的落点（见文件头）。 */
export type TranscribeLanding =
  | { kind: 'first' }
  | { kind: 'new-video'; sourceVideoId: Id; assetId: Id; name: string; scope: PipelineCreateScope }
  | { kind: 'replace'; assetId: Id; replace: TranscriptReplace };

/** 校验过的参数：给定的视频、新建视频的目标，或只给文件（`file` 已是绝对路径）。 */
export interface CheckedTranscribeParams extends Omit<TranscribeParams, 'videoId'> {
  videoId?: Id;
  create?: PipelineCreateTarget & { media: string };
  file?: string;
  outDir?: string;
}

/** 冻结的参数：Provider 与模型已选定，`captions` 已补上默认值。 */
export interface FrozenTranscribeParams extends CheckedTranscribeParams {
  provider: string;
  model: string;
  captions: boolean;
  /** 转写时套用视频里启用的转写术语表：启动它的不是对外服务的客户端（与 `models.transcribe` 相同，对外服务不碰用户库）。 */
  videoGlossaries?: boolean;
  /** 给定视频时的落点（提交时定下）；新建视频与只给文件时没有。 */
  landing?: TranscribeLanding;
}

interface CreateOutput extends Record<string, unknown> {
  videoId: Id;
  place: Record<string, unknown>;
  assetId: Id;
}

/** 只给文件时「转写」一步的产出。 */
interface FileTranscribeOutput extends Record<string, unknown> {
  jobId: Id;
  files: string[];
  outputs: GeneratedOutput[];
  language: string | null;
}

interface TranscribeOutput extends Record<string, unknown> {
  jobId: Id;
  videoId: Id;
  documentId: Id;
  /** 转写 Job 的结果产物（逐段的转写结果）。 */
  artifactId: string;
  assetId: Id;
  /** 写入文稿的那笔事务（换用文稿时是撤销用的那笔）；查不到时 null。 */
  transactionId: Id | null;
}

/** 识别提示的上限，与 `models.transcribe` 的 `hint` 相同。 */
const HINT_MAX = 1200;

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    videoId: { type: 'string', description: '已打开的视频（等同 target: { videoId }）' },
    target: targetSchema('要转录的视频：已打开的、Space 里的视频条目（流程期间由 Runtime 打开），或新建视频并导入本机媒体', {
      projectId: '新视频所在的项目',
      conversationId: '新视频建在这个会话的来源目录里（会话属于项目时是那个项目）；与 projectId 给一个',
      name: '新视频的名字；不给时取媒体的文件名',
      media: '本机媒体文件的绝对路径：以链接素材导入（文件留在原处）并放上时间线',
    }),
    assetId: { type: 'string', description: '要转写的素材；不给时取根序列主轨上唯一的素材' },
    language: { type: 'string', description: '断言语言（BCP 47）；不给时自动检测' },
    provider: { type: 'string', description: '转写的 Provider；不给时用默认值' },
    model: { type: 'string' },
    hint: {
      type: 'string',
      maxLength: HINT_MAX,
      description: '识别提示（同 models.transcribe 的 hint；模型不收提示时不交给模型，转写任务记 hint-ignored 提醒）；视频里启用的转写术语表照样拼进去',
    },
    diarize: { type: 'boolean', description: '区分说话人（同 models.transcribe 的 diarize）；不给时按模型，能区分的区分' },
    captionStyle: {
      type: 'object',
      properties: { schema: { const: 'baocut.legacy-studio-style/0.1' }, style: { type: 'object' } },
      required: ['schema', 'style'],
      description: '新建字幕的 Studio 样式文档；共用已有样式时保留原样',
    },
    captions: { type: 'boolean', default: true, description: '转写之后建立字幕层；同一份文稿已有字幕层时跳过' },
    file: {
      description: '只给文件：不建视频，转写这个媒体文件，把 <源文件名>.txt 与 .srt 写到保存位置；与 videoId、target 不能同时给',
      ...fileInputSchema('媒体文件的绝对路径', 'Space 里的音频、视频文件或成片条目'),
    },
    outDir: { type: 'string', description: '只给文件时的输出目录（绝对路径，不存在时创建）；不给时是保存位置' },
    destination: {
      type: 'string',
      enum: ['new-video', 'replace'],
      default: 'new-video',
      description:
        '视频已有这个素材的转写时的落点：new-video 在同一项目新建一部视频（链接同一份素材）；replace 换用文稿，一笔可撤销的事务里结转译文、字幕与配音。没有转写的视频两种都直接写进它；只配已有的视频',
    },
    name: { type: 'string', description: 'new-video 新建视频的名字；不给时「<原名> · 重新转录」' },
    translations: {
      type: 'string',
      enum: ['carry', 'discard'],
      default: 'carry',
      description: 'replace 时各语言译文：carry 结转（原文没变的句子保留译文与审阅状态，变了的标过期）；discard 不结转',
    },
    acceptEdited: {
      type: 'boolean',
      description: 'replace 而文稿在转录之后被改过（全文指纹与 stages.asr 不符）时仍然取代；不给时以 TRANSCRIPT_EDITED 拒绝',
    },
    // i18n-ignore-end
  },
  additionalProperties: false,
};

const LANGUAGE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

export function transcribePipeline(deps: TranscribeDeps): PipelineDefinition<FrozenTranscribeParams, CheckedTranscribeParams> {
  return {
    name: TRANSCRIBE_PIPELINE,
    label: () => JobsTranscribe.label(),
    description: () => JobsTranscribe.description(),
    paramsSchema: PARAMS_SCHEMA,
    target: { create: { media: true } },
    parse: parseTranscribeParams,
    async prepare(params, { retry, submitter }) {
      if (params.file !== undefined) return prepareFile(deps, params, retry);
      if (params.create) {
        if (!deps.targets) throw new RpcError('invalid-request', JobsTranscribe.cannotCreateVideo(), { code: 'PIPELINE_TARGET_UNSUPPORTED' });
        // 重试时新建这一步完成过就不再读文件。
        if (!retry) await checkMedia(params.create.media);
      } else if (params.videoId === undefined || !deps.videos.state(params.videoId)) {
        throw new RpcError('not-found', JobsTranscribe.videoNotOpen());
      }
      // 落点提交时定下；重试沿用冻结的那个（之前的尝试可能已经写进去了）。
      const frozenLanding = (params as FrozenTranscribeParams).landing;
      const landing = params.create ? undefined : (frozenLanding ?? (await resolveLanding(deps, params, params.videoId!)));
      const selection = await deps.transcriber.check({
        ...(params.provider !== undefined ? { provider: params.provider } : {}),
        ...(params.model !== undefined ? { model: params.model } : {}),
      });
      const frozen: FrozenTranscribeParams = {
        ...params,
        provider: selection.providerId,
        model: selection.modelId,
        captions: params.captions ?? true,
        videoGlossaries: submitter?.kind !== 'service',
        ...(landing ? { landing } : {}),
      };
      return {
        params: frozen,
        providerId: selection.providerId,
        modelId: selection.modelId,
        videoId: frozen.videoId ?? null,
        contentHash: `sha256:${sha256Hex(
          canonicalJson(
            frozen.create
              ? { media: frozen.create.media }
              : {
                  videoId: frozen.videoId,
                  assetId: frozen.assetId ?? null,
                  ...(landing && landing.kind !== 'first' ? { destination: landing.kind } : {}),
                },
          ),
        )}`,
      };
    },
    steps: [
      targetStep(),
      {
        name: 'create',
        label: () => JobsTranscribe.stepCreate(),
        holdsVideo: true,
        when: (params) => params.create !== undefined || params.landing?.kind === 'new-video',
        run: (context) => (context.params.create ? createVideo(deps, context) : createLinkedVideo(deps, context)),
      },
      {
        name: 'transcribe',
        label: () => JobsTranscribe.stepTranscribe(),
        run: (context) => (context.params.file !== undefined ? transcribeFile(deps, context) : transcribe(deps, context)),
        // 文档被删了：重试时重新转写。只给文件的转写完成过就不重做（文稿已经写出）。
        reusable: async (output) => {
          if ('files' in output) return true;
          const out = output as TranscribeOutput;
          return deps.videos.state(out.videoId)?.documents[out.documentId]?.kind === 'speech';
        },
      },
      captionsStep<FrozenTranscribeParams>(deps.videos, {
        captionStyle: (params) => params.captionStyle,
        pipeline: TRANSCRIBE_PIPELINE,
        enabled: (params) => params.captions,
        videoId: (params, outputs) => targetVideo(params, outputs),
        source: (_params, outputs) => {
          const transcribed = outputs.transcribe as TranscribeOutput | undefined;
          return transcribed ? { kind: 'speech', documentId: transcribed.documentId } : null;
        },
      }),
    ],
    async complete({ params, outputs }) {
      if (params.file !== undefined) {
        const done = outputs.transcribe as FileTranscribeOutput;
        const summary: TranscribeFileSummary = {
          file: params.file,
          files: done.files,
          transcribeJobId: done.jobId,
          language: done.language,
          providerId: params.provider,
          modelId: params.model,
        };
        return {
          summary: { ...summary },
          result: { documentId: null, artifactId: done.outputs[0]!.artifactId, outputs: done.outputs },
        };
      }
      const videoId = targetVideo(params, outputs)!;
      const transcribed = outputs.transcribe as TranscribeOutput;
      const record = deps.videos.state(videoId)?.documents[transcribed.documentId];
      const landing = params.landing;
      const impact = landing?.kind === 'replace' ? switchImpact(record, transcribed.jobId) : null;
      const summary: TranscribeSummary = {
        videoId,
        createdVideo: params.create !== undefined || landing?.kind === 'new-video',
        assetId: transcribed.assetId,
        transcribeJobId: transcribed.jobId,
        documentId: transcribed.documentId,
        language: record?.language ?? null,
        providerId: params.provider,
        modelId: params.model,
        target: landing?.kind ?? 'first',
        newVideo: landing?.kind === 'new-video' ? { videoId, name: landing.name } : null,
        replaced:
          landing?.kind === 'replace'
            ? {
                documentId: landing.replace.documentId,
                previousVersion: landing.replace.revision,
                transactionId: transcribed.transactionId,
              }
            : null,
        translations: impact?.translations ?? [],
        captionPins: landing?.kind === 'replace' ? (impact?.captionPins ?? { reanchored: 0, orphaned: 0 }) : null,
        dubs: impact?.dubs ?? [],
        speakerCount: speakerCountOf(record),
        captions: captionsSummary(
          deps.videos,
          params.captions,
          (outputs.captions as CaptionLayerOutput | undefined) ?? null,
          videoId,
          transcribed.documentId,
        ),
      };
      return { summary: { ...summary }, result: { documentId: transcribed.documentId, artifactId: transcribed.artifactId } };
    },
  };
}

export function parseTranscribeParams(raw: Record<string, unknown>): CheckedTranscribeParams {
  const reader = new ParamReader(raw, [
    'videoId',
    'target',
    'assetId',
    'language',
    'provider',
    'model',
    'hint',
    'diarize',
    'captions',
    'captionStyle',
    'file',
    'outDir',
    'destination',
    'name',
    'translations',
    'acceptEdited',
  ]);
  const videoId = reader.string('videoId', { max: 200, optional: true });
  const assetId = reader.string('assetId', { max: 200, optional: true });
  const language = reader.string('language', { max: 35, optional: true });
  if (language !== undefined && !LANGUAGE.test(language)) throw invalid('language', JobsParams.mustBeLanguageTag());
  const provider = reader.string('provider', { max: 128, optional: true });
  const model = reader.string('model', { max: 256, optional: true });
  const hint = reader.string('hint', { max: HINT_MAX, optional: true })?.trim();
  const captionStyle = readCaptionStyle(raw.captionStyle);
  const captions = raw.captions;
  if (captions !== undefined && typeof captions !== 'boolean') throw invalid('captions', JobsParams.mustBeBoolean());
  if (captionStyle && (captions === false || raw.file !== undefined)) throw invalid('captionStyle', JobsParams.onlyOneOf({ other: raw.file !== undefined ? 'file' : 'captions: false' }));
  const diarize = raw.diarize;
  if (diarize !== undefined && typeof diarize !== 'boolean') throw invalid('diarize', JobsParams.mustBeBoolean());
  const outDir = reader.string('outDir', { max: 4096, optional: true });
  const destination = reader.oneOf('destination', ['new-video', 'replace'] as const);
  const name = reader.string('name', { max: 200, optional: true })?.trim();
  const translations = reader.oneOf('translations', ['carry', 'discard'] as const);
  const acceptEdited = raw.acceptEdited;
  if (acceptEdited !== undefined && typeof acceptEdited !== 'boolean') throw invalid('acceptEdited', JobsParams.mustBeBoolean());
  // 落点的几个参数只配已有的视频（`{ videoId }`、`{ entryId }`）。
  const landingKey = (['destination', 'name', 'translations', 'acceptEdited'] as const).find((key) => raw[key] !== undefined);
  if (landingKey && (raw.file !== undefined || raw.target !== undefined)) throw invalid(landingKey, JobsTranscribe.landingNeedsVideo());
  if (name !== undefined && destination === 'replace') throw invalid('name', JobsTranscribe.nameNewVideoOnly());
  if (translations !== undefined && destination !== 'replace') throw invalid('translations', JobsTranscribe.replaceOnly());
  if (acceptEdited !== undefined && destination !== 'replace') throw invalid('acceptEdited', JobsTranscribe.replaceOnly());
  if (raw.file !== undefined) {
    const file = fileOf(raw.file);
    if (videoId !== undefined || raw.target !== undefined) throw invalid('file', JobsTranscribe.fileExcludesVideo());
    if (assetId !== undefined) throw invalid('assetId', JobsTranscribe.assetIdWithFile());
    if (captions !== undefined) throw invalid('captions', JobsTranscribe.captionsWithFile());
    if (diarize !== undefined) throw invalid('diarize', JobsTranscribe.diarizeWithFile());
    if (outDir !== undefined && !path.isAbsolute(outDir)) throw invalid('outDir', JobsParams.mustBeAbsolutePath());
    return {
      file,
      ...(outDir !== undefined ? { outDir } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(hint ? { hint } : {}),
    };
  }
  if (outDir !== undefined) throw invalid('outDir', JobsTranscribe.outDirFileOnly());
  // `{ videoId }` 与 `{ entryId }` 的目标由 PipelineRunner 换成了顶层的 `videoId`；这里只剩新建。
  const create = raw.target === undefined ? undefined : createOf(raw.target);
  if (create && videoId !== undefined) throw invalid('target', JobsParams.createExcludesVideoId());
  if (create && assetId !== undefined) throw invalid('assetId', JobsTranscribe.assetIdWithCreate());
  if (!create && videoId === undefined) throw new RpcError('invalid-request', JobsTranscribe.needVideoOrFile());
  return {
    ...(videoId !== undefined ? { videoId } : {}),
    ...(create ? { create } : {}),
    ...(assetId !== undefined ? { assetId } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(hint ? { hint } : {}),
    ...(diarize !== undefined ? { diarize } : {}),
    ...(captions !== undefined ? { captions } : {}),
    ...(destination !== undefined ? { destination } : {}),
    ...(name ? { name } : {}),
    ...(translations !== undefined ? { translations } : {}),
    ...(acceptEdited !== undefined ? { acceptEdited } : {}),
    ...(captionStyle !== undefined ? { captionStyle } : {}),
  };
}

function createOf(target: unknown): PipelineCreateTarget & { media: string } {
  if (typeof target !== 'object' || target === null || Array.isArray(target) || Object.keys(target).join() !== 'create') {
    throw invalid('target', JobsParams.targetShape());
  }
  const create = readCreateTarget((target as { create: unknown }).create, true);
  if (create.media === undefined) throw invalid('target.create.media', JobsTranscribe.createMediaRequired());
  return { ...create, media: create.media };
}

/** 只给文件的 `file`：绝对路径。Space 条目（`{ entryId }`）要由方法层先换成路径，到这里还没换是调用方的错。 */
function fileOf(value: unknown): string {
  if (typeof value === 'string') {
    if (!path.isAbsolute(value)) throw invalid('file', JobsParams.mustBeAbsolutePath());
    return value;
  }
  rejectUnresolvedEntry('file', value);
  throw invalid('file', JobsTranscribe.fileShape());
}

/** 只给文件：检查文件、冻结输出目录与 Provider；没有视频。 */
async function prepareFile(deps: TranscribeDeps, params: CheckedTranscribeParams, retry: boolean) {
  const file = params.file!;
  if (!deps.transcriber.submitFile) {
    throw new RpcError('conflict', JobsTranscribe.cannotTranscribeFile(), { code: 'CAPABILITY_NOT_CONFIGURED', capability: 'transcribe' });
  }
  if (!retry) await checkMedia(file);
  // 保存位置（§7.9）：给了用它，否则 Runtime 的保存位置；提交时冻结，不存在时创建，不能写入时拒绝。
  const outDir = params.outDir ?? deps.saveDirectory?.() ?? path.dirname(file);
  await ensureSaveDirectory(outDir);
  const selection = await deps.transcriber.check({
    ...(params.provider !== undefined ? { provider: params.provider } : {}),
    ...(params.model !== undefined ? { model: params.model } : {}),
  });
  const frozen: FrozenTranscribeParams = {
    ...params,
    outDir,
    provider: selection.providerId,
    model: selection.modelId,
    captions: false,
  };
  return {
    params: frozen,
    providerId: selection.providerId,
    modelId: selection.modelId,
    videoId: null,
    contentHash: `sha256:${sha256Hex(canonicalJson({ file }))}`,
  };
}

/** 只给文件的转写：提交没有视频的转写并等它完成，把 TXT 与 SRT 以源文件名写到输出目录。 */
async function transcribeFile(
  deps: TranscribeDeps,
  context: PipelineStepContext<FrozenTranscribeParams>,
): Promise<{ output: FileTranscribeOutput; result: NonNullable<JobRecord['result']> }> {
  const { params } = context;
  const stat = await fs.stat(params.file!).catch(() => null);
  if (!stat?.isFile()) throw new PipelineStepError('INPUT_NOT_FOUND', JobsTranscribe.mediaToTranscribeNotFound(), {});
  await ensureSaveDirectoryForStep(params.outDir!);
  const done = await downloadTranscript(deps.transcriber, context, {
    file: params.file!,
    directory: params.outDir!,
    provider: params.provider,
    model: params.model,
    ...(params.language !== undefined ? { language: params.language } : {}),
    ...(params.hint !== undefined ? { hint: params.hint } : {}),
    naming: 'source',
  });
  return {
    output: done,
    result: { documentId: null, artifactId: done.outputs[0]!.artifactId, outputs: done.outputs },
  };
}

/** 媒体文件在、是普通文件；不在时 `not-found`。 */
async function checkMedia(media: string): Promise<void> {
  const stat = await fs.stat(media).catch(() => null);
  if (!stat?.isFile()) throw new RpcError('not-found', JobsTranscribe.mediaToImportNotFound(), { code: 'INPUT_NOT_FOUND' });
}

/** 转写写进的视频：新建了视频（`target.create` 或落点 `new-video`）时是新视频，否则是给定的视频。 */
function targetVideo(params: FrozenTranscribeParams, outputs: StepOutputs): Id | null {
  return (outputs.create as CreateOutput | undefined)?.videoId ?? params.videoId ?? null;
}

/**
 * 给定视频的落点（见文件头）。素材没给又认不出主轨上唯一的那个时按 `first` 走，转写这一步照旧报素材的错。`replace` 在这里过
 * 手工修改闸门，并冻结文稿的版本与全文指纹。
 */
async function resolveLanding(deps: TranscribeDeps, params: CheckedTranscribeParams, videoId: Id): Promise<TranscribeLanding> {
  const state = deps.videos.state(videoId)!;
  const sequence = deps.videos.rootSequence(videoId);
  let assetId = params.assetId;
  if (assetId === undefined) {
    const found = sequence ? mainTrackAssets(sequence) : [];
    if (found.length !== 1) return { kind: 'first' };
    assetId = found[0]!;
  }
  const transcripts = Object.values(state.documents).filter((doc) => doc.kind === 'speech' && doc.sourceAssetId === assetId);
  if (!transcripts.length) return { kind: 'first' };
  if ((params.destination ?? 'new-video') === 'new-video') {
    const source = deps.sources?.video(videoId);
    if (!deps.targets || !source) {
      throw new RpcError('invalid-request', JobsTranscribe.cannotCreateVideo(), { code: 'PIPELINE_TARGET_UNSUPPORTED' });
    }
    const name = params.name ?? JobsTranscribe.retranscribedName({ name: source.name }).text;
    return { kind: 'new-video', sourceVideoId: videoId, assetId, name, scope: source.scope };
  }
  const record = currentTranscript(transcripts, sequence, state.documents);
  const content = await deps.videos.document(videoId, record.id);
  let fingerprint: string;
  try {
    fingerprint = contentFingerprint(content.body);
  } catch (error) {
    if (error instanceof EditorWasmError) {
      throw new RpcError('conflict', withCause(JobsTranscribe.transcriptUnreadable(), error), {
        code: 'INPUT_UNREADABLE',
        documentId: record.id,
      });
    }
    throw error;
  }
  const asr = asrStage(content.body);
  if (asr !== null && asr !== fingerprint && params.acceptEdited !== true) {
    throw new RpcError('conflict', JobsTranscribe.transcriptEdited(), {
      code: 'TRANSCRIPT_EDITED',
      documentId: record.id,
      fingerprint,
      asr,
    });
  }
  return {
    kind: 'replace',
    assetId,
    replace: { documentId: record.id, revision: content.revision, fingerprint, translations: params.translations ?? 'carry' },
  };
}

/** 素材的几份转写里要换用的那份：根序列上有字幕层的，都没有（或都有）时取最近写过的。 */
function currentTranscript(
  transcripts: DocumentRecord[],
  sequence: Sequence | null,
  documents: Record<Id, DocumentRecord>,
): DocumentRecord {
  const written = (doc: DocumentRecord) => doc.revisions[doc.currentRevision]?.createdAt ?? '';
  const ranked = [...transcripts].sort((a, b) => {
    const shown = (doc: DocumentRecord) => (sequence && existingCaptionLayer(sequence, documents, doc.id) ? 1 : 0);
    return shown(b) - shown(a) || (written(a) < written(b) ? 1 : written(a) > written(b) ? -1 : 0);
  });
  return ranked[0]!;
}

/** 换用文稿那笔事务记在文稿扩展里的影响（与新版本同一笔事务落下）；不是这次转写记的时 null。 */
function switchImpact(record: DocumentRecord | undefined, jobId: Id): TranscriptSwitchImpact | null {
  const value = record?.extensions?.[TRANSCRIPT_SWITCH_EXTENSION] as { jobId?: unknown; impact?: TranscriptSwitchImpact } | undefined;
  return value && value.jobId === jobId && value.impact ? value.impact : null;
}

/** 落点 `new-video`：在原视频的范围里新建视频，以链接素材导入同一份素材文件并放上主轨。 */
async function createLinkedVideo(
  deps: TranscribeDeps,
  context: PipelineStepContext<FrozenTranscribeParams>,
): Promise<{ output: CreateOutput }> {
  const landing = context.params.landing;
  if (landing?.kind !== 'new-video' || !deps.targets || !deps.sources) {
    throw new PipelineStepError('PIPELINE_TARGET_UNSUPPORTED', JobsTranscribe.cannotCreateVideo(), {});
  }
  const file = await deps.sources.assetFile(landing.sourceVideoId, landing.assetId);
  const stat = file ? await fs.stat(file).catch(() => null) : null;
  if (!file || !stat?.isFile()) throw new PipelineStepError('INPUT_NOT_FOUND', JobsTranscribe.mediaToImportNotFound(), {});
  context.progress(null, 'applying');
  const lease = await createHeldVideo(deps.targets, context, { ...landing.scope, name: landing.name });
  const { assetId } = await importMedia(deps.videos, context, {
    videoId: lease.videoId,
    file,
    name: path.basename(file),
    place: true,
    label: JobsTranscribe.importMediaLabel().text,
    provenance: { origin: 'file-import', source: { path: file, jobId: context.parentJobId } },
  });
  return { output: { videoId: lease.videoId, place: lease.place, assetId } };
}

/** 新建视频并导入媒体（同一笔事务放上主轨）。 */
async function createVideo(deps: TranscribeDeps, context: PipelineStepContext<FrozenTranscribeParams>): Promise<{ output: CreateOutput }> {
  const create = context.params.create!;
  if (!deps.targets) throw new PipelineStepError('PIPELINE_TARGET_UNSUPPORTED', JobsTranscribe.cannotCreateVideo(), {});
  const stat = await fs.stat(create.media).catch(() => null);
  if (!stat?.isFile()) throw new PipelineStepError('INPUT_NOT_FOUND', JobsTranscribe.mediaToImportNotFound(), {});
  context.progress(null, 'applying');
  const base = path.basename(create.media, path.extname(create.media)).trim() || path.basename(create.media);
  const lease = await createHeldVideo(deps.targets, context, { ...createScopeOf(create), name: create.name ?? base });
  const { assetId } = await importMedia(deps.videos, context, {
    videoId: lease.videoId,
    file: create.media,
    name: path.basename(create.media),
    place: true,
    label: JobsTranscribe.importMediaLabel().text,
    provenance: { origin: 'file-import', source: { path: create.media, jobId: context.parentJobId } },
  });
  return { output: { videoId: lease.videoId, place: lease.place, assetId } };
}

async function transcribe(
  deps: TranscribeDeps,
  context: PipelineStepContext<FrozenTranscribeParams>,
): Promise<{ output: TranscribeOutput; result: { documentId: Id; artifactId: string } }> {
  const { params, outputs } = context;
  const videoId = targetVideo(params, outputs);
  if (!videoId) throw new PipelineStepError('INTERNAL', JobsTranscribe.noVideo(), {});
  const created = outputs.create as CreateOutput | undefined;
  // 新建的视频里转写导入的那个素材；落点 `new-video` 时给定的 `assetId` 是原视频里的。
  const assetId = created?.assetId ?? params.assetId ?? mainAsset(deps.videos, videoId);
  const landing = params.landing;
  // 视频里启用的转写术语表（§5.9）：与 `models.transcribe` 一样在提交转写时读出（新建的视频此刻已采用库里默认启用的），
  // 版本由转写 Job 冻结。
  const glossaries = params.videoGlossaries && deps.enabledGlossaries ? await deps.enabledGlossaries(videoId) : [];
  const { jobId, documentId, artifactId, transactionId } = await transcribeInVideo(
    deps.transcriber,
    context,
    {
      videoId,
      assetId,
      provider: params.provider,
      model: params.model,
      ...(params.language !== undefined ? { language: { mode: 'assert' as const, tag: params.language } } : {}),
      ...(params.hint !== undefined ? { hint: params.hint } : {}),
      ...(params.diarize !== undefined ? { diarize: params.diarize } : {}),
      ...(glossaries.length ? { glossaries: glossaries.map((id) => ({ id })) } : {}),
      ...(landing?.kind === 'replace' ? { replace: landing.replace } : {}),
    },
    // 上次完成的转写写入的文档被删了：重新转写。
    (job) => !!job.result?.documentId && deps.videos.state(videoId)?.documents[job.result.documentId]?.kind === 'speech',
  );
  if (!documentId || !artifactId) throw new PipelineStepError('APPLY_FAILED', JobsTranscribe.notApplied(), { jobId });
  return {
    output: { jobId, videoId, documentId, artifactId, assetId, transactionId },
    result: { documentId, artifactId },
  };
}

/** 这次写入的文稿区分出几位说话人（文档版本概要里的 `speakerCount`）；读不出时 null。 */
function speakerCountOf(record: DocumentRecord | undefined): number | null {
  const summary = record?.revisions[record.currentRevision]?.summary;
  const count = summary && typeof summary === 'object' ? (summary as { speakerCount?: unknown }).speakerCount : undefined;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null;
}

/** 主轨上唯一的素材（见文件头）；视频没打开时 `VIDEO_NOT_OPEN`。 */
function mainAsset(videos: CaptionVideos, videoId: Id): Id {
  const sequence = videos.rootSequence(videoId);
  if (!sequence) throw new PipelineStepError('VIDEO_NOT_OPEN', JobsTranscribe.videoClosed(), {});
  const found = mainTrackAssets(sequence);
  if (found.length === 1) return found[0]!;
  if (found.length === 0) {
    throw new PipelineStepError('TRANSCRIBE_ASSET_NOT_FOUND', JobsTranscribe.noMainAsset(), {});
  }
  throw new PipelineStepError('TRANSCRIBE_ASSET_AMBIGUOUS', JobsTranscribe.ambiguousMainAsset(), {
    assetIds: found,
  });
}

/**
 * 主轨：第一条（`order` 最小）有音视频实例的画面轨，没有时第一条有音视频实例的音频轨；返回它上面的素材（去重，按在时间线上
 * 出现的先后）。
 */
export function mainTrackAssets(sequence: Sequence): Id[] {
  const media = (trackId: Id) =>
    sequence.items.filter(
      (item): item is Extract<SequenceItem, { type: 'video' | 'audio' }> =>
        item.trackId === trackId && (item.type === 'video' || item.type === 'audio'),
    );
  const tracks = [...sequence.tracks].sort((a, b) => a.order - b.order);
  const main =
    tracks.find((track) => track.kind === 'visual' && media(track.id).length > 0) ??
    tracks.find((track) => track.kind === 'audio' && media(track.id).length > 0);
  if (!main) return [];
  const start = (item: Extract<SequenceItem, { type: 'video' | 'audio' }>) =>
    item.type === 'audio' ? item.fromFrame : item.span.fromFrame;
  const items = media(main.id).sort((a, b) => start(a) - start(b));
  return [...new Set(items.map((item) => item.assetRef.id))];
}
