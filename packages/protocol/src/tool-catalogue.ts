import type { Id } from './domain.ts';
import type { ModelServiceCapability } from './models.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 工具目录（架构设计 §7.9；产品设计 §2.7）：固定流程与直接任务在产品上的目录。工具不是另一套执行机制：每个工具对应一个
 * 固定流程（`pipelines.start`）或一种直接提交的 Job（`models.*`），目录只声明它接受什么输入、产出什么、依赖什么。
 *
 * - 目录是一份静态注册表（`@baocut/jobs` 的 `TOOL_CATALOGUE`），加上 Runtime 此刻的可用性判断（`tools.list`）。
 * - 候选输入（`tools.candidates`）来自内容索引（§5.11）与 Space 目录（§5.7），不打开视频。
 */

/**
 * 工具的组（架构设计 §7.9，产品设计 §2.7）：`speech` 语音与字幕、`text-image` 文字与图片、`video-file` 视频文件。
 * 按用户要做的事分组，不按结果写进视频还是成为产物分（那是每个工具的 `results`）。
 */
export const TOOL_CATEGORIES = ['speech', 'text-image', 'video-file'] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** 输入的种类：本机文件、链接、一段文字、Space 里的视频、一份文档（流程工具指视频里的文档，直接任务指 Space 里的文档或字幕条目，作 `material`）。 */
export const TOOL_INPUT_KINDS = ['file', 'link', 'text', 'video', 'document'] as const;
export type ToolInputKind = (typeof TOOL_INPUT_KINDS)[number];

/** 结果的种类：写进视频（新的文稿、译文、配音组，或新建的视频），或产物（文件、生成的音频与图片）。 */
export type ToolResultKind = 'video' | 'artifact';

/** 直接提交的 Job 用的方法。 */
export type ToolJobMethod = 'models.transcribe' | 'models.synthesizeSpeech' | 'models.generateImage' | 'models.generateText';

/**
 * 怎么执行：
 * - `pipeline`：`pipelines.start` 启动这个流程；`params` 是这个工具固定带上的参数（例如转码的 `action`），其余由客户端给；
 * - `job`：直接提交一种模型任务。
 */
export type ToolExecution =
  | { kind: 'pipeline'; method: 'pipelines.start'; pipeline: string; params?: Record<string, unknown> }
  | { kind: 'job'; method: ToolJobMethod; capability: ModelServiceCapability };

/**
 * 候选输入的规则（`tools.candidates`）：
 * - `videos`：回收站之外的全部视频（转录的目标、链接导入写进已有的视频）；
 * - `videos-with-transcript`：有文稿的视频，每个视频列出可选的文稿（翻译字幕、翻译配音）。
 */
export type ToolCandidateRule = 'videos' | 'videos-with-transcript';

/** 注册表里的一个工具（静态声明，不随 Runtime 的状态变）。 */
export interface ToolDefinition {
  /** 稳定的 ID（小写字母与连字符），界面、CLI 与产物的来源都用它。 */
  id: string;
  label: string;
  description: string;
  category: ToolCategory;
  inputs: ToolInputKind[];
  results: ToolResultKind[];
  execution: ToolExecution;
  /**
   * 按输入种类换执行方式：同一个工具对不同的输入由不同的流程完成（例如翻译字幕：视频里的文稿走 `translate`，
   * 字幕文件走 `translate-subtitles`）。没列出的输入种类用 `execution`。
   */
  executionByInput?: Partial<Record<ToolInputKind, ToolExecution>>;
  /** 一定要用的能力。 */
  capabilities: ModelServiceCapability[];
  /** 只在某些输入或参数下才用的能力（例如配音缺译文时的文本生成）。没有配置时工具照样可用，`limitations` 里说明。 */
  optionalCapabilities: ModelServiceCapability[];
  /** 一定要用的受管外部工具（§12.9），按工具名。 */
  externalTools: string[];
  /** 只在某些输入下才用的外部工具（例如转录的链接输入要下载工具）。 */
  optionalExternalTools: string[];
  /** 要不要联网下载（不是模型调用）：`required` 一定要，`optional` 只在链接输入时要。严格离线（`offline.strict`）时据此判断。 */
  network: 'required' | 'optional' | 'none';
  /** 候选输入的规则；不接受视频输入的工具为 null。 */
  candidates: ToolCandidateRule | null;
}

/**
 * 不可用的一个原因，`code` 沿用已有的错误码（命令与协议规范 §11.3）：`CAPABILITY_NOT_CONFIGURED`、`TOOL_NOT_INSTALLED`、
 * `TOOL_UNAVAILABLE`、`TOOL_OUTDATED`、`TOOL_CONSENT_REQUIRED`、`TOOL_UPDATING`、`OFFLINE_STRICT`；浏览器会话里执行方法不在白名单时
 * `WEB_METHOD_NOT_ALLOWED`。
 */
