import type { Id } from './domain.ts';
import type { SpaceSearchDocumentKind } from './space.ts';
import type { MediaTime } from './video.ts';

/**
 * 本机语义检索（EmbeddingGemma 2 检索集成方案 v0.1 §10–§11，创作辅助集成设计 §3）的公开合同：`space.searchV2`、
 * `space.indexStatus`、`space.indexBuild`、`space.resolveSearchHit` 与对应的智能体工具。`space.search` 的旧合同不变（§11.1）。
 *
 * 向量与索引是派生缓存（§8）：不随成片导出、不同步云端。这里只有过线的形状，排序分数只用于排序，不是置信度（§10.3）。
 */

/** `space.searchV2` 最多返回多少条命中。 */
export const SPACE_SEARCH_V2_MAX_LIMIT = 100;
/** 查询文字的上限（字符）：超过时报 `INPUT_TOO_LONG`，不截断后伪装正常（§10.1）。 */
export const SEMANTIC_QUERY_MAX_CHARS = 1000;

/** 检索通道：讲话内容（文稿、字幕、译文、章节）、画面、声音（§6.4，三路分别存向量，不默认融合）。 */
export type SemanticChannel = 'text' | 'visual' | 'audio';
export const SEMANTIC_CHANNELS: readonly SemanticChannel[] = ['text', 'visual', 'audio'];

/** 「精确文字」保留旧语义（全部词都出现）；「语义」只走向量；「综合」两路按名次融合（§10.2）。 */
export type SemanticSearchMode = 'lexical' | 'semantic' | 'hybrid';

/** 实际走了哪条路（§11.5、创作辅助集成设计 §3.11）：没有语义索引时退回字面匹配，结果写明。 */
export type SemanticEffectiveMode = 'semantic' | 'hybrid' | 'lexical' | 'none';

/**
 * 标准错误与降级原因（§11.5）。作为 `RpcError.details.reason` 过线，也出现在结果的 `degraded.reason` 里。
 * 值就是规范里的名字：稳定的英文标识，给人看的说明另取（`semantic-copy`）。
 */
export type SemanticReason =
  | 'MODEL_NOT_INSTALLED'
  | 'MODEL_UNAVAILABLE'
  | 'PROFILE_INCOMPATIBLE'
  | 'INPUT_TOO_LONG'
  | 'SOURCE_MISSING'
  | 'INDEX_NOT_READY'
  | 'INDEX_PARTIAL'
  | 'STALE_REVISION'
  | 'CURSOR_STALE'
  | 'SEARCH_CANCELLED'
  | 'RESOURCE_EXHAUSTED'
  | 'APPEARANCE_UNAVAILABLE'
  /** 这一路通道在这个版本还没有索引实现（例如画面、声音的索引尚未建立）。 */
  | 'CHANNEL_UNAVAILABLE';

export const SEMANTIC_REASONS: readonly SemanticReason[] = [
  'MODEL_NOT_INSTALLED',
  'MODEL_UNAVAILABLE',
  'PROFILE_INCOMPATIBLE',
  'INPUT_TOO_LONG',
  'SOURCE_MISSING',
  'INDEX_NOT_READY',
  'INDEX_PARTIAL',
  'STALE_REVISION',
  'CURSOR_STALE',
  'SEARCH_CANCELLED',
  'RESOURCE_EXHAUSTED',
  'APPEARANCE_UNAVAILABLE',
  'CHANNEL_UNAVAILABLE',
];

// ---- §11.2 查询 ----

export type SemanticQuery =
  | { kind: 'text'; text: string }
  /** 已授权素材的引用（Space 条目 ID）：不接受磁盘路径或 URL（§11.2）。 */
  | { kind: 'image'; referenceId: Id }
  | { kind: 'audio'; referenceId: Id };

export interface SpaceSearchV2Params {
  query: SemanticQuery;
  mode: SemanticSearchMode;
  /** 至少一路；缺省 `['text']`。 */
  channels?: SemanticChannel[];
  /** 只找这个项目的视频；`null` 是不属于任何项目的视频；省略是调用方能看到的全部（§8.3）。 */
  projectId?: Id | null;
  videoIds?: Id[];
  /** 只找这几类文字证据（讲话内容通道）。 */
  kinds?: SpaceSearchDocumentKind[];
  /** `source` 是原素材上的位置，`sequence` 是当前时间线投影（§7）。缺省 `sequence`。 */
  view?: 'source' | 'sequence';
  /** 成片呈现索引还没有（§7.3）：给 `rendered` 时报 `APPEARANCE_UNAVAILABLE`，不静默改搜原素材。 */
  appearance?: 'original' | 'rendered';
  /** 默认 20，最多 `SPACE_SEARCH_V2_MAX_LIMIT`。 */
  limit?: number;
  /** 上一页结果的 `nextCursor`。索引或范围变了时报 `CURSOR_STALE`（§9.5）。 */
  cursor?: string;
}

