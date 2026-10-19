/**
 * 一份打开着的文档（docs/design/docs §4）：同一个目录在内存里只有一份，编辑器的连接与智能体的连接器都经它读写。
 *
 * - 改动先落在内存，300 ms 去抖后写回目录；`flush()` 立即写。
 * - `transaction()`：一组改动要么全部生效、要么一条也不生效（door 的 batch、连接器的一次调用）；通知在提交后才发出。
 * - 每个正文留最近 50 个 rev 的快照，供 `atRev` / `sinceRev` 读与 `restore`；另记最多 10 个版本（`versions.ts`），
 *   版本结束时的正文也能按 rev 读与回去。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { newSessionPrefix, parseCharId, type CharId } from './char-id.ts';
import { compressBlock, expandBlock, type ProseBlock } from './prose-document.ts';
import {
  ASSETS_DIR,
  DOC_FILE,
  HISTORY_LIMIT,
  emptyDirty,
  writeDocState,
  type DirtySet,
  type DocMeta,
  type DocSession,
  type DocState,
  type LiveNode,
  type StoredThread,
  type VersionAuthor,
} from './store.ts';
import { cloneVersions, recordVersion, versionAt, versionBlocks } from './versions.ts';

/** 文档变了：订阅者（mux）据此推给开着的编辑器。`origin` 是发起改动的连接（它自己已经有了这次改动）。 */
export type DocEvent =
  | { type: 'node'; nodeId: string; rev: number; opId?: string; origin?: unknown; actor: DocEventActor }
  | { type: 'comment'; nodeId: string; threadId: string; actor: DocEventActor }
  | { type: 'project'; actor: DocEventActor };

export interface DocEventActor {
  principal: string;
  channel: 'human' | 'agent';
}

const SAVE_DELAY_MS = 300;

export interface LiveDocOptions {
  onError?: (message: string, error: unknown) => void;
  /** 目录在磁盘上不见了（被删、被挪走）：服务端据此把它从内存里拿掉。 */
  onGone?: (doc: LiveDoc) => void;
  /** 现在的时间（毫秒）：版本按它分段，测试换成假的钟。 */
  now?: () => number;
}

export class LiveDoc {
  readonly dir: string;
  #state: DocState;
  #dirty: DirtySet = emptyDirty();
  #events: DocEvent[] = [];
  #depth = 0;
  readonly #listeners = new Set<(event: DocEvent) => void>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #writing: Promise<void> = Promise.resolve();
  /** 还没写过磁盘的新文档：第一次写之前不检查 `doc.json` 在不在。 */
  #fresh: boolean;
  #gone = false;
  readonly #options: LiveDocOptions;
  /** 目录里已有的素材（sha256）。 */
  readonly #assets = new Set<string>();

  constructor(dir: string, state: DocState, options: LiveDocOptions & { fresh?: boolean } = {}) {
    this.dir = dir;
    this.#state = state;
    this.#fresh = options.fresh ?? false;
    this.#options = options;
    if (this.#fresh) {
      this.#dirty.meta = true;
      this.#dirty.comments = true;
      for (const id of state.nodes.keys()) this.#dirty.nodes.add(id);
    }
  }

  get meta(): DocMeta {
    return this.#state.meta;
  }

  get id(): string {
    return this.#state.meta.id;
  }

  get gone(): boolean {
    return this.#gone;
  }

  node(id: string): LiveNode | undefined {
    return this.#state.nodes.get(id);
  }

