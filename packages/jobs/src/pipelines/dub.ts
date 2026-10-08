import { randomInt } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  type DubOriginalAudio,
  type DubParams,
  type DubSummary,
  type DubPlanTake,
  type DubRegroup,
  type DubRegroupSummary,
  type DubVoiceSource,
  type EditOperation,
  type AudioItem,
  type FrozenDubRegroup,
  type FrozenLibraryEntry,
  type Id,
  type SequenceItem,
  type SequenceItemInput,
  type TranslateParams,
} from '@baocut/protocol';
import { JobsDub as J } from '@baocut/protocol/messages/jobs/dub.ts';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { parseLibraryVoice } from '@baocut/runtime-storage/library';
import type { ArtifactExtension, ArtifactStore } from '../artifact-store.ts';
import { canonicalJson, sha256Hex } from '../input-hash.ts';
import { errorText, jobWarning, joinList, type LazyText } from '../job-text.ts';
import { videoSelection } from '../library-selection.ts';
import { MAX_DUB_TEMPO, alignDub, atempoFilter, type DubFit } from './dub-alignment.ts';
import { probeMedia, runFfmpeg, type MediaToolResolver } from './ffmpeg.ts';
import { localSeparateResources } from '../resource-profiles.ts';
import { ParamReader, invalid } from './params.ts';
import {
  CallCounter,
  PipelineStepError,
  type PipelineDefinition,
  type PipelinePrepareOptions,
  type PipelineStep,
  type PipelineStepContext,
  type StepOutput,
  type StepResult,
} from './pipeline.ts';
import { targetSchema, targetStep } from './video-target.ts';
import { PIPELINE_ACTOR_ID } from './pipeline-runner.ts';
import {
  GLOSSARIES_SCHEMA,
  glossarySummary,
  parseTranslateParams,
  pickSource,
  readArtifact,
  translatePipeline,
  type FrozenTranslateParams,
  type PipelineVideos,
  type TranslateDeps,
} from './translate.ts';
import { TRANSLATION_SCHEMA, type FrozenSource } from './translation-document.ts';
import { glossaryChanged, readGlossaryRef } from './translation-glossary.ts';

/**
 * 翻译配音（架构设计 §7.9；视频格式规范 §7.2、§7.3）：视频里一份 `speech` 文档 → 一组配音（一条配音轨、逐句的配音实例与
 * 一份 `dubbing-plan` 文档），在一笔编辑事务里应用。由流程自己调用模型，不启动智能体。
 *
 * 步骤：读取原文 →（缺译文时）翻译、组装、写入译文 → 核对译文 →（可选）分离人声与背景 → 逐句合成 → 时间对齐 → 应用。
 *
 * - 翻译的四步就是 `translate` 流程的步骤（同一份实现，参数按配音的冻结参数换算），不另写一份；
 * - 核对译文：逐句比较译文单元的 `sourceFingerprint` 与原文当前句子的指纹（§10）；原文改过、句子没了或单元标成 `stale` 的
 *   是过期的；译文记下的术语表（`glossaryRef`）在库里改过、改动涉及这句的术语时也过期（`glossary-changed`）。过期的不合成，
 *   在结果里报告句数与单元；
 * - 音色按说话人选：视频里给这位说话人绑定的（`library-selection` 的 `speakerVoices`）优先，其次参数 `voice`，最后模型的默认
 *   音色。绑定的音色在合成这一步换算、检查（库里音色的授权声明与克隆有效性）；不可用时这位说话人的句子不合成、逐句报告，
 *   配音计划里这些单元是 `failed`，不换成别的音色；
 * - 逐句合成：每句一个子任务、一个产物；每次调用都经授权与预算（由 Runtime 实现的 `DubSpeech` 负责）。授权或额度不够、
 *   凭据被拒时停下（已经合成的句子留在 staging 的清单里）；其余失败的句子记下，全部跑完之后这一步失败，重试只合成
 *   失败与没合成的句子，成功的句子复用；
 * - 时间对齐：`alignDub`（纯函数）；需要加速时用 ffmpeg `atempo` 生成新文件，放不下的句子不放，报告超出多少；
 * - 应用：导入音频、新建配音轨、放实例、写配音计划，原声按参数静音、压低或不动，都在同一笔事务里。实例带
 *   `role: 'dub'` 与 `extensions['baocut.dub']`（这一组的 `groupId`、语言与译文单元）；导出按它选「只要某一组配音」。
 *
 * 每次执行都新增一组配音，不替换已有的配音轨（给定的配音不被自动改成语音合成）。
 */

export const DUB_PIPELINE = 'dub';
export const DUBBING_PLAN_SCHEMA = 'baocut.dubbing-plan/1';
/** 配音实例的扩展命名空间。 */
export const DUB_EXTENSION = 'baocut.dub';
const DEFAULT_DUCK_DB = 18;
const APPLY_ATTEMPTS = 3;
const MANIFEST_FILE = 'dub-synthesis.json';

/** 合成用的音色：启动时选定并检查（不联网），之后每次调用照用。 */
export interface DubVoice {
  providerId: string;
  modelId: string;
  /** 用户给的音色（`library:<id>` 原样记下，每次调用时再换成那个 Provider 上的克隆）。 */
  voice: string;
  /** 输出格式（`wav` 优先）。 */
  format: 'wav' | 'mp3' | 'flac';
  /** 单次合成的字符上限。 */
  maxInputChars: number;
  /** 模型接受种子（`seed`）；句级重配据此决定记不记种子。旧的冻结参数没有，当作不接受。 */
  acceptsSeed?: boolean;
}

/** 语音合成：由 Runtime 实现（选择 Provider、换算库里的音色、授权与预算、调用）。 */
export interface DubSpeech {
  /** 启动（与重试）时：选定 Provider 与模型，检查音色、语言与格式；`library:<id>` 没有有效克隆时抛 `VOICE_CLONE_REQUIRED`。 */
  prepare(target: { provider?: string; model?: string; voice?: string; language: string }): Promise<DubVoice>;
  /**
   * 合成一句，输出写在 `staging` 里。每次调用经授权与预算（预留、结算）；失败抛 `PipelineStepError`（错误码同任务的错误码：
   * `GRANT_REQUIRED`、`BUDGET_EXCEEDED`、`PROVIDER_*`……）。
   */
  synthesize(request: {
    voice: DubVoice;
    text: string;
    language: string;
    videoId: Id;
    jobId: Id;
    staging: string;
    signal: AbortSignal;
    /** 合成的种子（句级重配，模型接受时才给）。 */
    seed?: number;
  }): Promise<{ file: string }>;
}

/** 人声与背景分离（`separateAudio`，架构设计 §6.1）的执行者。没有配置时流程的分离这一步跳过。 */
export interface DubSeparator {
  readonly providerId: string;
  /** 用的模型（本机是分离模型包的 ID）。 */
  readonly modelId: string;
  /** Model Worker 要加载的权重（字节，`ModelCatalog.workerWeightBytes`），估计它的内存需求用；不知道时 null。 */
  readonly workerWeightBytes: number | null;
  /** 把 `file` 分成人声与背景两个文件，写在 `staging` 里。 */
  separate(request: {
    file: string;
    staging: string;
    videoId: Id;
    jobId: Id;
    signal: AbortSignal;
  }): Promise<{ vocals: string; background: string }>;
}

/** 配音读写视频的能力：在翻译的基础上，多了序列的实例与文稿在序列上的位置。 */
export interface DubVideos extends PipelineVideos {
  /** 序列此刻的帧率与实例；没有时 null。 */
  sequence(videoId: Id, sequenceId: Id): { fps: { num: number; den: number }; items: SequenceItem[] } | null;
  /** 文稿在序列上的投影（引擎的文字计划）：每个词在序列上的起止秒与所在的实例；`end` 是序列的终点。 */
  speechOnTimeline(
    videoId: Id,
    sequenceId: Id,
    documentId: Id,
  ): Promise<{ videoRevision: string; end: number; words: Array<{ wordId: Id; itemId: Id | null; start: number; end: number }> }>;
  /** 素材某个版本的源文件（分离用）。 */
  assetFile(videoId: Id, assetId: Id): Promise<{ file: string; revision: string } | null>;
}

export interface DubDeps {
  videos: DubVideos;
  /** 缺译文时翻译用的文本生成（与 `translate` 流程同一份）。 */
  translation: Omit<TranslateDeps, 'videos'>;
  speech: DubSpeech;
  /**
   * 分离的执行者：不给 `model` 时按此刻的默认（用户默认值或出厂默认，§6.2）选，给了时用冻结的那只；没有配置或已不可用
   * 时 null。
   */
  separator?: (model?: { providerId: string; modelId: string }) => Promise<DubSeparator | null>;
  ffmpeg: MediaToolResolver;
  ffprobe: MediaToolResolver;
  /** 同时在途的合成调用（默认 2）。 */
  concurrency?: number;
}

/** 视频里给一位说话人绑定的音色（启动时读出）。 */
export interface DubSpeakerVoice {
  speakerId: string;
  /** 绑定的音色：`library:<id>` 或 Provider 的音色 ID。 */
  voice: string;
  /** 启动时已经确定不能用（对外服务的客户端不能用库里的音色）。 */
  unavailable?: { code: string; reason: string };
}

/** 冻结的参数。 */
export interface FrozenDubParams {
  videoId: Id;
  documentId: Id;
  language: string;
  /** 用户给的译文；null 时流程先翻译。 */
  translationId: Id | null;
  /** 读取原文与翻译四步用的参数（给了译文时只用到视频与源文档）。 */
  translate: FrozenTranslateParams;
  voice: DubVoice;
  /** `voice` 的来源：参数给的（`params`）或模型的默认音色（`default`）。旧的冻结参数没有，按 `params`。 */
  voiceSource?: 'params' | 'default';
  /** 视频里给这份转写的说话人绑定的音色；指定了别的 Provider 的绑定不在里面（不用）。 */
  speakerVoices?: DubSpeakerVoice[];
  originalAudio: DubOriginalAudio;
  duckDb: number;
  separateBackground: boolean;
  /** 分离的执行者；没有要求或没有配置时 null。 */
  separatorId: string | null;
  /** 分离用的模型（启动时选定，重试照用）；`separatorId` 为 null 时 null。旧的冻结参数没有，执行时按此刻的默认选。 */
  separatorModel?: string | null;
  /** 分离的 Model Worker 要加载的权重（字节），这一步的资源估计用；不知道时 null。 */
  separatorWeightBytes?: number | null;
  /** 句级重配：只合成这一组里的这几句，写回这一组（见 `DubRegroup`）。 */
  regroup?: FrozenDubRegroup;
}

/** 句级重配一次最多几句。 */
const MAX_REGROUP_UNITS = 200;
/** 种子的上限（ElevenLabs 等接受 32 位无符号整数）。 */
const MAX_SEED = 4_294_967_295;

const PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
    videoId: { type: 'string', description: '已打开的视频（等同 target: { videoId }）' },
    target: targetSchema('要配音的视频：已打开的，或 Space 里的视频条目（流程期间由 Runtime 打开）；与 videoId 给一个', null),
    documentId: { type: 'string', description: '源 speech 文档；视频里只有一份或给了 translationId 时可以不给' },
    targetLanguage: { type: 'string', description: '目标语言（BCP 47）；给了 translationId 时可以不给' },
    translationId: { type: 'string', description: '已有的译文文档；不给时先翻译' },
    voice: { type: 'string', description: '音色：模型的音色 ID，或用户库里的 library:<id>' },
    provider: { type: 'string', description: '语音合成的 Provider；不给时用默认值' },
    model: { type: 'string' },
    textProvider: { type: 'string', description: '缺译文时翻译用的文本模型 Provider' },
    textModel: { type: 'string' },
    style: { type: 'string', maxLength: 500 },
    glossary: {
      type: 'array',
      maxItems: 500,
      items: {
        type: 'object',
        properties: { source: { type: 'string' }, target: { type: 'string' }, note: { type: 'string' } },
        required: ['source', 'target'],
        additionalProperties: false,
      },
    },
    glossaries: GLOSSARIES_SCHEMA,
    batchSize: { type: 'integer', minimum: 1, maximum: 100 },
    originalAudio: { type: 'string', enum: ['duck', 'mute', 'keep'], default: 'duck' },
    duckDb: { type: 'integer', minimum: 1, maximum: 60, default: DEFAULT_DUCK_DB },
    separateBackground: { type: 'boolean', default: false },
    regroup: {
      type: 'object',
      description: '句级重配：只重新合成已有一组配音里的这几句，写回那一组；译文、语言与音色取自那一组的配音计划',
      properties: {
        groupId: { type: 'string' },
        units: { type: 'array', minItems: 1, maxItems: MAX_REGROUP_UNITS, items: { type: 'string' } },
        seed: { oneOf: [{ type: 'string', enum: ['new'] }, { type: 'integer', minimum: 0, maximum: MAX_SEED }] },
      },
      required: ['groupId', 'units'],
      additionalProperties: false,
    },
    // i18n-ignore-end
  },
  additionalProperties: false,
};

