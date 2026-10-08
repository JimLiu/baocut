import {attachmentUploadMime} from '@baocut/protocol';
import { BaoCutClient } from '@baocut/client';
import { preparePlaybackMedia } from './media-playback.ts';
import {
  RUNTIME_VERSION,
  newId,
  type AgentMode,
  type ApprovalDecision,
  type AttachmentRef,
  type Conversation,
  type DriverId,
  type EditorContext,
  type ExportCreateRequest,
  type FileTarget,
  type Id,
  type JobReconcileDecision,
  type JobRecord,
  type MediaHandle,
  type MediaTarget,
  type Project,
  type SpaceEntry,
  type SubtitleTrack,
  type SkillSendRef,
  type TemplateSendRef,
} from '@baocut/protocol';
import type { HostBridge } from '../host.ts';
import { importAndPlace } from '../model/editor-ops.ts';
import { insertVisual, type VisualLayer } from '../model/new-items.ts';
import { useConnection } from '../state/connection-store.ts';
import { useDirectory } from '../state/directory-store.ts';
import { useGrants } from '../state/grants-store.ts';
import { useJobs } from '../state/jobs-store.ts';
import { libraryFeed } from '../state/library-feed.ts';
import { useModels } from '../state/models-store.ts';
import { useSettings } from '../state/settings-store.ts';
import { useSpace } from '../state/space-store.ts';
import { useTasks } from '../state/tasks-store.ts';
import { useTimeline } from '../state/timeline-store.ts';
import { putAttachment } from './attachment-upload.ts';
import { RT } from './runtime-copy.ts';
import { SpaceThumbnailCache } from './space-thumbnails.ts';
import { VideoController, targetOf } from './video-controller.ts';

/**
 * 界面与 Runtime 之间的唯一通道：把订阅灌进 Zustand 镜像，把用户操作变成公共命令。
 * 组件不直接碰 WebSocket，也不在本地改业务状态（架构设计 §11.1）。
 */
export class RuntimeSession {
  readonly client: BaoCutClient;
  readonly host: HostBridge;
  /** 编辑器打开的视频。 */
  readonly videos: VideoController;
  /** Space 网格与列表的缩略图（`space.thumbnail`）。 */
  readonly spaceThumbnails: SpaceThumbnailCache;
  readonly #watchers = new Map<Id, { count: number; unsubscribe: () => void }>();
  #disposers: (() => void)[] = [];

  constructor(host: HostBridge) {
    this.host = host;
    this.client = new BaoCutClient({
      resolve: () => host.getConnection(),
      client: { kind: 'desktop', name: 'baocut-desktop', version: RUNTIME_VERSION },
    });
    this.videos = new VideoController(this.client);
    this.spaceThumbnails = new SpaceThumbnailCache((entryId) => this.spaceThumbnail(entryId));
  }