  nodes(): LiveNode[] {
    return [...this.#state.nodes.values()];
  }

  get threads(): StoredThread[] {
    return this.#state.comments.threads;
  }

  /** 评论行的最新序号。 */
  get commentSeq(): number {
    return this.#state.comments.seq;
  }

  /** 给一条新的评论行分配序号。 */
  nextCommentSeq(): number {
    this.#state.comments.seq += 1;
    this.markComments();
    return this.#state.comments.seq;
  }

  /** 读一遍目录里的素材，之后上传时更新。 */
  async scanAssets(): Promise<void> {
    const entries = await fs.readdir(path.join(this.dir, ASSETS_DIR)).catch(() => [] as string[]);
    for (const name of entries) {
      const match = /^([0-9a-f]{64})(?:\.[A-Za-z0-9]{1,10})?$/.exec(name);
      if (match) this.#assets.add(match[1]!);
    }
  }

  hasAsset(sha256: string): boolean {
    return this.#assets.has(sha256);
  }

  /** 素材文件名：`<sha256>.<扩展名>`；按 mime 取扩展名。 */
  assetPath(sha256: string, mime: string): string {
    return path.join(this.dir, ASSETS_DIR, `${sha256}${extensionOf(mime)}`);
  }

  /** 找某个 sha256 的素材文件（扩展名可能不同）。 */
  async findAsset(sha256: string): Promise<string | null> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
    const entries = await fs.readdir(path.join(this.dir, ASSETS_DIR)).catch(() => [] as string[]);
    const name = entries.find((entry) => entry === sha256 || entry.startsWith(`${sha256}.`));
    return name ? path.join(this.dir, ASSETS_DIR, name) : null;
  }

  /** 写入一份素材（已按内容寻址，存在就不重写）。 */
  async putAsset(sha256: string, mime: string, bytes: Uint8Array): Promise<void> {
    if (this.#assets.has(sha256) && (await this.findAsset(sha256))) return;
    const file = this.assetPath(sha256, mime);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, file);
    this.#assets.add(sha256);
  }

  subscribe(listener: (event: DocEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  // ---------- 改动 ----------

  markMeta(bumpRev = false): void {
    this.#state.meta.updated = new Date().toISOString();
    if (bumpRev) this.#state.meta.rev += 1;
    this.#dirty.meta = true;
    this.#schedule();
  }

  markComments(): void {
    this.#dirty.comments = true;
    this.#schedule();
  }

  /**
   * 正文换成新的块与 rev：记快照与版本，标记要写。`author` 是改的人（分版本、记谁改的）；`restoredFrom` 表示这是回到某个 rev，
   * 单独成一版。
   */
  commitNode(node: LiveNode, blocks: ProseBlock[], rev: number, change: { author?: VersionAuthor; restoredFrom?: number } = {}): void {
    const before = node.blocks;
    const beforeRev = node.rev;
    node.blocks = blocks;
    node.rev = rev;
    node.history.push({ rev, blocks: blocks.map(compressBlock) });
    if (node.history.length > HISTORY_LIMIT) node.history.splice(0, node.history.length - HISTORY_LIMIT);
    recordVersion(node, { before, beforeRev, ...change, now: this.#options.now?.() ?? Date.now() });
    this.#dirty.nodes.add(node.id);
    this.markMeta();
  }

  addNode(node: LiveNode): void {
    this.#state.nodes.set(node.id, node);
    this.#dirty.nodes.add(node.id);
    this.#dirty.removedNodes.delete(node.id);
    this.markMeta();
  }

  removeNode(id: string): void {
    this.#state.nodes.delete(id);
    this.#dirty.nodes.delete(id);
    this.#dirty.removedNodes.add(id);
    this.markMeta();
  }

  /** 某个 rev 时的正文（展开后）：先找快照，再找结束在这个 rev 的版本；都没有时 undefined。 */
  snapshot(node: LiveNode, rev: number): ProseBlock[] | undefined {
    const found = node.history.find((snapshot) => snapshot.rev === rev);
    if (found) return found.blocks.map((block, index) => expandBlock(block, `history.${rev}[${index}]`));
    const version = versionAt(node, rev);
    return version?.blocks ? versionBlocks(node, version) : undefined;
  }

  /** 最早还留着快照的 rev。 */
  oldestRev(node: LiveNode): number {
    return node.history[0]?.rev ?? node.rev;
  }

  emit(event: DocEvent): void {
    this.#events.push(event);
    if (this.#depth === 0) this.#flushEvents();
  }

  /**
   * 一组改动：`run` 返回 `{ commit: false }` 或抛错时，内存恢复到调用前、不发通知、不写盘。
   * 可以嵌套（内层并进外层）。
   */
  transaction<T>(run: () => T & { commit?: boolean }): T {
    const saved = this.#depth === 0 ? { state: cloneState(this.#state), dirty: cloneDirty(this.#dirty), events: this.#events.length } : undefined;
    this.#depth++;
    let result: T & { commit?: boolean };
    try {
      result = run();
    } catch (error) {
      this.#depth--;
      if (saved) this.#rollback(saved);
      throw error;
    }
    this.#depth--;
    if (saved) {
      if (result.commit === false) this.#rollback(saved);
      else this.#flushEvents();
    }
    return result;
  }

  #rollback(saved: { state: DocState; dirty: DirtySet; events: number }): void {
    this.#state = saved.state;
    this.#dirty = saved.dirty;
    this.#events.length = saved.events;
  }

  #flushEvents(): void {
    const events = this.#events.splice(0);
    for (const event of events)
      for (const listener of this.#listeners) {
        try {
          listener(event);
        } catch (error) {
          this.#options.onError?.('docs listener failed', error);
        }
      }
  }

  // ---------- 编辑会话与 id ----------

  /** 新开一个编辑会话：编辑器用这个前缀给新字、新块分配 id。前缀不与这份文档里已有的重复。 */
  openSession(): DocSession {
    const sessions = this.#state.meta.sessions;
    let prefix = newSessionPrefix();
    while (sessions[prefix]) prefix = newSessionPrefix();
    const session: DocSession = { prefix, next: 1, secret: newSessionPrefix() };
    sessions[prefix] = session;
    this.markMeta();
    return session;
  }

  /** 服务端补发 id 的会话：序号跨请求、跨重启递增。 */
  mintSession(): DocSession {
    const meta = this.#state.meta;
    const existing = meta.mintPrefix ? meta.sessions[meta.mintPrefix] : undefined;
    if (existing) return existing;
    const session = this.openSession();
    meta.mintPrefix = session.prefix;
    return session;
  }

  /** 记下用掉的 id，之后不再分配。 */
  advanceSessions(used: readonly CharId[]): void {
    const sessions = this.#state.meta.sessions;
    for (const id of used) {
      const parsed = parseCharId(id);
      const session = parsed && sessions[parsed.session];
      if (session && parsed.clock >= session.next) {
        session.next = parsed.clock + 1;
        this.#dirty.meta = true;
      }
    }
  }

  // ---------- 写盘 ----------

  #schedule(): void {
    if (this.#gone) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush().catch((error: unknown) => this.#options.onError?.('docs save failed', error));
    }, SAVE_DELAY_MS);
  }

  /** 立即把改动写回目录（等前一次写完）。 */
  flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const next = this.#writing.then(() => this.#write());
    this.#writing = next.catch(() => undefined);
    return next;
  }