const KEYS = [
  'videoId',
  'documentId',
  'targetLanguage',
  'translationId',
  'voice',
  'provider',
  'model',
  'textProvider',
  'textModel',
  'style',
  'glossary',
  'glossaries',
  'batchSize',
  'originalAudio',
  'duckDb',
  'separateBackground',
  'regroup',
];

/** 句级重配时不能同时给的参数：都取自那一组的配音计划。 */
const REGROUP_EXCLUSIVE = [
  'documentId',
  'targetLanguage',
  'translationId',
  'voice',
  'provider',
  'model',
  'textProvider',
  'textModel',
  'style',
  'glossary',
  'glossaries',
  'batchSize',
  'originalAudio',
  'duckDb',
  'separateBackground',
];

export function parseDubParams(raw: Record<string, unknown>): DubParams {
  const reader = new ParamReader(raw, KEYS);
  if (raw.regroup !== undefined) {
    const conflicting = REGROUP_EXCLUSIVE.filter((key) => raw[key] !== undefined);
    if (conflicting.length > 0) {
      throw new RpcError(
        'invalid-request',
        J.regroupConflict({ params: joinList(conflicting) }),
        { conflicting },
      );
    }
    return { videoId: reader.string('videoId', { max: 128 }), regroup: parseRegroup(raw.regroup) };
  }
  const optional = (key: string, max: number) => reader.string(key, { optional: true, max });
  const translationId = optional('translationId', 128);
  const targetLanguage = optional('targetLanguage', 35);
  if (targetLanguage === undefined && translationId === undefined) throw invalid('targetLanguage', J.orTranslationId());
  // 翻译相关的参数按 `translate` 的规则校验（同一份实现）。
  const translateRaw: Record<string, unknown> = { videoId: raw.videoId, targetLanguage: targetLanguage ?? 'und' };
  for (const [from, to] of [
    ['documentId', 'documentId'],
    ['style', 'style'],
    ['glossary', 'glossary'],
    ['glossaries', 'glossaries'],
    ['textProvider', 'provider'],
    ['textModel', 'model'],
    ['batchSize', 'batchSize'],
  ] as const) {
    if (raw[from] !== undefined) translateRaw[to] = raw[from];
  }
  const t = parseTranslateParams(translateRaw);
  if (
    translationId !== undefined &&
    (t.style !== undefined || t.glossary !== undefined || t.glossaries !== undefined || t.provider !== undefined || t.model !== undefined)
  ) {
    throw new RpcError('invalid-request', J.translationIdNoTranslate());
  }
  const voice = optional('voice', 256);
  const provider = optional('provider', 128);
  const model = optional('model', 256);
  const originalAudio = reader.oneOf('originalAudio', ['duck', 'mute', 'keep'] as const);
  const duckDb = reader.int('duckDb', 1, 60);
  const separate = raw.separateBackground;
  if (separate !== undefined && typeof separate !== 'boolean') throw invalid('separateBackground', J.mustBeBooleanValue());
  return {
    videoId: t.videoId,
    ...(t.documentId !== undefined ? { documentId: t.documentId } : {}),
    ...(targetLanguage !== undefined ? { targetLanguage } : {}),
    ...(translationId !== undefined ? { translationId } : {}),
    ...(voice !== undefined ? { voice } : {}),
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(t.provider !== undefined ? { textProvider: t.provider } : {}),
    ...(t.model !== undefined ? { textModel: t.model } : {}),
    ...(t.style !== undefined ? { style: t.style } : {}),
    ...(t.glossary !== undefined ? { glossary: t.glossary } : {}),
    ...(t.glossaries !== undefined ? { glossaries: t.glossaries } : {}),
    ...(t.batchSize !== undefined ? { batchSize: t.batchSize } : {}),
    ...(originalAudio !== undefined ? { originalAudio } : {}),
    ...(duckDb !== undefined ? { duckDb } : {}),
    ...(separate !== undefined ? { separateBackground: separate } : {}),
  };
}

function parseRegroup(value: unknown): DubRegroup {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('regroup', J.mustBeObject());
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!['groupId', 'units', 'seed'].includes(key)) throw new RpcError('invalid-request', JobsParams.unknownParam({ key: `regroup.${key}` }));
  }
  const { groupId, units, seed } = raw;
  if (typeof groupId !== 'string' || groupId.trim() === '' || groupId.length > 128) throw invalid('regroup.groupId', JobsParams.mustBeNonEmptyString());
  if (!Array.isArray(units) || units.length === 0 || units.length > MAX_REGROUP_UNITS) {
    throw invalid('regroup.units', J.unitsCount({ max: MAX_REGROUP_UNITS }));
  }
  if (units.some((u) => typeof u !== 'string' || u.trim() === '' || u.length > 128)) throw invalid('regroup.units', JobsParams.mustBeNonEmptyString());
  if (new Set(units).size !== units.length) throw invalid('regroup.units', J.mustBeUnique());
  if (seed !== undefined && seed !== 'new' && !(typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= MAX_SEED)) {
    throw invalid('regroup.seed', J.seedInvalid({ max: MAX_SEED }));
  }
  return { groupId, units: units as Id[], ...(seed !== undefined ? { seed: seed as 'new' | number } : {}) };
}

// ---- 各步的产出 ----

interface CheckOutput extends StepOutput {
  artifactId: string;
  translationId: Id;
  revision: string;
  created: boolean;
  total: number;
  usable: number;
  stale: number;
}

/** 核对过的配音脚本（产物）。 */
interface DubScript {
  translation: { id: Id; revision: string };
  language: string;
  /** `speakerId`：原句的说话人（转写没有说话人时没有）。 */
  units: Array<{ unitId: Id; sentenceId: Id; fingerprint: string; text: string; speakerId?: string }>;
  stale: Array<{
    unitId: Id;
    sentenceId: Id;
    reason: 'marked-stale' | 'source-changed' | 'sentence-gone' | 'empty' | 'glossary-changed';
  }>;
}

interface SeparateOutput extends StepOutput {
  assetId: Id;
  assetRevision: string;
  vocalsArtifactId: string;
  backgroundArtifactId: string;
}

interface SynthEntry {
  /** 文本、音色与语言的摘要：变了就重新合成。 */
  key: string;
  artifactId: string;
  durationSec: number;
  sampleRate: number;
}

interface SynthOutput extends StepOutput {
  artifactId: string;
  synthesized: number;
  reused: number;
  calls: { calls: number; retries: number; failures: number };
  /** 音色不可用、没有合成的句数。 */
  voiceUnavailable?: number;
}

/** 合成这一步的产物（`SynthOutput.artifactId`）。旧的产物只有 `units`。 */
interface SynthResult {
  /** 合成了的句子（音色不可用的不在里面）。 */
  units: Record<Id, SynthEntry>;
  /** 每句的音色（用户给的写法）与来源。 */
  voices?: Record<Id, { voice: string; voiceSource: DubVoiceSource }>;
  unavailable?: DubSummary['voiceUnavailableUnits'];
  speakers?: DubSummary['speakers'];
}

interface Placement {
  unitId: Id;
  sentenceId: Id;
  /** 原句所在的实例（同一句在时间线上出现几次就放几次）。 */
  itemId: Id | null;
  startUs: number;
  fit: Exclude<DubFit, 'overlong'>;
  tempo: number;
  artifactId: string;
  samples: number;
  sampleRate: number;
}

interface AlignResult {
  videoRevision: string;
  sequenceId: Id;
  placements: Placement[];
  overlong: Array<{ unitId: Id; overflowSeconds: number }>;
  offTimeline: Id[];
  /** 原句所在的实例：原声的静音或闪避作用在它们上面。 */
  dialogueItemIds: Id[];
}

interface AlignOutput extends StepOutput {
  artifactId: string;
  videoRevision: string;
  placed: number;
  overlong: number;
}

interface ApplyOutput extends StepOutput {
  trackId: Id;
  planDocumentId: Id;
  groupId: string;
  items: number;
  /** 句级重配：每句新记下的是第几版。 */
  takes?: Record<Id, number>;
}

/** 合成失败时这句怎么办：停下整步，再试一次，或记下这句失败。 */
const TERMINAL = new Set([
  'GRANT_REQUIRED',
  'GRANT_REVOKED',
  'BUDGET_EXCEEDED',
  'BUDGET_UNVERIFIABLE',
  'TASK_BUDGET_EXCEEDED',
  'TASK_BUDGET_UNVERIFIABLE',
  'PROVIDER_AUTH_FAILED',
  'PROVIDER_QUOTA_EXCEEDED',
  'CAPABILITY_NOT_CONFIGURED',
  'VOICE_CLONE_REQUIRED',
  'VOICE_CONSENT_REQUIRED',
  'VOICE_NOT_FOUND',
  'MODEL_LOAD_FAILED',
  'MEDIA_TOOL_UNAVAILABLE',
]);
const TRANSIENT = new Set(['PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', 'PROVIDER_RATE_LIMITED', 'MODEL_OUTPUT_INVALID']);
/** 说话人绑定的音色在合成途中变得不可用：这位说话人余下的句子不合成、逐句报告（参数与默认的音色照旧停下整步）。 */
const VOICE_LOST = new Set(['VOICE_CLONE_REQUIRED', 'VOICE_CONSENT_REQUIRED', 'VOICE_NOT_FOUND']);

