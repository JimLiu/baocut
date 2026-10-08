import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  applyVideoEvent,
  type Actor,
  type AssetRevision,
  type DocumentContent,
  type EditResult,
  type FontFaceLayout,
  type FontFaceQuery,
  type FontsResolveResult,
  type HistoryEntry,
  type Id,
  type MissingAsset,
  type ProtectionRef,
  type VideoEvent,
  type VideoOpenResult,
  type VideoRef,
  type VideoSnapshot,
  type VideoTopicEvent,
  type VideoTopicSnapshot,
  type RpcParams,
  type Seq,
  type SequencedEvent,
  type TransactionReceipt,
  type UndoState,
  type UnusedAsset,
} from '@baocut/protocol';
import { TopicLog, type Logger, type TopicSubscription } from '@baocut/harness';
import { isDotLottie } from '@baocut/runtime-storage/library';
import type { TrustedPrincipal } from '../gateway.ts';
import { TRASH_DIR, scanDirectory } from '../space-catalog.ts';
import { EngineHost } from './engine-host.ts';
import { hostPath } from './host-path.ts';
import { RcCommon, RcVideo } from '@baocut/protocol/messages/runtime-core';

/**
 * 已打开视频的会话（架构设计 §2.3、§4.4）：Runtime 这边只做路由、镜像与生命周期，视频的语义都在引擎里。
 *
 * - 一个视频在 Runtime 里只打开一次；打开它的连接各记一次，最后一个离开后关闭，释放写入锁。
 *   连接断开后留一段宽限期，界面重连后重新打开就能接上。
 * - 镜像只由引擎推来的事件更新（共享的 `applyVideoEvent`），按视频自己的事件序号去重；序号接不上时取快照整体替换。
 * - 每个视频的主题在 Runtime 生命周期里只有一个，关闭再打开也沿用它，客户端的游标不会落到另一份日志上。
 * - 引擎进程意外退出时重启它、重新打开视频，并在主题上发 `video.replaced`。
 */

/** 交给引擎的任务保护（引擎在提交前检查，`TASK_PROTECTED`）。 */
/** 引擎 `fonts.resolve` 的结果：找到的 face 带所在文件的绝对路径（Runtime 换成读取句柄给界面，导出冻结时记下）。 */
export interface LocalFontFaces {
  faces: (FontFaceQuery & FontFaceLayout & { source: 'local' | 'downloaded'; path: string })[];
  missing: FontsResolveResult['missing'];
}

/** 引擎 `fonts.inspect` 的结果：字体文件里的 face。 */
export interface InspectedFontFace {
  index: number;
  families: string[];
  postScriptName: string;
  weight: number;
  italic: boolean;
}

export type EngineProtection = Pick<ProtectionRef, 'protectionId' | 'target'>;

/** 任务与流水线写入所属的执行（架构设计 §7.4）：`runGeneration` 是十进制整数字符串，重试换代时递增。 */
export interface EngineRun {
  runId: Id;
  runGeneration: string;
}

export interface VideoLocation {
  /** 来源目录（项目目录或会话工作目录）。视频目录必须在它里面。 */
  root: string;
  /** 视频目录或其中的 `video.db`，绝对路径或相对 `root`。 */
  file: string;
  scope: { projectId: Id } | { conversationId: Id };
}

export interface VideoServiceOptions {
  log: Logger;
  /** 找到引擎可执行文件；没有时返回 null（界面提示先构建引擎）。 */
  resolveCommand: () => string | null;
  /** 引擎进程的环境变量（PATH 里要能找到 ffprobe）。 */
  env: () => Promise<NodeJS.ProcessEnv>;
  /** 连接断开后多久关闭它打开的视频。 */
  graceMs?: number;
  /** 下载的字体所在的目录（`<home>/fonts/files`）：本机没有的族由引擎再到这里挑（架构设计 §9.1）。 */
  fontCacheDir?: string;
}

interface Session {
  ref: VideoRef;
  openers: Set<string>;
  /** Runtime 内部的租约（如进行中的转写任务）：有租约时不因打开者走光而关闭。 */
  leases: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
}

interface Channel {
  log: TopicLog<VideoTopicSnapshot, VideoTopicEvent>;
  mirror: VideoTopicSnapshot;
  session: Session | null;
  /** 正在取快照补齐：期间到达的事件等快照到了再说。 */
  resyncing: boolean;
}

/** `assets.blobPath` 的结果：素材的一个版本此刻在哪里。 */
interface ResolvedAsset {
  path: string;
  storage: 'managed' | 'linked';
  mediaType: string;
  byteLength: number;
  name: string;
}

interface HostOpened {
  videoId: Id;
  path: string;
  eventSeq: Seq;
  snapshot: VideoSnapshot;
}

const DEFAULT_GRACE_MS = 15_000;
const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 60_000;
const DB_FILE = 'video.db';
/** 改名之前的数据库文件名：引擎打开时就地升级成 `video.db`。 */
const LEGACY_DB_FILE = 'movie.db';

/**
 * 公共请求不带操作者；操作者由连接身份构造（架构设计 §4.2）。对外服务的请求记为 `external:<serviceId>`（§4.8）：
 * 引擎的操作者种类只有 user、agent、system，外部智能体归在 `agent` 下，由 ID 区分。
 * Web 服务的浏览器会话是用户本人在操作，与桌面界面一样记为 `user_local`（撤销栈也与桌面共用）。
 */
