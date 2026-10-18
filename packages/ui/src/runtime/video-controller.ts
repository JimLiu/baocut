import { applyVideoTopicEvent, type BaoCutClient, type ConnectionState } from '@baocut/client';
import {
  RpcError,
  localDocumentOperation,
  isEngineErrorBody,
  newId,
  refOf,
  type EditOperation,
  type FileTarget,
  type Id,
  type Localized,
  type MessageRef,
  type VideoRef,
  type TransactionReceipt,
  type UndoTarget,
  type VideoSnapshotStatus,
  type VideoVersionList,
  type VideoVersionText,
} from '@baocut/protocol';
import { useVideo } from '../state/video-store.ts';
import { AssetCache } from './asset-cache.ts';
import { DocumentCache } from './document-cache.ts';
import { MediaAnalysisCache } from './media-analysis.ts';
import { MediaUrlCache } from './media-url-cache.ts';
import { preparePlaybackMedia } from './media-playback.ts';
import { RT } from './runtime-copy.ts';

/**
 * 编辑器与视频之间的通道（架构设计 §11）：打开、订阅、提交命令、撤销。
 *
 * - 同一时间只打开一个视频（一个窗口一个编辑器）。
 * - 命令排队一个一个发：每个命令都带上发出时最新的版本号，前一个的事件总在它的回执之前到达。
 * - 引擎暂时不可用时用同一个 commandId 重试；重复提交由引擎去重。
 * - 连接恢复（包括 Runtime 重启）后重新打开视频、重新订阅，从快照接上。
 */
export class VideoController {
  readonly #client: BaoCutClient;
  #unsubscribe: (() => void) | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #wasConnected = false;
  #generation = 0;
  /** 当前视频的文档正文（字幕的句子与样式），预览与时间线共用。 */
  readonly documents: DocumentCache;
  /** 当前视频的素材内容（Lottie 动画、声音的频谱），预览用。 */
  readonly assets: AssetCache;
  /** 当前视频素材的分析结果（波形峰值、缩略图），时间线用。 */
  readonly media: MediaAnalysisCache;
  /** 当前视频素材的媒体地址（`media.resolve` 的句柄），预览与素材面板的媒体元素共用。 */
  readonly mediaUrls: MediaUrlCache;