// ---- §11.3 结果 ----

/** 证据类别（§6.1）：原话、字幕、译文、章节摘要；摘要只作导航，不当原话引用。 */
export type SemanticEvidenceType = 'transcript' | 'caption' | 'translation' | 'summary' | 'visual' | 'audio';

/** 精确锚点（§12.1）：`MediaTime` 是身份，秒数只用于显示与旧协议兼容。 */
export interface SearchHitAnchor {
  clock: 'source' | 'sequence';
  start: MediaTime;
  end: MediaTime;
  startSec: number;
  endSec: number;
  /** 文字命中按句子是精确的；画面、声音窗口只是候选区间（§6.2、§12.2）。 */
  boundary: 'exact' | 'window';
}

/** 命中的对象：文档里的句群（讲话内容通道）。画面与声音命中（素材片段）在对应通道接入后加入。 */
export interface SemanticDocumentTarget {
  kind: 'document-span';
  videoId: Id;
  documentId: Id | null;
  documentKind: SpaceSearchDocumentKind;
  /** 稳定句子身份（`baocut.transcript` 的句子 ID）；章节命中为空。 */
  sentenceIds: string[];
}

export interface SemanticAssetTarget {
  kind: 'asset-span';
  assetId: Id;
  /** 素材所在的视频；素材库里的独立素材为 null，不伪造视频（§11.3）。 */
  videoId: Id | null;
  representation: 'keyframe' | 'clip' | 'audio-window';
}

export type SemanticSearchTarget = SemanticDocumentTarget | SemanticAssetTarget;

/** 命中可以做什么：预览、在当前时间线打开、作为引用交给智能体或写作。原素材不在时间线上时没有 `open-in-timeline`（§12.3）。 */
export type SemanticHitAction = 'preview' | 'open-in-timeline' | 'cite' | 'derive';

export interface SpaceSearchV2Hit {
  /** 本次结果里的命中身份（索引世代 + chunk），`space.resolveSearchHit` 用它。 */
  hitId: string;
  target: SemanticSearchTarget;
  videoName: string | null;
  entryId: Id | null;
  projectId: Id | null;
  /** 命中的通道。 */
  matchChannels: SemanticChannel[];
  /** 命中的召回路（综合模式下可能两路都命中）。 */
  matchedBy: Array<'lexical' | 'semantic'>;
  evidenceType: SemanticEvidenceType;
  /** 原文（不清洗）；太长时截取命中附近。 */
  snippet: string;
  /** 字面命中的位置（UTF-16 `[开始, 结束)`）；纯语义命中为空，不假高亮（§11.3）。 */
  highlights: [number, number][];
  speaker: string | null;
  language: string | null;
  anchor: SearchHitAnchor;
  /** 索引时的视频版本；与当前版本不同时打开前要重新解析（`needsResolve`）。 */
  indexedRevision: string;
  needsResolve: boolean;
  /** 章节标题（有章节时）。 */
  chapter: { id: string; title: string } | null;
  /** 只用于排序的分数（§10.2：本次查询内的 z 分数加字面加分），不是置信度，界面不显示为百分比。 */
  rank: number;
  /**
   * 弱命中：只有向量一路命中，且 z 低于 `strongZ` 或分数不到第一名的 `strongRatio` 倍（`semantic-thresholds.json`，未校准）。
   * 服务端只标出、不藏起来；调用方据此判断「可能沾边」，不当作答案的依据，界面可以折在后面。字面命中从不标弱。
   */
  weak: boolean;
  actions: SemanticHitAction[];
}

/** 一路通道在范围内的覆盖（§11.3）：`complete` 只指所请求索引的就绪程度，不表示搜尽所有相关内容。 */
export interface SemanticCoverage {
  channel: SemanticChannel;
  /** 范围内应该有这路索引的对象数（例如有文稿的视频）。 */
  eligible: number;
  indexed: number;
  pending: number;
  failed: number;
  /** 没有输入（例如没有文稿的视频）。 */
  missingInput: number;
  /** 不在设置「语义索引 › 项目」里的视频：不建这路索引，只能字面检索。不计入 `eligible`，也不让结果不完整。 */
  excluded: number;
  /** 已建索引里有落后于当前版本的。 */
  stale: number;
  knownScopeComplete: boolean;
}