export interface ToolProblem {
  code: string;
  /** 给人看的一句话（Runtime 的语言）；界面用 `localizeText(message, messageRef)` 按自己的语言显示。 */
  message: string;
  messageRef?: MessageRef;
  /** 能力没有配置时：哪种能力与 `CAPABILITY_NOT_CONFIGURED` 的 `reason`。 */
  capability?: ModelServiceCapability;
  reason?: string;
  /** 外部工具的问题：哪个工具。 */
  tool?: string;
  /** 怎么补救（给人看的一句话）；没有时不给。 */
  remedy?: string;
  remedyRef?: MessageRef;
}

/** `tools.list` 的一项：声明加上此刻的可用性。 */
export interface ToolStatus extends ToolDefinition {
  /** 此刻能不能启动：`problems` 为空。 */
  available: boolean;
  /** 不能启动的原因（一定要的能力、外部工具、联网）。 */
  problems: ToolProblem[];
  /** 不影响启动、但某些输入或参数用不了的原因（可选的能力或外部工具）。 */
  limitations: ToolProblem[];
}

export interface ToolsListResult {
  tools: ToolStatus[];
  /**
   * 保存位置（架构设计 §7.9「保存位置」）：工具没有视频的结果落在这里的本机绝对路径（设置 `downloads.directory`，
   * 没有设置时是主机的下载文件夹）。工具页显示它，直接任务把它作为 `saveDir` 传入。带本机路径，Web 服务不给。
   */
  saveDirectory?: string;
}

// ---- 内容索引里的视频事实（§5.11）：候选输入用，不打开视频 ----

/** 一份文稿（`speech` 文档）。 */
export interface VideoTranscriptFact {
  documentId: Id;
  name: string;
  language: string | null;
  /** 有可见的词，且没有一个词的时间是估计的或缺失的（`timingQuality`）。 */
  wordTiming: boolean;
  /** 在根序列上投影得出内容（对应的素材在时间线上）。 */
  onTimeline: boolean;
}

/** 一份译文（`translation` 文档）。 */
export interface VideoTranslationFact {
  documentId: Id;
  name: string;
  /** 目标语言。 */
  language: string | null;
  /** 译自哪份文稿；记不出来时 null。 */
  sourceDocumentId: Id | null;
  units: number;
  /**
   * 过期的单元数：标成过期、原文的句子不在了、原文改过（指纹不符）、译文为空。术语表改过（`glossary-changed`）要读用户库，
   * 索引里不判断，配音时照样会查。
   */
  staleUnits: number;
}

/** 一组配音（同一次配音写进的配音计划与实例）。 */
export interface VideoDubGroupFact {
  groupId: string;
  language: string | null;
  /** 配音计划（`dubbing-plan` 文档）；只有实例时 null。 */
  planDocumentId: Id | null;
  /** 这组配音用的译文与译文对应的文稿；记不出来时 null。 */
  translationId: Id | null;
  transcriptId: Id | null;
  /** 时间线上属于这一组的配音实例数。 */
  items: number;
}

// ---- tools.candidates ----

/** `tools.candidates` 一页最多多少个视频。 */
export const TOOL_CANDIDATES_MAX_LIMIT = 500;

export interface ToolCandidatesParams {
  toolId: string;
  /** 只列这个项目的视频；`null` 是不属于任何项目的视频。不给时不按项目筛。 */
  projectId?: Id | null;
  /** 上一页结果里的 `nextCursor`。 */
  cursor?: string;
  /** 默认 100，最多 `TOOL_CANDIDATES_MAX_LIMIT`。 */
  limit?: number;
}

/** 视频里一份可选的文稿，带上已有的译文与配音组（工具据此提示「已经有英文译文」）。 */
export interface ToolCandidateDocument extends VideoTranscriptFact {
  kind: 'speech';
  translations: Array<Pick<VideoTranslationFact, 'documentId' | 'language' | 'units' | 'staleUnits'>>;
  dubs: Array<Pick<VideoDubGroupFact, 'groupId' | 'language' | 'translationId'>>;
}

export interface ToolCandidate {
  entryId: Id;
  /** 还没有索引、目录里也没记下时 null。 */
  videoId: Id | null;
  name: string;
  projectId: Id | null;
  lastActivityAt: string;
  /**
   * 索引是当前的。false：还没有索引、排队重读（旧版本的缓存、视频改过）或读失败：`documents` 可能不全，
   * 有文稿才列的工具也照样列出它（不能断定没有文稿）。
   */
  indexed: boolean;
  /** 索引时的视频版本；没有索引时 null。 */
  indexedRevision: string | null;
  /** 这个工具可选的文档（`videos-with-transcript` 是文稿）；`videos` 规则的工具为空。 */
  documents: ToolCandidateDocument[];
}

export interface ToolCandidatesResult {
  toolId: string;
  /** 按最近活动从新到旧。 */
  candidates: ToolCandidate[];
  /** 符合条件的视频总数（不止这一页）。 */
  total: number;
  nextCursor: string | null;
  /** 与 `space.search` 相同：没有待索引的视频、首次扫描已完成、索引可用。 */
  complete: boolean;
  pendingVideos: number;
  scanning: boolean;
}