  constructor(client: BaoCutClient) {
    this.#client = client;
    this.documents = new DocumentCache((documentId, revision) => {
      const videoId = useVideo.getState().video?.videoId;
      if (!videoId) return Promise.reject(new Error(RT.noOpenVideo));
      return this.#client.request('documents.read', { videoId, documentId, revision });
    });
    this.assets = new AssetCache(async (asset) => {
      const videoId = useVideo.getState().video?.videoId;
      if (!videoId) throw new Error(RT.noOpenVideo);
      const handle = await this.#client.request('media.resolve', { videoId, assetId: asset.id, revision: asset.revision });
      return handle.url;
    });
    this.mediaUrls = new MediaUrlCache((videoId, asset, signal, onProgress) =>
      this.#client.request('media.resolve', { videoId, assetId: asset.id, revision: asset.revision })
        .then(handle => preparePlaybackMedia(this.#client, handle, signal, { onProgress })),
    );
    const videoId = () => {
      const id = useVideo.getState().video?.videoId;
      if (!id) throw new Error(RT.noOpenVideo);
      return id;
    };
    this.media = new MediaAnalysisCache({
      peaks: async (asset) => this.#client.request('media.peaks', { videoId: videoId(), assetId: asset.id, revision: asset.revision }),
      thumbnail: async (asset, at) =>
        this.#client.request('media.thumbnail', { videoId: videoId(), assetId: asset.id, revision: asset.revision, at }),
    });
  }

  /** 连接状态变化（由会话转来）。断开时标成未追平；重新连上后丢掉旧的媒体地址（Runtime 重启后句柄失效），重新打开。 */
  onConnection(state: ConnectionState): void {
    const connected = state.status === 'connected';
    const video = useVideo.getState().video;
    if (!connected && this.#wasConnected && video && video.status === 'ready') useVideo.getState().update({ status: 'stale' });
    if (connected && !this.#wasConnected) this.mediaUrls.clear();
    if (connected && !this.#wasConnected && video) void this.#open(video.target);
    this.#wasConnected = connected;
  }

  /** 打开一个视频。已经打开同一个定位时不重复打开。 */
  open(target: FileTarget): void {
    const current = useVideo.getState().video;
    if (current && sameTarget(current.target, target) && current.status !== 'error') return;
    this.close();
    useVideo.getState().begin(target);
    void this.#open(target);
  }

  /** 新建视频并打开。返回打开它用的定位（放进路由）。 */
  async create(scope: { projectId?: Id; conversationId?: Id }, name?: string): Promise<FileTarget> {
    const { ref } = await this.#client.request('videos.create', { ...scope, ...(name ? { name } : {}), commandId: newId('cmd') });
    return targetOf(ref);
  }

  close(): void {
    const video = useVideo.getState().video;
    this.#generation++;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.documents.clear();
    this.assets.clear();
    this.media.clear();
    this.mediaUrls.clear();
    useVideo.getState().clear();
    if (video?.videoId) void this.#client.request('videos.close', { videoId: video.videoId }).catch(() => {});
  }

  /**
   * 提交一笔编辑事务。成功返回回执；失败时错误记在 store 里（界面显示），返回 null。修改名带着目录引用一起存下
   * （命令与协议规范 §3.1），历史与撤销提示按读者的语言显示；不给时由引擎起名。
   */
  apply(operations: EditOperation[], label?: Localized): Promise<TransactionReceipt | null> {
    // 差异必须基于编辑时的正文与视频版本；排队期间变化时让引擎拒绝，不能把旧正文重基到新版本。
    const base = useVideo.getState().video?.state?.video;
    const commandId = newId('cmd');
    const hasDocumentEdit = operations.some((op) => op.type === 'patchDocument' || op.type === 'renameSpeakers' || op.type === 'updateWords' || (op.type === 'putDocument' && !!op.documentId));
    return this.#enqueue(async (videoId, revision) => {
      const bodies = new Map<Id, unknown>();
      const local: EditOperation[] = [];
      for (const operation of operations) {
        if (operation.type !== 'putDocument' || !operation.documentId) {
          local.push(operation);
          continue;
        }
        const record = base?.documents?.[operation.documentId];
        if (!record) { local.push(operation); continue; }
        let body = bodies.get(record.id) ?? this.documents.peek(record.id, record.currentRevision);
        if (body === undefined) body = (await this.#client.request('documents.read', { videoId, documentId: record.id, revision: record.currentRevision })).body;
        local.push(localDocumentOperation(operation, body));
        bodies.set(record.id, operation.body);
      }
      return this.#client.request('edits.apply', {
        videoId,
        commandId,
        expectedRevision: hasDocumentEdit && base ? base.revision : revision,
        operations: local,
        ...(label ? transactionLabel(label) : {}),
      });
    });
  }

  undo(target: UndoTarget): Promise<TransactionReceipt | null> {
    return this.#enqueue((videoId) => this.#client.request('edits.undo', { videoId, commandId: newId('cmd'), target }));
  }

  /** 应用一次识别说话人的提案（`edits.applySpeakers`，一笔事务）；`names` 是确认页改过的名字。失败同 `apply`。 */
  applySpeakers(jobId: Id, names?: Record<Id, string>): Promise<TransactionReceipt | null> {
    return this.#enqueue((videoId) =>
      this.#client.request('edits.applySpeakers', { videoId, jobId, commandId: newId('cmd'), ...(names ? { names } : {}) }),
    );
  }

  /** 已经发出的命令都有了结果（发送前同步，产品设计 §3.2.4）：之后读到的版本包含用户刚做的修改。 */
  settled(): Promise<void> {
    return this.#queue.then(
      () => {},
      () => {},
    );
  }