export function actorOf(principal: TrustedPrincipal): Actor {
  if (principal.kind === 'service') return { kind: 'agent', id: `external:${principal.name}` };
  if (principal.kind === 'web') return { kind: 'user', id: 'user_local' };
  return principal.kind === 'agent' ? { kind: 'agent', id: `agent:${principal.name}` } : { kind: 'user', id: 'user_local' };
}

/** 视频目录名：去掉路径里不能用的字符。 */
export function videoDirName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '-')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
  return cleaned || RcVideo.defaultDirName().text;
}

/**
 * 在来源目录里占下一个新视频的目录（与 `VideoService.create` 同样按名字挑一个还不存在的，建成空目录），返回相对来源目录的
 * 名字。占下之后 `create` 挑目录时会跳过它。
 */
export async function reserveVideoDir(root: string, name: string): Promise<string> {
  const rootReal = await fs.realpath(root).catch(() => {
    throw new RpcError('not-found', RcVideo.sourceDirNotFound());
  });
  const base = videoDirName(name.trim() || RcVideo.untitledVideo().text);
  for (let n = 1; ; n++) {
    const file = n === 1 ? base : `${base} ${n}`;
    // 不递归建：已经存在（别处同时占下或新建）时换下一个名字。
    const made = await fs.mkdir(path.join(rootReal, file)).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return false;
        throw error;
      },
    );
    if (made) return file;
  }
}

/** 目录里有视频的数据库（含改名之前的）。 */
export async function hasVideoDb(dir: string): Promise<boolean> {
  return (await exists(path.join(dir, DB_FILE))) || (await exists(path.join(dir, LEGACY_DB_FILE)));
}

export class VideoService {
  readonly #log: Logger;
  readonly #options: VideoServiceOptions;
  readonly #graceMs: number;
  readonly #channels = new Map<Id, Channel>();
  readonly #creates = new Map<Id, Promise<VideoOpenResult>>();
  readonly #claims = new Map<Id, Promise<{ reassigned: number; skipped: number }>>();
  readonly #changeListeners = new Set<(change: { videoId: Id; path: string; revision: string }) => void>();
  #host: EngineHost | null = null;
  #starting: Promise<EngineHost> | null = null;
  #afterCreate: ((videoId: Id, principal: TrustedPrincipal) => Promise<void>) | null = null;
  #restarts: number[] = [];
  #closed = false;

  constructor(options: VideoServiceOptions) {
    this.#options = options;
    this.#log = options.log.child('videos');
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  }

  // ---- 打开与关闭 ----