  async #write(): Promise<void> {
    if (this.#gone) return;
    const dirty = this.#dirty;
    if (!dirty.meta && !dirty.comments && !dirty.nodes.size && !dirty.removedNodes.size) return;
    if (!this.#fresh) {
      const stat = await fs.lstat(path.join(this.dir, DOC_FILE)).catch(() => null);
      if (!stat?.isFile()) {
        // 目录被删了或换掉了：不重建它
        this.#gone = true;
        this.#options.onGone?.(this);
        return;
      }
    }
    this.#dirty = emptyDirty();
    try {
      await writeDocState(this.dir, this.#state, dirty);
      this.#fresh = false;
    } catch (error) {
      // 没写成：并回去，下一次再写
      this.#dirty.meta ||= dirty.meta;
      this.#dirty.comments ||= dirty.comments;
      for (const id of dirty.nodes) this.#dirty.nodes.add(id);
      for (const id of dirty.removedNodes) this.#dirty.removedNodes.add(id);
      throw error;
    }
  }

  /** 关闭：写完改动，不再接受定时写。 */
  async close(): Promise<void> {
    await this.flush();
    this.#listeners.clear();
  }
}

function cloneState(state: DocState): DocState {
  return { meta: structuredClone(state.meta), nodes: new Map([...state.nodes].map(([id, node]) => [id, { ...node, blocks: structuredClone(node.blocks), history: [...node.history], versions: cloneVersions(node.versions) }])), comments: structuredClone(state.comments) };
}

function cloneDirty(dirty: DirtySet): DirtySet {
  return { meta: dirty.meta, comments: dirty.comments, nodes: new Set(dirty.nodes), removedNodes: new Set(dirty.removedNodes) };
}

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
};

function extensionOf(mime: string): string {
  return EXTENSIONS[mime.toLowerCase()] ?? '';
}