export interface SpaceSearchV2Result {
  hits: SpaceSearchV2Hit[];
  effectiveMode: SemanticEffectiveMode;
  /** 退回或部分可用时的原因（§11.5）；纯语义请求不可用时不返回结果而是报错。 */
  degraded: { reason: SemanticReason } | null;
  coverage: SemanticCoverage[];
  /** 融合规则与权重的版本（§10.2）。 */
  rankingVersion: string;
  nextCursor: string | null;
  truncated: boolean;
}

// ---- §11.4 其他接口 ----

export interface SemanticIndexStatusParams {
  projectId?: Id | null;
  videoIds?: Id[];
}

/** 本机语义能力的总体状态（设置 › 语义索引，创作辅助集成设计 §2.11）。 */
export interface SemanticIndexStatus {
  /** 可用的模型包；没有装时 null。 */
  model: {
    bundleId: string;
    label: string;
    encoderProfileId: string;
    embeddingSpaceId: string;
    /** 实际后端设备（CPU / GPU），还没加载过时 null。 */
    device: string | null;
  } | null;
  /** 不可用时的原因。 */
  reason: SemanticReason | null;
  /** 各通道是否启用（设置里开关）。 */
  channels: Record<SemanticChannel, { enabled: boolean; available: boolean }>;
  coverage: SemanticCoverage[];
  /** 派生库在磁盘上的大小（字节）。 */
  cacheBytes: number;
  /** 构建停着（用户暂停，或因为供电、温度自动停下）。 */
  paused: boolean;
  /** 为什么停着；没停时 null（规范 §16.1）。用户暂停优先于自动停下。 */
  pauseReason: SemanticPauseReason | null;
  /** 范围内各路还要建多久（规范 §13.2）：开着的通道估待建的；画面没开时估打开之后要建的（`ifEnabled`）。 */
  estimates: SemanticEstimate[];
  /** 正在建索引的任务。 */
  jobId: Id | null;
}

/** `user`：用户暂停（记在库里，重启后仍停着）；`battery`：在用电池（设置 `semantic.pauseOnBattery`）；`thermal`：系统因过热降频。 */
export type SemanticPauseReason = 'user' | 'battery' | 'thermal';

/** 一路索引还要建的量与时间（规范 §13.2）。 */
export interface SemanticEstimate {
  channel: SemanticChannel;
  /** 这一路没开：估的是打开之后要建的量。 */
  ifEnabled: boolean;
  /** 要建（含落后于当前版本、要重建）的视频数。 */
  videos: number;
  /** 其中时长未知的视频数：没算进时长、帧数与时间。 */
  unknownDuration: number;
  /** 这些视频的时间线总时长（秒）。 */
  sourceSeconds: number;
  /** 画面：要取的帧数（按时间线时长估）；文字 null。 */
  frames: number | null;
  /** 估计用时（秒）；还没有可用的速度（文字没量过、没装能用的模型包）时 null。 */
  seconds: number | null;
  /** `measured`：这台机器上量过的速度；`default`：内置的参考速度（只有画面有）。 */
  basis: 'measured' | 'default' | null;
  /** 画面：新增向量约多少字节（不含可以清掉的关键帧缓存）；文字 null。 */
  vectorBytes: number | null;
}

export interface SemanticIndexBuildParams {
  /** 省略是调用方能看到的全部已登记视频。 */
  projectId?: Id | null;
  videoIds?: Id[];
  channels?: SemanticChannel[];
  /** 丢掉已有向量、按当前 profile 全部重算。 */
  rebuild?: boolean;
}

export interface SemanticIndexBuildResult {
  jobId: Id | null;
  /** 计划处理的视频数。 */
  planned: number;
}

export interface SemanticIndexControlParams {
  action: 'pause' | 'resume' | 'clear';
}

/** 控制之后的状态：是否暂停（清理不改变暂停状态）。 */
export interface SemanticIndexControlResult {
  paused: boolean;
}

/** `space.citations`：写作结果文档条目的出处旁文件；条目没有出处或旁文件读不出时为 null。 */
export interface SpaceCitationsResult {
  citations: CitationsFile | null;
}

