import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  nowIso,
  type Conversation,
  type DirectoryEvent,
  type DirectorySnapshot,
  type Id,
  type JobRecord,
  type Project,
  type SpaceEntry,
  type SpaceEntryKind,
  type SpaceEvent,
  type SpaceOpenForEditResult,
  type SpacePurgeResult,
  type SpaceReference,
  type SpaceScanIssue,
  type SpaceSnapshot,
} from '@baocut/protocol';
import { TopicLog, type Harness, type Logger, type TopicSubscription } from '@baocut/harness';
import {
  EMPTY_MARK,
  artifactIdsOf,
  spaceJobFacts,
  type SpaceArtifactStore,
  type SpaceJobFacts,
  type SpaceMarkStore,
  type TrashedVideo,
} from '@baocut/runtime-storage';
import type { ContentIndex } from './space/content-index.ts';
import {
  deriveEntries,
  type DeriveSource,
  type DerivedEntry,
  type FileStat,
  type ScannedFile,
  type ScannedItem,
} from './space/space-derive.ts';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';

export type { ScannedFile } from './space/space-derive.ts';

/**
 * Space 目录（架构设计 §5.7）。它是派生索引，丢了可以重建；只有用户标记（收藏、显示名、回收站、清除的占位）
 * 与 `space.import` 的登记存在 Runtime Store 里。条目的来源与派生规则见 `space/space-derive.ts`：
 *
 * - 来源目录：登记的项目目录，和不属于项目的会话的工作目录。只收认得出类型的媒体与文档文件，跳过隐藏目录与依赖目录；
 *   含 `video.db` 的目录是一个视频（视频格式规范 §1），整个目录算一个条目，不再往里走。
 *   设计里「只索引登记过的文件、不扫描整个项目目录」（§5.7）还没有做到：界面与会话里的文件列表依赖扫描，见 §14。
 * - Job Ledger（`jobs`）：生成与导出的产物、进行中与失败的占位。Job 事件到来时增量重算。产出产物的任务另记一份派生用事实
 *   （`artifacts`，Runtime Store 的 `space-artifacts.json`）：Ledger 修剪掉旧任务之后，产物条目照样在。
 * - 删除了的视频（`videos.delete`）：视频目录在来源目录的 `.bcut-trash/` 里，记录在 `space.json`，是回收站里的视频条目。
 * - 内容索引（`index`）：视频的 videoId、当前版本与时间线上用到的素材，决定视频条目的 `ref`、`applied` 与 `source-changed`。
 *
 * 每次变化都从这些输入整体重算一遍（纯函数），再与上一次的结果比较，只发变了的条目：增量与重建的结果因此一致。
 */

const KIND_BY_EXT: Record<string, SpaceEntryKind> = {};
for (const [kind, exts] of Object.entries({
  'video-file': ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'bmp', 'avif'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
  subtitle: ['srt', 'vtt', 'ass', 'ssa'],
  document: ['md', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'rtf', 'html', 'htm', 'csv', 'tsv', 'json'],
  // 便携包（视频格式规范 §8）：别处导出的包放进来也认得出。
  package: ['baocut'],
}) as [SpaceEntryKind, string[]][]) {
  for (const ext of exts) KIND_BY_EXT[ext] = kind;
}

export function classifyFile(fileName: string): SpaceEntryKind | null {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return KIND_BY_EXT[ext] ?? null;
}

const IGNORED_DIRS = new Set(['node_modules', '__pycache__', 'Pods', 'DerivedData']);

/** 隐藏文件与目录（含 `.git` 与项目标记目录 `.bcut`）和依赖目录不进 Space，也不往里走。 */
export function isIgnoredName(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

export interface ScanLimits {
  /** 进入子目录的最大深度，来源目录本身是 0。 */
  maxDepth: number;
  /** 每个来源最多收多少个文件。 */
  maxFiles: number;
  /** 每个来源最多看多少个目录项，防止误把很大的目录登记成项目时扫个没完。 */
  maxVisited: number;
}

export const DEFAULT_SCAN_LIMITS: ScanLimits = { maxDepth: 6, maxFiles: 2000, maxVisited: 50_000 };

export interface ScanResult {
  files: ScannedFile[];
  issue: { kind: SpaceScanIssue['kind']; detail: string } | null;
}

/** 扫一个来源目录。目录不存在算空；读不了根目录算问题；子目录读不了就跳过。不跟随符号链接。 */
export async function scanDirectory(root: string, limits: ScanLimits = DEFAULT_SCAN_LIMITS): Promise<ScanResult> {
  const files: ScannedFile[] = [];
  const queue: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: '', depth: 0 }];
  let visited = 0;
  while (queue.length > 0) {
    const { dir, rel, depth } = queue.shift()!;
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (depth > 0) continue;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { files, issue: null };
      return { files, issue: { kind: 'unreadable', detail: RcSpace.dirUnreadable({ code: code ?? 'error' }).text } };
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      if (++visited > limits.maxVisited) {
        return { files, issue: { kind: 'truncated', detail: RcSpace.tooManyDirEntries({ max: limits.maxVisited }).text } };
      }
      if (isIgnoredName(dirent.name)) continue;
      const relPath = rel ? `${rel}/${dirent.name}` : dirent.name;
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        const video = await inspectVideoDir(full);
        if (video) {
          if (files.length >= limits.maxFiles) {
            return { files, issue: { kind: 'truncated', detail: RcSpace.tooManyFiles({ max: limits.maxFiles }).text } };
          }
          files.push({ relPath, kind: 'video', ...video });
        } else if (depth < limits.maxDepth) queue.push({ dir: full, rel: relPath, depth: depth + 1 });
        continue;
      }
      if (!dirent.isFile()) continue;
      const kind = classifyFile(dirent.name);
      if (!kind) continue;
      if (files.length >= limits.maxFiles) {
        return { files, issue: { kind: 'truncated', detail: RcSpace.tooManyFiles({ max: limits.maxFiles }).text } };
      }
      try {
        const stat = await fsp.stat(full);
        files.push({ relPath, kind, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // 扫描期间被删掉了。
      }
    }
  }
  return { files, issue: null };
}

/**
 * 视频目录的大小与最近活动：`video.db` 加上受管理的素材；WAL 里还没合并的写入也算活动。
 * 不是视频目录返回 null。不打开数据库，不碰写入锁。
 */
