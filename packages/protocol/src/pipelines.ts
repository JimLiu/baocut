import type { Id } from './domain.ts';
import type { CitationsFile, SemanticEffectiveMode, SemanticReason } from './semantic.ts';

/**
 * 固定流程（架构设计 §7.9）：步骤固定、不需要模型规划的多步工作，由 Runtime 编排，执行主体是 `system:pipeline`，
 * 不创建智能体会话。一个流程是一个父 Job（`kind: 'pipeline'`），每一步是它的子 Job（`kind: 'pipeline-step'`）；
 * 状态与进度经 `jobs.*` 与 `jobs` 主题读取。
 */

/** `pipelines.list` 的一项：流程名、说明、步骤与参数的 JSON Schema。 */
export interface PipelineInfo {
  name: string;
  label: string;
  description: string;
  steps: Array<{ name: string; label: string; optional: boolean }>;
  /** 参数的 JSON Schema（`pipelines.start` 的 `params`）。 */
  paramsSchema: Record<string, unknown>;
}

/**
 * 文件转码（`transcode`）：文件到文件，不建视频，不经过视频的渲染管线。`compress` 把每个输入各压成一个文件；
 * `merge` 按顺序拼成一个文件：各片段的编码参数（编码、分辨率、帧率、像素格式、采样率、声道）一致时流复制，
 * 否则重新编码，结果里说明原因。
 */
export interface TranscodeParams {
  /** 输入文件的绝对路径，至少一个；`merge` 至少两个。 */
  inputs: string[];
  /**
   * `compress` 逐个压缩；`merge` 按顺序合并成一个；`extract-audio` 逐个取出音轨（去掉画面：AAC、MP3、Opus、FLAC 流复制进
   * `.m4a`、`.mp3`、`.ogg`、`.flac`，其余重新编码为 AAC `.m4a`；没有音频轨的输入以 `TRANSCODE_NO_AUDIO` 失败）。
   */
  action: 'compress' | 'merge' | 'extract-audio';
  /** 视频编码，默认 `h264`。 */
  codec?: 'h264' | 'hevc';
  /** 画面高度的上限（像素）；不给时不缩放。 */
  maxHeight?: number;
  /** 恒定质量（0–51）；与 `videoBitrateKbps` 二选一，都不给时 h264 用 23、hevc 用 28。 */
  crf?: number;
  /** 视频码率（kbps）。 */
  videoBitrateKbps?: number;
  /** 音频码率（kbps，AAC），默认 128。 */
  audioBitrateKbps?: number;
  /**
   * 输出目录的绝对路径，不存在时创建；不给时是保存位置（设置 `downloads.directory`，默认主机的下载文件夹，§7.9）。提交时冻结；
   * 不能写入是 `OUTPUT_DESTINATION_UNAVAILABLE`。不覆盖已有的文件，重名时加序号。
   */
  outDir?: string;
}

/**
 * 视频工具的目标（架构设计 §7.9）：`{ videoId }` 是已打开的视频；`{ entryId }` 是 Space 里的视频条目，不要求已打开
 * （流程以 Runtime 的租约打开它，结束、取消或失败后放下）；`{ create }` 在项目或会话的目录里新建一个视频（只有接受它的流程
 * 可以给，别的以 `PIPELINE_TARGET_UNSUPPORTED` 拒绝）。顶层的 `videoId` 等同 `target: { videoId }`，两者都给时要指同一个视频。
 */
export type PipelineVideoTarget = { videoId: Id } | { entryId: Id } | { create: PipelineCreateTarget };

/**
 * 新建视频的所在：项目（`projectId`），或会话（`conversationId`，与智能体的 `videos_create` 同样的放置：会话属于项目时是
 * 那个项目，否则是会话的工作目录），两者给且只给一个。
 */
export type PipelineCreateScope = { projectId: Id; conversationId?: never } | { conversationId: Id; projectId?: never };

/**
 * 新建视频的目标：所在（`PipelineCreateScope`）、名字（不给时取页面标题或媒体的文件名）与媒体。`media` 是本机媒体文件的绝对
 * 路径，只有接受它的流程（`transcribe`）可以给：以链接素材导入（文件留在原处）并放上时间线；从链接导入不给，媒体是下载的结果。
 */
export type PipelineCreateTarget = PipelineCreateScope & {
  name?: string;
  media?: string;
};

/** `pipelines.start` 接受的视频工具参数：`videoId` 换成可选，另可给 `target`（两者给一个；都给时要指同一个视频）。 */
export type PipelineTargetParams<P extends { videoId: Id }> = Omit<P, 'videoId'> & { videoId?: Id; target?: PipelineVideoTarget };

/** 术语表的一条：源语言的写法与译法，可选的说明。 */
export interface GlossaryEntry {
  source: string;
  target: string;
  note?: string;
}

/**
 * 翻译（`translate`）：视频里一份 `speech` 文档 → 一份新的 `translation` 文档（视频格式规范 §5.3）。由流程逐批调用
 * 文本生成完成；文本模型没有配置时 `pipelines.start` 以 `CAPABILITY_NOT_CONFIGURED` 拒绝，不改交智能体。
 * 每次执行都新增一份译文文档，不替换已有的（它们可能有手工修改，架构设计 §10.3）。
 *
 * 给了 `translationId` 时是就地刷新：只重译那份译文里过期与还没有译文的句子（或 `sentences` 点名的句子），写成同一份译文的
 * 新版本，别的单元原样保留；从这份译文生成的字幕文档在同一笔事务里只换这几句的字幕条，时间轴照旧。
 */