  async history(limit = 100) {
    const videoId = useVideo.getState().video?.videoId;
    if (!videoId) return [];
    const { entries } = await this.#client.request('videos.history', { videoId, limit });
    return entries;
  }

  // ---- 版本记录（视频格式规范 §9、架构设计 §5.12）：只读的直接发；写的排在已经发出的命令后面 ----

  /** 当前视频的版本（新的在前）与读不出的版本序号。 */
  versionList(): Promise<VideoVersionList> {
    return this.#client.request('videos.versions.list', { videoId: this.#videoId() });
  }

  /** 一个版本的头部与 diff 文本。 */
  versionText(version: number): Promise<VideoVersionText> {
    return this.#client.request('videos.versions.get', { videoId: this.#videoId(), version });
  }

  /** 工作区快照与视频库的关系（同步、正在写、被外部改过……）与最新的版本号。 */
  versionStatus(): Promise<VideoSnapshotStatus> {
    return this.#client.request('videos.versions.status', { videoId: this.#videoId() });
  }

  /** 保存版本（§9.6）。失败时抛出原来的错误：对话框要看错误码与断点，不记进 `commandError`。 */
  saveVersion(name: string, note?: string): Promise<{ version: number }> {
    const commandId = newId('cmd');
    return this.#versionWrite((videoId) =>
      this.#client.request('videos.versions.save', { videoId, commandId, name, ...(note ? { note } : {}) }),
    );
  }

  /** 回到版本（§9.5）：一笔可以撤销的修改，单独成一版；与现在相同时没有回执，也没有新版本。失败同 `saveVersion`。 */
  restoreVersion(version: number, before: boolean): Promise<{ receipt: TransactionReceipt | null; version: number | null }> {
    const commandId = newId('cmd');
    return this.#versionWrite((videoId) =>
      this.#client.request('videos.versions.restore', { videoId, commandId, version, ...(before ? { before: true } : {}) }),
    );
  }

  /** 删除保存的版本与它的检查点（§9.6）。失败同 `saveVersion`。 */
  deleteVersion(version: number): Promise<{ receipt: TransactionReceipt | null }> {
    const commandId = newId('cmd');
    return this.#versionWrite((videoId) => this.#client.request('videos.versions.delete', { videoId, commandId, version }));
  }

  clearError(): void {
    useVideo.getState().update({ commandError: null });
  }

  // ---- 内部 ----

  async #open(target: FileTarget): Promise<void> {
    const generation = ++this.#generation;
    const store = useVideo.getState();
    store.update({ status: 'opening', error: null });
    try {
      const { ref, snapshot } = await this.#client.request('videos.open', target);
      if (generation !== this.#generation) return;
      useVideo.getState().update({ videoId: ref.videoId, ref, state: snapshot });
      this.#subscribe(ref.videoId, generation);
    } catch (error) {
      if (generation !== this.#generation) return;
      useVideo.getState().update({ status: 'error', error: (error as Error).message });
    }
  }

  #subscribe(videoId: Id, generation: number): void {
    this.#unsubscribe?.();
    this.#unsubscribe = this.#client.subscribeVideo(videoId, {
      snapshot: (snapshot) => {
        if (generation !== this.#generation) return;
        useVideo.getState().update({ state: snapshot, status: 'ready' });
        void this.#refreshUndo();
      },
      event: (event) => {
        if (generation !== this.#generation) return;
        const video = useVideo.getState().video;
        if (!video?.state) return;
        const next = applyVideoTopicEvent(video.state, event);
        if (next === null) {
          // 视频在 Runtime 里关闭了（例如引擎多次崩溃）：保留最后的画面，重新打开。
          useVideo.getState().update({ status: 'stale' });
          void this.#open(video.target);
          return;
        }
        useVideo.getState().update({
          state: next,
          status: 'ready',
          ref: video.ref ? { ...video.ref, name: next.video.name } : video.ref,
          ...(event.type === 'video.event'
            ? { lastChange: { by: event.event.actor.kind, label: event.event.label, labelRef: event.event.labelRef } }
            : {}),
          ...(event.type === 'video.replaced' ? { replaced: (video.replaced ?? 0) + 1 } : {}),
        });
        void this.#refreshUndo();
      },
    });
  }

  async #refreshUndo(): Promise<void> {
    const videoId = useVideo.getState().video?.videoId;
    if (!videoId) return;
    try {
      const undo = await this.#client.request('edits.undoState', { videoId });
      if (useVideo.getState().video?.videoId === videoId) useVideo.getState().update({ undo });
    } catch {
      // 断线时在重新打开后再取。
    }
  }

  #videoId(): Id {
    const videoId = useVideo.getState().video?.videoId;
    if (!videoId) throw new Error(RT.noOpenVideo);
    return videoId;
  }

  /** 版本记录的写操作：同 `#enqueue` 排队并计入正在提交，但错误原样抛给调用方；有回执时记成上一次修改的回执。 */
  #versionWrite<T extends { receipt: TransactionReceipt | null }>(send: (videoId: Id) => Promise<T>): Promise<T> {
    const videoId = this.#videoId();
    const bump = (delta: number) => {
      const latest = useVideo.getState().video;
      if (latest) useVideo.getState().update({ inFlight: Math.max(0, latest.inFlight + delta) });
    };
    bump(1);
    const run = async (): Promise<T> => {
      try {
        const result = await send(videoId);
        if (result.receipt && useVideo.getState().video?.videoId === videoId)
          useVideo.getState().update({ lastReceipt: result.receipt, commandError: null });
        return result;
      } finally {
        bump(-1);
      }
    };
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => null);
    return result;
  }

  #enqueue(
    send: (videoId: Id, revision: string) => Promise<{ receipt: TransactionReceipt; replayed: boolean }>,
  ): Promise<TransactionReceipt | null> {
    const store = useVideo.getState();
    const video = store.video;
    if (!video?.videoId || video.status !== 'ready') {
      store.update({ commandError: { message: RT.notCaughtUp, code: null } });
      return Promise.resolve(null);
    }
    store.update({ inFlight: video.inFlight + 1 });
    const run = async (): Promise<TransactionReceipt | null> => {
      try {
        for (let attempt = 0; ; attempt++) {
          const current = useVideo.getState().video;
          if (!current?.videoId || !current.state) return null;
          try {
            const { receipt } = await send(current.videoId, current.state.video.revision);
            useVideo.getState().update({ lastReceipt: receipt, commandError: null });
            return receipt;
          } catch (error) {
            if (error instanceof RpcError && error.code === 'engine-unavailable' && attempt < 2) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              continue;
            }
            throw error;
          }
        }
      } catch (error) {
        const details = error instanceof RpcError ? error.details : undefined;
        useVideo.getState().update({
          commandError: { message: (error as Error).message, code: isEngineErrorBody(details) ? details.code : null },
        });
        return null;
      } finally {
        const latest = useVideo.getState().video;
        if (latest) useVideo.getState().update({ inFlight: Math.max(0, latest.inFlight - 1) });
      }
    };
    const result = this.#queue.then(run, run);
    this.#queue = result;
    return result;
  }
}

/** `edits.apply` 的修改名字段：当前语言的文字与它的目录引用（命令与协议规范 §3.1）。 */
export function transactionLabel(label: Localized): { label: string; labelRef: MessageRef } {
  return { label: label.text, labelRef: refOf(label) };
}

/** 视频的定位：所在来源目录里的相对路径。 */
export function targetOf(ref: VideoRef): FileTarget {
  return ref.source.projectId
    ? { projectId: ref.source.projectId, path: ref.relPath }
    : { conversationId: ref.source.conversationId!, path: ref.relPath };
}

export function sameTarget(a: FileTarget, b: FileTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