/**
 * `space.relevantChunks`：写作「按主题」挑出的句群的预览（创作辅助集成设计 §2.2「查看挑选的段落」）。与 `ai-tool` 流程的
 * `selection` 同一个查询（按时间排、前后各带一句、只要讲话），用户勾掉的句群 `chunkId` 作为 `selection.exclude` 交回。
 */
export interface SpaceRelevantChunksParams {
  intent: string;
  /** 这几部视频（第一部是写作的视频）。 */
  videoIds: Id[];
  /** 默认 24，上限 `AI_TOOL_TOPIC_MAX_CHUNKS`。 */
  limit?: number;
}

export interface SpaceRelevantChunk {
  chunkId: string;
  videoId: Id;
  chapter: string | null;
  /** 时间线上的起止（秒）；不在时间线上的讲话是源时间（`clock: 'source'`），写作时不用。 */
  clock: 'sequence' | 'source';
  start: number;
  end: number;
  text: string;
  /** 与意图只是勉强相关（低于未校准的弱命中阈值）。 */
  weak?: boolean;
}

export interface SpaceRelevantChunksResult {
  effectiveMode: SemanticEffectiveMode;
  reason: SemanticReason | null;
  /** 覆盖的章节标题；索引过期时 `stale`（结果可能不含最近的修改）。 */
  coverage: { chapters: string[]; stale: boolean };
  chunks: SpaceRelevantChunk[];
}

/** `space.relatedVideos` 缺省列几部。 */
export const SPACE_RELATED_VIDEOS_DEFAULT_LIMIT = 5;
/** `space.relatedVideos` 最多列几部。 */
export const SPACE_RELATED_VIDEOS_MAX_LIMIT = 20;

/**
 * `space.relatedVideos`：讲相近内容的视频（创作辅助集成设计 §2.4「相关视频」）。Space 查看框打开视频时才算，只列主体看得到的
 * 别的视频，不列这部视频切出的短视频与它的来源视频（内容本来就重叠）。
 */
export interface SpaceRelatedVideosParams {
  /** 视频条目。 */
  entryId: Id;
  /** 缺省 `SPACE_RELATED_VIDEOS_DEFAULT_LIMIT`，上限 `SPACE_RELATED_VIDEOS_MAX_LIMIT`。 */
  limit?: number;
}

export interface SpaceRelatedVideo {
  entryId: Id;
  /** 内容索引还没读到的视频没有。 */
  videoId: Id | null;
  name: string;
  /** 按意思找到时：那部视频里离这部视频整体最近的一段讲话（`clock` 同检索命中，起止是秒）。按名字时 null。 */
  passage: { clock: 'sequence' | 'source'; start: number; end: number; text: string } | null;
  /** 按名字时：两个名字里共同的那个词。按意思时 null。 */
  sharedName: string | null;
}

export interface SpaceRelatedVideosResult {
  /** `semantic`：按整部视频讲话的意思（只看文字通道）；`name`：语义一路用不了，退回名字相近（§2.13）。 */
  basis: 'semantic' | 'name';
  /**
   * `name` 时是退回的原因（`MODEL_NOT_INSTALLED`、`INDEX_NOT_READY`、`PROFILE_INCOMPATIBLE`…）；`semantic` 时范围内的索引
   * 不完整是 `INDEX_PARTIAL`（可能漏了还没建好索引的视频），否则 null。
   */
  reason: SemanticReason | null;
  /** 最近的在前；不给分数。 */
  videos: SpaceRelatedVideo[];
}

// ---- 编辑辅助：术语候选与重录候选（创作辅助集成设计 §2.5、§2.7、§3.7、§3.8）----

/** `edits.glossaryCandidates` / `edits.retakeCandidates`：只读，不改视频；`documentId` 不给时取视频里唯一的一份转写。 */
export interface EditCandidatesParams {
  videoId: Id;
  documentId?: Id;
}

/** 一处出现：时间线上的起止（秒）、涉及的词与一对一的改法（`edits.apply` 的 `updateWords`，词数不变）。 */
export interface GlossaryOccurrence {
  wordIds: Id[];
  start: number;
  end: number;
  words: Array<{ id: Id; text: string }>;
}

/**
 * 一条术语候选：文稿里的写法 `from` 疑似是术语表条目 `to` 的误听。`exact` 是术语表里记下的误听写法（或只差大小写、空格）；
 * `semantic` 是语义相近且字面相近（字符相似度复核过）的写法。不自动应用。
 */
export interface GlossaryCandidate {
  id: string;
  from: string;
  to: string;
  glossaryId: Id;
  glossaryName: string;
  mode: 'exact' | 'semantic';
  /** 语义候选的相似度（只排序，阈值未校准）。 */
  score?: number;
  occurrences: GlossaryOccurrence[];
}