async function inspectVideoDir(dir: string): Promise<{ size: number; mtimeMs: number } | null> {
  // 改名之前的目录只有 `movie.db`：照样列出，引擎打开它时就地升级成 `video.db`。
  const current = await fsp.stat(path.join(dir, 'video.db')).catch(() => null);
  const dbFile = current ? 'video.db' : 'movie.db';
  const db = current ?? (await fsp.stat(path.join(dir, dbFile)).catch(() => null));
  if (!db?.isFile()) return null;
  let size = db.size;
  let mtimeMs = db.mtimeMs;
  const wal = await fsp.stat(path.join(dir, `${dbFile}-wal`)).catch(() => null);
  if (wal) {
    size += wal.size;
    mtimeMs = Math.max(mtimeMs, wal.mtimeMs);
  }
  const blobs = await fsp.readdir(path.join(dir, 'blobs'), { withFileTypes: true }).catch(() => []);
  for (const blob of blobs) {
    if (!blob.isFile() || blob.name.startsWith('.')) continue;
    const stat = await fsp.stat(path.join(dir, 'blobs', blob.name)).catch(() => null);
    if (stat) size += stat.size;
  }
  return { size, mtimeMs };
}

/** Space 目录读 Job Ledger 用到的那一部分（`JobManager`）。 */
export interface SpaceJobsSource {
  list(): JobRecord[];
  onChange(listener: (job: JobRecord) => void): () => void;
  artifacts: { locate(artifactId: string): Promise<string | null> };
}

/** 已打开视频的版本变化（`VideoService.onChange`）。 */
export interface SpaceVideoEvents {
  onChange(listener: (change: { videoId: Id; path: string; revision: string }) => void): () => void;
}

export interface SpaceCatalogOptions {
  harness: Harness;
  marks: SpaceMarkStore;
  log: Logger;
  /** 监视来源目录的变化。测试里关掉，改用 `rescan()`。 */
  watch?: boolean;
  debounceMs?: number;
  limits?: ScanLimits;
  jobs?: SpaceJobsSource;
  /** 产出产物的任务的派生用事实，不随 Job Ledger 修剪丢失。没有时只看 Ledger。 */
  artifacts?: SpaceArtifactStore;
  videos?: SpaceVideoEvents;
  index?: ContentIndex;
}

/** 回收站目录：在来源目录里（与视频目录同一个卷，移动是改名），隐藏目录不进 Space 的扫描。 */
export const TRASH_DIR = '.bcut-trash';

/** 视频目录里归视频管理的文件：物理删除只删这些（视频格式规范 §1）。 */
const VIDEO_OWNED = /^(video|movie)\.(db|db-wal|db-shm|db-journal|lock)$|^blobs$|^\.DS_Store$/;

/** 一个删除了的视频：回收站里的条目 id、记录与来源。 */
export interface TrashedVideoInfo {
  entryId: Id;
  record: TrashedVideo;
  /** 来源目录；来源不在了（项目被移除）时 null。 */
  root: string | null;
}

/** 来源目录里的一个视频条目的位置（删除视频用）。 */
export interface VideoEntryInfo {
  entry: SpaceEntry;
  dir: string;
  root: string;
  sourceKey: string;
  relPath: string;
  scope: { projectId: Id } | { conversationId: Id };
}

/** 一个视频条目与它在内容索引里的记录。 */
export interface SpaceVideo {
  entryId: Id;
  dir: string;
  projectId: Id | null;
  conversationId: Id | null;
  lastActivityAt: string;
  videoId: Id | null;
}

export class SpaceCatalog {
  readonly #harness: Harness;
  readonly #marks: SpaceMarkStore;
  readonly #log: Logger;
  readonly #watch: boolean;
  readonly #debounceMs: number;
  readonly #limits: ScanLimits;
  readonly #jobs: SpaceJobsSource | null;
  readonly #artifacts: SpaceArtifactStore | null;
  readonly #index: ContentIndex | null;
  readonly #topic: TopicLog<SpaceSnapshot, SpaceEvent>;
  readonly #sources = new Map<string, DeriveSource>();
  /** 会话属于哪个项目：会话里生成的产物归到那个项目。 */
  readonly #conversationProjects = new Map<Id, Id | null>();
  readonly #files = new Map<Id, ScannedItem>();
  #derived = new Map<Id, DerivedEntry>();
  /** 派生时用的文件状态缓存：产物文件、来源目录之外的发布路径。 */
  #artifactStats = new Map<string, FileStat | null>();
  #pathStats = new Map<string, FileStat | null>();
  readonly #issues = new Map<string, SpaceScanIssue>();
  readonly #watchers = new Map<string, fs.FSWatcher>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  readonly #unsubscribe: (() => void)[] = [];
  #directory: TopicSubscription<unknown, unknown> | null = null;
  #recomputeTimer: ReturnType<typeof setTimeout> | null = null;
  #queue: Promise<void> = Promise.resolve();
  #scanning = true;
  #closed = false;
  /** 首次扫描完成。 */
  readonly ready: Promise<void>;
  #markReady!: () => void;

  constructor(options: SpaceCatalogOptions) {
    this.#harness = options.harness;
    this.#marks = options.marks;
    this.#log = options.log.child('space');
    this.#watch = options.watch ?? true;
    this.#debounceMs = options.debounceMs ?? 400;
    this.#limits = options.limits ?? DEFAULT_SCAN_LIMITS;
    this.#jobs = options.jobs ?? null;
    this.#artifacts = options.artifacts ?? null;
    this.#index = options.index ?? null;
    this.#topic = new TopicLog(() => this.snapshot(), '0');
    this.ready = new Promise((resolve) => (this.#markReady = resolve));
    if (this.#jobs) {
      this.#unsubscribe.push(
        this.#jobs.onChange((job) => {
          this.#retain([job]);
          this.#scheduleRecompute();
        }),
      );
    }
    // 内容索引里有视频更新了：重算派生状态（`ref`、`applied`、`source-changed`）。
    if (this.#index) this.#unsubscribe.push(this.#index.listen(() => this.#scheduleRecompute()));
    if (options.videos && this.#index) {
      const index = this.#index;
      this.#unsubscribe.push(options.videos.onChange((change) => index.touched(change.path, change.revision)));
    }
  }