export interface TranslateParams {
  /** 已打开的视频。`pipelines.start` 也可以改给 `target`（`{ videoId }` 或 `{ entryId }`，见 `PipelineTargetParams`）。 */
  videoId: Id;
  /** 源 `speech` 文档；不给时取视频里唯一的一份（有多份时要指明）。 */
  documentId?: Id;
  /** 目标语言（BCP 47）。 */
  targetLanguage: string;
  /** 风格提示，例如「口语、简洁」。 */
  style?: string;
  /** 术语表：调用时传入的列表。 */
  glossary?: GlossaryEntry[];
  /**
   * 用户库里的翻译用术语表（最多 20 张；可以指定版本，不给时取当前版本）。与视频里启用的（`library.getVideoSelection`）
   * 合在一起用：先这里的，再视频启用的。启动时冻结版本、固定到流程结束；对外服务的客户端不能用（`LIBRARY_ENTRY_NOT_APPLICABLE`）。
   */
  glossaries?: { id: Id; version?: number }[];
  /** 文本模型；不给时用文本生成的默认值（架构设计 §6.2）。 */
  provider?: string;
  model?: string;
  /** 每批的句数，默认 20。 */
  batchSize?: number;
  /**
   * 写入译文之后建立目标语言的字幕层，默认 false（不给时这一步 `skipped`，与没有这一步时一样）；同一份译文已有字幕层时跳过。
   * 工具入口（工具目录的 `execution.params`）与 CLI 带上 `true`；编辑器同样传 true，由流程建字幕层。
   */
  captions?: boolean;
  /** 新字幕的 Studio 样式文档；只创建样式时使用，共用已有视频样式时保留原样。仅建字幕层时可给。 */
  captionStyle?: Record<string, unknown>;
  /**
   * 字幕层双语显示（原文与译文两条字幕轨、共用一份样式），默认 false：只显示译文，配对的原文字幕层从画面上拿下（不删）。
   * 只在 `captions: true` 时可以给，否则 `invalid-request`。
   */
  bilingual?: boolean;
  /**
   * 就地刷新这份 `translation` 文档（不新增一份）：原文是它的 `sourceDocumentId`（给了 `documentId` 时要一致），
   * `targetLanguage` 要与它的语言相同。不能与 `captions`、`captionStyle`、`bilingual` 同给（已有的字幕层跟着更新）。
   */
  translationId?: Id;
  /**
   * 就地刷新时重译的句子（`s-<首词 ID>`，最多 500 句），译文新鲜的也重译；不给时取标了过期、原句改过与还没有译文的句子。
   * 只能与 `translationId` 一起给。
   */
  sentences?: Id[];
  /**
   * 翻译记忆（创作辅助集成设计 §2.6、§3.7），默认开：在用户其他视频里同一语言方向的已有译文里，原文规范化后相同的句子沿用
   * 已有译法（不送翻，单元标 `reuse`），语义相近的作为参考附在提示里。`false` 关掉。就地刷新时不用（重译就是要换译法）。
   */
  memory?: boolean;
  /**
   * 翻译页顺带交回对齐草稿的载体，默认 `lines`：行文本载体 `lines/1`（行文本载体设计 §8.16），一句一行，每块译文用
   * 首尾源词引用标出对应，由核心定位，输入输出都更短。`rows` 是 HTML 页，模型按源词序号把译文切成显示行。启动时冻结，
   * 重试沿用；冻结参数里没有这一项的（缺省值改成 `lines` 之前启动的）按 `rows`。
   */
  alignFusion?: TranslateAlignFusion;
}

/** 融合草稿的载体（`TranslateParams.alignFusion`）。 */
export type TranslateAlignFusion = 'rows' | 'lines';

/** 翻译记忆用了多少（`TranslateSummary.memory`）。 */
export interface TranslateMemoryUse {
  /** 沿用已有译文的句数（输出与已有译文相同的才算）。 */
  reused: number;
  /** 作为参考附在提示里的已有译句数。 */
  referenced: number;
  /** 查过的已有译文所在的视频数。 */
  videos: number;
  /** `semantic`：沿用 + 语义参考；`lexical`：只沿用原文相同的（原因见 `reason`）。 */
  effectiveMode: 'semantic' | 'lexical';
  reason: string | null;
}

/** 翻译用到的术语表（`TranslateSummary.glossary`、`DubSummary.glossary`）。 */
export interface TranslateGlossaryUse {
  /** 用到的库里的术语表与冻结的版本；`origin` 是调用时给的（`explicit`）还是视频里启用的（`video`）。 */
  entries: Array<{ id: Id; version: number; contentHash: string; name: string; origin: 'explicit' | 'video' }>;
  /** 视频里启用、但这次没用的：库里已经删了（`removed`），或目标语言、源语言不符（`language`）。 */
  skipped: Array<{ id: Id; reason: 'removed' | 'language' }>;
  /** 去重之后的术语条数（调用时给的与库里的合计）。 */
  terms: number;
  /** 相关的术语超过上限、有术语没能放进提示词的批数（架构设计 §7.9）。 */
  cappedBatches: number;
}

/** 文件转码完成时父任务的 `pipeline.summary`。 */
export interface TranscodeSummary {
  action: 'compress' | 'merge' | 'extract-audio';
  /**
   * 执行方式：流复制，或重新编码；`compress` 总是重新编码。`extract-audio` 逐个判断：全部流复制时 `stream-copy`，
   * 有一个重新编码就是 `re-encode`（`reason` 写明是哪几个、为什么）。
   */
  mode: 'stream-copy' | 're-encode';
  /** 为什么重新编码（`merge` 时片段的参数哪里不一致，`extract-audio` 时哪个输入的音频编码放不进常见容器）；流复制与 `compress` 时 null。 */
  reason: string | null;
  /** 执行器：ffmpeg 的版本与实际命令的参数摘要（路径只留文件名）。 */
  executor: { tool: 'ffmpeg'; version: string; commands: string[][] };
  /** 输出文件的绝对路径，与 `result.outputs` 一一对应。 */
  files: string[];
}

/** 翻译完成时父任务的 `pipeline.summary`。 */
export interface TranslateSummary {
  videoId: Id;
  /** 新写入的 `translation` 文档。 */
  documentId: Id;
  /** 译自的 `speech` 文档版本。 */
  source: { documentId: Id; revision: string };
  targetLanguage: string;
  unitCount: number;
  providerId: string;
  modelId: string;
  /** 用到的术语表；调用时没给、视频里也没启用时没有这个字段。 */
  glossary?: TranslateGlossaryUse;
  /** 目标语言的字幕层；没有这一步的旧记录没有这个字段。 */
  captions?: PipelineCaptionsSummary;
  /** 就地刷新（参数给了 `translationId`）时有：写成的版本、重译与去掉的单元、跟着更新的字幕文档。 */
  refresh?: TranslateRefreshSummary;
  /** 翻译记忆；关掉、就地刷新或旧记录没有这个字段。 */
  memory?: TranslateMemoryUse;
}

/** 就地刷新一份译文的结果（`TranslateSummary.refresh`）。 */
export interface TranslateRefreshSummary {
  /** 写入之后译文文档的版本。 */
  revision: string;
  /** 重译的句子（`s-<首词 ID>`）。 */
  sentences: Id[];
  /** 原句已经不在、这次去掉的译文单元。 */
  removedUnitIds: Id[];
  /** 跟着换了字幕条的字幕文档（从这份译文生成的）。 */
  captionDocumentIds: Id[];
  /** 写入的那笔事务，按它撤销（`videos.undo` 的 `{ transaction }`）。 */
  transactionId?: Id;
}

/**
 * 流程建立的字幕层（`transcribe`、`translate` 的 `summary.captions`，架构设计 §7.9）。`status`：
 * `created` 这次建了；`existing` 同一份文稿（译文）已经有字幕层，这一步记为 `skipped`，`documentId` 是已有的那份；
 * `disabled` 参数 `captions: false`；`not-on-timeline` 时间线上没有取用这个素材的片段，没有建；`empty` 没有可显示的字幕条。
 */