  /**
   * 新建视频：在来源目录里按名字挑一个还不存在的目录。`reserved` 是 `reserveVideoDir` 事先占下的空目录（固定流程的新建，
   * `pipeline-targets.ts`）：建在那里，不再挑。
   */
  async create(
    params: RpcParams<'videos.create'>,
    root: VideoLocation['root'],
    scope: VideoLocation['scope'],
    principal: TrustedPrincipal,
    reserved?: string,
  ) {
    if (params.commandId) {
      const existing = this.#creates.get(params.commandId);
      if (existing) return existing;
    }
    const run = (async (): Promise<VideoOpenResult> => {
      const name = params.name?.trim() || RcVideo.untitledVideo().text;
      const rootReal = await fs.realpath(root).catch(() => {
        throw new RpcError('not-found', RcVideo.sourceDirNotFound());
      });
      let dir: string;
      if (reserved !== undefined) {
        dir = path.join(rootReal, reserved);
        if (path.relative(rootReal, dir).startsWith('..')) throw new RpcError('invalid-request', RcVideo.reservedDirOutsideSource());
      } else {
        const base = videoDirName(name);
        dir = path.join(rootReal, base);
        for (let n = 2; await exists(dir); n++) dir = path.join(rootReal, `${base} ${n}`);
      }
      const host = await this.#ensureHost();
      const opened = await host.request<HostOpened>('videos.create', {
        path: dir,
        name,
        fps: params.fps ?? { num: 30, den: 1 },
        width: params.width ?? 1920,
        height: params.height ?? 1080,
        ...projectOf(scope),
      });
      this.#log.info('Video created', { videoId: opened.videoId });
      const result = this.#register(opened, rootReal, scope, principal);
      if (!this.#afterCreate) return result;
      // 新视频的初始内容（采用用户库里默认启用的条目，§5.9）：失败不影响新建，只记日志。
      await this.#afterCreate(opened.videoId, principal).catch((error: unknown) =>
        this.#log.warn('Setup after creating the video did not finish', { videoId: opened.videoId, error: String(error) }),
      );
      return { ...result, snapshot: this.mirror(opened.videoId) ?? result.snapshot };
    })();
    if (params.commandId) {
      const key = params.commandId;
      this.#creates.set(key, run);
      run.catch(() => this.#creates.delete(key));
    }
    return run;
  }

  /**
   * 新建视频（`create`，不含打开便携包）之后、返回之前做的事：写进新视频的初始内容，由 Runtime 接上（用户库的默认启用）。
   * 返回的快照是做完之后的。
   */
  onCreated(fn: (videoId: Id, principal: TrustedPrincipal) => Promise<void>): void {
    this.#afterCreate = fn;
  }

  async open(location: VideoLocation, principal: TrustedPrincipal): Promise<VideoOpenResult> {
    const { rootReal, dir } = await locateVideoDir(location);
    const host = await this.#ensureHost();
    // 带上所属项目：视频里记的项目不同（副本）时引擎先换标识，同一个 videoId 不会指向两个目录（架构设计 §5.1）。
    const opened = await host.request<HostOpened>('videos.open', { path: dir, ...projectOf(location.scope) });
    if (hostPath(opened.path) !== dir) {
      // 同一个 videoId 出现在两个目录（不属于项目、无从区分的副本，或打开期间被移动）：保留先打开的那一个。
      this.#log.warn('Two folders hold the same video; kept the open one', { videoId: opened.videoId });
    }
    return this.#register(opened, rootReal, location.scope, principal);
  }

  /**
   * 打开项目时的预处理（架构设计 §5.1）：项目里的视频记的所属项目与它不同（副本）或没有记（升级前的视频）时，
   * 先由引擎换标识或采用，再被打开。只处理这个已登记项目目录里的视频；正被打开的跳过（打开时已经认领过），
   * 被别处锁着的留到下次（打开时还会再认领）。每个视频只短暂地取一次写锁。没有视频时不启动引擎。
   */
  claimProjectVideos(project: { id: Id; path: string }): Promise<{ reassigned: number; skipped: number }> {
    // 同一个项目的预处理同时只跑一趟：重复打开项目时接上进行中的那一趟。
    const running = this.#claims.get(project.id);
    if (running) return running;
    const run = this.#claimProjectVideos(project).finally(() => this.#claims.delete(project.id));
    this.#claims.set(project.id, run);
    return run;
  }

  async #claimProjectVideos(project: { id: Id; path: string }): Promise<{ reassigned: number; skipped: number }> {
    const result = { reassigned: 0, skipped: 0 };
    if (this.#closed || !this.#options.resolveCommand()) return result;
    const rootReal = await fs.realpath(project.path).catch(() => null);
    if (!rootReal) return result;
    const scan = await scanDirectory(rootReal);
    const dirs = scan.files.filter((file) => file.kind === 'video').map((file) => path.join(rootReal, ...file.relPath.split('/')));
    if (dirs.length === 0) return result;
    const open = new Set(this.openRefs().map((ref) => ref.path));
    const host = await this.#ensureHost();
    for (const dir of dirs) {
      if (open.has(dir)) continue;
      try {
        const claim = await host.request<{ outcome: string; videoId: Id }>('videos.claimProject', { path: dir, projectId: project.id });
        if (claim.outcome === 'reassigned') result.reassigned++;
      } catch (error) {
        result.skipped++;
        this.#log.info('Skipped this video while opening the project; deferred until it is opened', { projectId: project.id, error: String(error) });
      }
    }
    if (result.reassigned > 0) this.#log.info('Videos in the project were copies; gave them new IDs', { projectId: project.id, count: result.reassigned });
    return result;
  }

  /** 这条连接不再需要这个视频。没有其他打开者时立即关闭。 */
  async close(videoId: Id, principal: TrustedPrincipal): Promise<{ closed: boolean }> {
    const channel = this.#channels.get(videoId);
    const session = channel?.session;
    if (!session) return { closed: false };
    session.openers.delete(principal.connectionId);
    if (session.openers.size > 0 || session.leases > 0) return { closed: false };
    await this.#closeSession(videoId, 'closed');
    return { closed: true };
  }

  /** 视频此刻在 Runtime 里怎么被用着（删除视频前查）：打开它的连接与内部租约。没有打开时 null。 */
  usage(videoId: Id): { openers: string[]; leases: number } | null {
    const session = this.#channels.get(videoId)?.session;
    return session ? { openers: [...session.openers], leases: session.leases } : null;
  }

  /** 视频被删除了：关闭它，订阅的客户端收到 `video.closed`（`reason: 'deleted'`）。 */
  async closeDeleted(videoId: Id): Promise<void> {
    await this.#closeSession(videoId, 'deleted');
  }

  /**
   * 取得一个没有打开的视频目录的写锁，在持有期间执行 `fn`（删除视频时移动目录），然后放下（§5.5）。锁跟着打开的文件走，
   * 目录改名不影响它。别的进程锁着时以 `VIDEO_LOCKED` 拒绝；同一个视频在另一个目录里开着时以 `VIDEO_IN_USE` 拒绝。
   */
  async withWriteLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const host = await this.#ensureHost();
    const opened = await host.request<HostOpened>('videos.open', { path: dir });
    // 引擎里已经开着的（会话里的，或同一个视频在另一个目录里开着）不是这次取到的锁，不能替它放下。
    const owned = !this.#channels.get(opened.videoId)?.session && hostPath(opened.path) === dir;
    try {
      if (!owned) throw new RpcError('conflict', RcVideo.videoInUse(), { code: 'VIDEO_IN_USE', videoId: opened.videoId });
      return await fn();
    } finally {
      if (owned && host.alive) {
        await host
          .request('videos.close', { videoId: opened.videoId })
          .catch((error) => this.#log.warn('Releasing the write lock failed', { error: String(error) }));
      }
    }
  }

  /** Runtime 内部持有一个已打开的视频（后台任务用），直到 `release`。视频没有打开时报 not-found。 */
  retain(videoId: Id): void {
    const session = this.#channels.get(videoId)?.session;
    if (!session) throw new RpcError('not-found', RcCommon.videoNotOpen());
    session.leases++;
    if (session.closeTimer) {
      clearTimeout(session.closeTimer);
      session.closeTimer = null;
    }
  }

  /** 放下 `retain` 的租约。最后一个租约放下且没有打开者时，按宽限期关闭。 */
  release(videoId: Id): void {
    const channel = this.#channels.get(videoId);
    const session = channel?.session;
    if (!channel || !session || session.leases === 0) return;
    session.leases--;
    this.#scheduleIdleClose(videoId, channel);
  }

  /** 连接断开：它打开的视频在宽限期后关闭（期间重新打开就取消）。 */
  connectionClosed(connectionId: string): void {
    for (const [videoId, channel] of this.#channels) {
      if (!channel.session?.openers.delete(connectionId)) continue;
      this.#scheduleIdleClose(videoId, channel);
    }
  }

  #scheduleIdleClose(videoId: Id, channel: Channel): void {
    const session = channel.session;
    if (!session || session.openers.size > 0 || session.leases > 0 || session.closeTimer) return;
    session.closeTimer = setTimeout(() => {
      session.closeTimer = null;
      if (channel.session === session && session.openers.size === 0 && session.leases === 0) void this.#closeSession(videoId, 'idle');
    }, this.#graceMs);
    session.closeTimer.unref?.();
  }

  // ---- 编辑 ----

  /**
   * `provenance.taskId` 由 Runtime 按调用者当前的任务填入，公共请求不能自己声明（命令与协议规范 §2.2）。
   * `provenance.protections` 是这个任务合同的保护范围（架构设计 §3.2）：智能体带任务的提交由引擎对照检查。
   */
  async apply(
    params: RpcParams<'edits.apply'>,
    principal: TrustedPrincipal,
    provenance: { taskId?: Id; protections?: EngineProtection[] } = {},
  ): Promise<EditResult> {
    return this.applyAs(params, actorOf(principal), provenance);
  }

  /**
   * 以给定的行为者编辑：Runtime 自己的写入（如转写结果，`{ kind: 'system' }`）走这里。
   * `provenance.run` 是任务与流水线写入所属的执行（架构设计 §7.4）：引擎据此执行停止屏障；只由 Runtime 填，公共请求带不进来。
   */
  async applyAs(
    params: RpcParams<'edits.apply'>,
    actor: Actor,
    provenance: { taskId?: Id; run?: EngineRun; protections?: EngineProtection[] } = {},
  ): Promise<EditResult> {
    const host = await this.#hostFor(params.videoId);
    return host.request<EditResult>('edits.apply', {
      videoId: params.videoId,
      commandId: params.commandId,
      expectedRevision: params.expectedRevision,
      operations: params.operations,
      ...(params.label !== undefined ? { label: params.label } : {}),
      actor,
      ...(provenance.taskId ? { taskId: provenance.taskId } : {}),
      ...(provenance.run ? { run: { runId: provenance.run.runId, runGeneration: provenance.run.runGeneration } } : {}),
      ...(provenance.protections?.length ? { protections: provenance.protections } : {}),
    });
  }

  /**
   * 停止屏障（架构设计 §7.4）：让引擎拒绝这个执行这一代及更早的提交。请求在调用时同步写给引擎，
   * 之后发出的同一执行的提交一定排在它后面、被拒；resolve 时，在它之前写给引擎的提交都已经有了结果。
   * 视频没有打开、引擎不在或正在重启时 resolve false：这时只有 Node 侧的屏障。
   */
  invalidateRun(videoId: Id, run: EngineRun): Promise<boolean> {
    const host = this.#host;
    if (!this.#channels.get(videoId)?.session || !host?.alive) return Promise.resolve(false);
    return host.request<{ recorded: boolean }>('runs.invalidate', { videoId, runId: run.runId, runGeneration: run.runGeneration }).then(
      (result) => result.recorded,
      (error) => {
        this.#log.warn('Stop barrier did not reach the engine', { videoId, runId: run.runId, error: String(error) });
        return false;
      },
    );
  }

  /**
   * 按 `commandId` 查一笔已经提交的事务的回执（崩溃或回执响应丢失之后，架构设计 §7.3）；没有时 null。视频要已经打开。
   */
  async receiptFor(videoId: Id, commandId: Id): Promise<TransactionReceipt | null> {
    const host = await this.#hostFor(videoId);
    const { receipt } = await host.request<{ receipt: TransactionReceipt | null }>('receipts.byCommand', { videoId, commandId });
    return receipt;
  }

  /** `guard.protections`：智能体撤销时同样不能触碰它任务的保护范围（§3.2）。 */
  async undo(
    params: RpcParams<'edits.undo'>,
    principal: TrustedPrincipal,
    guard: { protections?: EngineProtection[] } = {},
  ): Promise<EditResult> {
    const host = await this.#hostFor(params.videoId);
    return host.request<EditResult>('edits.undo', {
      ...params,
      actor: actorOf(principal),
      ...(guard.protections?.length ? { protections: guard.protections } : {}),
    });
  }

  async undoState(videoId: Id, principal: TrustedPrincipal): Promise<UndoState> {
    const host = await this.#hostFor(videoId);
    return host.request<UndoState>('edits.undoState', { videoId, actor: actorOf(principal) });
  }

  async history(videoId: Id, limit?: number): Promise<{ entries: HistoryEntry[] }> {
    const host = await this.#hostFor(videoId);
    return host.request<{ entries: HistoryEntry[] }>('history.list', { videoId, ...(limit ? { limit } : {}) });
  }

  /** 此刻读不到的素材版本：由引擎逐个核对文件在不在、长度对不对（`videos.assetStatus`）。 */
  async assetStatus(videoId: Id): Promise<{ missing: MissingAsset[] }> {
    const host = await this.#hostFor(videoId);
    return host.request<{ missing: MissingAsset[] }>('videos.assetStatus', { videoId });
  }

  /**
   * 没有任何引用的素材（引擎按实例与替身、章节缩略图、文档来源核对，所有序列都算）：`assets_prune` 的预检清单，
   * 也就是 `removeAssets` 能删的那些。只读。
   */
  async unusedAssets(videoId: Id): Promise<{ unused: UnusedAsset[] }> {
    const host = await this.#hostFor(videoId);
    return host.request<{ unused: UnusedAsset[] }>('videos.unusedAssets', { videoId });
  }

  async document(videoId: Id, documentId: Id, revision?: string): Promise<DocumentContent> {
    const host = await this.#hostFor(videoId);
    return host.request<DocumentContent>('documents.read', { videoId, documentId, ...(revision ? { revision } : {}) });
  }

  /**
   * 不打开、不取写入锁地读一个视频目录的身份与概况（引擎只读打开，已经打开的直接用）。对外服务用它按 videoId 判断范围，
   * 范围之外的视频不会因此被打开。`dir` 是视频目录的绝对路径。
   */
  async peek(dir: string): Promise<{ videoId: Id; name: string; revision: string }> {
    const host = await this.#ensureHost();
    return host.request<{ videoId: Id; name: string; revision: string }>('videos.inspect', { path: dir });
  }

  /**
   * 本机字体（架构设计 §9.1）：引擎按「族名、字重、斜体」挑 face（与排版引擎同一套匹配），给出所在文件的路径、
   * 文件里第几个与抽成单独字体的做法。预览与导出冻结用的都是这一份。不涉及哪个视频；第一次要扫一遍本机字体的名字表。
   * 本机没有的族再到下载缓存里挑（`source: 'downloaded'`）。
   */
  async fontFaces(faces: FontFaceQuery[]): Promise<LocalFontFaces> {
    const host = await this.#ensureHost();
    const cacheDir = this.#options.fontCacheDir;
    return host.request('fonts.resolve', { faces, ...(cacheDir ? { cacheDir } : {}) });
  }

  /** 本机已装的字体的族名（引擎扫的那一份，只有名字）。 */
  async fontFamilies(): Promise<string[]> {
    const host = await this.#ensureHost();
    const { families } = await host.request<{ families: string[] }>('fonts.families', {});
    return families;
  }

  /** 检查一个字体文件（下载之后核对）：按渲染用的同一套解析读出的 face；不是能用的字体时引擎以 `FONT_INVALID` 拒绝。 */
  async inspectFont(file: string): Promise<InspectedFontFace[]> {
    const host = await this.#ensureHost();
    const { faces } = await host.request<{ faces: InspectedFontFace[] }>('fonts.inspect', { path: file });
    return faces;
  }

  /**
   * 导出的冻结（架构设计 §9.11）：引擎在一次请求里按同一个视频版本求出声音的区间计划或文档在时间线上的投影，
   * 连同素材位置与文档版本（`exports.plan`）。之后的编辑不影响这份结果。
   */
  async exportPlan<T>(videoId: Id, params: Record<string, unknown>): Promise<T> {
    const host = await this.#hostFor(videoId);
    return host.request<T>('exports.plan', { ...params, videoId });
  }

  /**
   * 便携包的冻结（视频格式规范 §8）：引擎在一次请求里给出当前的快照、每个文档版本存下的正文原文与每个素材版本的位置
   * （`exports.package`）。之后的编辑不影响这份结果。
   */
  async freezePackage<T>(videoId: Id): Promise<T> {
    const host = await this.#hostFor(videoId);
    return host.request<T>('exports.package', { videoId });
  }

  /**
   * 便携包导入（`package-import.ts`）：引擎把解开、校验过的包建成 `dir` 里的新视频（`videos.importPackage`），
   * 这里把它登记为打开的视频。`dir` 在 `rootReal` 里、还不存在。
   */
  async createFromPackage(
    dir: string,
    packageDir: string,
    rootReal: string,
    scope: VideoLocation['scope'],
    principal: TrustedPrincipal,
  ): Promise<VideoOpenResult> {
    const host = await this.#ensureHost();
    const opened = await host.request<HostOpened>('videos.importPackage', { path: dir, packageDir, ...projectOf(scope) });
    this.#log.info('Video created from portable package', { videoId: opened.videoId });
    return this.#register(opened, rootReal, scope, principal);
  }

  /**
   * 素材 bytes 的位置，交给媒体通道发句柄。收纳的素材在视频目录里。链接的素材（导入的默认）留在它原来的位置：
   * 放行的正是视频登记的那一个文件（路径来自引擎里的素材记录，不来自调用方），不放行它所在目录里别的东西；
   * 而且只放行预览用得到的类型（见 `servableLinked`），免得一个别处拿来的视频把本机的任意文件登记成「素材」再读出来。
   */
  async assetFile(videoId: Id, assetId: Id, revision?: string): Promise<{ root: string; file: string; name: string }> {
    const host = await this.#hostFor(videoId);
    const blob = await host.request<ResolvedAsset>('assets.blobPath', {
      videoId,
      assetId,
      ...(revision ? { revision } : {}),
    });
    // 等引擎回话期间视频可能已经关了（没人打开时的空闲关闭、别处关闭）：按没有打开回绝，不去读已经清掉的会话。
    const session = this.#channels.get(videoId)?.session;
    if (!session) throw new RpcError('not-found', RcVideo.videoNotOpenOpenFirst(), { code: 'VIDEO_NOT_OPEN' });
    return servableAsset(blob, session.ref.path);
  }

  /**
   * 同 `assetFile`，但按视频目录找、不要求视频已经打开（引擎的只读查询 `videos.resolveAsset`，不取写锁；打开着的用打开的那一份）。
   * Space 的视频封面用（架构设计 §5.7）。`dir` 是视频目录的绝对路径，来自 Space 目录，不来自调用方。
   */
  async assetFileAt(dir: string, assetId: Id, revision?: string): Promise<{ root: string; file: string; name: string }> {
    const host = await this.#ensureHost();
    const blob = await host.request<ResolvedAsset>('videos.resolveAsset', { path: dir, assetId, ...(revision ? { revision } : {}) });
    return servableAsset(blob, dir);
  }

  /**
   * 媒体分析（波形、缩略图）的输入：素材版本的记录（内容摘要、媒体类型、探测出来的流）与文件位置。
   * 记录取自镜像，文件按 `assetFile` 的规则放行；能不能分析由媒体分析按媒体类型再判断。
   */
  async mediaSource(videoId: Id, assetId: Id, revision?: string): Promise<{ root: string; file: string; record: AssetRevision }> {
    await this.#hostFor(videoId);
    const asset = this.#channels.get(videoId)?.mirror.video.assets[assetId];
    const record = asset?.revisions[revision ?? asset.currentRevision];
    if (!record) throw new RpcError('not-found', RcVideo.assetVersionNotFound());
    const { root, file } = await this.assetFile(videoId, assetId, record.revision);
    return { root, file, record };
  }

  // ---- 主题 ----

  subscribe(
    videoId: Id,
    afterSeq: Seq | undefined,
    listener: (event: SequencedEvent<unknown>) => void,
  ): TopicSubscription<unknown, unknown> {
    const channel = this.#channels.get(videoId);
    if (!channel?.session) throw new RpcError('not-found', RcCommon.videoNotOpen());
    return channel.log.subscribe(afterSeq, listener as (event: SequencedEvent<VideoTopicEvent>) => void) as TopicSubscription<
      unknown,
      unknown
    >;
  }

  /** 已打开视频的位置与身份；没有打开时为空。 */
  ref(videoId: Id): VideoRef | null {
    const channel = this.#channels.get(videoId);
    return channel?.session ? { ...channel.session.ref, name: channel.mirror.video.name } : null;
  }

  /** 当前打开的所有视频。 */
  openRefs(): VideoRef[] {
    return [...this.#channels.keys()].flatMap((videoId) => this.ref(videoId) ?? []);
  }

  /** 测试与诊断：引擎进程号。 */
  get enginePid(): number | null {
    return this.#host?.pid ?? null;
  }

  /** 测试与诊断：Runtime 里的镜像。 */
  mirror(videoId: Id): VideoTopicSnapshot | null {
    return this.#channels.get(videoId)?.session ? this.#channels.get(videoId)!.mirror : null;
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    for (const channel of this.#channels.values()) {
      if (channel.session?.closeTimer) clearTimeout(channel.session.closeTimer);
      channel.session = null;
      channel.log.clear();
    }
    const host = this.#host ?? (await this.#starting?.catch(() => null)) ?? null;
    this.#host = null;
    await host?.close();
  }

  // ---- 内部 ----

  #register(opened: HostOpened, rootReal: string, scope: VideoLocation['scope'], principal: TrustedPrincipal): VideoOpenResult {
    opened = { ...opened, path: hostPath(opened.path) };
    let channel = this.#channels.get(opened.videoId);
    if (!channel) {
      const holder: Channel = {
        log: new TopicLog<VideoTopicSnapshot, VideoTopicEvent>(() => holder.mirror, '0'),
        mirror: { video: opened.snapshot, eventSeq: opened.eventSeq },
        session: null,
        resyncing: false,
      };
      channel = holder;
      this.#channels.set(opened.videoId, channel);
    } else if (!channel.session) {
      // 关闭之后重新打开：沿用同一个主题，发一条整体替换。
      channel.mirror = { video: opened.snapshot, eventSeq: opened.eventSeq };
      channel.log.publish({ type: 'video.replaced', snapshot: channel.mirror });
    }
    if (!channel.session) {
      const relPath = path.relative(rootReal, opened.path).split(path.sep).join('/');
      channel.session = {
        ref: {
          videoId: opened.videoId,
          name: channel.mirror.video.name,
          path: opened.path,
          source: {
            projectId: 'projectId' in scope ? scope.projectId : null,
            conversationId: 'conversationId' in scope ? scope.conversationId : null,
          },
          relPath,
        },
        openers: new Set(),
        leases: 0,
        closeTimer: null,
      };
    }
    const session = channel.session;
    session.openers.add(principal.connectionId);
    if (session.closeTimer) {
      clearTimeout(session.closeTimer);
      session.closeTimer = null;
    }
    return { ref: { ...session.ref, name: channel.mirror.video.name }, snapshot: channel.mirror };
  }

  async #closeSession(videoId: Id, reason: string): Promise<void> {
    const channel = this.#channels.get(videoId);
    if (!channel?.session) return;
    if (channel.session.closeTimer) clearTimeout(channel.session.closeTimer);
    const { ref: { path }, leases } = channel.session;
    channel.session = null;
    channel.log.publish({ type: 'video.closed', reason });
    this.#log.info('Video closed', { videoId, reason });
    const host = this.#host;
    if (!host?.alive) return;
    // 放下写锁之前清理 `blobs/`（架构设计 §5.2、§5.5）：只在正常关闭（打开者走光或空闲）且没有任务租约时做；
    // 被删除的视频正在搬走、引擎出错的不做。便携包导入在登记会话之前完成，走不到这里。失败只记日志，照常关闭。
    if ((reason === 'closed' || reason === 'idle') && leases === 0)
      await host.request('videos.gcBlobs', { path }).catch((error) => this.#log.warn('Cleaning up video blobs failed', { error: String(error) }));
    await host.request('videos.close', { videoId }).catch((error) => this.#log.warn('Closing the video failed', { error: String(error) }));
  }

  async #hostFor(videoId: Id): Promise<EngineHost> {
    if (!this.#channels.get(videoId)?.session) throw new RpcError('not-found', RcVideo.videoNotOpenOpenFirst(), { code: 'VIDEO_NOT_OPEN' });
    const host = this.#host ?? (await this.#starting);
    if (!host?.alive) throw new RpcError('engine-unavailable', RcVideo.engineRestarting());
    return host;
  }

  #ensureHost(): Promise<EngineHost> {
    if (this.#closed) return Promise.reject(new RpcError('engine-unavailable', RcVideo.runtimeStopping()));
    if (this.#host?.alive) return Promise.resolve(this.#host);
    this.#starting ??= (async () => {
      const command = this.#options.resolveCommand();
      if (!command) throw new RpcError('engine-unavailable', RcVideo.engineNotFound());
      const host = await EngineHost.start({
        command,
        env: await this.#options.env(),
        log: this.#log.child('engine'),
        onEvent: (event) => this.#onEvent(event),
        onExit: () => this.#onHostExit(),
      });
      this.#host = host;
      return host;
    })().finally(() => {
      this.#starting = null;
    });
    return this.#starting;
  }

  #onEvent(event: VideoEvent): void {
    const channel = this.#channels.get(event.videoId);
    if (!channel?.session || channel.resyncing) return;
    const current = BigInt(channel.mirror.eventSeq);
    const seq = BigInt(event.eventSeq);
    if (seq <= current) return;
    if (seq !== current + 1n) {
      void this.#resync(event.videoId);
      return;
    }
    channel.mirror = applyVideoEvent(channel.mirror, event);
    channel.log.publish({ type: 'video.event', event });
    this.#notifyChange(event.videoId);
  }

  /**
   * 已打开视频的版本变化（提交、补齐之后）。Space 的派生索引（架构设计 §5.7、§5.11）靠它增量更新；
   * 没有打开的视频由 Space 按目录变化发现。返回取消订阅的函数。
   */
  onChange(listener: (change: { videoId: Id; path: string; revision: string }) => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  #notifyChange(videoId: Id): void {
    const channel = this.#channels.get(videoId);
    if (!channel?.session) return;
    const change = { videoId, path: channel.session.ref.path, revision: channel.mirror.video.revision };
    for (const listener of this.#changeListeners) {
      try {
        listener(change);
      } catch (error) {
        this.#log.error('Video change listener failed', { videoId, error: String(error) });
      }
    }
  }

  /**
   * 内容索引用的只读查询（架构设计 §5.11，引擎的 `videos.readContent`）：快照与文字类文档的正文和时间线投影。
   * 与 `peek` 一样不打开视频、不取写入锁；已经打开的视频用打开的那一份。`dir` 是视频目录的绝对路径。
   */
  async readContent<T>(dir: string): Promise<T> {
    const host = await this.#ensureHost();
    return host.request<T>('videos.readContent', { path: dir });
  }

  async #resync(videoId: Id): Promise<void> {
    const channel = this.#channels.get(videoId);
    if (!channel || channel.resyncing) return;
    channel.resyncing = true;
    try {
      const host = await this.#ensureHost();
      const fresh = await host.request<{ eventSeq: Seq; snapshot: VideoSnapshot }>('videos.snapshot', { videoId });
      if (!channel.session) return;
      channel.mirror = { video: fresh.snapshot, eventSeq: fresh.eventSeq };
      channel.log.publish({ type: 'video.replaced', snapshot: channel.mirror });
      this.#notifyChange(videoId);
    } catch (error) {
      this.#log.error('Catching up the video mirror failed', { videoId, error: String(error) });
    } finally {
      channel.resyncing = false;
    }
  }

