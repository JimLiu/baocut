import fs from 'node:fs/promises';
import path from 'node:path';
import type { Id, SpaceSearchHit } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import { extractContent, type ReadContentResult } from './content-extract.ts';
import { searchSegments, type SearchableVideo, type SearchQuery } from './content-search.ts';
import { ContentStore, type StoredVideo } from './content-store.ts';
import { RcSpace } from '@baocut/protocol/messages/runtime-core';

/**
 * 跨视频的内容索引（架构设计 §5.11）。派生缓存：一个 SQLite 库（`<cache>/content-index/index.db`，见 `content-store.ts`），
 * 记下索引时的视频版本、可检索的段落（FTS5）与视频事实（Space 目录的派生状态；工具候选输入要的文稿、译文与配音组，§7.9）。
 * 视频的记录与事实同时留在内存里（同步查询用），段落只在库里。删掉库文件可以重建；库的格式版本不对时删库，全部排队重读。
 *
 * - 视频目录由 Space 目录的扫描给出（`sync`）；没有打开的视频也在里面。读取走 VideoService 的只读查询
 *   （引擎的 `videos.inspect` 与 `videos.readContent`），不直接读 `video.db`，不打开视频，不占写锁。
 * - 增量：目录的修改时间变了先 `peek` 一次版本，版本没变只记下新的修改时间；已打开视频提交新版本时由 `touched` 触发。
 *   一次只读一个视频，避免启动时一下子把引擎占满。
 * - 读不了的视频（引擎不可用、旧版引擎没有 `videos.readContent`、库损坏）记为失败，等下一次变化或重建再试；
 *   检索时它们算「还没有索引」，结果标明不完整。
 */

export interface ContentReader {
  readContent(dir: string): Promise<ReadContentResult>;
  peek(dir: string): Promise<{ videoId: Id; name: string; revision: string }>;
}

/**
 * 一个视频的索引记录（不含段落，段落只在库里）：`dir` 是视频目录的真实路径，`mtimeMs` 是索引时目录的修改时间
 * （`video.db` 与 WAL）。
 */
export type IndexedVideo = StoredVideo;

export interface ContentIndexOptions {
  /** 缓存目录：`<home>/cache/content-index`。 */
  dir: string;
  reader: ContentReader | null;
  log: Logger;
}

export class ContentIndex {
  readonly #dir: string;
  readonly #reader: ContentReader | null;
  readonly #log: Logger;
  readonly #listeners = new Set<() => void>();
  /** 真实路径 → 索引。 */
  readonly #videos = new Map<string, IndexedVideo>();
  /** Space 目录此刻知道的视频目录：真实路径 → 修改时间。 */
  #wanted = new Map<string, number>();
  /** 扫描给的路径 → 真实路径。 */
  #aliases = new Map<string, string>();
  /** 重建中：记录还在，但要重读。 */
  readonly #stale = new Set<string>();
  readonly #pending = new Set<string>();
  readonly #failed = new Map<string, string>();
  #current: string | null = null;
  /** 等某个视频读完的（`ensure`）。 */
  readonly #waiters = new Map<string, Set<() => void>>();
  #worker: Promise<void> | null = null;
  #closed = false;
  /** 库：第一次用到时打开；打不开时 null（索引只留在内存里，检索没有段落）。 */
  #store: ContentStore | null | undefined;

  constructor(options: ContentIndexOptions) {
    this.#dir = options.dir;
    this.#reader = options.reader;
    this.#log = options.log.child('content-index');
  }

  /** 有视频索引完成或被移除时通知（Space 目录据此重算派生状态）。返回取消函数。 */
  listen(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }

  /**
   * 读回上次留下的索引。库坏掉或格式版本不对时删库重建（全部视频算没有索引，`sync` 时排队）。
   * 早先每个视频一个 JSON 文件的缓存（`<摘要>.json`）直接删掉，不迁移。
   */
  async load(): Promise<void> {
    const names = await fs.readdir(this.#dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith('.json') || name.endsWith('.tmp')) await fs.rm(path.join(this.#dir, name), { force: true }).catch(() => {});
    }
    const store = this.#open();
    if (!store) return;
    try {
      for (const video of store.videos()) this.#videos.set(video.dir, video);
    } catch (error) {
      this.#log.warn("Couldn't read the content index", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  #open(): ContentStore | null {
    if (this.#store !== undefined) return this.#store;
    try {
      this.#store = new ContentStore(this.#dir);
    } catch (error) {
      this.#store = null;
      this.#log.warn("Couldn't open the content index", { error: error instanceof Error ? error.message : String(error) });
    }
    return this.#store;
  }

  /**
   * 在这些视频（调用方排好的顺序）里检索（`content-search.ts`）。落后于当前版本的视频照样用库里旧的段落；
   * 库打不开、读库出错或已经关闭时没有命中（记日志）。
   */
  search(videos: readonly SearchableVideo[], query: SearchQuery): { hits: SpaceSearchHit[]; truncated: boolean } {
    const store = this.#closed ? null : this.#open();
    if (!store) return { hits: [], truncated: false };
    try {
      return searchSegments(store, videos, query);
    } catch (error) {
      this.#log.warn("Couldn't search the content index", { error: error instanceof Error ? error.message : String(error) });
      return { hits: [], truncated: false };
    }
  }

  /**
   * 来源目录里此刻的全部视频目录（扫描的绝对路径与修改时间）。不在里面的索引删掉；新的、变了的排队。
   */
  async sync(locations: readonly { dir: string; mtimeMs: number }[]): Promise<void> {
    // 先算出新的表再整体换上：解析真实路径的期间，查询仍看到旧的。
    const wanted = new Map<string, number>();
    const aliases = new Map<string, string>();
    for (const location of locations) {
      const real = await fs.realpath(location.dir).catch(() => null);
      if (!real) continue;
      aliases.set(location.dir, real);
      wanted.set(real, location.mtimeMs);
    }
    this.#aliases = aliases;
    this.#wanted = wanted;
    const gone = [...this.#videos.keys()].filter((dir) => !wanted.has(dir));
    for (const dir of gone) {
      this.#videos.delete(dir);
      this.#stale.delete(dir);
      this.#failed.delete(dir);
    }
    const removed = gone.length > 0;
    if (removed && !this.#closed) {
      try {
        this.#open()?.remove(gone);
      } catch (error) {
        this.#log.warn("Couldn't remove videos from the content index", { error: error instanceof Error ? error.message : String(error) });
      }
    }
    for (const dir of [...this.#failed.keys()]) if (!wanted.has(dir)) this.#failed.delete(dir);
    for (const [dir, mtime] of wanted) {
      const indexed = this.#videos.get(dir);
      if (!indexed || indexed.mtimeMs !== mtime || this.#stale.has(dir)) this.#enqueue(dir);
    }
    if (removed) this.#changed();
  }

  /** 已打开的视频提交了新版本（VideoService 的变化通知）。 */
  touched(given: string, revision: string): void {
    const dir = this.#aliases.get(given) ?? given;
    const indexed = this.#videos.get(dir);
    if (indexed && indexed.revision === revision) return;
    if (!this.#wanted.has(dir)) return;
    this.#enqueue(dir);
  }

  /**
   * 整体重建：把全部视频排队重读（不走版本比对的捷径），每个视频读完在一个事务里换掉它的记录与段落。重读完之前旧的记录
   * 仍可查询，但都算待索引，检索结果标明不完整；Space 目录的派生状态也不会因此闪一下。返回要重建的视频数。
   */
  async rebuild(): Promise<number> {
    for (const dir of this.#videos.keys()) this.#stale.add(dir);
    this.#failed.clear();
    for (const dir of this.#wanted.keys()) this.#enqueue(dir);
    return this.#wanted.size;
  }

  /** 视频目录（扫描给的路径或真实路径）的索引；还没有时 null。可能是旧版本的（变化还在排队）。 */
  at(dir: string): IndexedVideo | null {
    return this.#videos.get(this.#aliases.get(dir) ?? dir) ?? null;
  }

  /**
   * 这个视频目录的索引，必要时等它读完：还没有索引（或只有待重建的旧记录）时排到队首先读，读完返回。Space 的缩略图用：
   * 卡片出现时只等这一个视频，不等整个队列。不在 Space 目录里、读失败过、超时或已经关闭时返回手上有的（可能是 null）。
   */
  async ensure(given: string, timeoutMs = 15_000): Promise<IndexedVideo | null> {
    const dir = this.#aliases.get(given) ?? given;
    const indexed = this.#videos.get(dir) ?? null;
    if (indexed && !this.#stale.has(dir)) return indexed;
    if (this.#closed || !this.#wanted.has(dir) || this.#failed.has(dir)) return indexed;
    if (this.#current !== dir) {
      const rest = [...this.#pending].filter((other) => other !== dir);
      this.#pending.clear();
      this.#pending.add(dir);
      for (const other of rest) this.#pending.add(other);
      this.#worker ??= this.#drain().finally(() => (this.#worker = null));
    }
    await new Promise<void>((resolve) => {
      const waiters = this.#waiters.get(dir) ?? new Set();
      this.#waiters.set(dir, waiters);
      const done = () => {
        clearTimeout(timer);
        waiters.delete(done);
        if (waiters.size === 0 && this.#waiters.get(dir) === waiters) this.#waiters.delete(dir);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      waiters.add(done);
    });
    return this.#videos.get(dir) ?? null;
  }

  /** 这些视频目录里还没有当前索引的个数（排队中、正在读、读失败、从来没有）。不给时是全部。 */
  pendingCount(dirs?: readonly string[]): number {
    const list = dirs ? dirs.map((dir) => this.#aliases.get(dir) ?? dir) : [...this.#wanted.keys()];
    let pending = 0;
    for (const dir of list) {
      if (this.#pending.has(dir) || this.#stale.has(dir) || this.#current === dir || this.#failed.has(dir) || !this.#videos.has(dir))
        pending++;
    }
    return pending;
  }

  /** 这个视频目录的索引是不是当前的（读过、不在排队、没有失败、不是待重建的旧记录）。 */
  current(dir: string): boolean {
    return this.pendingCount([dir]) === 0;
  }

  /** 读失败的视频与原因（诊断用）。 */
  failures(): { dir: string; reason: string }[] {
    return [...this.#failed].map(([dir, reason]) => ({ dir, reason }));
  }

  /** 队列清空（测试用）。 */
  async idle(): Promise<void> {
    while (this.#worker) await this.#worker;
  }

  get busy(): boolean {
    return this.#worker !== null;
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#pending.clear();
    for (const dir of [...this.#waiters.keys()]) this.#wake(dir);
    await this.#worker?.catch(() => {});
    this.#store?.close();
    this.#store = null;
  }

  #enqueue(dir: string): void {
    if (this.#closed) return;
    this.#pending.add(dir);
    this.#worker ??= this.#drain().finally(() => (this.#worker = null));
  }

  async #drain(): Promise<void> {
    while (!this.#closed && this.#pending.size > 0) {
      const dir = this.#pending.values().next().value!;
      this.#pending.delete(dir);
      this.#current = dir;
      try {
        if (await this.#refresh(dir)) this.#changed();
      } finally {
        this.#current = null;
        this.#wake(dir);
      }
    }
  }

  #wake(dir: string): void {
    for (const done of [...(this.#waiters.get(dir) ?? [])]) done();
  }

  /** 读一个视频；返回索引是否变了。 */
  async #refresh(dir: string): Promise<boolean> {
    const mtimeMs = this.#wanted.get(dir);
    if (mtimeMs === undefined) return false;
    if (!this.#reader) {
      this.#failed.set(dir, RcSpace.engineUnavailable().text);
      return false;
    }
    const store = this.#open();
    try {
      const indexed = this.#stale.has(dir) ? undefined : this.#videos.get(dir);
      if (indexed) {
        const peeked = await this.#reader.peek(dir);
        if (peeked.videoId === indexed.videoId && peeked.revision === indexed.revision) {
          const updated = { ...indexed, mtimeMs, name: peeked.name };
          if (this.#closed || !this.#wanted.has(dir)) return false;
          store?.touch(dir, mtimeMs, peeked.name);
          this.#videos.set(dir, updated);
          this.#failed.delete(dir);
          return updated.name !== indexed.name;
        }
      }
      const content = await this.#reader.readContent(dir);
      const extracted = extractContent(content, dir);
      const record: IndexedVideo = {
        dir,
        videoId: content.videoId,
        name: content.name,
        revision: content.revision,
        mtimeMs,
        indexedAt: new Date().toISOString(),
        facts: extracted.facts,
        problems: extracted.problems,
      };
      if (this.#closed) return false;
      // 视频已经从目录里移走（读的期间 `sync` 过）：不写回。
      if (!this.#wanted.has(dir)) return false;
      store?.replace(record, extracted.segments);
      this.#videos.set(dir, record);
      this.#stale.delete(dir);
      this.#failed.delete(dir);
      return true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.#failed.set(dir, reason);
      this.#log.warn("Couldn't read the video's content", { dir, error: reason });
      return false;
    }
  }
}