export interface PipelineCaptionsSummary {
  status: 'created' | 'existing' | 'disabled' | 'not-on-timeline' | 'empty';
  /** 字幕文档（`caption`）；没有时 null。 */
  documentId: Id | null;
  /** 新建的字幕条数；没有新建时 null。 */
  cueCount: number | null;
  /** 新建的一层是否显示在画面上（这个素材已经有原文字幕显示着时，新的原文字幕层以停用放上去）；没有新建时 null。 */
  enabled: boolean | null;
  /** 译文：是否双语显示。 */
  bilingual?: boolean;
  /** `created`：建字幕层的那笔事务，按它撤销（`videos.undo` 的 `{ transaction }`）。 */
  transactionId?: Id;
}

/**
 * 转录（`transcribe`，架构设计 §7.9）：解析目标（按需新建视频、导入本机媒体并放上时间线）→ 转写（提交一个 `transcribe`
 * Job 并等它完成；Job 自己把语音文档应用到视频）→ 建立字幕层。与 `models.transcribe` 提交的转写 Job 同名、不是一回事：
 * 流程是父 Job（`kind: 'pipeline'`），转写 Job 是它的一步提交的。视频里已有这个素材的转写时按 `destination` 决定落点：新建一部
 * 视频（缺省），或换用文稿（§6.6）；一部视频里不并存两份。
 */
export interface TranscribeParams {
  /** 已打开的视频。`pipelines.start` 也可以改给 `target`（`{ videoId }`、`{ entryId }` 或带 `media` 的 `{ create }`）。 */
  videoId: Id;
  /**
   * 要转写的素材；不给时取根序列主轨（`order` 最小、有音视频片段的画面轨，没有时音频轨）上唯一的那个素材：主轨上有几个素材时
   * 报 `TRANSCRIBE_ASSET_AMBIGUOUS`（`details.assetIds`），时间线上没有音视频片段时报 `TRANSCRIBE_ASSET_NOT_FOUND`。
   */
  assetId?: Id;
  /** 断言语言（BCP 47）；不给时自动检测。 */
  language?: string;
  /** 转写的 Provider 与模型；不给时用默认值（同 `models.transcribe`）。 */
  provider?: string;
  model?: string;
  /** 识别提示（同 `models.transcribe` 的 `hint`，至多 1200 字符）；视频里启用的转写术语表照样拼进去。 */
  hint?: string;
  /** 区分说话人（同 `models.transcribe` 的 `diarize`）；不给时按模型，能区分的区分。 */
  diarize?: boolean;
  /** 转写之后建立字幕层，默认 true；同一份文稿已有字幕层时跳过。 */
  captions?: boolean;
  /**
   * 视频已有这个素材的转写时的落点（工具与 CLI 叫 `target`）：`new-video`（缺省）在原视频所在的项目（或会话的来源目录）里
   * 新建一部视频、链接同一份素材，转写写进新视频；`replace` 换用文稿（§6.6）：一笔事务写已有文档的新版本并结转译文、
   * 字幕与配音。视频没有这个素材的转写时两种都直接写进它（摘要的 `target: 'first'`）。只配 `{ videoId }`、`{ entryId }` 目标。
   */
  destination?: TranscribeDestination;
  /** `new-video` 新建视频的名字；不给时「<原名> · 重新转录」。 */
  name?: string;
  /** `replace` 时各语言译文：`carry`（缺省）按视频格式规范 §5.3 结转，`discard` 不结转（译文留在旧版本上，配音计划不动）。 */
  translations?: 'carry' | 'discard';
  /**
   * 越过手工修改闸门（§6.6）：当前文稿的全文指纹与 `stages.asr` 不符（用户改过原文）时，`replace` 不给它就以
   * `TRANSCRIPT_EDITED` 拒绝。同意只绑定提交时的指纹：之后文稿又被改了，`transcribe` 一步照样以它失败。
   */
  acceptEdited?: boolean;
  /** 新字幕的 Studio 样式文档；只创建样式时使用，共用已有视频样式时保留原样。仅建字幕层时可给。 */
  captionStyle?: Record<string, unknown>;
}

/** 转录的落点（`TranscribeParams.destination`）。 */
export type TranscribeDestination = 'new-video' | 'replace';

/**
 * Space 里的一个条目作为输入（架构设计 §7.9「Space 条目作为输入」）：Runtime 在方法层按 Space 目录换成条目的文件路径。
 * 条目在回收站里是 `SPACE_ENTRY_TRASHED`，没有可读的文件（视频、来源不在了）是 `SPACE_ENTRY_NO_FILE`，种类不合用是
 * `SPACE_ENTRY_UNSUPPORTED`。
 */
export interface SpaceEntryInput {
  entryId: Id;
}

/**
 * `pipelines.start` 提交 `transcode` 时的参数：`inputs` 的每一项可以是 Space 条目（视频文件、成片、音频），Runtime 在方法层
 * 换成文件路径后冻结，冻结的 `params` 里只有路径。
 */
export type TranscodeStartParams = Omit<TranscodeParams, 'inputs'> & { inputs: Array<string | SpaceEntryInput> };

/** `pipelines.start` 提交 `translate-subtitles` 时的参数：`input` 可以是 Space 里的字幕条目（.srt、.vtt），规则同上。 */
export type TranslateSubtitlesStartParams = Omit<TranslateSubtitlesParams, 'input'> & { input: string | SpaceEntryInput };

/**
 * 只给文件的转录（`transcribe` 流程不给 `videoId` / `target`，架构设计 §7.9）：转写一个本机媒体文件，把
 * `<源文件名>.txt` 与 `.srt` 写到保存位置，不建视频、不建字幕层。不收 `assetId`、`diarize` 与 `captions`。
 */
export interface TranscribeFileParams {
  /** 媒体文件的绝对路径，或 Space 里的文件条目（音频、视频文件）。 */
  file: string | SpaceEntryInput;
  /** 输出目录的绝对路径，不存在时创建；不给时是保存位置（同 `TranscodeParams.outDir`）。 */
  outDir?: string;
  language?: string;
  provider?: string;
  model?: string;
  hint?: string;
}

/** 只给文件的转录完成时父任务的 `pipeline.summary`；`result.outputs` 是写出的 TXT 与 SRT（带 `path`）。 */
export interface TranscribeFileSummary {
  /** 转写的源文件。 */
  file: string;
  /** 写出的文稿：`<源文件名>.txt` 与 `.srt`，重名时一起加序号，不覆盖。 */
  files: string[];
  transcribeJobId: Id;
  /** 断言的或检测到的语言；没有时 null。 */
  language: string | null;
  providerId: string;
  modelId: string;
}