  start(): void {
    this.#disposers.push(
      this.client.onState((state) => {
        useConnection.getState().setState(state);
        this.videos.onConnection(state);
        if (state.status === 'connected') this.spaceThumbnails.revive();
      }),
      // Agent 列表与偏好：快照先给上次的探测结果（Runtime 存在磁盘上），后台刷新、纠正与偏好变化都推整份新视图。
      // 断线重连后客户端会重新订阅、重取快照。
      this.client.subscribeAgents({
        snapshot: (view) => useConnection.getState().setAgents(view),
        event: (event) => useConnection.getState().setAgents(event.view),
      }),
      // 用户去终端登录或装好 Agent 再回来：窗口重新获得焦点时拉一次 `agents.list`，Runtime 据此对缓存说不可用的
      // Driver 做便宜的纠正（架构设计 §3.11），结果经主题推送，这里不用返回值。
      this.#onWindowFocus(() => {
        if (useConnection.getState().state.status !== 'connected') return;
        void this.client.request('agents.list', {}).catch(() => {});
      }),
      this.client.subscribeDirectory({
        snapshot: (snapshot) => useDirectory.getState().replace(snapshot),
        event: (event) => useDirectory.getState().apply(event),
      }),
      this.client.subscribeTasks({
        snapshot: (snapshot) => useTasks.getState().replace(snapshot),
        event: (event) => useTasks.getState().apply(event),
      }),
      this.client.subscribeSpace({
        snapshot: (snapshot) => useSpace.getState().replace(snapshot),
        event: (event) => useSpace.getState().apply(event),
      }),
      this.client.subscribeJobs({
        snapshot: (snapshot) => useJobs.getState().replace(snapshot),
        event: (event) => useJobs.getState().apply(event),
      }),
      this.client.subscribeModels({
        snapshot: (snapshot) => useModels.getState().replace(snapshot),
        event: (event) => useModels.getState().apply(event),
      }),
      this.client.subscribeSettings({
        snapshot: (snapshot) => useSettings.getState().replace(snapshot),
        event: (event) => useSettings.getState().apply(event),
      }),
      // 用户库只订阅这一次：各个库的镜像在 library-feed 里登记（同一主题再 subscribe 会顶掉这一次）。
      this.client.subscribe<import('@baocut/protocol').LibrarySnapshot, import('@baocut/protocol').LibraryEvent>('library', libraryFeed),
      this.client.subscribe<import('@baocut/protocol').GrantsSnapshot, import('@baocut/protocol').GrantsEvent>('grants', {
        snapshot: (snapshot) => useGrants.getState().replace(snapshot),
        event: (event) => useGrants.getState().apply(event),
      }),
    );
    void this.client.connect().catch(() => {});
  }

  #onWindowFocus(handler: () => void): () => void {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }

  dispose(): void {
    this.videos.close();
    this.spaceThumbnails.clear();
    for (const dispose of this.#disposers) dispose();
    for (const watcher of this.#watchers.values()) watcher.unsubscribe();
    this.#watchers.clear();
    this.client.close();
  }

  /** 打开一个会话的内容订阅；引用计数，最后一个使用者离开时退订。 */
  watchConversation(id: Id): () => void {
    let watcher = this.#watchers.get(id);
    if (!watcher) {
      const unsubscribe = this.client.subscribeConversation(id, {
        snapshot: (snapshot) => useTimeline.getState().replace(id, snapshot),
        event: (event) => useTimeline.getState().apply(id, event),
      });
      watcher = { count: 0, unsubscribe };
      this.#watchers.set(id, watcher);
    }
    watcher.count++;
    return () => {
      const current = this.#watchers.get(id);
      if (!current || --current.count > 0) return;
      current.unsubscribe();
      this.#watchers.delete(id);
    };
  }

  // ---- 命令 ----

  /** 不给的字段用 Runtime 记着的偏好：上次的访问模式、默认 Agent 及它的默认模型与推理强度。 */
  async createConversation(
    projectId: Id | null,
    options: { accessMode?: AgentMode; driverId?: DriverId; model?: string | null; effort?: string | null } = {},
  ): Promise<Conversation> {
    const { conversation } = await this.client.request('conversations.create', { projectId, commandId: newId('cmd'), ...options });
    return conversation;
  }

  /**
   * `context`：编辑器当时的状态（打开的视频、版本、选区、播放头），随消息交给智能体。
   * `attachments`：已经上传完的图片（`uploadAttachment` 返回的 id）。
   * `template`：挂着的场景模板（模板包规范 §5.2），Runtime 据此给智能体拼简报引导与模板正文；`text` 仍是用户自己的话。
   * `skill`：输入框「+ › 使用 Skill」点选的 skill（产品设计 §6.9），Runtime 把 `SKILL.md` 正文附给智能体，消息上另带标记。
   */
  async send(
    conversationId: Id,
    text: string,
    context?: EditorContext,
    attachments?: Id[],
    template?: TemplateSendRef,
    skill?: SkillSendRef,
  ): Promise<Id> {
    const { taskId } = await this.client.request('conversations.send', {
      conversationId,
      text,
      commandId: newId('cmd'),
      ...(context ? { context } : {}),
      ...(attachments?.length ? { attachments } : {}),
      ...(template ? { template } : {}),
      ...(skill ? { skill } : {}),
    });
    return taskId;
  }

  /** 插进正在运行的回合；Agent 不支持、或已经没有在跑的回合时如实返回，由调用方决定排队还是直接发。 */
  async steer(conversationId: Id, text: string, attachments?: Id[]): Promise<'steered' | 'unsupported' | 'no-active-turn'> {
    const { status } = await this.client.request('conversations.steer', {
      conversationId,
      text,
      commandId: newId('cmd'),
      ...(attachments?.length ? { attachments } : {}),
    });
    return status;
  }

  /** 上传一张要随消息发送的图片：先登记拿到一次性地址，再 PUT 原始字节（Content-Type 与登记时一致）。 */
  async uploadAttachment(file: File, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<AttachmentRef> {
    const { attachment, uploadUrl } = await this.client.request('attachments.prepare', {
      fileName: file.name || 'image',
      mimeType: attachmentUploadMime(file.type),
      size: file.size,
    });
    await putAttachment(uploadUrl, file, attachment.mimeType, onProgress, signal);
    return attachment;
  }

  async stop(taskId: Id): Promise<void> {
    await this.client.request('tasks.stop', { taskId });
  }

  async interrupt(conversationId: Id): Promise<void> {
    await this.client.request('agents.interrupt', { conversationId });
  }

  async respondToApproval(conversationId: Id, approvalId: Id, decision: ApprovalDecision): Promise<void> {
    await this.client.request('agents.respondToApproval', { conversationId, approvalId, decision });
  }

  /** 让用户选一个目录并登记为项目；取消时返回 null。 */
  async openProjectFromDialog(): Promise<Project | null> {
    const dir = await this.host.pickDirectory();
    if (!dir) return null;
    const { project } = await this.client.request('projects.open', { path: dir });
    return project;
  }

  /** 新建项目：在项目目录下建一个新目录（产品设计 §3.1）。 */
  async createProject(name: string): Promise<Project> {
    const { project } = await this.client.request('projects.create', { name: name.trim() || undefined, commandId: newId('cmd') });
    return project;
  }

  async updateProject(projectId: Id, patch: { name?: string; pinned?: boolean; archived?: boolean }): Promise<Project> {
    const { project } = await this.client.request('projects.update', { projectId, ...patch });
    return project;
  }

  async updateConversation(
    conversationId: Id,
    patch: {
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      accessMode?: AgentMode;
      driverId?: DriverId;
      model?: string | null;
      effort?: string | null;
    },
  ): Promise<void> {
    await this.client.request('conversations.update', { conversationId, ...patch });
  }

  async markRead(conversationId: Id): Promise<void> {
    await this.client.request('conversations.markRead', { conversationId });
  }

  async updateSpaceEntry(entryId: Id, patch: { favorite?: boolean; displayName?: string | null; trashed?: boolean }): Promise<SpaceEntry> {
    const { entry } = await this.client.request('space.update', { entryId, ...patch });
    return entry;
  }

  async rescanSpace(): Promise<void> {
    await this.client.request('space.rescan', {});
  }

  /** 媒体地址（架构设计 §4.5）：受限句柄，有期限，只指向这一个文件。 */
  async resolveMedia(target: MediaTarget): Promise<MediaHandle> {
    return this.client.request('media.resolve', target);
  }

  playbackMedia(handle: MediaHandle, signal?: AbortSignal): Promise<MediaHandle> {
    return preparePlaybackMedia(this.client, handle, signal);
  }

  /** 与视频同一目录里的字幕文件。 */
  async listSubtitles(target: FileTarget): Promise<SubtitleTrack[]> {
    const { tracks } = await this.client.request('media.subtitles', target);
    return tracks;
  }

  async deleteConversation(conversationId: Id): Promise<void> {
    await this.client.request('conversations.delete', { conversationId });
  }

  /** 取消一个 Job（转录、配音、生成）。已经结束的如实返回它的终态，不报错。 */
  async cancelJob(jobId: Id): Promise<void> {
    await this.client.request('jobs.cancel', { jobId });
  }

  /** 处理重启后结果不明、中断或没有写进视频的任务（架构设计 §7.5）。只由用户决定，智能体不能调。 */
  async reconcileJob(jobId: Id, decision: JobReconcileDecision): Promise<void> {
    await this.client.request('jobs.reconcile', { jobId, decision });
  }

  /** 产物的受限地址（架构设计 §4.5）：有期限，只指向这一个产物。 */
  async openArtifact(artifactId: string): Promise<MediaHandle> {
    return this.client.request('artifacts.openHandle', { artifactId });
  }

  /**
   * 项目文件浏览（架构设计 §11.2）：会话所属项目目录（无项目时是会话工作目录）里的一层，或给了 `query` 时按名字查找。
   * 文件内容走 `resolveMedia({ conversationId, path })`。
   */
  async listProjectFiles(params: {
    conversationId: Id;
    dir?: string;
    query?: string;
    limit?: number;
  }): Promise<import('@baocut/protocol').ProjectFilesList> {
    return this.client.request('projects.files.list', params);
  }

  /**
   * 在项目目录（无项目时是会话工作目录）里独占新建一个文本文件，重名自动加序号（新标签页起始页的「新建网页」）。
   * 返回新文件的定位（交给文件页签）与条目。
   */
  async createProjectFile(
    params: ({ conversationId: Id } | { projectId: Id }) & { name: string; content: string; dir?: string },
  ): Promise<import('@baocut/protocol').RpcResult<'projects.files.create'>> {
    return this.client.request('projects.files.create', params);
  }

  // ---- 模型页（架构设计 §6）：新视图都经 `models` 主题送达 `useModels`，这里不另写 ----

  /** 设置或清除（`providerId: null`）一种能力的默认模型。 */
  async setModelDefault(
    capability: import('@baocut/protocol').ModelServiceCapability,
    providerId: string | null,
    modelId?: string,
  ): Promise<import('@baocut/protocol').ModelRef | null> {
    const { default: ref } = await this.client.request('models.setDefault', { capability, providerId, ...(modelId ? { modelId } : {}) });
    return ref;
  }

  /** 设置文本生成的参数默认值（推理强度、并发上限）：给出的字段替换，null 恢复出厂值，不给不变。返回补全后的值。 */
  async setCapabilityParameters(
    request: import('@baocut/protocol').SetCapabilityParametersRequest,
  ): Promise<import('@baocut/protocol').TextCapabilityParameters> {
    const { parameters } = await this.client.request('models.setCapabilityParameters', request);
    return parameters;
  }

  /** 配置一个在线 Provider（连接、换密钥、声明模型）。`verify` 不过时 Runtime 以 `conflict` 拒绝，不保存。 */
  async configureModelProvider(
    request: import('@baocut/protocol').ConfigureProviderRequest,
  ): Promise<import('@baocut/protocol').ProviderView> {
    const { provider } = await this.client.request('models.configure', request);
    return provider;
  }

  /** 删除一个自建服务商与它的密钥。 */
  async removeModelProvider(providerId: string): Promise<void> {
    await this.client.request('models.removeProvider', { providerId });
  }

  /** 向一家在线服务商取模型与音色列表（`models.refreshProvider`）。取不到时 `ok: false`，结果也记在它的配置里。 */
  async refreshModelProvider(providerId: string): Promise<import('@baocut/protocol').ProviderRefreshStatus> {
    const { refreshed } = await this.client.request('models.refreshProvider', { providerId });
    return refreshed;
  }

  /** 本机的模型包与状态。 */
  async listModelBundles(): Promise<import('@baocut/protocol').ModelBundleStatus[]> {
    const { bundles } = await this.client.request('models.list', {});
    return bundles;
  }

  /** 重新启用一个停用或加载失败的模型包。 */
  async enableModelBundle(bundleId: string): Promise<import('@baocut/protocol').ModelBundleStatus> {
    const { bundle } = await this.client.request('models.enable', { bundleId });
    return bundle;
  }

  /** 合成一段语音，返回任务 ID；进度与结果经 `jobs` 主题送达。 */
  async synthesizeSpeech(request: Omit<import('@baocut/protocol').SynthesizeSpeechRequest, 'commandId'>): Promise<Id> {
    const { jobId } = await this.client.request('models.synthesizeSpeech', { ...request, commandId: newId('cmd') });
    return jobId;
  }

  /** 生成图片，返回任务 ID；进度与结果经 `jobs` 主题送达。 */
  async generateImage(request: Omit<import('@baocut/protocol').GenerateImageRequest, 'commandId'>): Promise<Id> {
    const { jobId } = await this.client.request('models.generateImage', { ...request, commandId: newId('cmd') });
    return jobId;
  }

  /** 调用一次文本模型，返回任务 ID；全文是结果里的产物，进度与结果经 `jobs` 主题送达。 */
  async generateText(request: Omit<import('@baocut/protocol').GenerateTextRequest, 'commandId'>): Promise<Id> {
    const { jobId } = await this.client.request('models.generateText', { ...request, commandId: newId('cmd') });
    return jobId;
  }

  /**
   * 启动一个固定流程（`pipelines.start`），返回父任务 ID；各步的进度与结果经 `jobs` 主题送达。参数在 Runtime 校验并冻结，
   * 不合法、输入不存在或执行工具不可用时直接拒绝（不建任务）。
   */
  async startPipeline(pipeline: string, params: Record<string, unknown>): Promise<Id> {
    const { jobId } = await this.client.request('pipelines.start', { pipeline, params, commandId: newId('cmd') });
    return jobId;
  }

  /** 检测一个外部工具（`externalTools.detect`，只在本机跑 `--version`、不联网）；登记表里没有时 null。 */
  async detectExternalTool(name: string): Promise<import('@baocut/protocol').ExternalToolStatus | null> {
    const { tools } = await this.client.request('externalTools.detect', { name });
    return tools.find((t) => t.name === name) ?? null;
  }

  /**
   * 本机哪些浏览器有 Cookie 库（`externalTools.cookieBrowsers`，只看文件在不在、什么时候改过，不读 Cookie），最近用过的在前；
   * `platform` 是 Runtime 所在主机的平台，系统授权的提示看它。
   */
  async cookieBrowsers(): Promise<{ platform: string; browsers: import('@baocut/protocol').CookieBrowserInfo[] }> {
    return this.client.request('externalTools.cookieBrowsers', {});
  }

  // ---- 远端算力（节点协议规范 §10）：共享这台 Mac 与使用其他电脑。没有订阅主题，服务页按需轮询 status。 ----

  async shareStatus(): Promise<import('@baocut/protocol').ShareStatus> {
    return this.client.request('nodes.share.status', {});
  }

  /** 开启共享并监听；端口被占用时照常返回，`listening` 为 false、`error` 说明原因。每次开启都生成新的配对码。 */
  async startShare(params: import('@baocut/protocol').ShareStartParams = {}): Promise<import('@baocut/protocol').ShareStatus> {
    return this.client.request('nodes.share.start', params);
  }

  async stopShare(): Promise<import('@baocut/protocol').ShareStatus> {
    return this.client.request('nodes.share.stop', {});
  }

  /** 作废旧配对码并生成新的，同时解除配对锁定；共享没开时 `conflict`。 */
  async renewPairingCode(): Promise<import('@baocut/protocol').ShareStatus> {
    return this.client.request('nodes.share.pairingCode', {});
  }

  async revokeShareClient(clientId: string): Promise<import('@baocut/protocol').ShareStatus> {
    return this.client.request('nodes.share.revoke', { clientId });
  }

  async setShareCapability(capability: string, enabled: boolean): Promise<import('@baocut/protocol').ShareStatus> {
    return this.client.request('nodes.share.setCapability', { capability, enabled });
  }

  /**
   * 旧版项目的导入询问（架构设计 §2.7）：只有桌面界面订阅，Web 服务不开放这个主题。断线重连后客户端重新订阅、重取快照，
   * Runtime 换了（重启）时询问的标识跟着换。
   */
  watchLegacyImport(onPrompt: (prompt: import('@baocut/protocol').LegacyImportPrompt | null) => void): () => void {
    return this.client.subscribeLegacyImport({
      snapshot: (snapshot) => onPrompt(snapshot.prompt),
      event: (event) => onPrompt(event.prompt),
    });
  }

  async answerLegacyImport(answer: import('@baocut/protocol').LegacyImportAnswer): Promise<void> {
    await this.client.request('legacyImport.answer', answer);
  }

  /** 在局域网里找开着共享的节点（不含这台电脑）。 */
  async discoverNodes(timeoutMs?: number): Promise<import('@baocut/protocol').DiscoveredNode[]> {
    const { nodes } = await this.client.request('nodes.discover', timeoutMs === undefined ? {} : { timeoutMs });
    return nodes;
  }

  async pairNode(params: { host: string; port: number; code: string; alias?: string }): Promise<import('@baocut/protocol').PairedNode> {
    const { node } = await this.client.request('nodes.pair', params);
    return node;
  }

  /** 已配对的节点，每个带一次实时探测（2 秒超时）。 */
  async listNodes(): Promise<import('@baocut/protocol').PairedNode[]> {
    const { nodes } = await this.client.request('nodes.list', {});
    return nodes;
  }

  async removeNode(nodeId: string): Promise<void> {
    await this.client.request('nodes.remove', { nodeId });
  }

  // ---- 转录（字幕面板「生成字幕」） ----

  /**
   * 转录一个素材，返回任务 ID；进度与结果经 `jobs` 主题送达，完成后 Runtime 把 `speech` 文档写进视频。
   * 没有配置转录时以 `CAPABILITY_NOT_CONFIGURED`（`conflict`）拒绝，details 带 `remedy`。
   */
  async transcribe(request: Omit<import('@baocut/protocol').TranscribeRequest, 'commandId'>): Promise<Id> {
    const { jobId } = await this.client.request('models.transcribe', { ...request, commandId: newId('cmd') });
    return jobId;
  }

  /** 读一份文档某个版本的正文（不给版本时读当前版本）。不进预览用的文档缓存。 */
  async readDocument(videoId: Id, documentId: Id, revision?: string): Promise<import('@baocut/protocol').DocumentContent> {
    return this.client.request('documents.read', revision === undefined ? { videoId, documentId } : { videoId, documentId, revision });
  }

  // ---- 翻译（字幕面板「翻译成…」） ----

  /**
   * 启动翻译流程，返回父任务 ID；进度与结果经 `jobs` 主题送达，完成后 Runtime 把 `translation` 文档写进视频。
   * 文本模型没有配置时以 `CAPABILITY_NOT_CONFIGURED` 拒绝，details 带 `remedy`。
   */
  async startTranslate(params: import('@baocut/protocol').TranslateParams): Promise<Id> {
    const { jobId } = await this.client.request('pipelines.start', {
      pipeline: 'translate',
      params: params as unknown as Record<string, unknown>,
      commandId: newId('cmd'),
    });
    return jobId;
  }

  /** 从失败、取消或中断的那一步重跑一个流程，任务 ID 不变；已经完成的步骤不重做。 */
  async retryPipeline(jobId: Id): Promise<void> {
    await this.client.request('pipelines.retry', { jobId });
  }

  /** 视频里启用的库条目（`library-selection` 文档）：哪一步用哪几张术语表、哪个说话人用哪个音色。 */
  async getVideoSelection(videoId: Id): Promise<import('@baocut/protocol').VideoLibrarySelection> {
    return this.client.request('library.getVideoSelection', { videoId });
  }

  /** 改视频里启用的条目：一笔普通的编辑事务（能撤销）；给了的字段整体替换，没给的照旧。 */
  async setVideoSelection(
    params: Omit<import('@baocut/protocol').LibrarySetSelectionParams, 'commandId'>,
  ): Promise<import('@baocut/protocol').LibrarySetSelectionResult> {
    return this.client.request('library.setVideoSelection', { ...params, commandId: newId('cmd') });
  }

  // ---- Space（产品设计 §4、架构设计 §5.5、§5.7、§5.11） ----

  /** 跨视频的内容检索：查派生的内容索引，不打开视频。索引没追平的视频列在 `pendingVideos` 里。 */
  async searchSpace(params: import('@baocut/protocol').SpaceSearchParams): Promise<import('@baocut/protocol').SpaceSearchResult> {
    return this.client.request('space.search', params);
  }

  /** 把一个文件登记为项目的素材，不放进任何视频；项目之外的文件先复制进项目的 `imports/`（`copied`）。 */
  async importToSpace(projectId: Id, path: string, name?: string): Promise<{ entry: SpaceEntry; copied: boolean }> {
    return this.client.request('space.import', { projectId, path, ...(name ? { name } : {}) });
  }

  /** 显示名；`null` 恢复文件名。 */
  async renameSpaceEntry(entryId: Id, name: string | null): Promise<SpaceEntry> {
    const { entry } = await this.client.request('space.rename', { entryId, name });
    return entry;
  }

  /** 物理删除回收站里的条目（失败的占位直接清除）；仍被引用时不删，返回阻止删除的引用。 */
  async purgeSpaceEntry(entryId: Id): Promise<import('@baocut/protocol').SpacePurgeResult> {
    return this.client.request('space.purge', { entryId });
  }

  /**
   * 条目的缩略图（网格卡片与列表名称列）：图片（base64）、文字摘要或 `none`。读不了、解不了的都是 `none`，不报错；
   * 条目不在了是 `not-found`。按需取（卡片可见时），不要一次取全部。
   */
  async spaceThumbnail(entryId: Id): Promise<import('@baocut/protocol').SpaceThumbnail> {
    return this.client.request('space.thumbnail', { entryId });
  }

  /** 从条目回到可以编辑的视频：只回答去哪里，不打开视频。 */
  async openSpaceEntryForEdit(entryId: Id): Promise<import('@baocut/protocol').SpaceOpenForEditResult> {
    return this.client.request('space.openForEdit', { entryId });
  }

  /** 从条目继续一段会话：只建会话、附上条目的引用，不启动任务（下一条消息带上引用）。 */
  async continueSpaceEntry(entryId: Id, conversationId?: Id): Promise<import('@baocut/protocol').SpaceContinueResult> {
    return this.client.request('space.continueInConversation', {
      entryId,
      ...(conversationId ? { conversationId } : {}),
      commandId: newId('cmd'),
    });
  }

  /** 丢掉派生的目录与内容索引，从权威来源重建；收藏、显示名、回收站不受影响。 */
  async rebuildSpaceIndex(): Promise<import('@baocut/protocol').SpaceRebuildResult> {
    return this.client.request('space.rebuildIndex', {});
  }

  /** 去掉会话里还没随消息发出的 Space 引用（Runtime 只支持一起去掉）。 */
  async clearPendingReferences(conversationId: Id): Promise<Conversation> {
    const { conversation } = await this.client.request('conversations.update', { conversationId, pendingReferences: null });
    return conversation;
  }

  /**
   * 以一个文件为素材新建视频（原型 page-space.jsx「从文件新建视频」、架构设计 §5.7「以它为素材新建视频」）：
   * 新建空视频，再用一笔事务导入这个文件并放上主序列（与编辑器从电脑里拖入文件同一套操作）。返回打开它用的定位。
   * 新建失败照常抛出；视频建好了但导入被拒时不抛，`importError` 带上原因（视频是空的，由调用方如实告诉用户）。
   */
  async createVideoFromFile(
    scope: { projectId?: Id; conversationId?: Id },
    path: string,
    kind: 'video' | 'image' | 'audio' | null,
    name?: string,
  ): Promise<{ target: FileTarget; importError: string | null }> {
    const { ref, snapshot } = await this.client.request('videos.create', { ...scope, ...(name ? { name } : {}), commandId: newId('cmd') });
    const video = snapshot.video;
    const sequence = video.sequences[video.rootSequenceId];
    if (!sequence) return { target: targetOf(ref), importError: RT.noRootSequence };
    try {
      await this.client.request('edits.apply', {
        videoId: ref.videoId,
        commandId: newId('cmd'),
        expectedRevision: video.revision,
        operations: importAndPlace(sequence, [{ path, kind }], 0),
        label: RT.edit.importAssets,
      });
      return { target: targetOf(ref), importError: null };
    } catch (error) {
      return { target: targetOf(ref), importError: (error as Error).message };
    }
  }

  /**
   * 把便携包打开成一个新视频（`videos.importPackage`，架构设计 §5.8）：建在给的项目或会话工作目录里并打开，返回打开它用的目标。
   * 版本更高、摘要不符、路径越界时 Runtime 拒绝，不留下视频目录。
   */
  async importPackage(scope: { projectId: Id } | { conversationId: Id }, path: string): Promise<FileTarget> {
    const { ref } = await this.client.request('videos.importPackage', { ...scope, path, commandId: newId('cmd') });
    return targetOf(ref);
  }

  // ---- 对外服务（架构设计 §4.8、§3.12；服务页） ----

  /**
   * 订阅 `services` 主题（快照与事件交给调用方，界面把它灌进 services-store）。客户端每个主题只留一个订阅，
   * 所以只由常驻的 rail 调一次；重连后客户端自己续订。返回退订函数。
   */
  watchServices(handlers: {
    snapshot: (snapshot: import('@baocut/protocol').ServicesSnapshot) => void;
    event: (event: import('@baocut/protocol').ServicesEvent) => void;
  }): () => void {
    return this.client.subscribeServices(handlers);
  }

  async listServices(): Promise<import('@baocut/protocol').ServiceStatus[]> {
    const { services } = await this.client.request('services.list', {});
    return services;
  }

  /** 开启一项服务。端口被占用时照常返回，状态是 `error`、`error` 字段说明原因；这个版本没有的服务以 `SERVICE_NOT_AVAILABLE` 拒绝。 */
  async startService(serviceId: import('@baocut/protocol').ServiceId): Promise<import('@baocut/protocol').ServiceStatus> {
    const { service } = await this.client.request('services.start', { serviceId });
    return service;
  }

  async stopService(serviceId: import('@baocut/protocol').ServiceId): Promise<import('@baocut/protocol').ServiceStatus> {
    const { service } = await this.client.request('services.stop', { serviceId });
    return service;
  }

  /** 改配置并落盘，立即生效；改了端口且服务开着时 Runtime 按新端口重开。节点服务以 `invalid-request` 拒绝（它用 `nodes.share.*`）。 */
  async configureService(params: import('@baocut/protocol').ServiceConfigureParams): Promise<import('@baocut/protocol').ServiceStatus> {
    const { service } = await this.client.request('services.configure', params);
    return service;
  }

  /**
   * 处理一条待处理的审批（统一入口，服务审批与会话审批都行）。带外发授权（`grants`）的审批允许时可以给 `grant`。
   * 已经处理过、超时或取消的返回 `already-resolved`。
   */
  async respondToPendingApproval(
    approvalId: Id,
    decision: import('@baocut/protocol').PendingApprovalDecision,
    grant?: import('@baocut/protocol').ApprovalGrantChoice,
  ): Promise<'allowed' | 'denied' | 'already-resolved'> {
    const { status } = await this.client.request('approvals.respond', grant ? { approvalId, decision, grant } : { approvalId, decision });
    return status;
  }

  /** 发放一个 MCP 客户端令牌：明文只在这里返回一次，调用方只能放在组件局部状态里给用户看一次。 */
  async createMcpClient(name: string): Promise<{ client: import('@baocut/protocol').ServiceClient; token: string }> {
    return this.client.request('services.mcp.createClient', { name });
  }

  async listMcpClients(): Promise<import('@baocut/protocol').ServiceClient[]> {
    const { clients } = await this.client.request('services.mcp.listClients', {});
    return clients;
  }

  async revokeMcpClient(clientId: string): Promise<import('@baocut/protocol').ServiceClient[]> {
    const { clients } = await this.client.request('services.mcp.revokeClient', { clientId });
    return clients;
  }

  /** 连接信息（令牌用占位符）。给 `clientId` 时片段里写上客户端名。 */
  async mcpConnectionInfo(clientId?: string): Promise<import('@baocut/protocol').McpConnectionInfo> {
    return this.client.request('services.mcp.connectionInfo', clientId === undefined ? {} : { clientId });
  }

  /** 发放一个模型接口客户端令牌：规则同 MCP，两个服务的令牌互不通用。 */
  async createModelApiClient(name: string): Promise<{ client: import('@baocut/protocol').ServiceClient; token: string }> {
    return this.client.request('services.modelApi.createClient', { name });
  }

  async listModelApiClients(): Promise<import('@baocut/protocol').ServiceClient[]> {
    const { clients } = await this.client.request('services.modelApi.listClients', {});
    return clients;
  }

  async revokeModelApiClient(clientId: string): Promise<import('@baocut/protocol').ServiceClient[]> {
    const { clients } = await this.client.request('services.modelApi.revokeClient', { clientId });
    return clients;
  }

  async modelApiConnectionInfo(clientId?: string): Promise<import('@baocut/protocol').ModelApiConnectionInfo> {
    return this.client.request('services.modelApi.connectionInfo', clientId === undefined ? {} : { clientId });
  }

  /** 设一条别名（同名替换）；`modelId` 不给时用该 Provider 的默认模型。返回整张别名表。 */
  async setModelApiAlias(params: {
    alias: string;
    capability: import('@baocut/protocol').OnlineCapability;
    providerId: string;
    modelId?: string;
  }): Promise<import('@baocut/protocol').ModelApiAlias[]> {
    const { aliases } = await this.client.request('services.modelApi.setAlias', params);
    return aliases;
  }

  async removeModelApiAlias(alias: string): Promise<import('@baocut/protocol').ModelApiAlias[]> {
    const { aliases } = await this.client.request('services.modelApi.removeAlias', { alias });
    return aliases;
  }

  /** 浏览器访问链接（一次性代码在 fragment 里，2 分钟内有效）。Web 服务没开时以 `conflict`（`SERVICE_NOT_RUNNING`）拒绝。 */
  async createWebAccessLink(): Promise<import('@baocut/protocol').WebAccessLink> {
    return this.client.request('services.web.createAccessLink', {});
  }

  async listWebSessions(): Promise<import('@baocut/protocol').WebSession[]> {
    const { sessions } = await this.client.request('services.web.listSessions', {});
    return sessions;
  }

  async revokeWebSession(sessionId: string): Promise<import('@baocut/protocol').WebSession[]> {
    const { sessions } = await this.client.request('services.web.revokeSession', { sessionId });
    return sessions;
  }

  // ---- 导出（架构设计 §9.11、§9.13）：一次导出是一个 Job，进度经 jobs 主题进 jobs-store，取消用 cancelJob。 ----

  /**
   * 提交一次导出；预检不过时抛 RPC 错误（`details.code` 是拒绝码），不建任务。每次一个新的 commandId：
   * 被拒后按补救改了设置重提（跳过画不出来的内容、跳过缺失的素材、换位置）是另一次提交。
   */
  async createExport(request: Omit<ExportCreateRequest, 'commandId'>): Promise<Id> {
    const { jobId } = await this.client.request('exports.create', { ...request, commandId: newId('cmd') });
    return jobId;
  }

  /** 字幕或文稿的正文，不写文件（导出面板文稿页的预览与「复制文本」）：与同样设置导出的文件逐字节相同；预检不过时抛同样的拒绝。 */
  async renderTextExport(
    request: import('@baocut/protocol').ExportRenderTextRequest,
  ): Promise<import('@baocut/protocol').ExportRenderTextResult> {
    return this.client.request('exports.renderText', request);
  }

  async getExport(jobId: Id): Promise<JobRecord> {
    return this.client.request('exports.get', { jobId });
  }

  async listExports(videoId?: Id): Promise<JobRecord[]> {
    const { jobs } = await this.client.request('exports.list', videoId === undefined ? {} : { videoId });
    return jobs;
  }

  // ---- 本地模型包的安装管理（架构设计 §6.3）：状态与进度经 `models` 主题的 `bundle.updated` 送达 ----

  /** 安装：不给 `confirmBytes` 时只返回计划；交回计划里的 `confirmBytes` 才提交安装任务。 */
  async installModelBundle(bundleId: string, confirmBytes?: number): Promise<import('@baocut/protocol').ModelInstallResult> {
    return this.client.request(
      'models.install',
      confirmBytes === undefined ? { bundleId } : { bundleId, confirmBytes, commandId: newId('cmd') },
    );
  }

  /** 修复：逐个文件校验，只重下缺的与坏的。两步确认同安装。 */
  async repairModelBundle(bundleId: string, confirmBytes?: number): Promise<import('@baocut/protocol').ModelInstallResult> {
    return this.client.request(
      'models.repair',
      confirmBytes === undefined ? { bundleId } : { bundleId, confirmBytes, commandId: newId('cmd') },
    );
  }

  /** 停下安装：默认保留已经收到的部分（下次续传），`discard` 时一并删掉。 */
  async cancelModelInstall(bundleId: string, discard = false): Promise<import('@baocut/protocol').ModelBundleStatus> {
    const { bundle } = await this.client.request('models.cancelInstall', discard ? { bundleId, discard: true } : { bundleId });
    return bundle;
  }

  /** 删除模型包：别的模型包还在用的共享组件保留；有任务在用时 `MODEL_IN_USE`。 */
  async removeModelBundle(bundleId: string): Promise<import('@baocut/protocol').ModelRemoveResult> {
    return this.client.request('models.remove', { bundleId });
  }

  /** 检查：固定样本走一遍完整流程，返回任务 ID；结论记在模型包的 `selfTest` 上。 */
  async testModelBundle(bundleId: string): Promise<Id> {
    const { jobId } = await this.client.request('models.test', { bundleId, commandId: newId('cmd') });
    return jobId;
  }

  // ---- 模型目录（架构设计 §6.3）：目录换了时 `models` 主题对每个模型包发 `bundle.updated` ----

  async getModelsDir(): Promise<import('@baocut/protocol').ModelsDirInfo> {
    return this.client.request('models.getDir', {});
  }

  /** 只读地查看一个文件夹；`null` 是缺省位置。 */
  async inspectModelsDir(path: string | null): Promise<import('@baocut/protocol').ModelsDirInspection> {
    return this.client.request('models.inspectDir', { path });
  }

  /** 更改模型目录：`move` 有要搬的东西时返回移动任务的 `jobId`。 */
  async setModelsDir(
    path: string | null,
    mode: import('@baocut/protocol').ModelsDirMode,
  ): Promise<import('@baocut/protocol').ModelsDirChangeResult> {
    return this.client.request('models.setDir', { path, mode, commandId: newId('cmd') });
  }

  // ---- 用户库（架构设计 §5.9）：条目摘要经 `library` 主题送达，这里是读写 ----

  async getLibraryEntry(ref: import('@baocut/protocol').LibraryEntryRef): Promise<import('@baocut/protocol').LibraryEntry> {
    const { entry } = await this.client.request('library.get', ref);
    return entry;
  }

  /** 新建或修改一个条目；改已有条目时带上 `expectedVersion`，别处先改了时 `LIBRARY_VERSION_CONFLICT`。 */
  async putLibraryEntry(
    params: Omit<import('@baocut/protocol').LibraryPutParams, 'commandId'>,
  ): Promise<{ entry: import('@baocut/protocol').LibraryEntry; created: boolean; changed: boolean }> {
    return this.client.request('library.put', { ...params, commandId: newId('cmd') } as import('@baocut/protocol').LibraryPutParams);
  }

  async removeLibraryEntry(library: import('@baocut/protocol').LibraryName, id: Id): Promise<void> {
    await this.client.request('library.remove', { library, id });
  }

  /** 导入一个交换文件（音色包 `.bcvoice`、术语表……），按内容识别。 */
  async importLibraryFile(path: string): Promise<import('@baocut/protocol').LibraryEntry> {
    const { entry } = await this.client.request('library.import', { path, commandId: newId('cmd') });
    return entry;
  }

  /** 把一个条目写成交换文件；目标已存在时 `conflict`，不覆盖。 */
  async exportLibraryEntry(
    entry: import('@baocut/protocol').LibraryEntryRef,
    path: string,
  ): Promise<import('@baocut/protocol').LibraryExportResult> {
    return this.client.request('library.export', { entry, path });
  }

  /** 条目文件（音色的参考录音）的受限地址。 */
  async openLibraryHandle(ref: import('@baocut/protocol').LibraryEntryRef): Promise<MediaHandle> {
    return this.client.request('library.openHandle', ref);
  }

  /** 在一个 Provider 上克隆库里的音色：会上传参考录音，返回任务 ID。 */
  async createVoiceClone(id: Id, providerId: string): Promise<Id> {
    const { jobId } = await this.client.request('library.createVoiceClone', { id, providerId, commandId: newId('cmd') });
    return jobId;
  }

  /** 删除一个克隆：先删远端；远端删不掉时记录保留、以 Provider 的错误码报告。`localOnly` 只清本机记录。 */
  async removeVoiceClone(id: Id, providerId: string, localOnly = false): Promise<import('@baocut/protocol').VoiceCloneRemoveResult> {
    return this.client.request('library.removeVoiceClone', localOnly ? { id, providerId, localOnly: true } : { id, providerId });
  }

  // ---- 数据外发授权（架构设计 §12.5）：列表走 grants 主题，这里只有撤销 ----

  /** 撤销一条授权：之后的新调用与排队中的调用被拒绝；已经交出与计费的部分如实报告。 */
  async revokeGrant(grantId: Id): Promise<import('@baocut/protocol').GrantRevokeResult> {
    return this.client.request('grants.revoke', { grantId });
  }

  // ---- 首页的固定流程与从链接导入（设计稿 page-new.jsx、import-flow.jsx；启动与重试流程用上面的 startPipeline / retryPipeline / detectExternalTool） ----

  /**
   * 用户点了「同意并安装 / 更新」：记下同意（`via: 'app'`）并提交安装任务（`kind: 'toolInstall'`，进度经 `jobs` 主题）。
   * 只能由用户的这一下触发；清单不全、严格离线时 Runtime 以 `conflict` 拒绝。
   */
  async installExternalTool(name: string): Promise<import('@baocut/protocol').ExternalToolInstallResult> {
    return this.client.request('externalTools.install', { name, consent: true, via: 'app', commandId: newId('cmd') });
  }

  /**
   * 用户点了更新命令旁的执行：按原安装方式更新系统里的那一份（`externalTools.update`，提交 `kind: 'toolUpdate'` 任务，
   * 输出经 `jobs` 主题）。交回的是界面上显示的那条命令，就是用户的确认；办法已经变了时 Runtime 以 `conflict`
   * （`TOOL_UPDATE_CONFIRM_REQUIRED`，`details.update` 是此刻的办法）拒绝，不执行。
   */
  async updateExternalTool(name: string, command: string): Promise<import('@baocut/protocol').ExternalToolUpdateResult> {
    return this.client.request('externalTools.update', { name, command, commandId: newId('cmd') });
  }

  /** 记下（或撤回）用户对一个外部工具的同意：只由用户在界面上点了才调。 */
  async consentExternalTool(name: string, grant: boolean): Promise<import('@baocut/protocol').ExternalToolStatus> {
    const { tool } = await this.client.request('externalTools.consent', { name, grant, via: 'app' });
    return tool;
  }

  /** 指定（`null` 清除）用户自己装的那一份；Runtime 先跑一次 `--version` 核对，不能运行时 `invalid-request`。 */
  async setExternalToolPath(name: string, path: string | null): Promise<import('@baocut/protocol').ExternalToolStatus> {
    const { tool } = await this.client.request('externalTools.setPath', { name, path });
    return tool;
  }

  /**
   * 固定流程建视频：（按画幅）新建视频，再用一笔事务（可选地）设背景、导入素材放上主序列；要声波时再用一笔事务在整部片子上
   * 加一层声波（时长取上一笔回执里的新时长）。新建失败照常抛出；视频建好之后的失败不抛，如实带回（视频照常可用）。
   * 返回打开它用的定位与导入的素材 ID（转录要用）。
   */
  async createFlowVideo(
    scope: { projectId?: Id; conversationId?: Id },
    options: {
      name?: string;
      /** 画幅；不给时用 Runtime 的默认画布。 */
      width?: number;
      height?: number;
      /** 要导入的素材；`name`、`provenance` 是导入方已知的素材名与来源（链接导入下载的文件）。 */
      file?: { path: string; kind: 'video' | 'audio'; name?: string; provenance?: { origin: string; source?: unknown } };
      /** 画布底色 `#RRGGBB`。 */
      background?: string;
      /** 整部片子的声波（元素面板的那一层）。 */
      wave?: VisualLayer;
    },
  ): Promise<{ target: FileTarget; videoId: Id; assetId: Id | null; importError: string | null; waveError: string | null }> {
    const { ref, snapshot } = await this.client.request('videos.create', {
      ...scope,
      ...(options.name ? { name: options.name } : {}),
      ...(options.width && options.height ? { width: options.width, height: options.height } : {}),
      commandId: newId('cmd'),
    });
    const target = targetOf(ref);
    const videoId = ref.videoId;
    const video = snapshot.video;
    const sequence = video.sequences[video.rootSequenceId];
    if (!sequence) return { target, videoId, assetId: null, importError: RT.noRootSequence, waveError: null };
    const operations: import('@baocut/protocol').EditOperation[] = [
      ...(options.background
        ? [{ type: 'updateSequence' as const, sequenceId: sequence.id, background: options.background.toUpperCase() }]
        : []),
      ...(options.file ? importAndPlace(sequence, [options.file], 0) : []),
    ];
    if (!operations.length) return { target, videoId, assetId: null, importError: null, waveError: null };
    let receipt: import('@baocut/protocol').TransactionReceipt;
    try {
      ({ receipt } = await this.client.request('edits.apply', {
        videoId: ref.videoId,
        commandId: newId('cmd'),
        expectedRevision: video.revision,
        operations,
        label: options.file ? RT.edit.importAssets : RT.edit.setBackground,
      }));
    } catch (error) {
      return { target, videoId, assetId: null, importError: (error as Error).message, waveError: null };
    }
    const assetId = receipt.refs?.drop0 ?? null;
    if (!options.wave) return { target, videoId, assetId, importError: null, waveError: null };
    const span = { fromFrame: 0, durationFrames: receipt.impact.newDurationFrames };
    if (span.durationFrames <= 0) return { target, videoId, assetId, importError: null, waveError: RT.noDuration };
    try {
      await this.client.request('edits.apply', {
        videoId: ref.videoId,
        commandId: newId('cmd'),
        expectedRevision: receipt.videoRevision,
        operations: insertVisual(sequence, span, [options.wave], RT.waveformName),
        label: RT.edit.addWaveform,
      });
      return { target, videoId, assetId, importError: null, waveError: null };
    } catch (error) {
      return { target, videoId, assetId, importError: null, waveError: (error as Error).message };
    }
  }

  /**
   * 发放一条数据外发授权（`grants.create`，用户在界面上明确确认之后才调）：数据种类、接收方、范围、用途与预算方式照传。
   * 翻译配音第一次被 `GRANT_REQUIRED` 拒绝时由用户确认发放，之后重新提交。
   */
  async createGrant(params: import('@baocut/protocol').GrantCreateParams): Promise<import('@baocut/protocol').Grant> {
    const { grant } = await this.client.request('grants.create', params);
    return grant;
  }

  // ---- 翻译配音（工具页 › 翻译配音） ----

  /**
   * 启动翻译配音流程（`pipelines.start` 的 `dub`），返回父任务 ID；进度与结果经 `jobs` 主题送达，完成时 Runtime 在一笔事务里
   * 新增一组配音。没有授权覆盖外发时以 `GRANT_REQUIRED`（`forbidden`）拒绝，details 带 `remedy`。
   */
  async startDub(params: import('@baocut/protocol').DubParams): Promise<Id> {
    const { jobId } = await this.client.request('pipelines.start', {
      pipeline: 'dub',
      params: params as unknown as Record<string, unknown>,
      commandId: newId('cmd'),
    });
    return jobId;
  }

  // ---- 工具目录（工具页的视频工具，架构设计 §7.9） ----

  /** `tools.list`：工具注册表加上此刻能不能用（不能用的原因、受限的输入），与保存位置（Web 服务不给）。 */
  async listTools(): Promise<import('@baocut/protocol').ToolsListResult> {
    return this.client.request('tools.list', {});
  }

  /** `pipelines.list`：Runtime 注册了哪些固定流程（目录列了工具、执行它的流程还没有时按不了）。 */
  async listPipelines(): Promise<import('@baocut/protocol').PipelineInfo[]> {
    const { pipelines } = await this.client.request('pipelines.list', {});
    return pipelines;
  }

  /** `tools.candidates`：某个视频工具能选的视频与文稿（读 Space 目录与内容索引，不打开视频）。 */
  async toolCandidates(params: import('@baocut/protocol').ToolCandidatesParams): Promise<import('@baocut/protocol').ToolCandidatesResult> {
    return this.client.request('tools.candidates', params);
  }

  /**
   * 用调用方给的 `commandId` 启动固定流程：工具页被当场授权拒绝（`pendingGrants`）、用户确认并发放授权之后，
   * 用同一个 `commandId` 重新提交（Runtime 按它去重，被拒绝的那次不占用它）。
   */
  async startPipelineWithCommand(pipeline: string, params: Record<string, unknown>, commandId: string): Promise<Id> {
    const { jobId } = await this.client.request('pipelines.start', { pipeline, params, commandId });
    return jobId;
  }

  /** `jobs.inspect`：一条任务的完整记录（含固定流程的步骤与摘要）。 */
  async inspectJob(jobId: Id): Promise<JobRecord> {
    return this.client.request('jobs.inspect', { jobId });
  }
}