export function dubPipeline(deps: DubDeps): PipelineDefinition<FrozenDubParams, DubParams> {
  // 只复用翻译的前几步（不建字幕层）：根序列不交给它。
  const videos = deps.videos;
  const translate = translatePipeline({
    ...deps.translation,
    videos: {
      state: (videoId) => videos.state(videoId),
      document: (videoId, documentId, revision) => videos.document(videoId, documentId, revision),
      apply: (videoId, request) => videos.apply(videoId, request),
      asset: (videoId, assetId) => videos.asset?.(videoId, assetId) ?? null,
      rootSequence: () => null,
    },
  });
  const concurrency = Math.max(1, deps.concurrency ?? 2);
  const step = (name: string) => translate.steps.find((s) => s.name === name)!;
  // 翻译流程的步骤原样复用：换上它自己的参数。
  const reuse = (name: string, label: LazyText, onlyWhenTranslating: boolean): PipelineStep<FrozenDubParams> => {
    const inner = step(name);
    return {
      name,
      label,
      ...(onlyWhenTranslating ? { when: (params: FrozenDubParams) => params.translationId === null } : {}),
      run: (context) => inner.run({ ...context, params: context.params.translate }),
      ...(inner.reusable
        ? {
            reusable: (output: StepOutput, c: { params: FrozenDubParams; staging: string; artifacts: ArtifactStore }) =>
              inner.reusable!(output, { ...c, params: c.params.translate }),
          }
        : {}),
    };
  };

  return {
    name: DUB_PIPELINE,
    label: () => J.label(),
    description: () => J.description(),
    paramsSchema: PARAMS_SCHEMA,
    target: { create: false },
    parse: parseDubParams,
    async prepare(raw, options) {
      const params = raw as DubParams | FrozenDubParams;
      const { frozen, library } =
        'translate' in params
          ? { frozen: await refreeze(deps, translate, params, options), library: undefined }
          : await freeze(deps, translate, params, options);
      const state = deps.videos.state(frozen.videoId)!;
      const translationRevision = frozen.translationId ? (state.documents[frozen.translationId]?.currentRevision ?? null) : null;
      return {
        params: frozen,
        providerId: frozen.voice.providerId,
        modelId: frozen.voice.modelId,
        videoId: frozen.videoId,
        contentHash: `sha256:${sha256Hex(
          canonicalJson({
            videoId: frozen.videoId,
            documentId: frozen.documentId,
            revision: state.documents[frozen.documentId]?.currentRevision ?? null,
            translationId: frozen.translationId,
            translationRevision,
            ...(frozen.regroup ? { regroup: { groupId: frozen.regroup.groupId, units: frozen.regroup.units, seed: frozen.regroup.seed } } : {}),
          }),
        )}`,
        ...(library?.length ? { library } : {}),
      };
    },
    steps: [
      targetStep(),
      reuse('freeze-source', () => J.stepFreezeSource(), false),
      reuse('translate', () => J.stepTranslate(), true),
      reuse('assemble', () => J.stepAssemble(), true),
      reuse('write', () => J.stepWrite(), true),
      {
        name: 'check-translation',
        label: () => J.stepCheck(),
        run: (context) => checkTranslation(deps, context),
        reusable: async (output, { params, artifacts }) => {
          const o = output as CheckOutput;
          return (
            deps.videos.state(params.videoId)?.documents[o.translationId]?.currentRevision === o.revision &&
            (await artifacts.locate(o.artifactId)) !== null
          );
        },
      },
      {
        name: 'separate',
        label: () => J.stepSeparate(),
        when: (params) => params.separatorId !== null,
        // 本机分离：Worker 进程按模型包估计（同一个模型包的任务共用），这一步自己的是解出的音频与两路输出。
        resources: (params) => localSeparateResources(params.separatorModel ?? null, params.separatorWeightBytes ?? null),
        run: (context) => separate(deps, context),
        reusable: async (output, { params, artifacts }) => {
          const o = output as SeparateOutput;
          const files = await Promise.all([artifacts.locate(o.vocalsArtifactId), artifacts.locate(o.backgroundArtifactId)]);
          const current = deps.videos.state(params.videoId) ? await deps.videos.assetFile(params.videoId, o.assetId) : null;
          return files.every((f) => f !== null) && current?.revision === o.assetRevision;
        },
      },
      {
        name: 'synthesize',
        label: () => J.stepSynthesize(),
        run: (context) => synthesize(deps, context, concurrency),
        reusable: async (output, { artifacts }) => (await artifacts.locate((output as SynthOutput).artifactId)) !== null,
      },
      {
        name: 'align',
        label: () => J.stepAlign(),
        run: (context) => align(deps, context),
        // 对齐之后视频改过（时间线可能变了）：重新对齐。
        reusable: async (output, { params, artifacts }) =>
          deps.videos.state(params.videoId)?.revision === (output as AlignOutput).videoRevision &&
          (await artifacts.locate((output as AlignOutput).artifactId)) !== null,
      },
      {
        name: 'apply',
        label: () => J.stepApply(),
        run: (context) => applyDub(deps.videos, context),
      },
    ],
    async complete({ params, outputs, artifacts }) {
      const check = outputs['check-translation'] as CheckOutput;
      const synth = outputs.synthesize as SynthOutput;
      const aligned = outputs.align as AlignOutput;
      const applied = outputs.apply as ApplyOutput;
      const script = await readArtifact<DubScript>(artifacts, check.artifactId);
      const result = await readArtifact<AlignResult>(artifacts, aligned.artifactId);
      const synthesized = await readArtifact<SynthResult>(artifacts, synth.artifactId);
      const unavailable = synthesized.unavailable ?? [];
      const glossary =
        params.translationId === null
          ? glossarySummary(params.translate, outputs.translate as { glossaryTerms?: number; cappedBatches?: number } | null)
          : undefined;
      const unitsPlaced = new Set(result.placements.map((p) => p.unitId));
      const count = (fit: DubFit) => new Set(result.placements.filter((p) => p.fit === fit).map((p) => p.unitId)).size;
      const summary: DubSummary = {
        videoId: params.videoId,
        language: params.language,
        translation: { documentId: check.translationId, revision: check.revision, created: check.created },
        planDocumentId: applied.planDocumentId,
        trackId: applied.trackId,
        groupId: applied.groupId,
        units: {
          total: check.total,
          placed: unitsPlaced.size,
          stale: check.stale,
          offTimeline: result.offTimeline.length,
          tempo: count('tempo'),
          extended: count('extended'),
          overlong: result.overlong.length,
          voiceUnavailable: unavailable.length,
        },
        staleUnits: script.stale.map((s) => s.unitId),
        voiceUnavailableUnits: unavailable,
        speakers: synthesized.speakers ?? [],
        overlongUnits: result.overlong,
        synthesis: {
          providerId: params.voice.providerId,
          modelId: params.voice.modelId,
          voice: params.voice.voice,
          calls: synth.calls.calls,
          retries: synth.calls.retries,
          failures: synth.calls.failures,
          reused: synth.reused,
        },
        originalAudio: params.originalAudio,
        separation: outputs.separate ? 'completed' : params.separateBackground ? 'not-configured' : 'not-requested',
        ...(glossary ? { glossary } : {}),
        ...(params.regroup ? { regroup: regroupSummary(params.regroup, script, result, unavailable, applied.takes ?? {}) } : {}),
      };
      return { summary: { ...summary }, result: { documentId: applied.planDocumentId, artifactId: aligned.artifactId } };
    },
  };
}

/** 句级重配每句的结果。 */
function regroupSummary(
  regroup: FrozenDubRegroup,
  script: DubScript,
  aligned: AlignResult,
  unavailable: NonNullable<SynthResult['unavailable']>,
  takes: Record<Id, number>,
): DubRegroupSummary {
  const placed = new Set(aligned.placements.map((p) => p.unitId));
  const overlong = new Set(aligned.overlong.map((o) => o.unitId));
  const stale = new Set(script.stale.map((s) => s.unitId));
  const lost = new Set(unavailable.map((u) => u.unitId));
  return {
    seed: regroup.seed,
    units: regroup.units.map((unitId) => {
      const status = placed.has(unitId)
        ? ('replaced' as const)
        : overlong.has(unitId)
          ? ('overlong' as const)
          : stale.has(unitId)
            ? ('stale' as const)
            : lost.has(unitId)
              ? ('voice-unavailable' as const)
              : ('off-timeline' as const);
      return { unitId, status, take: takes[unitId] ?? null, seed: takes[unitId] !== undefined ? regroup.seed : null };
    }),
  };
}

// ---- 启动时的检查与冻结 ----

async function freeze(
  deps: DubDeps,
  translate: PipelineDefinition<FrozenTranslateParams, TranslateParams>,
  params: DubParams,
  options: PipelinePrepareOptions,
): Promise<{ frozen: FrozenDubParams; library: FrozenLibraryEntry[] | undefined }> {
  const state = deps.videos.state(params.videoId);
  if (!state) throw new RpcError('not-found', J.videoNotOpen());
  let documentId: Id;
  let language: string;
  let translateParams: FrozenTranslateParams;
  let library: FrozenLibraryEntry[] | undefined;
  if (params.regroup !== undefined) return { frozen: await freezeRegroup(deps, params.videoId, params.regroup, options), library: undefined };
  if (params.translationId !== undefined) {
    const given = await givenTranslation(deps, params.videoId, params.translationId);
    documentId = given.documentId;
    if (params.documentId !== undefined && params.documentId !== documentId) {
      throw new RpcError(
        'invalid-request',
        J.translationFromOther({ translationId: params.translationId, from: documentId, expected: params.documentId }),
      );
    }
    language = given.language;
    if (params.targetLanguage !== undefined && params.targetLanguage.toLowerCase() !== language.toLowerCase()) {
      throw new RpcError(
        'invalid-request',
        J.translationLanguage({ translationId: params.translationId, language, expected: params.targetLanguage }),
      );
    }
    translateParams = given.translate;
  } else {
    // 缺译文：与 `translate` 同样地选文本模型、检查结构化输出。
    const plan = await translate.prepare(
      {
        videoId: params.videoId,
        targetLanguage: params.targetLanguage!,
        ...(params.documentId !== undefined ? { documentId: params.documentId } : {}),
        ...(params.style !== undefined ? { style: params.style } : {}),
        ...(params.glossary !== undefined ? { glossary: params.glossary } : {}),
        ...(params.glossaries !== undefined ? { glossaries: params.glossaries } : {}),
        ...(params.textProvider !== undefined ? { provider: params.textProvider } : {}),
        ...(params.textModel !== undefined ? { model: params.textModel } : {}),
        ...(params.batchSize !== undefined ? { batchSize: params.batchSize } : {}),
      },
      { retry: false, ...(options.submitter ? { submitter: options.submitter } : {}) },
    );
    translateParams = plan.params;
    library = plan.library;
    documentId = plan.params.documentId;
    language = plan.params.targetLanguage;
  }
  const voice = await deps.speech.prepare({
    language,
    ...(params.provider !== undefined ? { provider: params.provider } : {}),
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.voice !== undefined ? { voice: params.voice } : {}),
  });
  const originalAudio = params.originalAudio ?? 'duck';
  // `keep` 原声不动，分出来的两轨没有地方用：不分离（结果 `not-requested`）。
  const separateBackground = (params.separateBackground ?? false) && originalAudio !== 'keep';
  const separator = separateBackground ? ((await deps.separator?.()) ?? null) : null;
  const frozen: FrozenDubParams = {
    videoId: params.videoId,
    documentId,
    language,
    translationId: params.translationId ?? null,
    translate: translateParams,
    voice,
    voiceSource: params.voice !== undefined ? 'params' : 'default',
    speakerVoices: await speakerBindings(deps, params.videoId, documentId, voice.providerId, options.submitter),
    originalAudio,
    duckDb: params.duckDb ?? DEFAULT_DUCK_DB,
    separateBackground,
    separatorId: separator?.providerId ?? null,
    separatorModel: separator?.modelId ?? null,
    separatorWeightBytes: separator?.workerWeightBytes ?? null,
  };
  return { frozen, library };
}

/** 已有的译文：译自哪份转写、什么语言，读取原文用的参数（不翻译）。 */
async function givenTranslation(
  deps: DubDeps,
  videoId: Id,
  translationId: Id,
): Promise<{ documentId: Id; language: string; translate: FrozenTranslateParams; unitIds: Set<Id> }> {
  const state = deps.videos.state(videoId);
  if (!state) throw new RpcError('not-found', J.videoNotOpen());
  const record = state.documents[translationId];
  if (!record) throw new RpcError('not-found', J.noDocument({ documentId: translationId }));
  if (record.kind !== 'translation') {
    throw new RpcError('invalid-request', J.notTranslation({ documentId: translationId, kind: record.kind }));
  }
  const body = (await deps.videos.document(videoId, translationId)).body as {
    schema?: unknown;
    language?: unknown;
    sourceBasis?: { speechRef?: { id?: unknown } };
    units?: Array<{ id?: unknown }>;
  } | null;
  if (body?.schema !== TRANSLATION_SCHEMA || typeof body.language !== 'string' || typeof body.sourceBasis?.speechRef?.id !== 'string') {
    throw new RpcError('invalid-request', J.translationNotUsable({ translationId, schema: TRANSLATION_SCHEMA }), {
      code: 'INPUT_UNREADABLE',
    });
  }
  const documentId = body.sourceBasis.speechRef.id;
  pickSource(state.documents, documentId);
  const language = body.language;
  const unitIds = new Set((Array.isArray(body.units) ? body.units : []).flatMap((u) => (typeof u?.id === 'string' ? [u.id] : [])));
  return {
    documentId,
    language,
    translate: { videoId, documentId, targetLanguage: language, provider: '', model: '', batchSize: 20 },
    unitIds,
  };
}