/** 转录完成时父任务的 `pipeline.summary`。 */
export interface TranscribeSummary {
  videoId: Id;
  /** 这次新建了视频（`target.create`）。 */
  createdVideo: boolean;
  assetId: Id;
  /** 转写这一步提交的 `transcribe` Job。 */
  transcribeJobId: Id;
  /** 新写入的 `speech` 文档。 */
  documentId: Id;
  /** 文档里的语言（断言的或检测到的）；没有时 null。 */
  language: string | null;
  providerId: string;
  modelId: string;
  /** 落点：`new-video` 新建了视频，`replace` 换用了文稿，`first` 原来没有这个素材的转写、直接写进去。 */
  target: 'new-video' | 'replace' | 'first';
  /** `new-video`：新建的视频（`videoId` 与它相同）；别的落点 null。 */
  newVideo: { videoId: Id; name: string } | null;
  /** `replace`：换用之前的文稿版本与可撤销的事务（`videos.undo` 的 `{ transaction }`）；别的落点 null。 */
  replaced: { documentId: Id; previousVersion: string; transactionId: Id | null } | null;
  /** `replace` 时各语言译文的结转（视频格式规范 §5.3）；没有结转时为空。 */
  translations: TranscriptCarryTranslation[];
  /** `replace` 时按时间重锚的 pin：重锚上的与锚不上（`orphaned`）的处数；别的落点 null。 */
  captionPins: { reanchored: number; orphaned: number } | null;
  /** `replace` 时各语言配音计划的结转（视频格式规范 §7.2）；没有结转时为空。 */
  dubs: TranscriptCarryDub[];
  /** 新文稿区分出的说话人数（没区分时 0）；读不出文稿的概要时 null。 */
  speakerCount: number | null;
  captions: PipelineCaptionsSummary;
}

/** 换用文稿时一种语言的译文结转：保留的句数（其中已审的）、过期的与新句没配上的（也记为过期）。 */
export interface TranscriptCarryTranslation {
  language: string;
  /** 译文文档（同一份文档的新版本）。 */
  documentId: Id;
  kept: number;
  keptReviewed: number;
  stale: number;
  unmatched: number;
}

/** 换用文稿时一种语言的配音计划结转：保留的与过期的单元数。 */
export interface TranscriptCarryDub {
  language: string;
  /** 配音计划文档（同一份文档的新版本）。 */
  documentId: Id;
  kept: number;
  stale: number;
}

/** 换用文稿那笔事务的影响（摘要的 `translations`、`captionPins`、`dubs`；也记在文稿的 `extensions['baocut.transcriptSwitch']`）。 */
export interface TranscriptSwitchImpact {
  translations: TranscriptCarryTranslation[];
  captionPins: { reanchored: number; orphaned: number };
  dubs: TranscriptCarryDub[];
}

/** 下载工具能读取 Cookie 的浏览器（yt-dlp `--cookies-from-browser` 的取值）。 */
export const LINK_COOKIE_BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'brave', 'chromium', 'opera', 'vivaldi', 'whale'] as const;
export type LinkCookieBrowser = (typeof LINK_COOKIE_BROWSERS)[number];

/**
 * 网站登录的设置（`downloads.cookieBrowsers`，设置 › 视频下载）：`all` 是所有检测到的浏览器（之后新检测到的也算在内）；
 * 列表是勾选的浏览器；空列表是匿名下载。每次下载开始时按当时的检测结果展开成浏览器列表（`resolveCookieBrowsers`），冻结进那一次下载。
 */
export type CookieBrowsersSetting = 'all' | LinkCookieBrowser[];

/** 设置 › 视频下载在界面里的地址：网站要求登录、Cookie 读不到时，错误的 `details.settingsHref` 与智能体的设置链接都指向它。 */
export const DOWNLOADER_SETTINGS_HREF = '/settings/downloader';

/**
 * 从链接导入（`link-import`，架构设计 §7.9）：用受管的下载工具（yt-dlp，§12.9）把一个视频页面的媒体下载到指定目录，
 * 可选地导入一个视频（`target`：已有的，或新建的并放上时间线）、再提交转写。下载工具要已安装并得到用户同意，否则
 * `pipelines.start` 以 `conflict`（`TOOL_NOT_INSTALLED` / `TOOL_CONSENT_REQUIRED`）拒绝。
 *
 * 下载位置：设置了 `downloads.directory` 时使用该目录，否则使用运行下载的主机的 `~/Downloads`。
 * 无视频目标时，转录 TXT/SRT 与视频写入同一下载目录。可选 projectId 仅决定转录结果的项目归属，不改变文件路径。提交时冻结。
 */
export interface LinkImportParams {
  /** 视频页面的链接：只接受 `http(s)://`，不接受本机、链路本地与内网地址。 */
  url: string;
  projectId?: Id;
  conversationId?: Id;
  /** 下载之后导入这个已打开的视频（链接素材，文件留在下载目录里）。等同 `target: { videoId }`。 */
  videoId?: Id;
  /**
   * 导入的目标（见 `PipelineVideoTarget`）：`create` 在项目或会话的来源目录里新建视频（不带 `media`，媒体是下载的结果；
   * 名字默认取页面标题），导入之后放上主轨、从 0 开始、覆盖整段媒体；同时给的 `projectId`、`conversationId` 要与它一致。
   * 不给目标时只下载：`result.outputs[0].artifactId` 是下载的文件的内容摘要，之后智能体可以按它导入视频。
   */
  target?: PipelineVideoTarget;
  /** 只下载音频。 */
  audioOnly?: boolean;
  /**
   * 本次下载显式使用哪些浏览器的登录信息（不重复，按尝试的顺序）；不给或空时匿名。解析链接时按顺序逐个用：读不到这个浏览器的
   * Cookie、或网站仍要求登录时换下一个，别的失败（网络、磁盘、不支持、工具过旧）不换；用上的那个记在结果的 `cookieBrowser`，
   * 下载沿用它。不保存 Cookie 内容。
   */
  cookieBrowsers?: LinkCookieBrowser[];
  /** 旧写法：只用一个浏览器，等同 `cookieBrowsers: [它]`；不能与 `cookieBrowsers` 同时给。 */
  cookieBrowser?: LinkCookieBrowser;
  /** 一并下载的字幕语言（例如 `en`、`zh-Hans`）；不给时不下载字幕。字幕作为文件放在媒体旁边，不导入视频。 */
  subtitleLanguages?: string[];
  /** 下载后转写；不给视频目标时输出独立文稿与 SRT，不新建视频。 */
  transcribe?: boolean;
  /** 转写的断言语言（BCP 47）；不给时自动检测。只与 `transcribe` 一起给。 */
  language?: string;
  /** 转写的 Provider 与模型；不给时用默认值（同 `TranscribeParams`）。只与 `transcribe` 一起给。 */
  provider?: string;
  model?: string;
  /** 识别提示（同 `TranscribeParams.hint`，至多 1200 字符）。只与 `transcribe` 一起给。 */
  hint?: string;
  /** 区分说话人（同 `TranscribeParams.diarize`）。只与 `transcribe` 和视频目标一起给（独立文稿不区分）。 */
  diarize?: boolean;
  /**
   * 转写之后建立字幕层（与 `TranscribeParams.captions` 同一步），默认 false：`download` 只转写，`transcribe` 给链接时打开。
   * 只与 `transcribe` 和视频目标一起给。
   */
  captions?: boolean;
  /**
   * 文件放在哪里：`downloads`（默认）是下载目录（设置 `downloads.directory`，否则主机的下载文件夹）；`project` 是归属项目
   * （`projectId`、导入的视频或新建视频所在的项目）里的 `downloads/`，归属是不属于项目的会话或没有归属时仍用下载目录。
   */
  saveTo?: 'downloads' | 'project';
  /**
   * 文件放进这个目录（本机绝对路径，不存在时创建），代替 `saveTo` 选的目录，与 `saveTo` 不能同时给；导入视频时素材链到这里。
   * 提交时建好、确认能写（不能写时 `conflict`，`OUTPUT_DESTINATION_UNAVAILABLE`，不建任务），冻结在任务里。
   */
  outDir?: string;
}