  /** 跟着目录主题登记来源，然后做首次扫描。不等扫描完成就返回。 */
  start(): void {
    this.#directory = this.#harness.subscribe('directory', undefined, (event) => this.#onDirectory(event.event as DirectoryEvent));
    const initial = this.#directory.result;
    if (initial.mode === 'snapshot') {
      const snapshot = initial.snapshot as DirectorySnapshot;
      for (const project of snapshot.projects) this.#addProject(project, false);
      for (const conversation of snapshot.conversations) this.#addConversation(conversation, false);
    }
    // 先把 Ledger 里还在的产物任务补进产物记录、按目录实际在哪里核对删除了的视频，再做首次扫描：条目不会先消失再出现。
    void this.#enqueue(async () => {
      if (this.#jobs) this.#retain(this.#jobs.list());
      await this.#reconcileTrash();
      await this.#scanAll();
    }).finally(() => {
      this.#scanning = false;
      this.#topic.publish({ type: 'catalog.replaced', snapshot: this.snapshot() });
      this.#markReady();
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#directory?.unsubscribe();
    for (const unsubscribe of this.#unsubscribe) unsubscribe();
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    if (this.#recomputeTimer) clearTimeout(this.#recomputeTimer);
    for (const watcher of this.#watchers.values()) watcher.close();
    this.#watchers.clear();
    await this.#queue.catch(() => {});
    await this.#index?.close();
    await this.#marks.flush().catch(() => {});
    await this.#artifacts?.flush().catch(() => {});
  }

  /** 排队中的扫描、重算与内容索引都做完（测试用）。 */
  async idle(): Promise<void> {
    for (;;) {
      await this.#index?.idle();
      await this.#queue;
      if (!this.#recomputeTimer && !this.#index?.busy) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  snapshot(): SpaceSnapshot {
    return { entries: this.entries(), issues: [...this.#issues.values()], scanning: this.#scanning };
  }

  /** 全部条目，按最近活动从新到旧，同一时刻按 id。 */
  entries(): SpaceEntry[] {
    const entries = [...this.#derived.values()].map((d) => d.entry);
    entries.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : a.id < b.id ? -1 : 1));
    return entries;
  }

  issues(): SpaceScanIssue[] {
    return [...this.#issues.values()];
  }

  get scanning(): boolean {
    return this.#scanning;
  }

  get(entryId: Id): SpaceEntry {
    const derived = this.#derived.get(entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone());
    return derived.entry;
  }

  /** 来源目录里的全部视频条目（内容检索的范围），按最近活动从新到旧。 */
  videos(): SpaceVideo[] {
    const videos: SpaceVideo[] = [];
    for (const derived of this.#derived.values()) {
      if (!derived.videoDir) continue;
      const { entry } = derived;
      videos.push({
        entryId: entry.id,
        dir: derived.videoDir,
        projectId: entry.source.projectId,
        conversationId: entry.source.conversationId,
        lastActivityAt: entry.lastActivityAt,
        videoId: entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : null,
      });
    }
    videos.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0));
    return videos;
  }

  /** 全部来源目录（项目目录、没有项目的会话的工作目录）。 */
  sourceRoots(): string[] {
    return [...this.#sources.values()].map((source) => source.root);
  }

  get index(): ContentIndex | null {
    return this.#index;
  }

  subscribe(afterSeq: string | undefined, listener: Parameters<TopicLog<SpaceSnapshot, SpaceEvent>['subscribe']>[1]) {
    return this.#topic.subscribe(afterSeq, listener);
  }

  /** 立即重扫全部来源，完成后发一条 `catalog.replaced`。 */
  rescan(): Promise<void> {
    return this.#enqueue(async () => {
      await this.#scanAll();
      this.#topic.publish({ type: 'catalog.replaced', snapshot: this.snapshot() });
    });
  }

  /**
   * 丢掉全部派生数据（扫描结果、文件状态缓存、内容索引）从权威来源重建（§5.7「可重建」）。用户标记与登记不动。
   * 目录在返回前重建完：重扫与重查都先算出新的再整体换上，期间的查询仍看到旧的目录。内容索引删掉缓存后在后台重建，
   * 期间检索结果标明不完整。
   */
  rebuild(): Promise<{ entries: number; pendingVideos: number }> {
    let pendingVideos = 0;
    return this.#enqueue(async () => {
      if (this.#index) await this.#index.rebuild();
      await this.#scanAll();
      pendingVideos = this.#index?.pendingCount() ?? 0;
      this.#topic.publish({ type: 'catalog.replaced', snapshot: this.snapshot() });
    }).then(() => ({ entries: this.#derived.size, pendingVideos }));
  }

  /** 用户标记：收藏、显示名、回收站。只写标记，不碰文件。 */
  async update(params: { entryId: Id; favorite?: boolean; displayName?: string | null; trashed?: boolean }): Promise<SpaceEntry> {
    const derived = this.#derived.get(params.entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone());
    // 视频进出回收站是移动目录（`videos.delete` / `videos.restore`），方法层已经转过去了；这里只防直接调用。
    if (params.trashed === true && derived.videoDir && !derived.entry.user.trashedAt) {
      throw new RpcError('invalid-request', RcSpace.trashVideoUseDelete(), { code: 'SPACE_TRASH_VIDEO' });
    }
    if (params.trashed === false && derived.location.kind === 'trash') {
      throw new RpcError('invalid-request', RcSpace.restoreVideoUseRestore(), { code: 'SPACE_TRASH_VIDEO' });
    }
    const mark = { ...this.#marks.get(params.entryId) };
    if (params.favorite !== undefined) mark.favorite = params.favorite;
    if (params.displayName !== undefined) mark.displayName = params.displayName?.trim() || null;
    if (params.trashed !== undefined) mark.trashedAt = params.trashed ? (mark.trashedAt ?? nowIso()) : null;
    await this.#marks.put(params.entryId, mark);
    // 等写盘的时候条目可能被重扫拿掉了。
    this.#recompute(true);
    return this.get(params.entryId);
  }

  /** 媒体通道与打开视频用：来源目录里的条目对应的来源目录与文件，以及来源（项目或会话）。 */
  locate(entryId: Id): { root: string; file: string; scope: { projectId: Id } | { conversationId: Id } } {
    const derived = this.#derived.get(entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone());
    const location = derived.location;
    if (location.kind === 'trash') throw new RpcError('conflict', RcSpace.videoDeletedRestoreFirst(), { code: 'VIDEO_TRASHED' });
    const source = location.kind === 'source' ? this.#sources.get(location.sourceKey) : undefined;
    if (location.kind !== 'source' || !source) throw new RpcError('not-found', RcSpace.notInSourceDir());
    const scope = source.projectId ? { projectId: source.projectId } : { conversationId: source.conversationId! };
    return { root: source.root, file: path.join(source.root, ...location.relPath.split('/')), scope };
  }

  /**
   * 媒体通道用：条目 bytes 的位置，只给受限句柄（§5.6）。来源目录里的按来源目录限定；产物与来源目录之外的导出
   * 限定到那一个文件所在的目录（句柄只放行这一个文件）。没有 bytes 的（占位、缺失）是 not-found。
   */
  locateBytes(entryId: Id): { root: string; file: string } {
    const derived = this.#derived.get(entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone());
    const location = derived.location;
    if (location.kind === 'source' || location.kind === 'trash') return this.locate(entryId);
    if (location.kind === 'artifact' || location.kind === 'file') return { root: path.dirname(location.path), file: location.path };
    throw new RpcError('not-found', derived.entry.status === 'generating' ? RcSpace.stillGeneratingNoFile() : RcSpace.noReadableFile());
  }

  /**
   * 工具的 Space 条目输入（架构设计 §7.9）：条目对应的、能读的文件。条目不在 `not-found`；在回收站里 `conflict`
   * （`SPACE_ENTRY_TRASHED`）；种类不在 `kinds` 里（含视频条目）`invalid-request`（`SPACE_ENTRY_UNSUPPORTED`）；
   * 没有可读的文件（占位、缺失、来源不在了）`conflict`（`SPACE_ENTRY_NO_FILE`）。种类先于文件判断：种类不会变，文件可以恢复。
   */
  resolveFile(entryId: Id, kinds: readonly SpaceEntryKind[]): { entry: SpaceEntry; file: string } {
    const derived = this.#derived.get(entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone(), { entryId });
    const { entry, location } = derived;
    if (location.kind === 'trash' || entry.user.trashedAt) {
      throw new RpcError('conflict', RcSpace.entryInTrash(), { code: 'SPACE_ENTRY_TRASHED', entryId });
    }
    if (derived.videoDir || !kinds.includes(entry.kind)) {
      throw new RpcError('invalid-request', RcSpace.entryKindNotAccepted({ kind: entry.kind }), {
        code: 'SPACE_ENTRY_UNSUPPORTED',
        entryId,
        kind: entry.kind,
        accepted: [...kinds],
      });
    }
    const noFile = () =>
      new RpcError('conflict', entry.status === 'generating' ? RcSpace.entryStillGeneratingNoFile() : RcSpace.noReadableFile(), {
        code: 'SPACE_ENTRY_NO_FILE',
        entryId,
      });
    if (entry.status === 'missing' || entry.status === 'generating' || entry.status === 'failed') throw noFile();
    let file: string;
    try {
      file = this.locateBytes(entryId).file;
    } catch (error) {
      if (error instanceof RpcError && error.code === 'not-found') throw noFile();
      throw error;
    }
    if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) throw noFile();
    return { entry, file };
  }

  /**
   * 把一个文件登记为项目的素材（§5.7「项目里不属于视频的文件」），不放进任何视频。项目目录里的文件原地登记；
   * 项目之外的复制进项目的 `imports/`（重名时加序号）。`file` 是调用方给的绝对路径。
   */
  async importFile(params: { projectId: Id; file: string; name?: string }): Promise<{ entry: SpaceEntry; copied: boolean }> {
    const key = `project:${params.projectId}`;
    const source = this.#sources.get(key);
    if (!source) throw new RpcError('not-found', RcSpace.projectNotFound());
    if (!path.isAbsolute(params.file)) throw new RpcError('invalid-request', RcSpace.needAbsolutePath());
    const real = await fsp.realpath(params.file).catch(() => null);
    const stat = real ? await fsp.stat(real).catch(() => null) : null;
    if (!real || !stat?.isFile()) throw new RpcError('not-found', RcSpace.fileNotFound());
    const kind = classifyFile(real);
    if (!kind)
      throw new RpcError('invalid-request', RcSpace.unrecognizedFileType(), {
        code: 'SPACE_IMPORT_UNSUPPORTED',
      });
    const rootReal = await fsp.realpath(source.root).catch(() => null);
    if (!rootReal) throw new RpcError('not-found', RcSpace.projectDirNotFound());
    let relPath: string;
    let copied = false;
    const inside = path.relative(rootReal, real);
    if (inside && !inside.startsWith('..') && !path.isAbsolute(inside)) {
      const parts = inside.split(path.sep);
      if (parts.some(isIgnoredName)) {
        throw new RpcError('invalid-request', RcSpace.hiddenDirFile(), { code: 'SPACE_IMPORT_UNSUPPORTED' });
      }
      for (let i = 1; i < parts.length; i++) {
        if (await inspectVideoDir(path.join(rootReal, ...parts.slice(0, i)))) {
          throw new RpcError('invalid-request', RcSpace.videoDirFile(), { code: 'SPACE_IMPORT_UNSUPPORTED' });
        }
      }
      relPath = parts.join('/');
    } else {
      const dir = path.join(rootReal, 'imports');
      await fsp.mkdir(dir, { recursive: true });
      relPath = await copyUnique(real, dir);
      relPath = `imports/${relPath}`;
      copied = true;
    }
    const id = entryIdOf(key, relPath);
    await this.#marks.putImport(id, {
      projectId: params.projectId,
      relPath,
      importedAt: nowIso(),
      copiedFrom: copied ? path.basename(real) : null,
    });
    if (params.name) await this.#marks.put(id, { ...this.#marks.get(id), displayName: params.name.trim() });
    await this.#enqueue(() => this.#rescanSource(key));
    return { entry: this.get(id), copied };
  }

  /**
   * 物理删除（§5.5、§5.7）。来源目录里的视频条目拒绝（先 `videos.delete`）；删除了的视频见 `#purgeVideo`；进行中的占位拒绝；
   * 失败的占位清除即可。其余只删回收站里的条目，先查引用：链接着这个文件的视频素材、用着这个产物的进行中任务；有视频此刻读不了时
   * 无法确认，按有引用处理（fail closed）。有引用时什么也不删，返回引用。
   */
  async purge(entryId: Id): Promise<SpacePurgeResult> {
    const derived = this.#derived.get(entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone());
    const { entry, location } = derived;
    if (location.kind === 'trash') return this.#purgeVideo(entryId, location);
    if (entry.kind === 'video' && derived.videoDir) {
      throw new RpcError('invalid-request', RcSpace.purgeVideoDeleteFirst(), {
        code: 'SPACE_PURGE_VIDEO',
      });
    }
    if (entry.status === 'generating') {
      throw new RpcError('conflict', RcSpace.purgeTaskRunning(), { code: 'SPACE_PURGE_RUNNING', jobId: entryId });
    }
    if (entry.status === 'failed' && entry.ref && 'jobId' in entry.ref) {
      await this.#marks.put(entryId, { ...this.#marks.get(entryId), dismissedAt: nowIso() });
      this.#recompute(true);
      return { status: 'purged', entryId };
    }
    if (!entry.user.trashedAt) {
      throw new RpcError('conflict', RcSpace.purgeNotTrashed(), { code: 'SPACE_NOT_TRASHED' });
    }
    const file = location.kind === 'source' ? this.locate(entryId).file : location.kind === 'none' ? null : location.path;
    const references = file ? await this.#references(entry, file) : [];
    if (references.length > 0) return { status: 'blocked', entryId, references };
    if (file) await fsp.rm(file, { force: true });
    await this.#marks.remove(entryId);
    // 导出与扫描到的文件合成一个条目：文件删了之后不要再以「缺失」的产物出现。
    const artifactId = entry.ref && 'artifactId' in entry.ref ? entry.ref.artifactId : null;
    if (artifactId) {
      await this.#marks.put(artifactId, { ...EMPTY_MARK, dismissedAt: nowIso() });
      await this.#pruneRetained();
    }
    await this.#enqueue(async () => {
      if (location.kind === 'source') await this.#rescanSource(location.sourceKey);
      await this.#refreshStats(true);
      this.#recompute(true);
    });
    return { status: 'purged', entryId };
  }

  /** 从条目回到可以编辑的视频（§5.7「从成片回到视频」）。只回答去哪里，不打开视频。 */
  openForEdit(entryId: Id): SpaceOpenForEditResult {
    const derived = this.#derived.get(entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone());
    if (derived.location.kind === 'trash') throw new RpcError('conflict', RcSpace.videoDeletedRestoreFirst(), { code: 'VIDEO_TRASHED' });
    const { entry } = derived;
    if (derived.videoDir) {
      return { mode: 'video', videoId: entry.ref && 'videoId' in entry.ref ? entry.ref.videoId : null, target: { entryId } };
    }
    const videoId = entry.origin?.videoId;
    if (videoId) {
      const video = this.videos().find((v) => v.videoId === videoId) ?? null;
      const current = video && this.#index ? (this.#index.at(video.dir)?.revision ?? null) : null;
      const frozen = entry.origin?.videoRevision ?? null;
      return {
        mode: 'source-video',
        videoId,
        target: video ? { entryId: video.entryId } : null,
        frozenRevision: frozen,
        currentRevision: current,
        changed: frozen !== null && current !== null && frozen !== current,
      };
    }
    return { mode: 'new-video', source: { entryId }, projectId: entry.source.projectId ?? entry.origin?.projectId ?? null };
  }

  // ---- 删除的视频（§5.5、§5.7）----

  /** 来源目录里的视频条目与它的位置。不是视频、已经删除或不在来源目录里时报错。 */
  videoEntry(entryId: Id): VideoEntryInfo {
    const derived = this.#derived.get(entryId);
    if (!derived) throw new RpcError('not-found', RcSpace.entryGone());
    if (derived.location.kind === 'trash') throw new RpcError('conflict', RcSpace.videoDeleted(), { code: 'VIDEO_TRASHED' });
    if (!derived.videoDir || derived.location.kind !== 'source') {
      throw new RpcError('invalid-request', RcSpace.notVideo(), { code: 'SPACE_ENTRY_NOT_VIDEO' });
    }
    const location = this.locate(entryId);
    return {
      entry: derived.entry,
      dir: derived.videoDir,
      root: location.root,
      sourceKey: derived.location.sourceKey,
      relPath: derived.location.relPath,
      scope: location.scope,
    };
  }

  /** 来源目录里、真实路径是 `dir` 的视频条目；没有时 null。刚建的视频可能还没扫到：先重扫它所在的来源再找一次。 */
  async videoEntryAt(dir: string): Promise<VideoEntryInfo | null> {
    const real = await fsp.realpath(dir).catch(() => null);
    if (!real) return null;
    const find = async () => {
      for (const video of this.videos()) {
        if (video.dir === real || (await fsp.realpath(video.dir).catch(() => null)) === real) return this.videoEntry(video.entryId);
      }
      return null;
    };
    const found = await find();
    if (found || !(await isVideoDir(real))) return found;
    const within = [...this.#sources.values()].filter((s) => real.startsWith(s.realRoot + path.sep) || real.startsWith(s.root + path.sep));
    if (within.length === 0) return null;
    for (const source of within) await this.refreshSource(source.key);
    return find();
  }

  /** 删除了的视频：按回收站里的条目 id，或删除之前的条目 id（撤销用）。没有时 null。 */
  trashedVideo(entryId: Id): TrashedVideoInfo | null {
    const trashed = this.#marks.trashedVideos();
    let id: Id | null = trashed.has(entryId) ? entryId : null;
    if (!id && !this.#derived.has(entryId)) {
      for (const [key, record] of trashed) if (record.formerEntryId === entryId) id = key;
    }
    if (!id) return null;
    const record = trashed.get(id)!;
    return { entryId: id, record, root: this.#sources.get(record.sourceKey)?.root ?? null };
  }

  /** 回收站里的条目 id：来源键与在回收站里的相对路径决定。 */
  trashEntryId(sourceKey: string, trashRelPath: string): Id {
    return entryIdOf(sourceKey, trashRelPath);
  }

  /** 记下要删除的视频（移动目录之前）。 */
  recordTrashedVideo(entryId: Id, record: TrashedVideo): Promise<void> {
    return this.#marks.putTrashedVideo(entryId, record);
  }

  /** 视频回到了来源目录（恢复，或删除没有完成）：去掉记录，标记搬到 `relPath` 的条目，重扫来源。返回新的条目 id。 */
  async releaseTrashedVideo(entryId: Id, record: TrashedVideo, relPath: string): Promise<Id> {
    const to = entryIdOf(record.sourceKey, relPath);
    await this.#marks.dropTrashedVideo(entryId, to);
    await this.refreshSource(record.sourceKey);
    return to;
  }

  /** 重扫一个来源并重算（移动了视频目录之后）。 */
  refreshSource(sourceKey: string): Promise<void> {
    return this.#enqueue(async () => {
      await this.#rescanSource(sourceKey);
      this.#recompute(true);
    });
  }

  /**
   * 回收站的保留期（§5.7）：移入回收站超过 `days` 天的条目逐个物理删除，与 `space.purge` 同一条路径：有引用的留着，
   * 来源目录里的视频（旧版本只写了回收站标记的）跳过。返回删了几个、留着几个。
   */
  async sweepTrash(days: number, now = Date.now()): Promise<{ purged: number; kept: number }> {
    const cutoff = now - days * 86_400_000;
    const result = { purged: 0, kept: 0 };
    const due = this.entries().filter((e) => e.user.trashedAt !== null && Date.parse(e.user.trashedAt) <= cutoff);
    for (const entry of due) {
      if (this.#closed) break;
      const derived = this.#derived.get(entry.id);
      if (!derived || (derived.videoDir && derived.location.kind === 'source') || entry.status === 'generating') {
        result.kept++;
        continue;
      }
      try {
        const purged = await this.purge(entry.id);
        if (purged.status === 'purged') result.purged++;
        else {
          result.kept++;
          this.#log.info('Expired trash item still has references; kept', { entryId: entry.id, references: purged.references.length });
        }
      } catch (error) {
        result.kept++;
        this.#log.warn('Expired trash item was not deleted', { entryId: entry.id, error: String(error) });
      }
    }
    if (result.purged > 0 || result.kept > 0) this.#log.info('Trash retention cleanup', { days, ...result });
    return result;
  }

  /**
   * 物理删除一个删除了的视频：查引用（别的视频链接着它目录里的文件、用着它的进行中任务、此刻读不了的视频），再查目录里有没有
   * 不归视频管理的文件；都没有时只删归视频管理的文件（数据库、锁、`blobs/`），再删掉空的目录。链接素材的原文件不在视频目录里，不碰。
   */
  async #purgeVideo(entryId: Id, location: { sourceKey: string; relPath: string }): Promise<SpacePurgeResult> {
    const record = this.#marks.trashedVideos().get(entryId);
    const source = this.#sources.get(location.sourceKey);
    if (!record || !source) throw new RpcError('not-found', RcSpace.videoSourceGone());
    const dir = path.join(source.root, ...location.relPath.split('/'));
    const original = path.join(source.root, ...record.relPath.split('/'));
    const roots = new Set([
      dir,
      original,
      path.join(source.realRoot, ...location.relPath.split('/')),
      path.join(source.realRoot, ...record.relPath.split('/')),
    ]);
    const inside = (file: string) => [...roots].some((d) => file.startsWith(d + path.sep));
    const references = await this.#linkReferences(
      async (linked) => inside(linked) || inside(await fsp.realpath(linked).catch(() => linked)),
    );
    if (record.videoId && this.#jobs) {
      for (const job of this.#jobs.list()) {
        if (job.videoId !== record.videoId) continue;
        if (job.state === 'queued' || job.state === 'running') {
          references.push({ kind: 'job', jobId: job.jobId, videoId: record.videoId, detail: RcSpace.refRunningTaskUsesVideo({ jobId: job.jobId }).text });
        } else if (job.state === 'needs-reconciliation') {
          // 结果还等用户决定（`jobs.reconcile apply` 会写进这个视频）：删除可以撤销，物理删除不行。
          references.push({
            kind: 'job',
            jobId: job.jobId,
            videoId: record.videoId,
            detail: RcSpace.refTaskAwaitsDecision({ jobId: job.jobId }).text,
          });
        }
      }
    }
    const names = await fsp.readdir(dir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const strays = (names ?? []).filter((name) => !VIDEO_OWNED.test(name));
    if (strays.length > 0) {
      references.push({
        kind: 'user-file',
        detail: RcSpace.refStrayFiles({ names: strays.slice(0, 3).join('/'), total: strays.length }).text,
      });
    }
    if (references.length > 0) return { status: 'blocked', entryId, references };
    for (const name of names ?? []) await fsp.rm(path.join(dir, name), { recursive: true, force: true });
    await fsp.rmdir(dir).catch(() => {});
    await fsp.rmdir(path.dirname(dir)).catch(() => {});
    await fsp.rmdir(path.join(source.root, TRASH_DIR)).catch(() => {});
    await this.#marks.remove(entryId);
    this.#log.info('Video permanently deleted', { entryId, videoId: record.videoId });
    await this.#enqueue(async () => this.#recompute(true));
    return { status: 'purged', entryId };
  }

  /**
   * 启动时核对删除了的视频（§5.7）：记录写了、目录没有移过去（删除时崩溃），或已经移回来、记录没删（恢复时崩溃）时去掉记录；
   * 两处都没有（被外部删掉了）时连同标记一起去掉。来源还没登记的留到下次。
   */
  async #reconcileTrash(): Promise<void> {
    for (const [entryId, record] of [...this.#marks.trashedVideos()]) {
      const source = this.#sources.get(record.sourceKey);
      if (!source) continue;
      const inTrash = await isVideoDir(path.join(source.root, ...record.trashRelPath.split('/')));
      if (inTrash) continue;
      const atOriginal = await isVideoDir(path.join(source.root, ...record.relPath.split('/')));
      if (atOriginal) await this.#marks.dropTrashedVideo(entryId, entryIdOf(record.sourceKey, record.relPath));
      else await this.#marks.remove(entryId);
      this.#log.info('Deleted video record did not match its folder; followed the folder', { entryId, atOriginal });
    }
  }

  // ---- 产物记录（§14「Space 与 Job Ledger 的保留」）----

  /** 任务输入：Ledger 里的任务，加上产物记录里 Ledger 已经修剪掉的。 */
  #jobFacts(): SpaceJobFacts[] {
    const live = this.#jobs?.list() ?? [];
    if (!this.#artifacts) return live;
    const seen = new Set(live.map((job) => job.jobId));
    return [...live, ...this.#artifacts.list().filter((facts) => !seen.has(facts.jobId))];
  }

  /** 结束了、有产物的任务记进产物记录（已经全部清除了的不再记）。 */
  #retain(jobs: readonly JobRecord[]): void {
    if (!this.#artifacts) return;
    const records = jobs.flatMap((job) => {
      const facts = spaceJobFacts(job);
      if (!facts) return [];
      const ids = artifactIdsOf(facts);
      return ids.length > 0 && ids.every((id) => this.#marks.get(id).dismissedAt) ? [] : [facts];
    });
    if (records.length > 0) void this.#artifacts.put(records).catch((error) => this.#log.warn('Writing output records failed', { error: String(error) }));
  }

  /** 产物全部物理删除或清除了的记录去掉；Ledger 里也没有这个任务时，清除标记也不再需要。 */
  async #pruneRetained(): Promise<void> {
    if (!this.#artifacts) return;
    const live = new Set((this.#jobs?.list() ?? []).map((job) => job.jobId));
    const done: Id[] = [];
    for (const facts of this.#artifacts.list()) {
      const ids = artifactIdsOf(facts);
      if (ids.length === 0 || !ids.every((id) => this.#marks.get(id).dismissedAt)) continue;
      done.push(facts.jobId);
      if (!live.has(facts.jobId)) for (const id of ids) await this.#marks.remove(id);
    }
    await this.#artifacts.remove(done);
  }

  // ---- 引用 ----

  async #references(entry: SpaceEntry, file: string): Promise<SpaceReference[]> {
    const real = await fsp.realpath(file).catch(() => file);
    const references = await this.#linkReferences(async (linked) => {
      if (path.basename(linked) !== path.basename(file) && path.basename(linked) !== path.basename(real)) return false;
      return linked === file || (await fsp.realpath(linked).catch(() => linked)) === real;
    });
    const artifactId = entry.ref && 'artifactId' in entry.ref ? entry.ref.artifactId : null;
    if (artifactId && this.#jobs) {
      for (const job of this.#jobs.list()) {
        if (job.state !== 'queued' && job.state !== 'running') continue;
        if (!JSON.stringify(job).includes(artifactId)) continue;
        references.push({ kind: 'job', jobId: job.jobId, detail: RcSpace.refRunningTaskUsesOutput({ jobId: job.jobId }).text });
      }
    }
    return references;
  }

  /** 来源目录里的视频的链接素材里，`matches` 的；有视频此刻读不了或索引没跟上时记 `unverified`。 */
  async #linkReferences(matches: (linkedPath: string) => Promise<boolean>): Promise<SpaceReference[]> {
    const references: SpaceReference[] = [];
    const index = this.#index;
    for (const video of this.videos()) {
      const indexed = index?.at(video.dir) ?? null;
      if (!indexed || (index && index.pendingCount([video.dir]) > 0)) {
        references.push({
          kind: 'unverified',
          ...(video.videoId ? { videoId: video.videoId } : {}),
          detail: RcSpace.refVideoUnreadable({ dir: path.basename(video.dir) }).text,
        });
        continue;
      }
      for (const linked of indexed.facts.linkedFiles) {
        if (!(await matches(linked.path))) continue;
        references.push({
          kind: 'video-asset',
          videoId: indexed.videoId,
          videoName: indexed.name,
          assetId: linked.assetId,
          detail: RcSpace.refVideoAssetLinks({ video: indexed.name, asset: linked.name }).text,
        });
      }
    }
    return references;
  }

  // ---- 来源 ----

  #onDirectory(event: DirectoryEvent): void {
    if (this.#closed) return;
    if (event.type === 'project.upsert') {
      this.#addProject(event.project, true);
    } else if (event.type === 'conversation.upsert') {
      // 回合结束等活动变化后重扫一次它的工作目录：监视失效（目录刚建好、平台不支持）时也不会漏。
      if (!this.#addConversation(event.conversation, true)) this.#schedule(sourceKeyOf(event.conversation));
      // 会话改属项目会改变它的产物的归属。
      this.#scheduleRecompute();
    } else if (event.type === 'conversation.removed') {
      this.#removeSource(`conv:${event.conversationId}`);
    }
  }

  #addProject(project: Project, scan: boolean): boolean {
    const key = `project:${project.id}`;
    // 项目目录被移动或改名（架构设计 §5.1）：来源换到新路径。条目 id 只由来源键与相对路径决定，用户标记跟得上。
    const existing = this.#sources.get(key);
    if (existing && existing.root !== project.path) this.#removeSource(key);
    return this.#addSource({ key, root: project.path, realRoot: project.path, projectId: project.id, conversationId: null }, scan);
  }

  #addConversation(conversation: Conversation, scan: boolean): boolean {
    this.#conversationProjects.set(conversation.id, conversation.projectId ?? null);
    if (conversation.projectId) {
      // 无项目会话绑定了项目（§3.10）：它的工作目录不再是来源，东西已经搬进项目，由项目来源列出。条目 id 随来源键换了，
      // 旧来源下的用户标记（收藏、显示名）不跟过去。
      this.#removeSource(`conv:${conversation.id}`);
      return false;
    }
    return this.#addSource(
      {
        key: `conv:${conversation.id}`,
        root: conversation.cwd,
        realRoot: conversation.cwd,
        projectId: null,
        conversationId: conversation.id,
      },
      scan,
    );
  }

  #addSource(source: DeriveSource, scan: boolean): boolean {
    if (this.#sources.has(source.key)) return false;
    this.#sources.set(source.key, source);
    this.#startWatch(source);
    if (scan) this.#schedule(source.key, 0);
    return true;
  }

  #removeSource(key: string): void {
    if (!this.#sources.delete(key)) return;
    this.#watchers.get(key)?.close();
    this.#watchers.delete(key);
    clearTimeout(this.#timers.get(key));
    this.#timers.delete(key);
    this.#issues.delete(key);
    for (const [id, item] of this.#files) if (item.sourceKey === key) this.#files.delete(id);
    this.#recompute(true);
    void this.#enqueue(() => this.#syncIndex());
  }

  #startWatch(source: DeriveSource): void {
    if (!this.#watch) return;
    try {
      const watcher = fs.watch(source.root, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename && String(filename).split(/[\\/]/).some(isIgnoredName)) return;
        this.#schedule(source.key);
      });
      watcher.on('error', () => {
        watcher.close();
        if (this.#watchers.get(source.key) === watcher) this.#watchers.delete(source.key);
      });
      this.#watchers.set(source.key, watcher);
    } catch {
      // 目录还不存在或不可读：靠会话活动触发的重扫补上。
    }
  }

  #schedule(key: string, delay = this.#debounceMs): void {
    if (this.#closed || !this.#sources.has(key)) return;
    clearTimeout(this.#timers.get(key));
    this.#timers.set(
      key,
      setTimeout(() => {
        this.#timers.delete(key);
        void this.#enqueue(() => this.#rescanSource(key));
      }, delay),
    );
  }

  /** Job 事件（进度一秒好几次）合并成一次重算。 */
  #scheduleRecompute(): void {
    if (this.#closed || this.#recomputeTimer) return;
    this.#recomputeTimer = setTimeout(() => {
      this.#recomputeTimer = null;
      void this.#enqueue(async () => {
        await this.#refreshStats(false);
        this.#recompute(true);
      });
    }, 50);
  }