/** 配音计划正文里句级重配读写的部分。 */
interface PlanBody {
  schema?: unknown;
  sequenceId?: unknown;
  language?: unknown;
  groupId?: unknown;
  translationRef?: { id?: unknown; revision?: unknown };
  originalDialoguePolicy?: unknown;
  units?: PlanUnit[];
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PlanUnit {
  id?: unknown;
  status?: unknown;
  speakerBindingId?: unknown;
  sourceFingerprint?: unknown;
  actualSamples?: unknown;
  sampleRate?: unknown;
  script?: { text?: unknown; revision?: unknown; reviewed?: unknown } | null;
  extensions?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 计划单元的 `extensions['baocut.dub']`。 */
interface PlanUnitDub {
  translationUnitId?: unknown;
  voice?: unknown;
  voiceSource?: unknown;
  fit?: unknown;
  tempo?: unknown;
  artifactId?: unknown;
  take?: unknown;
  seed?: unknown;
  takes?: DubPlanTake[];
  [key: string]: unknown;
}

function unitDub(unit: PlanUnit): PlanUnitDub {
  const value = unit.extensions?.[DUB_EXTENSION];
  return value && typeof value === 'object' ? (value as PlanUnitDub) : {};
}

/** 计划单元对应的译文单元 ID。 */
function planUnitId(unit: PlanUnit): Id | null {
  const id = unitDub(unit).translationUnitId;
  if (typeof id === 'string') return id;
  return typeof unit.id === 'string' && unit.id.startsWith('d-') ? unit.id.slice(2) : null;
}

/** 视频里这一组配音的计划：`summary.groupId`（旧的计划看正文的 `groupId`）是它的 `dubbing-plan` 文档。 */
async function findPlan(deps: DubDeps, videoId: Id, groupId: string): Promise<{ documentId: Id; revision: string; body: PlanBody } | null> {
  const state = deps.videos.state(videoId);
  if (!state) return null;
  const plans = Object.values(state.documents).filter((d) => d.kind === 'dubbing-plan');
  const summaryGroup = (d: (typeof plans)[number]) => (d.revisions[d.currentRevision]?.summary as { groupId?: unknown } | undefined)?.groupId;
  const ordered = [...plans.filter((d) => summaryGroup(d) === groupId), ...plans.filter((d) => summaryGroup(d) === undefined)];
  for (const record of ordered) {
    const content = await deps.videos.document(videoId, record.id, record.currentRevision);
    const body = content.body as PlanBody | null;
    if (body?.schema === DUBBING_PLAN_SCHEMA && body.groupId === groupId && Array.isArray(body.units)) {
      return { documentId: record.id, revision: content.revision, body };
    }
  }
  return null;
}

/** 这一组配音在序列上的实例（不含分离出来的背景）。 */
function groupItems(items: SequenceItem[], groupId: string): AudioItem[] {
  return items.filter((item): item is AudioItem => {
    if (item.type !== 'audio') return false;
    const dub = item.extensions?.[DUB_EXTENSION] as { groupId?: unknown; stem?: unknown } | undefined;
    return dub?.groupId === groupId && dub.stem === undefined;
  });
}

/**
 * 句级重配的冻结：找到这一组的配音计划，译文、语言、Provider、模型与音色都取自它（用了视频里说话人绑定的句子照那次记下的
 * 音色）；要重配的句子都要在计划与译文里。文本不取计划里的，合成时读译文的当前版本（先改译文再重配）。
 * 种子 `'new'` 在这里随机取一个（模型不接受种子时 null）。
 */
async function freezeRegroup(deps: DubDeps, videoId: Id, regroup: DubRegroup, options: PipelinePrepareOptions): Promise<FrozenDubParams> {
  const state = deps.videos.state(videoId);
  if (!state) throw new RpcError('not-found', J.videoNotOpen());
  const plan = await findPlan(deps, videoId, regroup.groupId);
  if (!plan) {
    throw new RpcError('invalid-request', J.noPlan({ groupId: regroup.groupId }), {
      code: 'DUB_GROUP_NOT_FOUND',
      groupId: regroup.groupId,
    });
  }
  const sequenceId = typeof plan.body.sequenceId === 'string' ? plan.body.sequenceId : state.rootSequenceId;
  const items = groupItems(deps.videos.sequence(videoId, sequenceId)?.items ?? [], regroup.groupId);
  if (items.length === 0) {
    throw new RpcError('invalid-request', J.groupGone({ groupId: regroup.groupId }), {
      code: 'DUB_GROUP_NOT_FOUND',
      groupId: regroup.groupId,
    });
  }
  const translationId = plan.body.translationRef?.id;
  if (typeof translationId !== 'string') {
    throw new RpcError('invalid-request', J.planNoTranslation(), { code: 'INPUT_UNREADABLE', documentId: plan.documentId });
  }
  const given = await givenTranslation(deps, videoId, translationId);
  const planUnits = new Map(
    (plan.body.units ?? []).flatMap((u) => {
      const id = planUnitId(u);
      return id ? [[id, u] as const] : [];
    }),
  );
  const missing = regroup.units.filter((id) => !planUnits.has(id) || !given.unitIds.has(id));
  if (missing.length > 0) {
    throw new RpcError('invalid-request', J.unitsNotInPlan({ count: missing.length, units: joinList(missing) }), {
      groupId: regroup.groupId,
      missing,
    });
  }
  const planDub = plan.body.extensions?.[DUB_EXTENSION] as { voice?: { providerId?: unknown; modelId?: unknown; voice?: unknown } } | undefined;
  const recorded = planDub?.voice;
  if (typeof recorded?.providerId !== 'string' || typeof recorded.modelId !== 'string' || typeof recorded.voice !== 'string') {
    throw new RpcError('invalid-request', J.planNoVoice(), {
      code: 'INPUT_UNREADABLE',
      documentId: plan.documentId,
    });
  }
  const voice = await deps.speech.prepare({
    provider: recorded.providerId,
    model: recorded.modelId,
    voice: recorded.voice,
    language: given.language,
  });
  // 用了视频里说话人绑定的句子：照那次记下的音色；其余的用计划记下的音色（参数给的或模型默认的）。
  const speakerVoices = new Map<string, DubSpeakerVoice>();
  let voiceSource: 'params' | 'default' = 'params';
  for (const id of regroup.units) {
    const unit = planUnits.get(id)!;
    const dub = unitDub(unit);
    if (dub.voiceSource === 'video' && typeof unit.speakerBindingId === 'string' && typeof dub.voice === 'string') {
      if (speakerVoices.has(unit.speakerBindingId)) continue;
      speakerVoices.set(unit.speakerBindingId, {
        speakerId: unit.speakerBindingId,
        voice: dub.voice,
        ...(options.submitter?.kind === 'service' && parseLibraryVoice(dub.voice) !== null
          ? { unavailable: { code: 'LIBRARY_ENTRY_NOT_APPLICABLE', reason: 'service-client' } }
          : {}),
      });
    } else if (dub.voiceSource === 'default') voiceSource = 'default';
  }
  let seed: number | null;
  if (typeof regroup.seed === 'number') {
    if (!voice.acceptsSeed) {
      throw new RpcError('invalid-request', J.seedNotAccepted({ model: voice.modelId }), { providerId: voice.providerId, modelId: voice.modelId });
    }
    seed = regroup.seed;
  } else seed = voice.acceptsSeed ? randomInt(1, 1_000_000) : null;
  const originalAudio = plan.body.originalDialoguePolicy;
  return {
    videoId,
    documentId: given.documentId,
    language: given.language,
    translationId,
    translate: given.translate,
    voice,
    voiceSource,
    speakerVoices: [...speakerVoices.values()],
    originalAudio: originalAudio === 'mute' || originalAudio === 'keep' ? originalAudio : 'duck',
    duckDb: DEFAULT_DUCK_DB,
    separateBackground: false,
    separatorId: null,
    regroup: {
      groupId: regroup.groupId,
      units: [...regroup.units],
      planDocumentId: plan.documentId,
      trackId: items[0]!.trackId,
      seed,
    },
  };
}

/**
 * 视频里给这份转写的说话人绑定的音色（`library-selection`，视频格式规范 §4.6）。指定了别的 Provider 的绑定不用；
 * 对外服务的客户端不能用库里的音色：这样的绑定记成不可用（这位说话人的句子不合成、报告），不换成别的音色。
 */
async function speakerBindings(
  deps: DubDeps,
  videoId: Id,
  documentId: Id,
  providerId: string,
  submitter: PipelinePrepareOptions['submitter'],
): Promise<DubSpeakerVoice[]> {
  const state = deps.videos.state(videoId);
  if (!state) return [];
  const { selection } = await videoSelection(
    state.documents,
    async (id, revision) => (await deps.videos.document(videoId, id, revision)).body,
  );
  return selection.speakerVoices
    .filter((b) => b.documentId === documentId && (b.providerId === undefined || b.providerId === providerId))
    .map((b) => ({
      speakerId: b.speakerId,
      voice: b.voice,
      ...(submitter?.kind === 'service' && parseLibraryVoice(b.voice) !== null
        ? { unavailable: { code: 'LIBRARY_ENTRY_NOT_APPLICABLE', reason: 'service-client' } }
        : {}),
    }));
}

/** 重试：以冻结的参数再查一次（视频打开着、音色的克隆还有效、文本模型还在）。 */
async function refreeze(
  deps: DubDeps,
  translate: PipelineDefinition<FrozenTranslateParams, TranslateParams>,
  params: FrozenDubParams,
  options: PipelinePrepareOptions,
): Promise<FrozenDubParams> {
  if (!deps.videos.state(params.videoId)) throw new RpcError('not-found', J.videoNotOpen());
  if (params.translationId === null) {
    await translate.prepare(params.translate, { retry: true, ...(options.submitter ? { submitter: options.submitter } : {}) });
  }
  await deps.speech.prepare({
    provider: params.voice.providerId,
    model: params.voice.modelId,
    voice: params.voice.voice,
    language: params.language,
  });
  return params;
}

// ---- 核对译文 ----

async function checkTranslation(deps: DubDeps, context: PipelineStepContext<FrozenDubParams>): Promise<StepResult> {
  const { videos } = deps;
  const { params, outputs, artifacts, progress, warn } = context;
  progress(null, 'validating');
  const source = await readArtifact<FrozenSource>(artifacts, (outputs['freeze-source'] as { artifactId: string }).artifactId);
  const created = params.translationId === null;
  const translationId = params.translationId ?? (outputs.write as { documentId: Id }).documentId;
  const state = videos.state(params.videoId);
  if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosed());
  const record = state.documents[translationId];
  if (!record) throw new PipelineStepError('STALE_JOB_INPUT', J.translationGone(), { documentId: translationId });
  const content = await videos.document(params.videoId, translationId, record.currentRevision);
  const body = content.body as {
    schema?: unknown;
    sourceBasis?: { speechRef?: { id?: unknown } };
    glossaryRef?: unknown;
    units?: Array<{ id?: unknown; sourceSentenceId?: unknown; sourceFingerprint?: unknown; naturalText?: unknown; status?: unknown }>;
  } | null;
  if (body?.schema !== TRANSLATION_SCHEMA || !Array.isArray(body.units)) {
    throw new PipelineStepError('INPUT_UNREADABLE', J.translationNotSchema({ schema: TRANSLATION_SCHEMA }), { documentId: translationId });
  }
  if (body.sourceBasis?.speechRef?.id !== params.documentId) {
    throw new PipelineStepError('INPUT_UNREADABLE', J.translationNotFromTranscript(), { documentId: translationId, source: params.documentId });
  }
  const current = new Map(source.sentences.map((s) => [s.id, s]));
  const glossaryStale = glossaryCheck(deps, body.glossaryRef);
  const script: DubScript = {
    translation: { id: translationId, revision: content.revision },
    language: params.language,
    units: [],
    stale: [],
  };
  for (const unit of body.units) {
    if (typeof unit?.id !== 'string' || typeof unit.sourceSentenceId !== 'string') {
      throw new PipelineStepError('INPUT_UNREADABLE', J.unitMissingIds(), { documentId: translationId });
    }
    const sentenceId = unit.sourceSentenceId;
    const sentence = current.get(sentenceId);
    const text = typeof unit.naturalText === 'string' ? unit.naturalText.trim() : '';
    const reason =
      unit.status === 'stale'
        ? ('marked-stale' as const)
        : !sentence
          ? ('sentence-gone' as const)
          : sentence.fingerprint !== unit.sourceFingerprint
            ? ('source-changed' as const)
            : text === ''
              ? ('empty' as const)
              : glossaryStale(sentence.text)
                ? ('glossary-changed' as const)
                : null;
    if (reason) script.stale.push({ unitId: unit.id, sentenceId, reason });
    else {
      const speakerId = sentence!.speaker;
      script.units.push({ unitId: unit.id, sentenceId, fingerprint: sentence!.fingerprint, text, ...(speakerId ? { speakerId } : {}) });
    }
  }
  // 句级重配：只核对、合成要重配的那几句。
  const only = params.regroup ? new Set(params.regroup.units) : null;
  if (only) {
    script.units = script.units.filter((u) => only.has(u.unitId));
    script.stale = script.stale.filter((u) => only.has(u.unitId));
  }
  if (params.separateBackground && params.separatorId === null) {
    warn(jobWarning('DUB_SEPARATION_NOT_CONFIGURED', J.separationNotConfigured()));
  }
  if (script.stale.length > 0) {
    warn(jobWarning('DUB_UNITS_STALE', J.unitsStale({ count: script.stale.length })));
  }
  if (script.units.length === 0) {
    throw new PipelineStepError('DUB_NOTHING_TO_DUB', J.nothingToDub(), {
      documentId: translationId,
      stale: script.stale.length,
    });
  }
  const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify(script)), 'json');
  const output: CheckOutput = {
    artifactId,
    translationId,
    revision: content.revision,
    created,
    total: only ? only.size : body.units.length,
    usable: script.units.length,
    stale: script.stale.length,
  };
  return { output, result: { documentId: null, artifactId } };
}

/**
 * 术语表改过的过期判断（视频格式规范 §5.3）：译文记下的库里术语表有一张的内容摘要与库里当前的不同时，逐句比较翻译时
 * 与现在出现在这句原文里的术语；有增、删或改了译法的，这句过期。库里删了的条目当作没有术语。没有用库里的术语表或没有库时不判断。
 */
function glossaryCheck(deps: DubDeps, value: unknown): (sentenceText: string) => boolean {
  const ref = readGlossaryRef(value);
  const library = deps.translation.library;
  if (!ref || ref.entries.length === 0 || !library) return () => false;
  const cache = new Map<Id, { contentHash: string; terms: Array<{ source: string; target: string; note: string | null }> } | null>();
  const current = (id: Id) => {
    if (!cache.has(id)) {
      let value: { contentHash: string; terms: Array<{ source: string; target: string; note: string | null }> } | null = null;
      try {
        const entry = library.get({ library: 'glossaries', id });
        value = { contentHash: entry.contentHash, terms: entry.content.kind === 'translation' ? entry.content.terms : [] };
      } catch {
        value = null;
      }
      cache.set(id, value);
    }
    return cache.get(id)!;
  };
  return (sentenceText) => glossaryChanged(ref, sentenceText, current);
}

// ---- 分离人声与背景（可选） ----