/** 从链接导入完成时父任务的 `pipeline.summary`。 */
export interface LinkImportSummary {
  /** 脱敏之后的链接（规则见架构设计 §7.9）。 */
  url: string;
  /** 解析出的元数据（来自下载工具，可能缺）。 */
  title: string | null;
  platform: string | null;
  uploader: string | null;
  durationSec: number | null;
  /** 视频简介，截到 1200 个字符（素材来源 `source.description` 里是完整的，最多 20000）；没有时 null。之前的版本没有这个字段。 */
  description?: string | null;
  /** 平台给的结构化章节（`chapters[]`）的条数；没有时 0。简介里的时间戳大纲不算在内。之前的版本没有这个字段。 */
  sourceChapters?: number;
  /** 下载得到的文件（绝对路径）：媒体，与字幕。 */
  files: { media: string; subtitles: string[] };
  tool: { name: string; version: string; source: string };
  /** 实际用上的浏览器 Cookie；匿名下载时 null。之前的版本没有这个字段。 */
  cookieBrowser?: LinkCookieBrowser | null;
  downloadedAt: string;
  /** 导入的视频与素材；没有导入时 null。 */
  videoId: Id | null;
  assetId: Id | null;
  /** 视频是这次新建的（`target.create`）；之前的版本没有这个字段。 */
  createdVideo?: boolean;
  /** 提交的转写任务；没有转写时 null。 */
  transcribeJobId: Id | null;
  /** 无视频目标的转录文件（TXT、SRT）。 */
  transcriptFiles?: string[];
  /** 转写写进视频的文稿；没有转写到视频里时没有。之前的版本没有这个字段。 */
  documentId?: Id | null;
  /** 字幕层（`captions` 打开时）；没打开时没有这个字段。 */
  captions?: PipelineCaptionsSummary;
}

/** 翻译配音对原声的处理：配音响起时压低（`duck`，默认）、静音（`mute`）、不动（`keep`）。 */
export type DubOriginalAudio = 'duck' | 'mute' | 'keep';

/**
 * 翻译配音（`dub`，架构设计 §7.9）：缺译文时先翻译（与 `translate` 同一份实现）→ 核对译文与原文的当前版本 →
 * 可选的人声与背景分离（没有配置时跳过）→ 逐句合成 → 时间对齐 → 在一笔编辑事务里作为一组配音应用（视频格式规范 §7.2）。
 * 给定的配音（视频里已有的配音轨）不会被自动改成语音合成：流程每次都新增一组配音，不替换已有的。
 */
export interface DubParams {
  /** 已打开的视频。`pipelines.start` 也可以改给 `target`（`{ videoId }` 或 `{ entryId }`，见 `PipelineTargetParams`）。 */
  videoId: Id;
  /** 源 `speech` 文档；不给时取视频里唯一的一份，给了 `translationId` 时取译文的来源。 */
  documentId?: Id;
  /** 目标语言（BCP 47）。给了 `translationId` 时可以不给（取译文的语言），给了就要与译文一致。 */
  targetLanguage?: string;
  /** 已有的 `translation` 文档；不给时先翻译（新增一份译文文档）。 */
  translationId?: Id;
  /**
   * 音色：模型的预置音色或账号里的音色 ID，或用户库里的 `library:<id>`（要有这个 Provider 上的有效克隆）。不给时用模型的默认音色。
   * 视频里给说话人绑定了音色（`library.setVideoSelection` 的 `speakerVoices`）时，那位说话人的句子用绑定的；这里的只用于没有绑定的说话人。
   */
  voice?: string;
  /** 语音合成的 Provider 与模型；不给时用语音合成的默认值（架构设计 §6.2）。 */
  provider?: string;
  model?: string;
  /** 缺译文时翻译用的文本模型、风格提示、术语表与批大小（同 `translate`）。 */
  textProvider?: string;
  textModel?: string;
  style?: string;
  glossary?: GlossaryEntry[];
  glossaries?: { id: Id; version?: number }[];
  batchSize?: number;
  /** 原声怎么处理，默认 `duck`。 */
  originalAudio?: DubOriginalAudio;
  /** `duck` 时压低多少 dB（1–60，默认 18）。 */
  duckDb?: number;
  /** 先把原声分离成人声与背景（`separateAudio`）；没有配置分离能力时这一步跳过（`skipped`），如实报告。 */
  separateBackground?: boolean;
  /**
   * 句级重配：只重新合成已有一组配音里的这几句，写回原来那一组（同一条配音轨、同一份配音计划的新版本），不新建一组、不动别的句。
   * 译文、语言、Provider、模型与音色都取自这一组的配音计划，所以不能同时给 `translationId`、`targetLanguage`、`documentId`、
   * `voice`、`provider`、`model`、翻译用的参数与原声的处理（`invalid-request`）。见 `DubRegroup`。
   */
  regroup?: DubRegroup;
}

/** 一句配音在时间线上的结果：`fit` 原样放下，`tempo` 加速后放下，`extended` 加速到上限后占用之后的静音，`overlong` 放不下（没有放）。 */
export type DubFitStatus = 'fit' | 'tempo' | 'extended' | 'overlong';