/** 从文稿发现的术语：写法不一致（`forms` 两种以上）或反复出现的专有名词，提示加入术语表（加入是 `library.put`）。 */
export interface GlossaryDiscovery {
  key: string;
  /** 建议的写法（出现最多的）。 */
  source: string;
  forms: Array<{ text: string; count: number }>;
  count: number;
}

export interface GlossaryCandidatesResult {
  documentId: Id;
  /** `semantic`：做了语义与字面两步；`lexical`：只按术语表里记下的误听写法与大小写、空格变体找（原因见 `reason`）。 */
  effectiveMode: 'semantic' | 'lexical';
  reason: SemanticReason | null;
  /** 视频转写启用的术语表数；0 时没有候选，只有发现。 */
  glossaries: number;
  candidates: GlossaryCandidate[];
  discovered: GlossaryDiscovery[];
}

/** 两遍之间的字面差异：数字、否定词、专有名词。 */
export type RetakeDifference = 'number' | 'negation' | 'name';

export interface RetakeTake {
  sentenceId: string;
  wordIds: Id[];
  /** 时间线上的起止（秒）。 */
  start: number;
  end: number;
  text: string;
  /** 句末有终止标点。 */
  complete: boolean;
  /** 这一遍里有、别的遍里没有的数字、否定词与专有名词（界面高亮）。 */
  marks: string[];
}

/**
 * 一组重录：相邻窗口内语义几乎相同的几遍（按时间）。`differ` 时数字、否定词或专有名词不同，列在「相似但有差异」里；
 * `keep` 是建议保留的那一遍的下标（只建议，不预勾）。
 */
export interface RetakeGroup {
  id: string;
  takes: RetakeTake[];
  keep: number;
  differ: boolean;
  differences: RetakeDifference[];
}

export interface RetakeCandidatesResult {
  documentId: Id;
  /** `semantic`：语义相似；`lexical`：只找文字完全相同的（原因见 `reason`）。 */
  effectiveMode: 'semantic' | 'lexical';
  reason: SemanticReason | null;
  groups: RetakeGroup[];
}

export interface SemanticResolveParams {
  hitId: string;
}

/** 按视频当前版本重新解析的位置（§12.2）：一个源区间可能出现多次，跨剪口时拆成几段；没有就是空数组。 */
export interface SemanticResolveResult {
  status: 'resolved' | 'not-in-timeline' | 'gone' | 'unsupported';
  videoId: Id | null;
  revision: string | null;
  spans: Array<{ clock: 'sequence' | 'source'; startSec: number; endSec: number; sentenceIds: string[]; text: string }>;
  boundary: 'exact' | 'window';
}

// ---- 写作出处（创作辅助集成设计 §3.4）----

/** 写作结果的出处旁文件（`baocut.citations/1`）：正文的每个段落 → 它依据的原句。 */
export const CITATIONS_SCHEMA = 'baocut.citations/1';

/** 一处出处：稳定句子身份是身份，时间只用于显示与跳转（按 `clock` 计的秒，写作时的版本）。 */
export interface CitationAnchor {
  videoId: Id;
  documentId: Id | null;
  /** 稳定句子身份（`s-<首词 ID>`）。 */
  sentenceIds: string[];
  clock: 'source' | 'sequence';
  startSec: number;
  endSec: number;
  /** 原句文字（供离线阅读与校对）。 */
  text: string;
}

/**
 * 正文的一个段落（Markdown 块：一段、一个列表项或一个标题），按出现顺序；全部段落按 `\n\n` 接起来就是正文。
 * `heading` 不需要出处；`body` 没有有效出处时 `inferred`，界面标「模型推断」，不与原话混在一起。
 */
export interface CitationParagraph {
  index: number;
  role: 'heading' | 'body';
  markdown: string;
  inferred: boolean;
  cites: CitationAnchor[];
}

export interface CitationsFile {
  schema: typeof CITATIONS_SCHEMA;
  /** 选材来自哪些视频（系列文章时多部）。 */
  videoIds: Id[];
  /** 选材走了哪条路（§3.3 冻结在任务记录里）：整篇或章节投影时为 `none`。 */
  effectiveMode: SemanticEffectiveMode;
  paragraphs: CitationParagraph[];
  /** 模型写了、但不是这次发出的句子编号的引用数（已丢弃）。 */
  droppedCites: number;
}