async function separate(deps: DubDeps, context: PipelineStepContext<FrozenDubParams>): Promise<StepResult> {
  const { params, artifacts, signal, staging, jobId, progress } = context;
  const frozenModel =
    params.separatorId !== null && params.separatorModel ? { providerId: params.separatorId, modelId: params.separatorModel } : undefined;
  const separator = (await deps.separator?.(frozenModel)) ?? null;
  if (!separator || separator.providerId !== params.separatorId) {
    throw new PipelineStepError('CAPABILITY_NOT_CONFIGURED', J.separationUnavailable(), { capability: 'separateAudio' });
  }
  progress(null, 'starting');
  const state = deps.videos.state(params.videoId);
  const assetId = state?.documents[params.documentId]?.sourceAssetId ?? null;
  if (!assetId) throw new PipelineStepError('INPUT_UNREADABLE', J.noSourceAsset(), { documentId: params.documentId });
  const source = await deps.videos.assetFile(params.videoId, assetId);
  if (!source) throw new PipelineStepError('ASSET_MISSING', J.sourceAssetMissing(), { assetId });
  const dir = path.join(staging, 'separate');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  progress(null, 'generating');
  const stems = await separator.separate({ file: source.file, staging: dir, videoId: params.videoId, jobId, signal });
  progress(null, 'validating');
  const [input, vocals, background] = await Promise.all([
    probeMedia(deps.ffprobe, source.file, signal),
    probeMedia(deps.ffprobe, stems.vocals, signal),
    probeMedia(deps.ffprobe, stems.background, signal),
  ]);
  const problems = stemProblems(input, { vocals, background });
  if (problems.length > 0) throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.separationInvalid(), { problems });
  const put = async (file: string) => (await artifacts.put(await fs.readFile(file), extensionOf(file))).artifactId;
  const output: SeparateOutput = {
    assetId,
    assetRevision: source.revision,
    vocalsArtifactId: await put(stems.vocals),
    backgroundArtifactId: await put(stems.background),
  };
  return { output, result: { documentId: null, artifactId: output.backgroundArtifactId } };
}

/** 分离的输出合约（架构设计 §6.4）：人声与背景各一条音频，与输入等长（容差一帧音频 20 毫秒）、采样率相同。 */
export function stemProblems(
  input: { durationSec: number; audio: { sampleRate: number } | null },
  stems: Record<'vocals' | 'background', { durationSec: number; audio: { sampleRate: number } | null }>,
): string[] {
  const problems: string[] = [];
  if (!input.audio) return [J.inputNoAudio().text];
  for (const [name, stem] of Object.entries(stems)) {
    if (!stem.audio) {
      problems.push(J.stemNoAudio({ name }).text);
      continue;
    }
    if (stem.audio.sampleRate !== input.audio.sampleRate)
      problems.push(J.stemSampleRate({ name, rate: stem.audio.sampleRate, input: input.audio.sampleRate }).text);
    if (Math.abs(stem.durationSec - input.durationSec) > 0.02) {
      problems.push(J.stemDuration({ name, duration: stem.durationSec, input: input.durationSec }).text);
    }
  }
  return problems;
}

// ---- 逐句合成 ----

async function synthesize(deps: DubDeps, context: PipelineStepContext<FrozenDubParams>, concurrency: number): Promise<StepResult> {
  const { params, outputs, artifacts, signal, staging, progress, spawn, warn } = context;
  const script = await readArtifact<DubScript>(artifacts, (outputs['check-translation'] as CheckOutput).artifactId);
  const manifestFile = path.join(staging, MANIFEST_FILE);
  const manifest = await readManifest(manifestFile);
  // 种子（句级重配）进摘要；没有种子时与原来的摘要相同（`acceptsSeed` 不算在音色里）。
  const seed = params.regroup?.seed ?? null;
  const keyOf = (text: string, { acceptsSeed: _, ...voice }: DubVoice) =>
    `sha256:${sha256Hex(canonicalJson({ text, language: params.language, voice, ...(seed !== null ? { seed } : {}) }))}`;

  // 每句的音色：说话人在视频里绑定的优先，其次参数 `voice`，最后模型的默认音色（`params.voice` 已经是二者之一）。
  const bound = await resolveSpeakerVoices(deps, params, new Set(script.units.flatMap((u) => (u.speakerId ? [u.speakerId] : []))));
  const voices: NonNullable<SynthResult['voices']> = {};
  const unavailable: NonNullable<SynthResult['unavailable']> = [];
  const work: Array<{ index: number; unit: DubScript['units'][number]; voice: DubVoice; speakerId: string | null }> = [];
  for (const [index, unit] of script.units.entries()) {
    const binding = unit.speakerId !== undefined ? bound.get(unit.speakerId) : undefined;
    if (binding) {
      voices[unit.unitId] = { voice: binding.voice, voiceSource: 'video' };
      if (binding.dub) work.push({ index, unit, voice: binding.dub, speakerId: unit.speakerId! });
      else unavailable.push({ unitId: unit.unitId, speakerId: unit.speakerId!, voice: binding.voice, ...binding.unavailable! });
    } else {
      voices[unit.unitId] = { voice: params.voice.voice, voiceSource: params.voiceSource ?? 'params' };
      work.push({ index, unit, voice: params.voice, speakerId: null });
    }
  }
  // 合成途中失效的绑定音色：这位说话人余下的句子不再调用。
  const lost = new Map<string, { code: string; reason: string }>();

  const counter = new CallCounter();
  let reused = 0;
  const pending: typeof work = [];
  for (const w of work) {
    const entry = manifest[w.unit.unitId];
    if (entry && entry.key === keyOf(w.unit.text, w.voice) && (await artifacts.locate(entry.artifactId)) !== null) reused++;
    else pending.push(w);
  }
  let synthesizedNow = 0;
  let skippedNow = 0;
  const done = () => work.length - pending.length + synthesizedNow + skippedNow;
  const report = () => progress({ done: done(), total: work.length, unit: 'units', calls: counter.snapshot() }, 'generating');
  report();

  const local = new AbortController();
  const stop = () => local.abort();
  signal.addEventListener('abort', stop, { once: true });
  // 停在授权、预算、认证这类之后每句都会遇到的失败上：不再发起新的调用；已经在路上的调用（已经预留、在额度之内）照常完成。
  let terminal: { unitId: Id; error: PipelineStepError } | null = null;
  const failed: Array<{ unitId: Id; code: string; message: string }> = [];
  let saving = Promise.resolve();
  const save = () => (saving = saving.then(() => writeManifest(manifestFile, manifest)));
  const skip = (w: (typeof work)[number], problem: { code: string; reason: string }) => {
    unavailable.push({ unitId: w.unit.unitId, speakerId: w.speakerId!, voice: voices[w.unit.unitId]!.voice, ...problem });
    skippedNow++;
    report();
  };

  const runUnit = async (w: (typeof pending)[number]) => {
    const { index, unit, voice } = w;
    if (w.speakerId !== null && lost.has(w.speakerId)) return skip(w, lost.get(w.speakerId)!);
    const dir = path.join(staging, 'synthesis', safeName(unit.unitId));
    await spawn(J.sentenceJob({ n: index + 1 }), async (job) => {
      for (let attempt = 0; ; attempt++) {
        local.signal.throwIfAborted();
        counter.calls++;
        report();
        try {
          await fs.rm(dir, { recursive: true, force: true });
          await fs.mkdir(dir, { recursive: true });
          const { file } = await deps.speech.synthesize({
            voice,
            text: unit.text,
            language: params.language,
            videoId: params.videoId,
            jobId: job.jobId,
            staging: dir,
            signal: local.signal,
            ...(seed !== null ? { seed } : {}),
          });
          const probed = await probeMedia(deps.ffprobe, file, local.signal).catch((error: unknown) => {
            throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.audioUndecodable(), { cause: messageOf(error) });
          });
          if (!probed.audio || !(probed.durationSec > 0)) throw new PipelineStepError('MODEL_OUTPUT_INVALID', J.outputNoAudio());
          const { artifactId } = await artifacts.put(await fs.readFile(file), voice.format as ArtifactExtension);
          manifest[unit.unitId] = {
            key: keyOf(unit.text, voice),
            artifactId,
            durationSec: probed.durationSec,
            sampleRate: probed.audio.sampleRate,
          };
          await save();
          await fs.rm(dir, { recursive: true, force: true });
          synthesizedNow++;
          report();
          return;
        } catch (error) {
          if (local.signal.aborted && !(error instanceof PipelineStepError)) throw error;
          const failure = asStepError(error);
          if (TRANSIENT.has(failure.code) && attempt === 0 && !TERMINAL.has(failure.code) && !terminal) {
            counter.retries++;
            continue;
          }
          counter.failures++;
          report();
          throw failure;
        }
      }
    }).catch((error: unknown) => {
      if (signal.aborted) throw error;
      const failure = asStepError(error);
      if (w.speakerId !== null && VOICE_LOST.has(failure.code)) {
        // 绑定的音色失效（克隆过期、撤回了授权声明、库里删了）：这句与这位说话人余下的句子不合成，逐句报告。
        const problem = voiceProblem(failure);
        lost.set(w.speakerId, problem);
        skip(w, problem);
      } else if (TERMINAL.has(failure.code)) {
        terminal ??= { unitId: unit.unitId, error: failure };
      } else {
        failed.push({ unitId: unit.unitId, code: failure.code, message: failure.message });
      }
    });
  };

  try {
    let next = 0;
    const worker = async () => {
      while (next < pending.length && !local.signal.aborted && !terminal) await runUnit(pending[next++]!);
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  } finally {
    signal.removeEventListener('abort', stop);
    await saving;
  }
  signal.throwIfAborted();
  const synthesized = done() - skippedNow;
  const remaining = work.length - done();
  if (terminal) {
    const { unitId, error } = terminal as { unitId: Id; error: PipelineStepError };
    throw new PipelineStepError(error.code, J.synthesisStopped({ cause: errorText(error), synthesized, remaining }), {
      ...(error.details ?? {}),
      stoppedAt: unitId,
      synthesized,
      remaining,
      calls: counter.snapshot(),
    });
  }
  if (failed.length > 0) {
    throw new PipelineStepError(
      'DUB_SYNTHESIS_FAILED',
      J.synthesisFailed({ failed: failed.length, synthesized }),
      {
        failed,
        synthesized,
        remaining,
        calls: counter.snapshot(),
      },
    );
  }
  const skipped = new Set(unavailable.map((u) => u.unitId));
  const units: Record<Id, SynthEntry> = {};
  for (const w of work) if (!skipped.has(w.unit.unitId)) units[w.unit.unitId] = manifest[w.unit.unitId]!;
  if (unavailable.length > 0) {
    const speakers = [...new Set(unavailable.map((u) => u.speakerId))];
    if (Object.keys(units).length === 0) {
      const first = unavailable[0]!;
      throw new PipelineStepError(
        first.code,
        J.voicesUnavailableAll({ speakers: joinList(speakers) }),
        {
          unavailable,
          calls: counter.snapshot(),
        },
      );
    }
    warn(jobWarning('DUB_VOICE_UNAVAILABLE', J.voicesUnavailable({ count: unavailable.length, speakers: joinList(speakers) })));
  }
  // 各说话人用的音色（同一位说话人的句子用同一个音色）。
  const speakers = new Map<string | null, NonNullable<SynthResult['speakers']>[number]>();
  for (const unit of script.units) {
    const key = unit.speakerId ?? null;
    const v = voices[unit.unitId]!;
    const s = speakers.get(key) ?? { speakerId: key, voice: v.voice, voiceSource: v.voiceSource, available: true, units: 0 };
    s.units++;
    if (skipped.has(unit.unitId)) s.available = false;
    speakers.set(key, s);
  }
  const result: SynthResult = { units, voices, unavailable, speakers: [...speakers.values()] };
  const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify(result)), 'json');
  const output: SynthOutput = {
    artifactId,
    synthesized: synthesizedNow,
    reused,
    calls: counter.snapshot(),
    voiceUnavailable: unavailable.length,
  };
  return { output, result: { documentId: null, artifactId } };
}

/** 说话人绑定的音色：每次合成这一步都重新换算、检查（库里音色的授权声明与克隆有效性；不联网）。 */
async function resolveSpeakerVoices(
  deps: DubDeps,
  params: FrozenDubParams,
  speakers: Set<string>,
): Promise<Map<string, { voice: string; dub: DubVoice | null; unavailable: { code: string; reason: string } | null }>> {
  const out = new Map<string, { voice: string; dub: DubVoice | null; unavailable: { code: string; reason: string } | null }>();
  for (const binding of params.speakerVoices ?? []) {
    if (!speakers.has(binding.speakerId)) continue;
    if (binding.unavailable) {
      out.set(binding.speakerId, { voice: binding.voice, dub: null, unavailable: binding.unavailable });
      continue;
    }
    try {
      const dub = await deps.speech.prepare({
        provider: params.voice.providerId,
        model: params.voice.modelId,
        voice: binding.voice,
        language: params.language,
      });
      out.set(binding.speakerId, { voice: binding.voice, dub, unavailable: null });
    } catch (error) {
      out.set(binding.speakerId, { voice: binding.voice, dub: null, unavailable: voiceProblem(error) });
    }
  }
  return out;
}