/** 翻译配音完成时父任务的 `pipeline.summary`。 */
export interface DubSummary {
  videoId: Id;
  language: string;
  /** 用的译文：已有的，或这次新翻译写入的（`created: true`）。 */
  translation: { documentId: Id; revision: string; created: boolean };
  /** 新写入的配音计划（`dubbing-plan`）、配音轨与这一组配音的 ID（实例的 `extensions['baocut.dub'].groupId`）。 */
  planDocumentId: Id;
  trackId: Id;
  groupId: string;
  units: {
    /** 译文的句数。 */
    total: number;
    /** 放上时间线的句数。 */
    placed: number;
    /** 译文过期（原文改过或标成 `stale`）没有合成的句数。 */
    stale: number;
    /** 原句已经不在时间线上（整句剪掉了），没有放的句数。 */
    offTimeline: number;
    tempo: number;
    extended: number;
    overlong: number;
    /** 说话人绑定的音色不可用（克隆过期或缺失、撤回了授权声明、库里删了），没有合成的句数。 */
    voiceUnavailable: number;
  };
  /** 过期的句子（译文单元 ID）。 */
  staleUnits: Id[];
  /** 音色不可用、没有合成的句子：哪位说话人、绑定的哪个音色、为什么（错误码与 `stale`、`missing` 之类的原因）。 */
  voiceUnavailableUnits: Array<{ unitId: Id; speakerId: string; voice: string; code: string; reason: string }>;
  /** 各说话人用的音色：`video` 是视频里的绑定，`params` 是参数 `voice`，`default` 是模型的默认音色；不可用时 `available: false`。 */
  speakers: Array<{ speakerId: string | null; voice: string; voiceSource: DubVoiceSource; available: boolean; units: number }>;
  /** 放不下的句子：超出下一句的起点多少秒。 */
  overlongUnits: Array<{ unitId: Id; overflowSeconds: number }>;
  synthesis: {
    providerId: string;
    modelId: string;
    voice: string;
    /** 合成调用、重发与失败的次数；`reused` 是重试时复用之前合成结果的句数。 */
    calls: number;
    retries: number;
    failures: number;
    reused: number;
  };
  originalAudio: DubOriginalAudio;
  /** 人声与背景分离：完成、没有要求，或要求了但没有配置（跳过）。 */
  separation: 'completed' | 'not-requested' | 'not-configured';
  /** 这次翻译用到的术语表（缺译文、先翻译时）。 */
  glossary?: TranslateGlossaryUse;
  /** 句级重配（`params.regroup`）时：每句的结果。没有重配时没有。 */
  regroup?: DubRegroupSummary;
}

/**
 * 句级重配的参数（`DubParams.regroup`）。
 *
 * - `groupId`：已有的一组配音（实例的 `extensions['baocut.dub'].groupId`、配音计划的 `summary.groupId`）；
 * - `units`：要重配的译文单元 ID（1–200 个，不重复），都要在这一组的计划与译文里；
 * - `seed`：合成的种子。`'new'`（默认）在提交时随机取一个；给数字时原样用（0–4294967295 的整数）。模型不接受种子时
 *   `'new'` 记为 `null`、给数字以 `invalid-request` 拒绝。
 */
export interface DubRegroup {
  groupId: string;
  units: Id[];
  seed?: 'new' | number;
}

/** 冻结的句级重配（父任务的 `pipeline.params.regroup`）：界面据此知道哪一组的哪几句在重配。 */
export interface FrozenDubRegroup {
  groupId: string;
  units: Id[];
  /** 这一组的配音计划与配音轨。 */
  planDocumentId: Id;
  trackId: Id;
  /** 实际用的种子；模型不接受种子时 `null`。 */
  seed: number | null;
}

/**
 * 句级重配每句的结果：`replaced` 新的一版放上时间线、成为当前版本；`overlong` 合成了但放不下，旧的那一版留着；
 * `stale` 译文过期没有合成；`voice-unavailable` 音色不可用没有合成；`off-timeline` 原句不在时间线上。
 */
export type DubRegroupUnitStatus = 'replaced' | 'overlong' | 'stale' | 'voice-unavailable' | 'off-timeline';

export interface DubRegroupSummary {
  seed: number | null;
  units: Array<{ unitId: Id; status: DubRegroupUnitStatus; take: number | null; seed: number | null }>;
}

/**
 * 配音计划里一句的一个版本（`units[].extensions['baocut.dub'].takes[]`，句级重配追加）。当前版本是同一处的 `take`；
 * 实例的 `extensions['baocut.dub']` 也记着 `take` 与 `seed`。切换版本是一笔编辑：删掉这句的实例、用那一版的素材放回原处、
 * 写配音计划的新版本（`take` 改成那一版）。
 */
export interface DubPlanTake {
  /** 第几版，从 1 开始。 */
  k: number;
  seed: number | null;
  /** 放上时间线的音频（变速之后的）产物；素材的 `provenance.source.artifactId` 与它相同。 */
  artifactId: string | null;
  /** 这一版的素材（知道时记下；当前版本的素材以实例为准）。 */
  assetRef?: { id: Id; revision: string };
  samples: number | null;
  sampleRate: number | null;
  fit: Exclude<DubFitStatus, 'overlong'> | null;
  tempo: number | null;
  /** 这一版没放上时间线时：放不下超出的秒数。 */
  overflowSeconds?: number;
  /** 合成用的译文。 */
  text: string | null;
  /** 产生这一版的流程（父任务）；旧计划补记的第 1 版是那次配音。 */
  jobId: Id | null;
  at: string | null;
}

/** 一句配音的音色从哪来：视频里的说话人绑定、流程参数 `voice`，或模型的默认音色。 */
export type DubVoiceSource = 'video' | 'params' | 'default';

/**
 * 字幕文件的翻译（`translate-subtitles`，架构设计 §7.9）：一个 SRT 或 WebVTT 文件 → 同样条数、同样时间码的译文字幕文件。
 * 文件到文件，不碰视频；由流程逐批调用文本生成完成，文本模型没有配置时以 `CAPABILITY_NOT_CONFIGURED` 拒绝，不改交智能体。
 * 读不准的文件启动时就拒绝（`SUBTITLE_FILE_INVALID`、`SUBTITLE_FILE_TOO_LARGE`），不建任务。字幕文本按 `transcript` 数据授权。
 */
export interface TranslateSubtitlesParams {
  /** 字幕文件的绝对路径（`.srt` 或 `.vtt`；不超过 4 MiB、10000 条）。 */
  input: string;
  /** 目标语言（BCP 47）。 */
  targetLanguage: string;
  /** 源语言（BCP 47）；不给时由模型判断。用于提示词与库里术语表的语言匹配。 */
  sourceLanguage?: string;
  style?: string;
  glossary?: GlossaryEntry[];
  /** 用户库里的翻译用术语表（同 `TranslateParams.glossaries`；没有视频，没有视频里启用的可合）。 */
  glossaries?: { id: Id; version?: number }[];
  provider?: string;
  model?: string;
  /** 每批的条数，默认 20。 */
  batchSize?: number;
  /** 输出格式；不给时与输入相同。 */
  format?: 'srt' | 'vtt';
  /** 双语：每条原文在上、译文在下。默认 false（只有译文）。 */
  bilingual?: boolean;
  /**
   * 输出目录的绝对路径，不存在时创建；不给时是保存位置（同 `TranscodeParams.outDir`）。文件名
   * `<原名>.<目标语言>[.bilingual].<格式>`，重名时加序号，不覆盖。
   */
  outDir?: string;
}

