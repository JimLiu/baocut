import type { Conversation, Id, SpaceEntry, SpaceEntryKind, SpaceEntryReference, SpaceEntryStatus, SpaceScanIssue } from './domain.ts';

/**
 * `space.*` 的参数与结果（架构设计 §5.7、§5.11）。条目类型 `SpaceEntry` 在 `domain.ts`，订阅主题 `space` 在 `events.ts`。
 */

/** `space.list` 一页最多多少条。 */
export const SPACE_LIST_MAX_LIMIT = 500;
/** `space.search` 最多返回多少条命中。 */
export const SPACE_SEARCH_MAX_LIMIT = 200;

export interface SpaceListParams {
  /** 只列这个项目的条目；`null` 是不属于任何项目的条目。不给时不按项目筛。 */
  projectId?: Id | null;
  kind?: SpaceEntryKind | SpaceEntryKind[];
  /** `none` 是没有状态的条目（普通文件、视频）。 */
  status?: SpaceEntryStatus | 'none' | (SpaceEntryStatus | 'none')[];
  /** 来源视频：这个视频本身，以及由它生成、导出的条目。 */
  videoId?: Id;
  favorite?: boolean;
  /** 回收站：默认 `exclude`（不列回收站里的），`only` 只列回收站，`include` 都列。 */
  trash?: 'exclude' | 'only' | 'include';
  /** 上一页结果里的 `nextCursor`。 */
  cursor?: string;
  /** 默认 100，最多 `SPACE_LIST_MAX_LIMIT`。 */
  limit?: number;
}

/** 按最近活动从新到旧排，同一时刻按 `id`。 */
export interface SpaceListResult {
  entries: SpaceEntry[];
  /** 符合筛选的条目总数（不止这一页）。 */
  total: number;
  /** 还有下一页时给出；目录在两次请求之间变化时，翻页可能漏掉或重复个别条目。 */
  nextCursor: string | null;
  issues: SpaceScanIssue[];
  /** 首次扫描还没完成。 */
  scanning: boolean;
}

/** 内容检索查找的文档种类：转写、字幕、译文与章节（章节的标题与简介）。 */
export type SpaceSearchDocumentKind = 'speech' | 'caption' | 'translation' | 'chapter';

export interface SpaceSearchParams {
  /** 用空白隔开的几个词都要出现（同一段里）；不区分大小写与全角半角。只给 `speaker` 时可以为空。 */
  query: string;
  /** 只找这个项目的视频；`null` 是不属于任何项目的视频。 */
  projectId?: Id | null;
  videoIds?: Id[];
  kinds?: SpaceSearchDocumentKind[];
  /** 说话人的名字里含有这段文字。 */
  speaker?: string;
  /** 默认 50，最多 `SPACE_SEARCH_MAX_LIMIT`。 */
  limit?: number;
}

export interface SpaceSearchHit {
  videoId: Id;
  videoName: string;
  /** 视频在 Space 里的条目；视频目录此刻不在任何来源目录里时为 null。 */
  entryId: Id | null;
  projectId: Id | null;
  /** 章节没有文档。 */
  documentId: Id | null;
  documentKind: SpaceSearchDocumentKind;
  language: string | null;
  /**
   * 时间位置（秒）。`sequence` 是根序列上的时间（文稿经时间线投影，章节在序列上）；`source` 是文档对应素材的源时间
   * （素材不在时间线上、投影不出来时）。以索引时的视频版本为准，打开视频后由客户端按当前版本重新定位（§5.11）。
   */
  time: { clock: 'sequence' | 'source'; start: number; end: number };
  /** 命中所在的那一段文字（太长时截取命中附近）。 */
  snippet: string;
  /** 命中在 `snippet` 里的位置：UTF-16 下标的 `[开始, 结束)`。 */
  highlights: [number, number][];
  speaker: string | null;
  /** 索引时的视频版本。 */
  indexedRevision: string;
}

export interface SpaceSearchResult {
  hits: SpaceSearchHit[];
  /** 索引是否覆盖了范围内的全部视频且都是当前版本。重建或增量更新期间为 false：结果可能缺视频，或是旧版本的。 */
  complete: boolean;
  /** 还没有索引（或正在重建）的视频数。 */
  pendingVideos: number;
  /** 命中超过 `limit`，只返回了前面的。 */
  truncated: boolean;
}

/** 阻止物理删除的一条引用（架构设计 §5.5）。 */
export interface SpaceReference {
  /**
   * `video-asset`：视频的素材引用着这个文件（删除的视频：别的视频链接着它目录里的文件）；`job`：进行中的任务用着它；
   * `unverified`：有视频此刻读不了（引擎不可用、库损坏），无法确认没有引用，按「有引用」处理；
   * `user-file`：删除的视频目录里有不归视频管理的文件（例如按相对路径链接的素材原文件），不替用户删。
   */
  kind: 'video-asset' | 'job' | 'unverified' | 'user-file';
  videoId?: Id;
  videoName?: string;
  assetId?: Id;
  jobId?: Id;
  detail: string;
}