  // ---- 扫描与派生 ----

  #enqueue(job: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(() => (this.#closed ? undefined : job()));
    this.#queue = run.catch((error) => this.#log.error('Space scan failed', { error: String(error) }));
    return run;
  }

  async #scanAll(): Promise<void> {
    const results = await Promise.all(
      [...this.#sources.values()].map(async (source) => {
        const result = await scanDirectory(source.root, this.#limits);
        await this.#resolveRoot(source);
        return [source, result] as const;
      }),
    );
    // 清空与填回在同一段同步代码里：期间到来的重算（用户标记、Job 事件）看不到半空的目录。
    this.#files.clear();
    this.#issues.clear();
    for (const [source, result] of results) {
      if (this.#sources.get(source.key) !== source) continue;
      this.#apply(source, result);
      for (const file of result.files) this.#files.set(entryIdOf(source.key, file.relPath), { sourceKey: source.key, file });
    }
    await this.#refreshStats(true);
    this.#recompute(false);
    await this.#syncIndex();
    this.#log.info('Space scan finished', { sources: results.length, entries: this.#derived.size });
  }

  async #rescanSource(key: string): Promise<void> {
    const source = this.#sources.get(key);
    if (!source) return;
    const result = await scanDirectory(source.root, this.#limits);
    await this.#resolveRoot(source);
    if (this.#sources.get(key) !== source) return;
    this.#apply(source, result);
    for (const [id, item] of this.#files) if (item.sourceKey === key) this.#files.delete(id);
    for (const file of result.files) this.#files.set(entryIdOf(key, file.relPath), { sourceKey: key, file });
    await this.#refreshStats(false);
    this.#recompute(true);
    await this.#syncIndex();
  }

  async #resolveRoot(source: DeriveSource): Promise<void> {
    source.realRoot = await fsp.realpath(source.root).catch(() => source.root);
  }

  /** 记下来源的扫描问题。问题清单只随 `catalog.replaced` 与快照下发。 */
  #apply(source: DeriveSource, result: ScanResult): void {
    if (result.issue) this.#issues.set(source.key, { sourceKey: source.key, ...result.issue });
    else this.#issues.delete(source.key);
  }

  /** 把来源目录里的视频目录交给内容索引。 */
  async #syncIndex(): Promise<void> {
    if (!this.#index || this.#closed) return;
    const locations: { dir: string; mtimeMs: number }[] = [];
    for (const item of this.#files.values()) {
      if (item.file.kind !== 'video') continue;
      const source = this.#sources.get(item.sourceKey);
      if (source) locations.push({ dir: path.join(source.root, ...item.file.relPath.split('/')), mtimeMs: item.file.mtimeMs });
    }
    await this.#index.sync(locations);
  }

  /** 产物文件与来源目录之外的发布路径在不在：新出现的查一次；`all` 时全部重查（重扫、重建）。 */
  async #refreshStats(all: boolean): Promise<void> {
    if (!this.#jobs) return;
    // 全部重查时先查到新的表里再换上：查的期间到来的重算仍用旧的。
    const artifactStats = all ? new Map<string, FileStat | null>() : this.#artifactStats;
    const pathStats = all ? new Map<string, FileStat | null>() : this.#pathStats;
    const artifacts = new Set<string>();
    const paths = new Set<string>();
    for (const job of this.#jobFacts()) {
      if (!job.result) continue;
      if (job.kind === 'generateText') artifacts.add(job.result.artifactId);
      for (const output of job.result.outputs ?? []) {
        // 发布的文件，以及直接任务另存在保存位置的副本（§7.9）。
        if (output.path) paths.add(output.path);
        if (job.kind === 'generateImage' || job.kind === 'synthesizeSpeech') artifacts.add(output.artifactId);
      }
    }
    for (const artifactId of artifacts) {
      if (artifactStats.has(artifactId)) continue;
      const file = await this.#jobs.artifacts.locate(artifactId).catch(() => null);
      artifactStats.set(artifactId, file ? await statOf(file) : null);
    }
    for (const file of paths) {
      if (pathStats.has(file)) continue;
      pathStats.set(file, await statOf(file));
    }
    if (all) {
      this.#artifactStats = artifactStats;
      this.#pathStats = pathStats;
    }
  }

  /** 从全部输入重算条目；`publish` 时把变了的条目逐条发出去（首次扫描与重建只发一条 `catalog.replaced`）。 */
  #recompute(publish: boolean): void {
    if (this.#closed) return;
    const next = deriveEntries({
      sources: this.#sources,
      files: this.#files,
      mark: (id) => this.#marks.get(id),
      imports: this.#marks.imports(),
      trashedVideos: this.#marks.trashedVideos(),
      jobs: this.#jobFacts(),
      videoAt: (dir) => {
        const indexed = this.#index?.at(dir);
        return indexed ? { videoId: indexed.videoId, name: indexed.name, revision: indexed.revision, facts: indexed.facts } : null;
      },
      projectOfConversation: (conversationId) => this.#conversationProjects.get(conversationId) ?? null,
      artifactFile: (artifactId) => this.#artifactStats.get(artifactId),
      pathStat: (file) => this.#pathStats.get(file),
      entryIdOf,
      classify: classifyFile,
    });
    const previous = this.#derived;
    this.#derived = next;
    if (!publish) return;
    for (const [id, derived] of next) {
      const before = previous.get(id);
      if (before && JSON.stringify(before.entry) === JSON.stringify(derived.entry)) continue;
      this.#topic.publish({ type: 'entry.upsert', entry: derived.entry });
    }
    for (const id of previous.keys()) {
      if (!next.has(id)) this.#topic.publish({ type: 'entry.removed', entryId: id });
    }
  }
}

async function isVideoDir(dir: string): Promise<boolean> {
  return (await inspectVideoDir(dir)) !== null;
}

async function statOf(file: string): Promise<FileStat | null> {
  const stat = await fsp.stat(file).catch(() => null);
  return stat?.isFile() ? { path: file, size: stat.size, mtimeMs: stat.mtimeMs } : null;
}

/** 复制进目录，重名时加序号；返回目录里的文件名。 */
async function copyUnique(file: string, dir: string): Promise<string> {
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`;
    try {
      await fsp.copyFile(file, path.join(dir, name), fs.constants.COPYFILE_EXCL);
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new RpcError('conflict', RcSpace.tooManySameName());
}

function sourceKeyOf(conversation: Conversation): string {
  return conversation.projectId ? `project:${conversation.projectId}` : `conv:${conversation.id}`;
}

/** 条目 id 由来源与相对路径决定：重扫、重启都不变，用户标记才能跟得上。 */
export function entryIdOf(sourceKey: string, relPath: string): Id {
  return `sp_${crypto.createHash('sha256').update(`${sourceKey}\0${relPath}`).digest('base64url').slice(0, 22)}`;
}