/** 字幕文件的翻译完成时父任务的 `pipeline.summary`。 */
export interface TranslateSubtitlesSummary {
  /** 源文件的绝对路径、格式与内容摘要。 */
  source: { path: string; format: 'srt' | 'vtt'; contentHash: string };
  /** 输出文件的绝对路径（与 `result.outputs[0].path` 相同）。 */
  file: string;
  format: 'srt' | 'vtt';
  bilingual: boolean;
  targetLanguage: string;
  sourceLanguage: string | null;
  /** 字幕条数（输入输出相同），其中送去翻译的条数（文本为空的条原样保留）。 */
  cueCount: number;
  translatedCount: number;
  /** 原文带行内标记（`<i>`、`{\an8}`、VTT 的 `<c>` 等）的条数：输出里这些标记去掉了。 */
  markupStripped: number;
  /** VTT 转 SRT 时丢掉的 cue settings 条数与 NOTE、STYLE、REGION 块数。 */
  droppedSettings: number;
  droppedBlocks: number;
  providerId: string;
  modelId: string;
  glossary?: TranslateGlossaryUse;
}

/**
 * 识别说话人（`speakers`，架构设计 §6.6）：给视频里已有的一份转写按声纹重新区分说话人，不重新转写。本机的「说话人区分」
 * 模型包区分，结果先做成提案（`SpeakersSummary`），不改视频；用户确认后用 `edits.applySpeakers` 应用，一笔可撤销的编辑。
 * 「说话人区分」模型包没装好时以 `conflict`（`MODEL_UNAVAILABLE`，`details.bundle` 是它的状态）拒绝。
 */
export interface SpeakersParams {
  videoId: Id;
  /** 要区分的 `speech` 文档；视频里只有一份时可以不给。 */
  documentId?: Id;
}

/** 提案里的一段试听：这位说话人的一句，`start` / `end` 是转写正文 `timescale` 下的素材时间刻度。 */
export interface SpeakerClip {
  sentenceId: Id;
  start: number;
  end: number;
  text: string;
}

/** 提案里的一位说话人（应用后的样子）。已有的说话人保留 ID 与名字；新的是 `spk-<n>`「说话人 n」。 */
export interface ProposedSpeaker {
  id: Id;
  name: string;
  /** 转写里原来没有的说话人。 */
  isNew: boolean;
  words: number;
  /** 这位说话人的词的总时长（秒）。 */
  seconds: number;
  sentences: number;
  clips: SpeakerClip[];
}

/** 识别说话人完成时父任务的 `pipeline.summary`：提案，还没应用。 */
export interface SpeakersSummary {
  videoId: Id;
  /** 区分的 `speech` 文档与版本：应用时文稿还得是这一版。 */
  source: { documentId: Id; revision: string };
  /** 转写正文的 `timescale`（试听片段的刻度）。 */
  timescale: number;
  /** 按在文稿里第一次出现的次序。 */
  speakers: ProposedSpeaker[];
  /** 换说话人的词数；0 表示与现状相同，应用只改名字。 */
  relabeled: number;
  /** 应用时按新的说话人边界重切的译文条数（各语言相加），不重新翻译。 */
  translationsSplit: number;
  /** 不是当前格式、应用时不重切的译文文档（它们的句子会对不上，标过期）。 */
  skippedTranslations: number;
  /** 提案的产物（`edits.applySpeakers` 读它）。 */
  proposalArtifactId: Id;
  /** 执行区分的本机模型包与区分本身的用时（毫秒）。 */
  bundleId: string;
  diarizeMs: number;
}

/**
 * `edits.applySpeakers`：把识别说话人的提案应用到视频（一笔编辑事务，`edits.undo` 撤销）。`names` 是确认页改过的名字
 * （说话人 ID → 名字），没给的用提案里的。文稿或它的译文在识别之后改过时以 `conflict`（`STALE_JOB_INPUT`）拒绝：重新识别。
 */
export interface ApplySpeakersParams {
  videoId: Id;
  /** 识别说话人的父任务。 */
  jobId: Id;
  names?: Record<Id, string>;
  commandId: Id;
}

/**
 * AI 工具的「直接调模型」（`ai-tool`，产品设计 §5.10）：不经过对话，把提示词与这个视频的上下文（文稿、章节、附件）直接交给
 * 一个文本模型；挂着的 skill 作为系统提示词，只带 `SKILL.md` 与它用到的 `references/` 文件。`polish`、`chapters` 完成即写进
 * 视频（一笔可撤销的事务）；其余工具（写作类）的结果不写进视频，保存成 Space 的一份文档条目（`AiToolSummary.text`，
 * 条目 ID 即 `artifactId`），并带出处旁文件（`baocut.citations/1`，创作辅助集成设计 §3.4）。
 * 文本模型没有配置时 `pipelines.start` 以 `CAPABILITY_NOT_CONFIGURED` 拒绝，不改交智能体。
 */
export const AI_TOOL_PIPELINE = 'ai-tool';

/** 能直接调模型的工具。重新转录、找可剪的口、重译过期句、做封面不在其中（产品设计 §5.10）。 */
export const AI_TOOL_KINDS = ['polish', 'chapters', 'summary', 'blog', 'title', 'desc'] as const;
export type AiToolKind = (typeof AI_TOOL_KINDS)[number];

/** 完成即写进视频的工具；其余只给结果。 */
export const AI_TOOL_APPLY_KINDS: readonly AiToolKind[] = ['polish', 'chapters'];

/** 提示词的上限（字符）。 */
export const AI_TOOL_PROMPT_MAX = 20_000;