export type SpacePurgeResult = { status: 'purged'; entryId: Id } | { status: 'blocked'; entryId: Id; references: SpaceReference[] };

/**
 * `space.openForEdit`：从条目回到可以编辑的视频（§5.7「从成片回到视频」）。只回答去哪里，不打开视频；客户端拿 `target` 调 `videos.open`。
 *
 * - `video`：条目本身是视频；
 * - `source-video`：有来源视频。`frozenRevision` 是成片（或生成结果）对应的视频版本，`currentRevision` 是视频当前的版本，
 *   二者不同（`changed`）时由客户端提示差异。来源视频此刻不在任何来源目录里时 `target` 为 null；
 * - `new-video`：没有来源视频（独立的文件、图片、音频）：可以「以此素材新建视频」，`projectId` 是建议放进的项目。
 */
export type SpaceOpenForEditResult =
  | { mode: 'video'; videoId: Id | null; target: { entryId: Id } }
  | {
      mode: 'source-video';
      videoId: Id;
      target: { entryId: Id } | null;
      frozenRevision: string | null;
      currentRevision: string | null;
      changed: boolean;
    }
  | { mode: 'new-video'; source: { entryId: Id }; projectId: Id | null };

/** `space.thumbnail` 画面的宽（像素）：会话里的视频卡最宽 360，在 2 倍屏上也清楚；网格卡片更窄。比原图宽时不放大。 */
export const SPACE_THUMBNAIL_WIDTH = 720;
/** `space.thumbnail` 正文摘要最多多少字节（UTF-8，截在字符边界上）。 */
export const SPACE_EXCERPT_MAX_BYTES = 1536;

/**
 * 一个 Space 条目的缩略图（`space.thumbnail`，产品设计 §4.2–§4.3）。按需取，Runtime 缓存；不含本机路径。
 *
 * - `image`：缩小的一帧，宽不超过 `SPACE_THUMBNAIL_WIDTH`、高不超过宽的 3 倍，保持比例，不放大；`data` 是 base64。
 *   视频取当前工作稿的封面那一帧（`posterFrame`）；成片与视频素材取 1 秒与时长的 10% 中较早的一处（视频更短时取第一帧）；
 *   图片缩小。可能带透明的图片（PNG、GIF、WebP）给 PNG，其余给 JPEG。
 * - `text`：文档（md、txt）与字幕（srt、vtt、ass、ssa）开头的正文：UTF-8（带 BOM 的 UTF-16 也认），字幕去掉序号、时间码、
 *   样式与标签，只留台词，一行一句。
 * - `none`：没有可画的：音频、便携包、模板、占位、文件不在了、删除了的视频、视频里没有可见的视频片段、读不了或解不了的文件
 *   （PDF、Word、SVG、HEIC、不是 UTF-8 的文本）。
 */
export type SpaceThumbnail =
  | { kind: 'image'; mimeType: 'image/jpeg' | 'image/png'; data: string; width: number; height: number }
  | { kind: 'text'; excerpt: string }
  | { kind: 'none' };

export interface SpaceRebuildResult {
  /** 重建之后的条目数。 */
  entries: number;
  /** 内容索引还要重建的视频数（在后台进行，期间检索结果标明不完整）。 */
  pendingVideos: number;
}

/**
 * `videos.delete` 的结果（架构设计 §5.5、§5.7）：视频目录整个移进来源目录里的回收站（`.bcut-trash/`），条目留在 Space 的回收站里，
 * `entryId` 不变，可以 `videos.restore`。`related` 是由它生成、导出的条目：它们不随视频删除。
 */
export interface VideoDeleteResult {
  status: 'trashed';
  entryId: Id;
  videoId: Id | null;
  name: string;
  trashedAt: string;
  related: Id[];
}

/** `videos.restore` 的结果：视频回到原来的位置；原位置被占了时换一个名字（`renamed`），这时条目 id 随相对路径变了。 */
export interface VideoRestoreResult {
  entry: SpaceEntry;
  relPath: string;
  renamed: boolean;
}

/**
 * `space.continueInConversation` 的结果（架构设计 §5.7）：接着做的会话（新建的或条目原来的会话）与附上的引用。
 * 不启动任务：引用随用户下一次发送一起发给智能体。
 */
export interface SpaceContinueResult {
  conversation: Conversation;
  created: boolean;
  reference: SpaceEntryReference;
}