/** 音色不可用的原因：错误码，与 `stale`、`missing`（克隆）、`no-consent`（没有授权声明）、`removed`（库里删了）之类。 */
function voiceProblem(error: unknown): { code: string; reason: string } {
  const details = (error instanceof PipelineStepError || error instanceof RpcError ? error.details : undefined) as
    { code?: unknown; reason?: unknown } | undefined;
  const code =
    error instanceof PipelineStepError
      ? error.code
      : typeof details?.code === 'string'
        ? details.code
        : error instanceof RpcError
          ? error.code
          : 'INTERNAL';
  const reason =
    typeof details?.reason === 'string'
      ? details.reason
      : code === 'VOICE_CONSENT_REQUIRED'
        ? 'no-consent'
        : code === 'VOICE_NOT_FOUND'
          ? 'removed'
          : 'invalid';
  return { code, reason };
}

async function readManifest(file: string): Promise<Record<Id, SynthEntry>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<Id, SynthEntry>) : {};
  } catch {
    return {};
  }
}

async function writeManifest(file: string, manifest: Record<Id, SynthEntry>): Promise<void> {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, JSON.stringify(manifest));
  await fs.rename(temp, file);
}

// ---- 时间对齐 ----

async function align(deps: DubDeps, context: PipelineStepContext<FrozenDubParams>): Promise<StepResult> {
  const { params, outputs, artifacts, signal, staging, progress, warn } = context;
  progress(null, 'starting');
  const source = await readArtifact<FrozenSource>(artifacts, (outputs['freeze-source'] as { artifactId: string }).artifactId);
  const script = await readArtifact<DubScript>(artifacts, (outputs['check-translation'] as CheckOutput).artifactId);
  const synth = await readArtifact<SynthResult>(artifacts, (outputs.synthesize as SynthOutput).artifactId);
  const state = deps.videos.state(params.videoId);
  if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosed());
  const sequenceId = source.sequenceId;
  const timeline = await deps.videos.speechOnTimeline(params.videoId, sequenceId, params.documentId);

  // 每句在时间线上的每次出现：同一个实例里的词合成一个时间窗（秒按微秒取整，比较用整数）。
  const sentenceOfWord = new Map<Id, Id>();
  for (const s of source.sentences) for (const w of s.wordIds) sentenceOfWord.set(w, s.id);
  const windows = new Map<string, { sentenceId: Id; itemId: Id | null; start: number; end: number }>();
  for (const word of timeline.words) {
    const sentenceId = sentenceOfWord.get(word.wordId);
    if (!sentenceId) continue;
    const key = `${sentenceId}\u0000${word.itemId ?? ''}`;
    const start = Math.round(word.start * 1e6);
    const end = Math.round(word.end * 1e6);
    const w = windows.get(key);
    if (!w) windows.set(key, { sentenceId, itemId: word.itemId, start, end });
    else {
      w.start = Math.min(w.start, start);
      w.end = Math.max(w.end, end);
    }
  }
  const sorted = [...windows.values()].sort((a, b) => a.start - b.start || a.end - b.end);
  // 同一句被剪成几段、前后相连（中间没有别的句子）时是同一次出现，只配一次：从第一段的起点开始，时间窗到最后一段的终点。
  // 隔着别的句子再出现（复制了片段）时再配一次。
  const ordered: typeof sorted = [];
  for (const w of sorted) {
    const last = ordered.at(-1);
    if (last && last.sentenceId === w.sentenceId) last.end = Math.max(last.end, w.end);
    else ordered.push({ ...w });
  }
  // 原声的静音或闪避不作用在只有「音色不可用、没有合成」的句子的实例上（那些句子没有配音替代）。
  const unvoiced = new Set(script.units.filter((u) => !synth.units[u.unitId]).map((u) => u.sentenceId));
  const dialogueItemIds = [...new Set(sorted.flatMap((w) => (w.itemId && !unvoiced.has(w.sentenceId) ? [w.itemId] : [])))];
  const dialogue = new Set(dialogueItemIds);
  const mixed = new Set(sorted.flatMap((w) => (w.itemId && unvoiced.has(w.sentenceId) && dialogue.has(w.itemId) ? [w.itemId] : [])));
  if (params.originalAudio === 'mute' && mixed.size > 0) {
    warn(jobWarning('DUB_MUTED_UNVOICED', J.mutedUnvoiced({ count: mixed.size })));
  }
  const sequenceEnd = Math.round(timeline.end * 1e6);
  const byUnit = new Map(script.units.map((u) => [u.sentenceId, u]));

  const result: AlignResult = {
    videoRevision: timeline.videoRevision,
    sequenceId,
    placements: [],
    overlong: [],
    offTimeline: [],
    dialogueItemIds,
  };
  const onTimeline = new Set(ordered.map((w) => w.sentenceId));
  for (const unit of script.units) {
    if (synth.units[unit.unitId] && !onTimeline.has(unit.sentenceId)) result.offTimeline.push(unit.unitId);
  }
  const overlong = new Map<Id, number>();
  const stretched = new Map<string, { artifactId: string; durationSec: number; sampleRate: number }>();
  const dir = path.join(staging, 'align');
  await fs.mkdir(dir, { recursive: true });

  for (const [i, window] of ordered.entries()) {
    const unit = byUnit.get(window.sentenceId);
    if (!unit) continue;
    // 音色不可用、没有合成的句子不放。
    const entry = synth.units[unit.unitId];
    if (!entry) continue;
    // 不越过：下一个开始得更晚的时间窗（任何一句，包括没有配音的），没有时是序列的终点。
    const next = ordered.slice(i + 1).find((w) => w.start > window.start || (w.start === window.start && w !== window));
    const limit = next ? next.start : Math.max(sequenceEnd, window.end);
    const aligned = alignDub({ start: window.start / 1e6, end: window.end / 1e6, limit: limit / 1e6 }, entry.durationSec);
    if (aligned.fit === 'overlong') {
      overlong.set(unit.unitId, Math.max(overlong.get(unit.unitId) ?? 0, round3(aligned.overflow)));
      continue;
    }
    let audio = { artifactId: entry.artifactId, durationSec: entry.durationSec, sampleRate: entry.sampleRate };
    if (aligned.tempo !== 1) {
      const cacheKey = `${entry.artifactId}@${aligned.tempo}`;
      let made = stretched.get(cacheKey);
      if (!made) {
        made = await stretch(deps, artifacts, entry.artifactId, aligned.tempo, path.join(dir, `${stretched.size}.wav`), signal);
        stretched.set(cacheKey, made);
      }
      audio = made;
    }
    const samples = Math.floor(audio.durationSec * audio.sampleRate);
    // 实测的长度（变速之后可能多出几个采样）仍要在下一句之前结束，否则如实算作放不下，不截断。
    const overflowUs = window.start * audio.sampleRate + samples * 1e6 - limit * audio.sampleRate;
    if (overflowUs > 0) {
      overlong.set(unit.unitId, Math.max(overlong.get(unit.unitId) ?? 0, round3(overflowUs / 1e6 / audio.sampleRate)));
      continue;
    }
    result.placements.push({
      unitId: unit.unitId,
      sentenceId: unit.sentenceId,
      itemId: window.itemId,
      startUs: window.start,
      fit: aligned.fit,
      tempo: aligned.tempo,
      artifactId: audio.artifactId,
      samples,
      sampleRate: audio.sampleRate,
    });
  }
  result.overlong = [...overlong].map(([unitId, overflowSeconds]) => ({ unitId, overflowSeconds }));
  if (result.overlong.length > 0) {
    warn(jobWarning('DUB_UNITS_OVERLONG', J.unitsOverlong({ count: result.overlong.length, tempo: MAX_DUB_TEMPO })));
  }
  if (result.offTimeline.length > 0) {
    warn(jobWarning('DUB_UNITS_OFF_TIMELINE', J.unitsOffTimeline({ count: result.offTimeline.length })));
  }
  if (result.placements.length === 0) {
    throw new PipelineStepError('DUB_NOTHING_PLACED', J.nothingPlaced(), {
      overlong: result.overlong,
      offTimeline: result.offTimeline.length,
    });
  }
  const { artifactId } = await artifacts.put(Buffer.from(JSON.stringify(result)), 'json');
  const output: AlignOutput = {
    artifactId,
    videoRevision: timeline.videoRevision,
    placed: result.placements.length,
    overlong: result.overlong.length,
  };
  return { output, result: { documentId: null, artifactId } };
}

/** 用 ffmpeg `atempo` 变速（保持音高），输出 16 位 PCM 的 WAV，发布为产物。 */
async function stretch(
  deps: DubDeps,
  artifacts: ArtifactStore,
  artifactId: string,
  tempo: number,
  out: string,
  signal: AbortSignal,
): Promise<{ artifactId: string; durationSec: number; sampleRate: number }> {
  const input = await artifacts.locate(artifactId);
  if (!input) throw new PipelineStepError('ARTIFACT_NOT_FOUND', J.artifactGone({ artifactId }));
  await runFfmpeg(
    deps.ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      input,
      '-filter:a',
      atempoFilter(tempo),
      '-c:a',
      'pcm_s16le',
      '-progress',
      'pipe:1',
      '-nostats',
      out,
    ],
    { signal },
  );
  const probed = await probeMedia(deps.ffprobe, out, signal);
  if (!probed.audio) throw new PipelineStepError('TRANSCODE_FAILED', J.stretchNoAudio());
  const put = await artifacts.put(await fs.readFile(out), 'wav');
  return { artifactId: put.artifactId, durationSec: probed.durationSec, sampleRate: probed.audio.sampleRate };
}

// ---- 应用 ----

async function applyDub(videos: DubVideos, context: PipelineStepContext<FrozenDubParams>): Promise<StepResult> {
  if (context.params.regroup) return applyRegroup(videos, context, context.params.regroup);
  const { params, outputs, artifacts, progress, warn, jobId, parentJobId, run } = context;
  progress(null, 'applying');
  const check = outputs['check-translation'] as CheckOutput;
  const script = await readArtifact<DubScript>(artifacts, check.artifactId);
  const aligned = await readArtifact<AlignResult>(artifacts, (outputs.align as AlignOutput).artifactId);
  const synth = await readArtifact<SynthResult>(artifacts, (outputs.synthesize as SynthOutput).artifactId);
  const separated = outputs.separate as SeparateOutput | null | undefined;
  const source = await readArtifact<FrozenSource>(artifacts, (outputs['freeze-source'] as { artifactId: string }).artifactId);
  const groupId = `dub_${parentJobId.replace(/^job_/, '')}`;
  const language = params.language;

  for (let attempt = 1; ; attempt++) {
    const state = videos.state(params.videoId);
    if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosedKept());
    if (state.revision !== aligned.videoRevision) {
      throw new PipelineStepError('STALE_JOB_INPUT', J.videoChanged(), {
        alignedRevision: aligned.videoRevision,
        currentRevision: state.revision,
      });
    }
    const sequence = videos.sequence(params.videoId, aligned.sequenceId);
    if (!sequence) throw new PipelineStepError('STALE_JOB_INPUT', J.sequenceGone());
    const operations = await dubOperations({
      params,
      aligned,
      script,
      synth,
      source,
      check,
      separated: separated ?? null,
      sequence,
      groupId,
      parentJobId,
      artifacts,
    });
    if (params.originalAudio === 'mute' && !separated && aligned.dialogueItemIds.length > 0) {
      warn(jobWarning('DUB_BACKGROUND_MUTED', J.backgroundMuted()));
    }
    try {
      const receipt = await videos.apply(params.videoId, {
        commandId: `cmd_${jobId}_apply_${attempt}`,
        expectedRevision: state.revision,
        operations,
        label: J.transactionLabel({ language }).text,
        run,
      });
      const trackId = receipt.refs?.['dub-track'];
      const planDocumentId = receipt.refs?.plan;
      if (!trackId || !planDocumentId) throw new PipelineStepError('APPLY_FAILED', J.noTrackOrPlanId());
      const output: ApplyOutput = { trackId, planDocumentId, groupId, items: aligned.placements.length };
      return { output, result: { documentId: planDocumentId, artifactId: (outputs.align as AlignOutput).artifactId } };
    } catch (error) {
      // 版本冲突：视频在读与写之间改过；下一轮会发现版本变了，以 STALE_JOB_INPUT 结束（重试时重新对齐）。
      if (error instanceof RpcError && error.code === 'conflict' && attempt < APPLY_ATTEMPTS) continue;
      if (error instanceof PipelineStepError) throw error;
      throw new PipelineStepError('APPLY_FAILED', J.applyRejected(), { cause: messageOf(error) });
    }
  }
}