export interface AiToolParams {
  videoId: Id;
  tool: AiToolKind;
  /** 工具页提示词框里的文字（发送时的原样）。 */
  prompt: string;
  /** 范围：时间线上的一段（秒，同 `ExportRange`）；不给时整篇。`chapters` 总是整篇，不接受范围。 */
  range?: { start: number; end: number };
  /** 用哪份 `speech` 文档；视频里只有一份时可以不给。 */
  documentId?: Id;
  /** 提示词框里的附件（`attachments.prepare` 登记的）：文本文件附上全文；图片与别的文件不发，摘要里计数。 */
  attachments?: Id[];
  /** 挂着的 skill，按挂上的顺序；重复的只算第一次。 */
  skills?: { id: string }[];
  /** 文本模型；不给时用文本生成的默认值（架构设计 §6.2）。 */
  provider?: string;
  model?: string;
  /** 用户的界面语言（BCP 47，如 `zh-Hans`、`en`），写进系统提示词；不给时不写。 */
  uiLanguage?: string;
  /**
   * 写作类工具的选材（创作辅助集成设计 §2.2、§3.4）：不给时按 `range` 发整篇（现有做法）。`topic` 按意图句在这几部视频里挑
   * 相关的句群（本机语义索引；没有模型时退回字面匹配，再没有就整篇，`AiToolContext.selection` 写明实际怎么选的）。
   */
  selection?: AiToolSelection;
  /**
   * 系列文章：同时取材的另几部视频（写作类工具才有，最多 `AI_TOOL_SERIES_MAX` 部，`videoId` 之外）。编号带视频前缀
   * （`v2:s17`），出处带视频。按主题选材时直接用语义索引里的句子，这几部不必打开；整篇时它们要已经打开。`range` 只用于 `videoId`。
   */
  videoIds?: Id[];
  /**
   * 生成章节的边界（创作辅助集成设计 §2.4、§3.6）：`topic` 先在本机按相邻句群的语义距离找出话题转折的候选边界，模型只在
   * 候选处分章（可以合并，不能新增）；`model`（缺省）由模型决定。没有语义模型或索引时退回 `model`，`AiToolContext.boundaries`
   * 写明。只有 `chapters` 接受。
   */
  boundaries?: 'topic' | 'model';
  /**
   * 重写一段（创作辅助集成设计 §2.2「这段不对」、§3.4「局部改写」）：上一次写作结果的出处旁文件与段落序号。材料是这一段原来的
   * 出处，加上以这一段文字为意图再挑的句群（`exclude` 去掉用户勾掉的）；连同全文大纲发给模型，只换掉这一段，其余段落原样。
   * 结果是新的一份文档条目。写作类工具才有，不与 `range`、`selection`、`videoIds` 同用。
   */
  section?: AiToolSection;
}

/** `AiToolParams.section`。 */
export interface AiToolSection {
  /** 上一次结果的出处旁文件（`AiToolSummary.citationsArtifactId`、Space 条目的 `citations.artifactId`）。 */
  citationsArtifactId: Id;
  /** 要重写的段落（`CitationParagraph.index`，正文段）。 */
  index: number;
  /**
   * 换材料重写时勾掉的材料：重新找来的句群写 `space.relevantChunks`（意图是这一段原文、`limit` 为 `AI_TOOL_SECTION_CHUNKS`）的
   * `chunkId`；这一段原有的出处写 `cite:<第几处>`（`AI_TOOL_SECTION_CITE_PREFIX`，从 0 数，按 `CitationParagraph.cites` 的次序）。
   */
  exclude?: string[];
}

/** 重写一段时按这一段原文重新找几个句群（`space.relevantChunks` 预览用同一个数）。 */
export const AI_TOOL_SECTION_CHUNKS = 8;
/** 重写一段时，这一段原有出处在 `AiToolSection.exclude` 里的写法前缀（`cite:0` 是第一处）。 */
export const AI_TOOL_SECTION_CITE_PREFIX = 'cite:';

/** 系列文章最多几部视频（含 `videoId`）。 */
export const AI_TOOL_SERIES_MAX = 8;
/** 按主题选材最多挑几个句群。 */
export const AI_TOOL_TOPIC_MAX_CHUNKS = 60;
/** 按主题选材默认挑几个句群（`selection.limit` 与 `space.relevantChunks` 的 `limit` 不给时）。 */
export const AI_TOOL_TOPIC_DEFAULT_CHUNKS = 24;

/** 写作类工具按主题选材（`AiToolParams.selection`）。 */
export interface AiToolSelection {
  mode: 'topic';
  /** 意图句；不给时用提示词。 */
  intent?: string;
  /** 最多挑几个句群（默认 24，上限 `AI_TOOL_TOPIC_MAX_CHUNKS`）。 */
  limit?: number;
  /** 用户在「查看挑选的段落」里勾掉的句群（`space.relevantChunks` 给的 `chunkId`）。 */
  exclude?: string[];
}

/** 发给模型的上下文（`AiToolSummary.context`，同工具页那行「发给模型的」）。 */
export interface AiToolContext {
  /** 文稿的段数与字数（字母文字按词、中日文按字）；没有文稿时 0。 */
  paragraphs: number;
  characters: number;
  /** 视频已有的章节数（随文稿给出）。 */
  chapters: number;
  /** 附上全文的附件数，与没发的（图片、不是文本的文件）。 */
  attachments: number;
  skippedAttachments: number;
  /** 作为系统提示词的 skill，与一起带上的 `references/` 文件数。 */
  skills: string[];
  references: number;
  /** 系列文章取材的视频数（含 `videoId`）；单部时不给。 */
  videos?: number;
  /**
   * 按主题选材时实际怎么选的（冻结在任务里）：`effectiveMode` 是 `semantic`（语义索引）、`lexical`（退回字面匹配）或 `none`
   * （没挑出来，发了整篇）；`chunks` 是发给模型的句群，`chapters` 是覆盖的章节标题；没按主题时不给。
   */
  selection?: {
    effectiveMode: SemanticEffectiveMode;
    reason: SemanticReason | null;
    chunks: number;
    chunkIds: string[];
    chapters: string[];
    /** 其中弱命中（与意图勉强相关）的句群数。 */
    weak: number;
  };
  /** 重写一段时：重写的是第几段、换成了几段。 */
  section?: { index: number; paragraphs: number };
  /** 生成章节按话题找边界时：候选边界数与实际用的方式（`model` 表示退回了模型决定，`reason` 写明原因）。 */
  boundaries?: { mode: 'topic' | 'model'; candidates: number; reason: SemanticReason | null };
}

/** `ai-tool` 完成时父任务的 `pipeline.summary`。 */
export interface AiToolSummary {
  videoId: Id;
  tool: AiToolKind;
  providerId: string;
  modelId: string;
  context: AiToolContext;
  /** 写进视频的那笔事务与改了几处（润色：改了文字的词数；章节：写入的章数）；只给结果的工具为 null。 */
  applied: { transactionId: Id | null; changes: number } | null;
  /** 只给结果的工具：模型写的正文（Markdown，句子编号已去掉）。写进视频的工具为 null。 */
  text: string | null;
  /** 写作类工具：正文（`.md`）的产物，也是 Space 文档条目的 ID；写进视频的工具：模型输出的原样。 */
  artifactId: Id;
  /**
   * 写作类工具的出处（创作辅助集成设计 §3.4）：文稿以编了号的句子发出，模型在每段末尾回引编号，校验后对应回原句。
   * 没有文稿（只有提示词）或写进视频的工具为 null。
   */
  citations: CitationsFile | null;
  /** 出处旁文件（`baocut.citations/1` 的 JSON）的产物；`citations` 为 null 时 null。 */
  citationsArtifactId: Id | null;
  /** 模型的停止原因：`length` 表示输出到了上限、可能不完整。 */
  finishReason: 'stop' | 'length';
}