  #onHostExit(): void {
    this.#host = null;
    if (this.#closed) return;
    const open = [...this.#channels.entries()].filter(([, channel]) => channel.session);
    if (open.length === 0) return;
    const now = Date.now();
    this.#restarts = this.#restarts.filter((t) => now - t < RESTART_WINDOW_MS);
    if (this.#restarts.length >= MAX_RESTARTS) {
      this.#log.error('Video engine keeps exiting; no more automatic restarts');
      for (const [videoId] of open) void this.#closeSession(videoId, 'engine-failed');
      return;
    }
    this.#restarts.push(now);
    void (async () => {
      for (const [videoId, channel] of open) {
        const session = channel.session;
        if (!session) continue;
        try {
          const host = await this.#ensureHost();
          const opened = await host.request<HostOpened>('videos.open', {
            path: session.ref.path,
            ...(session.ref.source.projectId ? { projectId: session.ref.source.projectId } : {}),
          });
          if (opened.videoId !== videoId) throw new Error('The video identity changed');
          channel.mirror = { video: opened.snapshot, eventSeq: opened.eventSeq };
          channel.log.publish({ type: 'video.replaced', snapshot: channel.mirror });
          this.#log.info('Reopened video after engine restart', { videoId });
        } catch (error) {
          this.#log.error("Couldn't reopen video after engine restart", { videoId, error: String(error) });
          channel.session = null;
          channel.log.publish({ type: 'video.closed', reason: 'engine-failed' });
        }
      }
    })();
  }
}

/** 视频所属的项目：在项目目录里的视频带上项目的 id，会话工作目录里的不带。 */
function projectOf(scope: VideoLocation['scope']): { projectId?: Id } {
  return 'projectId' in scope ? { projectId: scope.projectId } : {};
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

/** 取视频目录的真实路径，并确认它在来源目录之内、里面有 `video.db`。 */
async function locateVideoDir(location: VideoLocation): Promise<{ rootReal: string; dir: string }> {
  let rootReal: string;
  let real: string;
  try {
    rootReal = await fs.realpath(location.root);
    real = await fs.realpath(path.resolve(location.root, location.file));
  } catch {
    throw new RpcError('not-found', RcVideo.videoNotFound());
  }
  if (path.basename(real) === DB_FILE || path.basename(real) === LEGACY_DB_FILE) real = path.dirname(real);
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (real !== rootReal && !real.startsWith(prefix)) throw new RpcError('forbidden', RcVideo.onlyWorkspaceVideos());
  // 删除了的视频在来源目录的回收站里（§5.7）：先恢复再打开。
  if (path.relative(rootReal, real).split(path.sep).includes(TRASH_DIR)) {
    throw new RpcError('conflict', RcVideo.videoDeletedRestoreFromTrash(), { code: 'VIDEO_TRASHED' });
  }
  if (!(await exists(path.join(real, DB_FILE))) && !(await exists(path.join(real, LEGACY_DB_FILE)))) {
    throw new RpcError('not-found', RcVideo.dirNotVideo());
  }
  return { rootReal, dir: real };
}

/** Lottie 文件的大小上限：再大就不是贴纸动画了。 */
const LOTTIE_MAX_BYTES = 32 * 2 ** 20;

/**
 * 链接素材可以经媒体通道给出去的扩展名，及其应有的媒体类型的大类（与引擎按扩展名认媒体类型的表一致）。
 * 视频容器里只有声音时引擎按音频处理，所以音视频算一类。
 */
type ServableGroup = 'av' | 'image' | 'font' | 'json' | 'dotlottie';
const LINKED_SERVABLE: Record<string, ServableGroup> = {};
for (const [group, exts] of Object.entries({
  av: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  font: ['ttf', 'otf', 'woff2'],
  json: ['json'],
  dotlottie: ['lottie'],
}) as [ServableGroup, string[]][]) {
  for (const ext of exts) LINKED_SERVABLE[ext] = group;
}

function servableGroup(mediaType: string): ServableGroup | null {
  if (/^(video|audio)\//.test(mediaType)) return 'av';
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('font/')) return 'font';
  if (mediaType === 'application/json') return 'json';
  if (mediaType === 'application/zip') return 'dotlottie';
  return null;
}

/**
 * 引擎给出的素材位置 → 媒体通道放行的来源目录与文件。收纳的素材在视频目录（`videoDir`）里；链接的只放行登记的那一个文件，
 * 而且只放行预览用得到的类型（`servableLinked`）。
 */
async function servableAsset(blob: ResolvedAsset, videoDir: string): Promise<{ root: string; file: string; name: string }> {
  if (blob.storage === 'linked') {
    // 登记的路径可能是符号链接：按它指向的真实文件判断与放行（类型看真实文件的扩展名，免得借一个
    // 叫 clip.mp4 的符号链接读出别的文件），媒体通道也才不会把它当成所在目录之外的文件。
    const real = await fs.realpath(blob.path).catch(() => blob.path);
    if (!(await servableLinked({ ...blob, path: real }))) {
      throw new RpcError('forbidden', RcVideo.linkedPreviewUnsupported());
    }
    return { root: path.dirname(real), file: path.basename(real), name: blob.name };
  }
  return { root: videoDir, file: blob.path, name: blob.name };
}

/**
 * 链接素材能不能经媒体通道给出去。界面与预览会请求的是图片、音视频（播放、波形、缩略图、转写）、字体与 Lottie 动画：
 *
 * - 登记的媒体类型与文件实际的扩展名必须是同一大类。媒体类型来自视频里的记录，别处拿来的视频可以随便写；
 *   再要求文件本身叫 `*.mp4`、`*.png`、`*.ttf` 之类，登记成「图片」的 `~/.ssh/id_rsa` 就读不出来。
 * - JSON 只放行读出来确实是 Lottie 动画的（有版本、尺寸、帧率、帧范围与图层），本机别的 JSON（配置、凭据）登记成素材也读不出来；
 *   `.lottie` 只放行 zip 中央目录里确实有 `animations/*.json` 的压缩包。
 * - 不放行字幕文件（`srt`、`vtt`、`ass`）：内容是任意文本，没法像媒体那样按类型确认，预览也不经媒体通道读它们
 *   （字幕是视频里的文档）。不放行目录（代码包）：媒体通道只给单个文件，代码包合成的预览用预渲染的视频。
 */
async function servableLinked(blob: ResolvedAsset): Promise<boolean> {
  const group = servableGroup(blob.mediaType);
  if (!group || LINKED_SERVABLE[path.extname(blob.path).slice(1).toLowerCase()] !== group) return false;
  if (group !== 'json' && group !== 'dotlottie') return true;
  try {
    const stat = await fs.stat(blob.path);
    if (!stat.isFile() || stat.size > LOTTIE_MAX_BYTES) return false;
    if (group === 'dotlottie') return isDotLottie(await fs.readFile(blob.path));
    const data: unknown = JSON.parse(await fs.readFile(blob.path, 'utf8'));
    if (typeof data !== 'object' || data === null) return false;
    const lottie = data as Record<string, unknown>;
    return (
      typeof lottie.v === 'string' &&
      ['w', 'h', 'fr', 'ip', 'op'].every((key) => Number.isFinite(lottie[key])) &&
      Array.isArray(lottie.layers)
    );
  } catch {
    return false;
  }
}