/** 应用配音的那一笔事务的全部操作（导出给测试）。 */
export async function dubOperations(input: {
  params: FrozenDubParams;
  aligned: AlignResult;
  script: DubScript;
  synth: SynthResult;
  source: FrozenSource;
  check: CheckOutput;
  separated: SeparateOutput | null;
  sequence: { fps: { num: number; den: number }; items: SequenceItem[] };
  groupId: string;
  parentJobId: Id;
  artifacts: ArtifactStore;
}): Promise<EditOperation[]> {
  const { params, aligned, script, synth, source, check, separated, sequence, groupId, parentJobId, artifacts } = input;
  // 每句的音色（旧的合成产物没有：都是参数的音色）。
  const voiceOf = (unitId: Id) => synth.voices?.[unitId] ?? { voice: params.voice.voice, voiceSource: params.voiceSource ?? 'params' };
  const unavailable = new Map((synth.unavailable ?? []).map((u) => [u.unitId, u]));
  const language = params.language;
  const sequenceId = aligned.sequenceId;
  const operations: EditOperation[] = [];
  const importRefs = new Map<string, string>();
  const unitIndex = new Map(script.units.map((u, i) => [u.unitId, i]));
  const provenance = (unitId: Id, extra: Record<string, unknown>) => ({
    origin: 'generated',
    source: {
      pipeline: DUB_PIPELINE,
      jobId: parentJobId,
      providerId: params.voice.providerId,
      modelId: params.voice.modelId,
      voice: voiceOf(unitId).voice,
      language,
      unitId,
      ...extra,
    },
  });
  for (const p of aligned.placements) {
    if (importRefs.has(p.artifactId)) continue;
    const file = await artifacts.locate(p.artifactId);
    if (!file) throw new PipelineStepError('ARTIFACT_NOT_FOUND', J.artifactGone({ artifactId: p.artifactId }));
    const ref = `dub-audio-${importRefs.size + 1}`;
    importRefs.set(p.artifactId, ref);
    operations.push({
      type: 'importAsset',
      path: file,
      name: J.assetName({ language, n: (unitIndex.get(p.unitId) ?? 0) + 1 }).text,
      ref,
      storage: 'managed',
      provenance: provenance(p.unitId, { artifactId: p.artifactId, tempo: p.tempo }),
    });
  }
  operations.push({ type: 'addTrack', sequenceId, kind: 'audio', name: J.trackName({ language }).text, ref: 'dub-track' });
  const items: SequenceItemInput[] = aligned.placements.map((p) => {
    const { fromFrame, subframeOffset } = audioStart(p.startUs, sequence.fps);
    return {
      type: 'audio',
      trackRef: 'dub-track',
      assetImportRef: importRefs.get(p.artifactId)!,
      fromFrame,
      subframeOffset,
      playDuration: { ticks: String(p.samples), timescale: p.sampleRate },
      timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
      mix: { volume: 1 },
      name: J.itemName({ n: (unitIndex.get(p.unitId) ?? 0) + 1 }).text,
      role: 'dub',
      extensions: { [DUB_EXTENSION]: { groupId, language, unitId: p.unitId } },
    } as SequenceItemInput;
  });
  operations.push({ type: 'insertItems', sequenceId, items });

  // 原声：只作用在原句所在、带声音的实例上。
  const audible = new Set(sequence.items.filter((item) => item.type === 'audio' || item.type === 'video').map((item) => item.id));
  const dialogue = aligned.dialogueItemIds.filter((id) => audible.has(id));
  const sounding = (id: Id) => {
    const item = sequence.items.find((i) => i.id === id)!;
    return item.type === 'audio' ? !item.mix.muted : item.type === 'video' ? item.embeddedAudio.enabled : false;
  };
  // 分离过（`keep` 不分离）：原句所在、还出声、用的正是分离的那份素材的实例换成两份分轨——实例静音，同样的位置与源区间
  // 放一段背景（「背景声」轨，原样音量）；`duck` 时再放一段人声（「人声」轨），由闪避压低。`mute` 时人声也静音，不放。
  const stemmed =
    separated && params.originalAudio !== 'keep' ? dialogue.filter((id) => sounding(id) && stemSource(sequence, id, separated)) : [];
  const stems: Array<{ stem: 'background' | 'vocals'; artifactId: string; name: string }> =
    stemmed.length === 0
      ? []
      : [
          { stem: 'background', artifactId: separated!.backgroundArtifactId, name: J.backgroundName({ language }).text },
          ...(params.originalAudio === 'duck'
            ? [{ stem: 'vocals' as const, artifactId: separated!.vocalsArtifactId, name: J.vocalsName({ language }).text }]
            : []),
        ];
  for (const { stem, artifactId, name } of stems) {
    const file = await artifacts.locate(artifactId);
    if (!file) throw new PipelineStepError('ARTIFACT_NOT_FOUND', J.artifactGone({ artifactId }));
    operations.push(
      {
        type: 'importAsset',
        path: file,
        name,
        ref: `dub-${stem}`,
        storage: 'managed',
        provenance: {
          origin: 'generated',
          source: { pipeline: DUB_PIPELINE, jobId: parentJobId, capability: 'separateAudio', stem, language },
        },
      },
      { type: 'addTrack', sequenceId, kind: 'audio', name, ref: `dub-${stem}-track` },
      { type: 'insertItems', sequenceId, items: stemItems(sequence, stemmed, groupId, stem) },
    );
  }

  // 静音的实例记进配音计划（这次才静音的，之前已经静音的不算），「只要原声」的导出与「听原声」据此恢复：
  // `mute` 是原句所在的全部实例，`duck` 是换成分轨的那几个。
  const mutedNow = params.originalAudio === 'mute' ? dialogue.filter(sounding) : stems.length > 0 ? stemmed : [];
  // `duck` 压的是人声轨与没有换成分轨的原声实例。
  const stemmedSet = new Set(stemmed);
  const duckItems = dialogue.filter((id) => !stemmedSet.has(id));
  const duckVocals = stems.some((s) => s.stem === 'vocals');

  const placedUnits = new Map<Id, Placement>();
  for (const p of aligned.placements) if (!placedUnits.has(p.unitId)) placedUnits.set(p.unitId, p);
  const overlong = new Set(aligned.overlong.map((o) => o.unitId));
  const fingerprints = new Map(source.sentences.map((s) => [s.id, s.fingerprint]));
  const body = {
    schema: DUBBING_PLAN_SCHEMA,
    sequenceId,
    language,
    translationRef: { id: check.translationId, revision: check.revision },
    groupId,
    originalDialoguePolicy: params.originalAudio,
    backgroundPolicy: stems.length > 0 ? 'separate-stems' : 'none',
    units: [
      ...script.units.map((u) => {
        const placed = placedUnits.get(u.unitId);
        const voice = voiceOf(u.unitId);
        const lost = unavailable.get(u.unitId);
        return {
          id: `d-${u.unitId}`,
          sourceSentenceIds: [u.sentenceId],
          sourceFingerprint: u.fingerprint,
          script: { text: u.text, revision: check.revision, reviewed: false },
          // 用了视频里的说话人绑定时是那位说话人的 ID（`library-selection` 的 `speakerVoices`），否则 null。
          speakerBindingId: voice.voiceSource === 'video' ? (u.speakerId ?? null) : null,
          targetAnchor: { kind: 'sentence', speechRef: source.speechRef, sentenceId: u.sentenceId, edge: 'start' },
          timingPolicy: 'fit-fixed-slot',
          ...(placed ? { actualSamples: String(placed.samples), sampleRate: placed.sampleRate } : {}),
          status: placed ? 'ready' : lost ? 'failed' : overlong.has(u.unitId) ? 'needs-fit' : 'draft',
          extensions: {
            [DUB_EXTENSION]: {
              translationUnitId: u.unitId,
              voice: voice.voice,
              voiceSource: voice.voiceSource,
              ...(placed ? { fit: placed.fit, tempo: placed.tempo, artifactId: placed.artifactId } : {}),
              ...(overlong.has(u.unitId) ? { overflowSeconds: aligned.overlong.find((o) => o.unitId === u.unitId)!.overflowSeconds } : {}),
              ...(lost ? { voiceUnavailable: { speakerId: lost.speakerId, voice: lost.voice, code: lost.code, reason: lost.reason } } : {}),
              ...(!placed && !lost && !overlong.has(u.unitId) ? { offTimeline: true } : {}),
            },
          },
        };
      }),
      ...script.stale.map((s) => ({
        id: `d-${s.unitId}`,
        sourceSentenceIds: [s.sentenceId],
        sourceFingerprint: fingerprints.get(s.sentenceId) ?? null,
        script: null,
        speakerBindingId: null,
        targetAnchor: { kind: 'sentence', speechRef: source.speechRef, sentenceId: s.sentenceId, edge: 'start' },
        timingPolicy: 'fit-fixed-slot',
        status: 'stale',
        extensions: { [DUB_EXTENSION]: { translationUnitId: s.unitId, staleReason: s.reason } },
      })),
    ],
    extensions: {
      [DUB_EXTENSION]: {
        voice: { providerId: params.voice.providerId, modelId: params.voice.modelId, voice: params.voice.voice },
        ...(synth.speakers?.length ? { speakers: synth.speakers } : {}),
        ...(mutedNow.length > 0 ? { mutedItemIds: mutedNow } : {}),
      },
    },
  };
  operations.push({
    type: 'putDocument',
    ref: 'plan',
    kind: 'dubbing-plan',
    name: J.planName({ language }).text,
    language,
    sourceDocument: { documentId: check.translationId },
    body,
    summary: {
      groupId,
      placed: aligned.placements.length,
      overlong: aligned.overlong.length,
      stale: script.stale.length,
      voiceUnavailable: unavailable.size,
    },
    extensions: { pipeline: { name: DUB_PIPELINE, jobId: parentJobId, actor: PIPELINE_ACTOR_ID } },
  });

  for (const itemId of mutedNow) operations.push({ type: 'setAudioMix', sequenceId, itemId, muted: true });
  if (params.originalAudio === 'duck' && (duckItems.length > 0 || duckVocals)) {
    operations.push({
      type: 'setDucking',
      sequenceId,
      name: J.duckingName({ language }).text,
      trigger: { kind: 'items', trackRefs: ['dub-track'] },
      target: { ...(duckItems.length > 0 ? { itemIds: duckItems } : {}), ...(duckVocals ? { trackRefs: ['dub-vocals-track'] } : {}) },
      depth: params.duckDb,
    });
  }
  return operations;
}

// ---- 句级重配的应用 ----

/**
 * 句级重配的应用：一笔事务里导入新的音频、删掉这几句在这一组里的旧实例、在原来的配音轨上放新的、写配音计划的新版本
 * （每句追加一版并设为当前版本）。合成了却放不下的句子不删旧的那一版，只在计划里记下这一版没放上。不新建轨道，
 * 不动原声的处理与别的句子。
 */
async function applyRegroup(
  videos: DubVideos,
  context: PipelineStepContext<FrozenDubParams>,
  regroup: FrozenDubRegroup,
): Promise<StepResult> {
  const { params, outputs, artifacts, progress, jobId, parentJobId, run } = context;
  progress(null, 'applying');
  const check = outputs['check-translation'] as CheckOutput;
  const script = await readArtifact<DubScript>(artifacts, check.artifactId);
  const aligned = await readArtifact<AlignResult>(artifacts, (outputs.align as AlignOutput).artifactId);
  const synth = await readArtifact<SynthResult>(artifacts, (outputs.synthesize as SynthOutput).artifactId);

  for (let attempt = 1; ; attempt++) {
    const state = videos.state(params.videoId);
    if (!state) throw new PipelineStepError('STALE_JOB_INPUT', J.videoClosedKept());
    if (state.revision !== aligned.videoRevision) {
      throw new PipelineStepError('STALE_JOB_INPUT', J.videoChanged(), {
        alignedRevision: aligned.videoRevision,
        currentRevision: state.revision,
      });
    }
    const sequence = videos.sequence(params.videoId, aligned.sequenceId);
    if (!sequence) throw new PipelineStepError('STALE_JOB_INPUT', J.sequenceGone());
    const record = state.documents[regroup.planDocumentId];
    if (!record) {
      throw new PipelineStepError('STALE_JOB_INPUT', J.planGone(), { documentId: regroup.planDocumentId });
    }
    const plan = await videos.document(params.videoId, record.id, record.currentRevision);
    const { operations, takes, trackId } = await regroupOperations({
      params,
      regroup,
      aligned,
      script,
      synth,
      check,
      sequence,
      record,
      body: plan.body,
      parentJobId,
      artifacts,
    });
    try {
      await videos.apply(params.videoId, {
        commandId: `cmd_${jobId}_apply_${attempt}`,
        expectedRevision: state.revision,
        operations,
        label: J.regroupLabel({ language: params.language }).text,
        run,
      });
      const output: ApplyOutput = { trackId, planDocumentId: record.id, groupId: regroup.groupId, items: aligned.placements.length, takes };
      return { output, result: { documentId: record.id, artifactId: (outputs.align as AlignOutput).artifactId } };
    } catch (error) {
      if (error instanceof RpcError && error.code === 'conflict' && attempt < APPLY_ATTEMPTS) continue;
      if (error instanceof PipelineStepError) throw error;
      throw new PipelineStepError('APPLY_FAILED', J.regroupRejected(), { cause: messageOf(error) });
    }
  }
}

/** 句级重配那一笔事务的全部操作，与每句新记下的版本号。 */
async function regroupOperations(input: {
  params: FrozenDubParams;
  regroup: FrozenDubRegroup;
  aligned: AlignResult;
  script: DubScript;
  synth: SynthResult;
  check: CheckOutput;
  sequence: { fps: { num: number; den: number }; items: SequenceItem[] };
  record: { id: Id; currentRevision: string; revisions: Record<string, { summary?: unknown }>; extensions?: Record<string, unknown> };
  body: unknown;
  parentJobId: Id;
  artifacts: ArtifactStore;
}): Promise<{ operations: EditOperation[]; takes: Record<Id, number>; trackId: Id }> {
  const { params, regroup, aligned, script, synth, check, sequence, record, parentJobId, artifacts } = input;
  const body = structuredClone(input.body) as PlanBody | null;
  if (body?.schema !== DUBBING_PLAN_SCHEMA || !Array.isArray(body.units)) {
    throw new PipelineStepError('INPUT_UNREADABLE', J.planNotSchema({ schema: DUBBING_PLAN_SCHEMA }), { documentId: record.id });
  }
  const units = body.units;
  const { groupId, seed } = regroup;
  const language = params.language;
  const sequenceId = aligned.sequenceId;
  const items = groupItems(sequence.items, groupId);
  const trackId = items[0]?.trackId ?? regroup.trackId;
  const unitOfItem = (item: AudioItem) => (item.extensions?.[DUB_EXTENSION] as { unitId?: unknown } | undefined)?.unitId;
  const scripted = new Map(script.units.map((u) => [u.unitId, u]));
  const placements = new Map<Id, Placement[]>();
  for (const p of aligned.placements) placements.set(p.unitId, [...(placements.get(p.unitId) ?? []), p]);
  const overlong = new Map(aligned.overlong.map((o) => [o.unitId, o.overflowSeconds]));
  const planJobId = (record.extensions?.pipeline as { jobId?: unknown } | undefined)?.jobId;
  const now = new Date().toISOString();
  const operations: EditOperation[] = [];
  const importRefs = new Map<string, string>();
  const removed: Id[] = [];
  const inserted: SequenceItemInput[] = [];
  const takes: Record<Id, number> = {};

  for (const unitId of regroup.units) {
    const index = units.findIndex((u) => planUnitId(u) === unitId);
    const unit = units[index];
    const text = scripted.get(unitId);
    // 过期的（没有合成）、计划里已经没有的：不动。
    if (!unit || !text) continue;
    const placed = placements.get(unitId) ?? [];
    const over = overlong.get(unitId);
    // 音色不可用、原句不在时间线上：没有新的一版。
    if (placed.length === 0 && over === undefined) continue;
    const dub: PlanUnitDub = { ...unitDub(unit) };
    const olds = items.filter((item) => unitOfItem(item) === unitId);
    const versions = takesOf(unit, dub, olds[0] ?? null, typeof planJobId === 'string' ? planJobId : null);
    // 当前版本的素材以实例为准：换下来之前记进那一版，之后能切回。
    const current = versions.find((t) => t.k === dub.take);
    if (current && olds[0] && !current.assetRef) current.assetRef = { id: olds[0].assetRef.id, revision: olds[0].assetRef.revision };
    const k = versions.reduce((max, t) => Math.max(max, t.k), 0) + 1;
    const first = placed[0];
    versions.push({
      k,
      seed,
      artifactId: first?.artifactId ?? synth.units[unitId]?.artifactId ?? null,
      samples: first?.samples ?? null,
      sampleRate: first?.sampleRate ?? null,
      fit: first?.fit ?? null,
      tempo: first?.tempo ?? null,
      ...(!first && over !== undefined ? { overflowSeconds: over } : {}),
      text: text.text,
      jobId: parentJobId,
      at: now,
    });
    dub.takes = versions;
    takes[unitId] = k;
    if (first) {
      const n = index + 1;
      const voice = synth.voices?.[unitId]?.voice ?? params.voice.voice;
      const like = olds[0];
      for (const old of olds) removed.push(old.id);
      for (const p of placed) {
        let ref = importRefs.get(p.artifactId);
        if (!ref) {
          const file = await artifacts.locate(p.artifactId);
          if (!file) throw new PipelineStepError('ARTIFACT_NOT_FOUND', J.artifactGone({ artifactId: p.artifactId }));
          ref = `dub-audio-${importRefs.size + 1}`;
          importRefs.set(p.artifactId, ref);
          operations.push({
            type: 'importAsset',
            path: file,
            name: J.takeAssetName({ language, n, k }).text,
            ref,
            storage: 'managed',
            provenance: {
              origin: 'generated',
              source: {
                pipeline: DUB_PIPELINE,
                jobId: parentJobId,
                providerId: params.voice.providerId,
                modelId: params.voice.modelId,
                voice,
                language,
                unitId,
                artifactId: p.artifactId,
                tempo: p.tempo,
                take: k,
                ...(seed !== null ? { seed } : {}),
              },
            },
          });
        }
        const { fromFrame, subframeOffset } = audioStart(p.startUs, sequence.fps);
        inserted.push({
          type: 'audio',
          trackId,
          assetImportRef: ref,
          fromFrame,
          subframeOffset,
          playDuration: { ticks: String(p.samples), timescale: p.sampleRate },
          timeMap: { kind: 'linear', sourceIn: { ticks: '0', timescale: 1 }, rate: { num: 1, den: 1 } },
          // 留下这句原来的音量与静音；淡入淡出跟着旧的长度，不留。
          mix: { volume: like?.mix.volume ?? 1, ...(like?.mix.muted ? { muted: true } : {}) },
          name: like?.name ?? J.itemName({ n }).text,
          role: 'dub',
          extensions: { ...(like?.extensions ?? {}), [DUB_EXTENSION]: { groupId, language, unitId, take: k, ...(seed !== null ? { seed } : {}) } },
        } as SequenceItemInput);
      }
      dub.take = k;
      if (seed !== null) dub.seed = seed;
      else delete dub.seed;
      dub.voice = voice;
      dub.fit = first.fit;
      dub.tempo = first.tempo;
      dub.artifactId = first.artifactId;
      delete dub.overflowSeconds;
      delete dub.offTimeline;
      delete dub.voiceUnavailable;
      unit.status = 'ready';
      unit.actualSamples = String(first.samples);
      unit.sampleRate = first.sampleRate;
      unit.script = { text: text.text, revision: check.revision, reviewed: false };
      unit.sourceFingerprint = text.fingerprint;
    } else if (olds.length === 0) {
      // 放不下、之前也没有放上的一版：照第一次配音的样子标成要适配。
      unit.status = 'needs-fit';
      dub.overflowSeconds = over;
      unit.script = { text: text.text, revision: check.revision, reviewed: false };
      unit.sourceFingerprint = text.fingerprint;
    }
    unit.extensions = { ...(unit.extensions ?? {}), [DUB_EXTENSION]: dub };
  }

  if (removed.length > 0) operations.push({ type: 'deleteItems', sequenceId, itemIds: removed });
  if (inserted.length > 0) operations.push({ type: 'insertItems', sequenceId, items: inserted });
  const previous = (record.revisions[record.currentRevision]?.summary ?? {}) as Record<string, unknown>;
  operations.push({
    type: 'putDocument',
    documentId: record.id,
    kind: 'dubbing-plan',
    body,
    summary: {
      ...previous,
      groupId,
      placed: items.length - removed.length + inserted.length,
      overlong: units.filter((u) => u.status === 'needs-fit').length,
      stale: units.filter((u) => u.status === 'stale').length,
      voiceUnavailable: units.filter((u) => unitDub(u).voiceUnavailable !== undefined).length,
    },
  });
  return { operations, takes, trackId };
}

/** 一句已有的版本；旧的计划没有版本时，已经放上时间线的那一版补记为第 1 版（当前版本）。 */
function takesOf(unit: PlanUnit, dub: PlanUnitDub, current: AudioItem | null, planJobId: Id | null): DubPlanTake[] {
  if (Array.isArray(dub.takes)) return dub.takes.map((t) => ({ ...t }));
  const artifactId = typeof dub.artifactId === 'string' ? dub.artifactId : null;
  if (!current && !artifactId) return [];
  dub.take = 1;
  const fit = dub.fit === 'fit' || dub.fit === 'tempo' || dub.fit === 'extended' ? dub.fit : null;
  return [
    {
      k: 1,
      seed: typeof dub.seed === 'number' ? dub.seed : null,
      artifactId,
      ...(current ? { assetRef: { id: current.assetRef.id, revision: current.assetRef.revision } } : {}),
      samples: typeof unit.actualSamples === 'string' ? Number(unit.actualSamples) : null,
      sampleRate: typeof unit.sampleRate === 'number' ? unit.sampleRate : null,
      fit,
      tempo: typeof dub.tempo === 'number' ? dub.tempo : null,
      text: typeof unit.script?.text === 'string' ? unit.script.text : null,
      jobId: planJobId,
      at: null,
    },
  ];
}

/** 这个实例的声音来自分离的那份素材（音频实例，或带声音的视频实例）。 */
function stemSource(sequence: { items: SequenceItem[] }, itemId: Id, separated: SeparateOutput): boolean {
  const item = sequence.items.find((i) => i.id === itemId);
  return !!item && (item.type === 'audio' || item.type === 'video') && item.assetRef.id === separated.assetId;
}

/**
 * 换成分轨的原声实例各放一段分离出来的背景或人声：位置、源区间与音量照抄（分轨与源素材等长、同一时钟）。
 * 分轨也带这一组的标记（`stem`）：「只要原声」去掉它，「只要这一组配音」不含它，移除这组配音时一起拿掉。
 */
function stemItems(
  sequence: { fps: { num: number; den: number }; items: SequenceItem[] },
  itemIds: readonly Id[],
  groupId: string,
  stem: 'background' | 'vocals',
): SequenceItemInput[] {
  const extensions = { [DUB_EXTENSION]: { groupId, stem } };
  const base = {
    type: 'audio',
    trackRef: `dub-${stem}-track`,
    assetImportRef: `dub-${stem}`,
    role: stem === 'background' ? 'music' : 'a-roll',
    extensions,
  };
  const wanted = new Set(itemIds);
  const out: SequenceItemInput[] = [];
  for (const item of sequence.items) {
    if (!wanted.has(item.id)) continue;
    if (item.type === 'audio') {
      out.push({
        ...base,
        fromFrame: item.fromFrame,
        subframeOffset: item.subframeOffset,
        playDuration: item.playDuration,
        timeMap: item.timeMap,
        mix: { volume: item.mix.volume },
      } as SequenceItemInput);
    } else if (item.type === 'video') {
      const span = item.span;
      out.push({
        ...base,
        fromFrame: span.fromFrame,
        subframeOffset: { ticks: '0', timescale: 1 },
        playDuration: { ticks: String(span.durationFrames * sequence.fps.den), timescale: sequence.fps.num },
        timeMap: item.timeMap,
        mix: { volume: item.embeddedAudio.volume },
      } as SequenceItemInput);
    }
  }
  return out;
}

/** 序列上的精确起点（微秒）拆成「粗帧 + 余数」（视频格式规范 §2.10），余数落在 [0, 一帧)。 */
export function audioStart(
  startUs: number,
  fps: { num: number; den: number },
): { fromFrame: number; subframeOffset: { ticks: string; timescale: number } } {
  // 起点 = startUs / 1e6 秒；帧 = floor(startUs · num / (den · 1e6))。
  const us = BigInt(startUs);
  const num = BigInt(fps.num);
  const den = BigInt(fps.den);
  const million = 1_000_000n;
  const fromFrame = (us * num) / (den * million);
  // 余数 = startUs/1e6 − fromFrame·den/num = (startUs·num − fromFrame·den·1e6) / (1e6·num)
  let ticks = us * num - fromFrame * den * million;
  let timescale = million * num;
  const g = gcd(ticks, timescale);
  if (g > 1n) {
    ticks /= g;
    timescale /= g;
  }
  return { fromFrame: Number(fromFrame), subframeOffset: { ticks: ticks.toString(), timescale: Number(timescale) } };
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a === 0n ? 1n : a;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

function extensionOf(file: string): ArtifactExtension {
  return path.extname(file).slice(1).toLowerCase() as ArtifactExtension;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asStepError(error: unknown): PipelineStepError {
  if (error instanceof PipelineStepError) return error;
  if (error instanceof RpcError) {
    const code = (error.details as { code?: unknown } | undefined)?.code;
    return new PipelineStepError(typeof code === 'string' ? code : 'INTERNAL', error.message, error.details as Record<string, unknown>);
  }
  return new PipelineStepError('INTERNAL', messageOf(error));
}
