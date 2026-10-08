import { RcWeb } from '@baocut/protocol/messages/runtime-core';
import path from 'node:path';
import {
  RpcError,
  SETTING_MANAGED_BY,
  parseVideoTopic,
  type FileTarget,
  type Id,
  type RpcMethod,
  type RpcParams,
  type RpcResult,
  type RuntimeInfo,
  type Seq,
  type SequencedEvent,
  type Topic,
  webVideoHref,
} from '@baocut/protocol';
import type { Harness, TopicSubscription } from '@baocut/harness';
import type { AgentSetup } from './agent-setup.ts';
import type { AttachmentStore } from './attachments.ts';
import type { TrustedPrincipal } from './gateway.ts';
import { findSubtitles, type MediaRegistry } from './media.ts';
import { listProjectFiles } from './project-files.ts';
import { createProjectFile, type ProjectFileScope } from './project-file-create.ts';
import type { MediaAnalysis } from './media-analysis.ts';
import type { SpaceCatalog } from './space-catalog.ts';
import { resolvePipelineEntryInputs, withSpeechMaterial, withTextMaterial } from './space/space-inputs.ts';
import { spaceMethods, updateEntry } from './space/space-methods.ts';
import type { SpaceThumbnails } from './space/space-thumbnails.ts';
import type { VideoService } from './videos/video-service.ts';
import type { VideoTrash } from './videos/video-trash.ts';
import type { ModelJobs } from './models/model-jobs.ts';
import { applySpeakerProposal } from './models/speakers-apply.ts';
import type { ExportService } from './exports/export-service.ts';
import type { RuntimeSettings } from './settings-topic.ts';
import type { RuntimeServices } from './services/open-services.ts';
import type { LibraryService } from './library/library-service.ts';
import type { NodeInitiator, NodeService } from '@baocut/nodes';
import type { ExternalToolService } from './external-tools/external-tool-service.ts';
import { externalToolMethods } from './external-tools/external-tool-methods.ts';
import { toolCatalogueMethods } from './tool-catalogue/tool-methods.ts';
import { resolveSaveDirectory } from './external-tools/downloads-directory.ts';
import type { TemplateCatalog } from './templates/template-catalog.ts';
import { templateMethods } from './templates/template-methods.ts';
import { skillMethods } from './skills/skill-methods.ts';
import type { SkillCatalog } from './skills/skill-catalog.ts';
import type { SkillInstaller } from './skills/skill-installer.ts';
import type { FontService } from './fonts/font-service.ts';
import { fontMethods } from './fonts/font-methods.ts';
import type { CompositionService } from './compositions/composition-service.ts';
import { compositionMethods } from './compositions/composition-methods.ts';
import { PackageImporter } from './videos/package-import.ts';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';
import type { ToolCatalog } from './agent-tools/tool-catalog.ts';
import type { RuntimeActivity } from './runtime-activity.ts';
import { catalogMethods } from './agent-tools/catalog-methods.ts';

type MethodHandler<M extends RpcMethod> = (params: RpcParams<M>, principal: TrustedPrincipal) => RpcResult<M> | Promise<RpcResult<M>>;

export interface RpcHandlers {
  methods: { [M in Exclude<RpcMethod, 'subscribe' | 'unsubscribe'>]: MethodHandler<M> };
  subscribe(
    topic: Topic,
    afterSeq: Seq | undefined,
    listener: (event: SequencedEvent<unknown>) => void,
  ): TopicSubscription<unknown, unknown>;
}

/**
 * 方法表到 Harness 的映射。界面、CLI 与外部智能体走的是同一组处理函数（架构设计 §4.1）。
 * `principal` 0.1 只用于日志；权限检查随外部智能体接入出现。
 */
export interface HandlerDeps {
  harness: Harness;
  /** Agent 的安装、升级与登录动作（架构设计 §12.9）。 */
  setup: AgentSetup;
  space: SpaceCatalog;
  media: MediaRegistry;
  attachments: AttachmentStore;
  analysis: MediaAnalysis;
  /** Space 条目的缩略图（`space.thumbnail`）。 */
  spaceThumbnails: SpaceThumbnails;
  videos: VideoService;
  /** 删除与恢复视频（§5.5、§5.7）。 */
  videoTrash: VideoTrash;
  models: ModelJobs;
  exports: ExportService;
  library: LibraryService;
  nodes: NodeService;
  initiator: NodeInitiator;
  settings: RuntimeSettings;
  services: RuntimeServices;
  runtime: RuntimeInfo;
  /** 受管外部工具（§12.9）。 */
  externalTools: ExternalToolService;
  /** 创作模板目录（模板包规范 §6）。 */
  templates: TemplateCatalog;
  /** Agent 的 skill 目录与安装动作（§3.8、§12.9）。 */
  skills: SkillCatalog;
  skillInstaller: SkillInstaller;
  /** 按需下载的字体（§9.1）。 */
  fonts: FontService;
  /** 代码画面的导入与预览（§8，`compositions.*`）：与工具共用的服务。 */
  compositions: CompositionService;
  /** Agent 面的工具目录对终端的视图（`catalog.*`，§3.5）：与工具桥同一组工具。 */
  catalog: ToolCatalog;
  /** 说明书的根目录（`catalog.agentSkill` 渲染 CLI 面用；与会话指导同一份）。不给时每次调用重新找。 */
  agentSkillsDir?: string | null;
  /** 连接、任务与空闲退出（`runtime.status`，§2.2）。 */
  activity: RuntimeActivity;
  /** `runtime.stop` 的去处（入口停下 Runtime）；嵌入式的 Runtime（测试）没有。 */
  requestStop: (() => void) | null;
}

/** 文件目标定位到来源目录与文件（Space 条目、会话工作目录或项目目录里的路径）。目录内的检查在媒体通道（或视频服务）里做。 */
export function locateFileTarget(
  harness: Harness,
  space: SpaceCatalog,
  target: FileTarget,
): { root: string; file: string; scope: { projectId: Id } | { conversationId: Id } } {
  if ('entryId' in target) return space.locate(target.entryId);
  if ('conversationId' in target) {
    const { conversation } = harness.getConversation(target.conversationId);
    return { root: conversation.cwd, file: target.path, scope: { conversationId: conversation.id } };
  }
  const project = harness.listProjects().find((p) => p.id === target.projectId);
  if (!project) throw new RpcError('not-found', RcRuntime.projectNotFound());
  return { root: project.path, file: target.path, scope: { projectId: project.id } };
}

/**
 * videoId → 界面打开这个视频用的 FileTarget（与界面从 Space 条目打开时相同：所在项目或会话的工作目录 + 相对路径）。
 * 先看已打开的视频，再看 Space 登记的；都没有时 `not-found`（`VIDEO_NOT_FOUND`）。Web 访问链接直达编辑器时用。
 */
export function videoTargetOf(videos: VideoService, space: SpaceCatalog, videoId: Id): FileTarget {
  const fromSource = (source: { projectId: Id | null; conversationId: Id | null }, relPath: string): FileTarget | null =>
    source.projectId
      ? { projectId: source.projectId, path: relPath }
      : source.conversationId
        ? { conversationId: source.conversationId, path: relPath }
        : null;
  const ref = videos.ref(videoId);
  const open = ref && fromSource(ref.source, ref.relPath);
  if (open) return open;
  const known = space.videos().find((video) => video.videoId === videoId);
  if (known) {
    const entry = space.get(known.entryId);
    const target = fromSource(entry.source, entry.relPath);
    if (target) return target;
  }
  throw new RpcError('not-found', RcWeb.videoTargetNotFound({ videoId }), { code: 'VIDEO_NOT_FOUND', videoId });
}

export function createHandlers({
  harness,
  setup,
  space,
  media,
  attachments,
  analysis,
  spaceThumbnails,
  videos,
  videoTrash,
  models,
  exports,
  library,
  nodes,
  initiator,
  settings,
  services: external,
  runtime,
  externalTools,
  templates,
  skills,
  skillInstaller,
  fonts,
  compositions,
  catalog: toolCatalog,
  agentSkillsDir,
  activity,
  requestStop,
}: HandlerDeps): RpcHandlers {
  const { catalog, jobs, services, pipelines } = models;
  const packages = new PackageImporter(videos);
  /** 节点、模型包变化之后重算能力视图（`models` 主题）。失败只影响视图，不影响调用。 */
  const refreshModels = () => void services.refresh().catch(() => {});
  /** 节点服务的权威是 `NodeService`：`nodes.share.*` 改过之后把投影送到 `services` 主题。 */
  const nodeChanged = <T>(result: Promise<T>): Promise<T> => result.finally(() => external.manager.refresh('node'));
  /** 文件定位到来源目录与文件。目录内的检查在媒体通道（或视频服务）里做。 */
  const locateMedia = (target: FileTarget) => locateFileTarget(harness, space, target);

  /** 新建视频的位置：项目目录，或不属于项目的会话的工作目录。 */
  const videoRoot = (p: { projectId?: Id; conversationId?: Id }): { root: string; scope: { projectId: Id } | { conversationId: Id } } => {
    if (p.projectId) {
      const project = harness.listProjects().find((x) => x.id === p.projectId);
      if (!project) throw new RpcError('not-found', RcRuntime.projectNotFound());
      return { root: project.path, scope: { projectId: project.id } };
    }
    if (p.conversationId) {
      const { conversation } = harness.getConversation(p.conversationId);
      if (conversation.projectId) return videoRoot({ projectId: conversation.projectId });
      return { root: conversation.cwd, scope: { conversationId: conversation.id } };
    }
    throw new RpcError('invalid-request', RcRuntime.newVideoNeedsTarget());
  };

  /** 项目文件浏览的根目录：会话所属项目的目录；不属于项目的会话用它的工作目录。 */
  const filesRoot = (conversationId: Id): string => {
    const { conversation } = harness.getConversation(conversationId);
    const project = conversation.projectId ? harness.listProjects().find((p) => p.id === conversation.projectId) : undefined;
    return project?.path ?? conversation.cwd;
  };
  /** `projects.files.create` 的根目录与定位：属于项目的会话按项目定位，与项目文件页签打开的是同一个标签。 */
  const fileScope = (p: { conversationId: Id } | { projectId: Id }): { root: string; scope: ProjectFileScope } => {
    if ('projectId' in p) {
      const project = harness.listProjects().find((item) => item.id === p.projectId);
      if (!project) throw new RpcError('not-found', RcRuntime.projectFolderNotFound());
      return { root: project.path, scope: { projectId: project.id } };
    }
    const { conversation } = harness.getConversation(p.conversationId);
    const project = conversation.projectId ? harness.listProjects().find((item) => item.id === conversation.projectId) : undefined;
    return project
      ? { root: project.path, scope: { projectId: project.id } }
      : { root: conversation.cwd, scope: { conversationId: conversation.id } };
  };

  return {
    methods: {
      'runtime.info': () => runtime,
      'runtime.status': (_p, principal) => {
        if (principal.kind !== 'cli' && principal.kind !== 'desktop') throw new RpcError('forbidden', RcRuntime.statusLocalOnly());
        return activity.status();
      },
      // 只停 CLI 拉起的、没有别人在用的（§2.2）：桌面端、调用者之外的 CLI 连接、排队或运行中的任务都算在用。
      // 响应先送出去再停：停止顺序里会关掉网关。
      'runtime.stop': (_p, principal) => {
        if (principal.kind !== 'cli') throw new RpcError('forbidden', RcRuntime.stopCliOnly());
        if (runtime.launchedBy !== 'cli') {
          throw new RpcError('forbidden', RcRuntime.stopNotCliLaunched(), { code: 'RUNTIME_NOT_OWNED' });
        }
        const { connections, activeJobs } = activity.status();
        // 调用者自己是一个 CLI 连接，不算。
        const others = { desktop: connections.desktop, cli: Math.max(0, connections.cli - 1), activeJobs };
        if (others.desktop > 0 || others.cli > 0 || others.activeJobs > 0) {
          throw new RpcError('conflict', RcRuntime.runtimeInUse(others), { code: 'RUNTIME_IN_USE', ...others });
        }
        if (!requestStop) throw new RpcError('unsupported', RcRuntime.stopNotSupported());
        setTimeout(requestStop, 50);
        return { stopping: true as const };
      },
      'agents.list': () => harness.agents(),
      // 「重新检测」：强制探测（给了 driverId 只探那一个），探完再返回（§3.11）。
      'agents.detect': (p) => harness.agents({ fresh: true, ...(p.driverId ? { driverId: p.driverId } : {}) }),
      'agents.configure': (p) => harness.configureAgent(p),
      // 默认 Agent 存在偏好设置里（`agent.defaultDriver`，§3.11）：和设置页、CLI 的 settings set 是同一个值。
      // 设置变化时 Runtime 让 Harness 推送 `agents.updated`（见 runtime.ts）。
      'agents.setDefault': async (p) => {
        // 只认注册了的 Driver：写进设置之后，没注册的默认值会让每次建会话都失败。
        harness.assertDriverRegistered(p.driverId);
        await settings.store.set({ 'agent.defaultDriver': p.driverId });
        return harness.agents();
      },
      // 用户添加的 ACP 智能体（§3.11）：不在 Web 服务的白名单里（决定这台机器运行什么命令）。
      'agents.addProvider': (p) => harness.addProvider(p),
      'agents.removeProvider': (p) => harness.removeProvider(p.id),
      'agents.updatePreferences': (p) => harness.updateAgentPreferences(p),
      'agents.removeRule': (p) => harness.removeRule(p.rule),
      'agents.respondToApproval': (p) => harness.respondToApproval(p),
      'agents.interrupt': (p) => harness.interrupt(p.conversationId),
      'agents.runSetup': (p) => setup.run(p),
      'agents.cancelSetup': (p) => setup.cancel(p.runId),
      'agents.openTerminal': (p) => setup.openTerminal(p),
      'projects.list': () => ({ projects: harness.listProjects() }),
      'projects.open': async (p) => {
        const project = await harness.openProject(p.path);
        // 副本里的视频在后台换标识（架构设计 §5.1）；打开视频时引擎还会再认领一次，这一步失败不影响打开项目。
        void videos.claimProjectVideos(project).catch(() => {});
        return { project };
      },
      'projects.create': async (p) => ({ project: await harness.createProject(p) }),
      'projects.update': async (p) => ({ project: await harness.updateProject(p) }),
      'projects.files.list': (p) => listProjectFiles(filesRoot(p.conversationId), p),
      'projects.files.create': (p) => {
        const { root, scope } = fileScope(p);
        return createProjectFile(root, scope, p);
      },
      'conversations.list': () => harness.directorySnapshot(),
      'conversations.create': async (p) => ({ conversation: await harness.createConversation(p) }),
      'conversations.get': (p) => harness.getConversation(p.conversationId),
      'conversations.update': async (p) => ({ conversation: await harness.updateConversation(p) }),
      'conversations.markRead': (p) => ({ conversation: harness.markRead(p.conversationId) }),
      'conversations.delete': async (p) => {
        await harness.deleteConversation(p.conversationId);
        return { deleted: true as const };
      },
      // 带模板或 skill 的发送在 `templateMethods` 里：先解析模板与 skill，再交给 Harness。
      'conversations.steer': (p) => harness.steer(p),
      'attachments.prepare': (p) => attachments.prepare(p),
      'tasks.stop': (p) => harness.stopTask(p.taskId),
      // 任务合同（架构设计 §3.2）：经 RPC 的一方都是用户（界面、CLI、Web）；智能体经工具读写自己的合同。
      'tasks.create': async (p) => {
        const { taskId } = await harness.send({ ...p, text: p.goal });
        return { taskId, contract: harness.getContract(taskId).contract };
      },
      'tasks.getContract': (p) => harness.getContract(p.taskId, p.revision),
      'tasks.listContracts': (p) => harness.listContracts(p),
      'tasks.updateContract': (p) => harness.updateContract(p, 'user'),
      'tasks.changeGoal': (p) => harness.changeGoal(p),
      'tasks.recordCheck': (p) => harness.recordCheck(p, 'user'),
      'tasks.listChecks': (p) => harness.listChecks(p.taskId),
      // 统一的待处理审批（架构设计 §3.12）：会话的与对外服务的在一处列出、一处处理。
      'approvals.list': () => ({ approvals: harness.approvals.pending() }),
      // 带外发授权的审批可以同时选择「只这一次」或发放持续授权（§12.5）。
      'approvals.respond': (p) => harness.approvals.respond(p.approvalId, p.decision, p.grant ? { grant: p.grant } : {}),
      // 数据外发的授权与预算（§12.5、§7.8）：只开给本机连接，浏览器不开放。
      'grants.list': (p) => models.grants.list(p),
      'grants.create': (p) => models.grants.create(p),
      'grants.update': (p) => models.grants.update(p),
      'grants.revoke': (p) => models.grants.revoke(p.grantId),
      'grants.usage': (p) => models.grants.usage(p.grantId),
      'space.update': async (p, principal) => ({ entry: await updateEntry(space, videoTrash, p, principal) }),
      'space.rescan': async () => {
        await space.rescan();
        return { ok: true as const };
      },
      ...spaceMethods(space, { harness, trash: videoTrash, thumbnails: spaceThumbnails }),
      'media.resolve': async (p) => {
        if ('videoId' in p) {
          const asset = await videos.assetFile(p.videoId, p.assetId, p.revision);
          return { ...(await media.issue(asset.root, asset.file)), fileName: asset.name };
        }
        if ('attachmentId' in p) {
          // 只认这条会话自己的消息里出现过的附件：别的会话的、没发出去的，一律当作不存在。
          const { items } = harness.getConversation(p.conversationId);
          const ref = items
            .flatMap((item) => (item.kind === 'user-message' ? (item.attachments ?? []) : []))
            .find((a) => a.id === p.attachmentId);
          if (!ref) throw new RpcError('not-found', RcRuntime.attachmentNotFound());
          const { root, file } = attachments.fileOf(ref);
          return { ...(await media.issue(root, file)), fileName: ref.fileName };
        }
        const { root, file } = 'entryId' in p ? space.locateBytes(p.entryId) : locateMedia(p);
        return media.issue(root, file);
      },
      'media.playback': (p) => media.playback(p.url, (file) => analysis.playback(file)),
      // 字体（§9.1）：本机、下载缓存与按需下载。
      ...fontMethods(
        () => fonts,
        media,
        () => exports,
      ),
      'media.subtitles': async (p) => {
        const { root, file, scope } = locateMedia(p);
        const found = await findSubtitles(root, file);
        return { tracks: found.map(({ relPath, ...track }) => ({ ...track, target: { ...scope, path: relPath } })) };
      },
      'media.peaks': async (p) => analysis.peaks(await videos.mediaSource(p.videoId, p.assetId, p.revision)),
      'media.thumbnail': async (p) => analysis.thumbnail(await videos.mediaSource(p.videoId, p.assetId, p.revision), p.at),
      'videos.create': (p, principal) => {
        const { root, scope } = videoRoot(p);
        return videos.create(p, root, scope, principal);
      },
      // 便携包（视频格式规范 §8）：建成来源目录里的一个新视频。不给智能体与对外服务（它们没有这个方法的入口）。
      'videos.importPackage': (p, principal) => {
        const { root, scope } = videoRoot(p);
        return packages.import(p, root, scope, principal);
      },
      'videos.open': (p, principal) => videos.open(locateMedia(p), principal),
      'videos.close': (p, principal) => videos.close(p.videoId, principal),
      'videos.delete': (p, principal) => videoTrash.delete(p, principal),
      'videos.restore': (p) => videoTrash.restore(p.entryId),
      'videos.history': (p) => videos.history(p.videoId, p.limit),
      'videos.assetStatus': (p) => videos.assetStatus(p.videoId),
      'documents.read': (p) => videos.document(p.videoId, p.documentId, p.revision),
      'edits.apply': (p, principal) => videos.apply(p, principal),
      'edits.undo': (p, principal) => videos.undo(p, principal),
      'edits.undoState': (p, principal) => videos.undoState(p.videoId, principal),
      'edits.applySpeakers': (p, principal) => applySpeakerProposal({ videos, jobs }, p, principal),
      // 代码画面（§8）：界面不经过智能体预览与导入，与工具 compositions_preview / compositions_import 同一个服务。
      ...compositionMethods({ compositions, videos, harness, media }),
      'models.list': async () => ({ bundles: await catalog.list() }),
      // 没有显式给术语表时用视频里启用的转写术语表（§5.9）；对外服务的客户端不碰用户库。
      'models.transcribe': async (p, principal) => {
        const enabled =
          p.glossaries || principal.kind === 'service' ? null : (await library.enabledGlossaries(p.videoId, 'transcribe')).ids;
        const params = enabled?.length ? { ...p, glossaries: enabled.map((id) => ({ id })) } : p;
        return jobs.submitTranscribe(params, { kind: 'connection', id: principal.connectionId });
      },
      // Space 条目作为素材（§7.9）：在这里换成文字，任务只看到文本。
      'models.synthesizeSpeech': async (p, principal) =>
        jobs.submitSynthesizeSpeech(await withSpeechMaterial(space, p), { kind: 'connection', id: principal.connectionId }),
      'models.generateImage': (p, principal) => jobs.submitGenerateImage(p, { kind: 'connection', id: principal.connectionId }),
      'models.generateText': async (p, principal) =>
        jobs.submitGenerateText(await withTextMaterial(space, p), { kind: 'connection', id: principal.connectionId }),
      'models.refreshProvider': (p) => services.refreshProvider(p.providerId),
      'models.setCapabilityParameters': async (p) => ({ parameters: await services.setCapabilityParameters(p) }),
      'models.enable': async (p) => {
        jobs.enable(p.bundleId);
        refreshModels();
        return { bundle: (await catalog.status(p.bundleId))! };
      },
      // 本地模型包的安装管理（§6.3）：安装与自检是不属于任何智能体任务的普通 Job。
      'models.install': (p, principal) => models.installs.install(p, { kind: 'connection', id: principal.connectionId }),
      'models.repair': (p, principal) => models.installs.install(p, { kind: 'connection', id: principal.connectionId }, { repair: true }),
      'models.cancelInstall': (p) => models.installs.cancelInstall(p),
      'models.remove': (p) => models.installs.remove(p.bundleId),
      'models.test': (p, principal) => models.installs.test(p, { kind: 'connection', id: principal.connectionId }),
      // 模型目录（§6.3）：含本机路径，只给桌面界面与 CLI（不在 Web 白名单里，MCP 也不提供）。
      'models.getDir': () => models.dir.getDir(),
      'models.inspectDir': (p) => models.dir.inspect(p.path),
      'models.setDir': (p, principal) => models.dir.setDir(p, { kind: 'connection', id: principal.connectionId }),
      'models.capabilities': async () => ({ capabilities: await services.capabilities() }),
      'models.configure': async (p) => ({ provider: await services.configure(p) }),
      'models.removeProvider': async (p) => {
        await services.removeProvider(p.providerId);
        return { removed: true };
      },
      // 服务商的账号（§6.8）：都返回这个 Provider 的视图；变化经 `capabilities.updated` 送达。
      'models.addAccount': async (p) => ({ provider: await services.addAccount(p) }),
      'models.updateAccount': async (p) => ({ provider: await services.updateAccount(p) }),
      'models.removeAccount': async (p) => ({ provider: await services.removeAccount(p.providerId, p.accountId) }),
      'models.arrangeAccounts': async (p) => ({ provider: await services.arrangeAccounts(p) }),
      // 用量（§6.10）：只读。
      'models.usage': (p) => services.usage(p),
      'models.setDefault': async (p) => ({ default: await services.setDefault(p.capability, p.providerId, p.modelId) }),
      // 固定流程的步骤默认折叠在父任务下（架构设计 §7.9）。
      'jobs.list': (p) => ({ jobs: jobs.list(p.videoId).filter((r) => p.children === true || !r.parentJobId) }),
      'jobs.inspect': (p) => jobs.inspect(p.jobId),
      // 资源调度的现状（架构设计 §7.6、§7.7）：只读。
      'jobs.resources': () => jobs.resources.snapshot(),
      'jobs.cancel': (p) => jobs.cancel(p.jobId),
      // 对账（架构设计 §7.5）：retry 是新的一次调用，照常经授权与预算准入；智能体与 MCP 服务没有这个入口。
      'jobs.reconcile': (p) => jobs.reconcile(p.jobId, p.decision),
      // 导出：冻结与预检同步完成，失败时不建任务；进度、取消与结果走 jobs.*（架构设计 §9.11）。
      'exports.create': (p, principal) => exports.create(p, { kind: 'connection', id: principal.connectionId }),
      'exports.get': (p) => exports.get(p.jobId),
      'exports.list': (p) => ({ jobs: exports.list(p.videoId) }),
      // 只读：与 exports.create 同一套冻结与写法排出正文，不写文件、不建任务。
      'exports.renderText': (p) => exports.renderText(p),
      'pipelines.list': () => ({ pipelines: pipelines.list() }),
      // Space 条目作为输入（§7.9）：文件条目在提交时换成路径，冻结的参数里只有路径。
      'pipelines.start': (p, principal) =>
        pipelines.start(
          { ...p, params: resolvePipelineEntryInputs(space, p.pipeline, p.params) },
          { kind: 'connection', id: principal.connectionId },
        ),
      'pipelines.retry': (p) => pipelines.retry(p.jobId),
      ...externalToolMethods(() => externalTools),
      ...templateMethods({ templates, media, harness, skills }),
      ...skillMethods({ skills, installer: skillInstaller }),
      ...catalogMethods(toolCatalog, agentSkillsDir === undefined ? {} : { agentSkillsDir: () => agentSkillsDir }),
      ...toolCatalogueMethods({
        space,
        services,
        externalTools: () => externalTools,
        offlineStrict: () => settings.store.get('offline.strict'),
        saveDirectory: () => resolveSaveDirectory({ settings: settings.store.get('downloads.directory') }),
      }),
      // 产物（转写的原始结果、生成的音频与图片）的短期读取句柄：只读产物库里的文件。
      'artifacts.openHandle': async (p) => {
        const file = await jobs.artifacts.locate(p.artifactId);
        if (!file) throw new RpcError('not-found', RcRuntime.outputNotFound());
        return media.issue(jobs.artifacts.dir, path.basename(file));
      },
      // 用户库（架构设计 §5.9）：只经 Runtime 读写。
      'library.list': (p) => library.list(p),
      'library.get': (p) => library.get(p),
      'library.put': (p) => library.put(p),
      'library.remove': (p) => library.remove(p),
      'library.import': (p) => library.import(p),
      'library.export': (p) => library.export(p),
      'library.applyToVideo': (p, principal) => library.applyToVideo(p, principal),
      'library.getVideoSelection': (p) => library.getVideoSelection(p),
      'library.setVideoSelection': (p, principal) => library.setVideoSelection(p, principal),
      'library.openHandle': (p) => library.openHandle(p),
      // 音色克隆（§5.9）：创建是普通任务，删除先请求远端。
      'library.createVoiceClone': (p, principal) => library.voiceClones.create(p, { kind: 'connection', id: principal.connectionId }),
      'library.removeVoiceClone': (p) => library.voiceClones.remove(p),
      'nodes.share.start': (p) => nodeChanged(nodes.start(p)),
      'nodes.share.stop': () => nodeChanged(nodes.stop()),
      'nodes.share.status': () => nodes.status(),
      'nodes.share.pairingCode': () => nodes.pairingCode(),
      'nodes.share.revoke': (p) => nodes.revoke(p.clientId),
      'nodes.share.setCapability': (p) => nodes.setCapability(p.capability, p.enabled),
      // 发现结果里去掉这台机器自己的节点。
      'nodes.discover': async (p) => ({ nodes: await initiator.discover(p.timeoutMs, nodes.status().nodeId) }),
      'nodes.pair': async (p) => {
        const node = await initiator.pair(p);
        refreshModels();
        return { node };
      },
      'nodes.list': async () => ({ nodes: await initiator.list() }),
      'settings.get': (p) => settings.store.view(p.keys),
      'settings.set': async (p) => {
        // 有专门方法的键（模型目录）不经这里改：要先查在用、卸 Worker、选移动还是只换位置（§6.3）。
        for (const [key, method] of Object.entries(SETTING_MANAGED_BY)) {
          if (p.values && key in p.values) {
            throw new RpcError('invalid-request', RcRuntime.settingManaged({ key, method }), { code: 'SETTING_MANAGED', key, method });
          }
        }
        return (await settings.store.set(p.values)).snapshot;
      },
      'services.list': () => ({ services: external.manager.list() }),
      'services.start': async (p) => ({ service: await external.manager.start(p.serviceId) }),
      'services.stop': async (p) => ({ service: await external.manager.stop(p.serviceId) }),
      'services.configure': async (p) => ({ service: await external.manager.configure(p) }),
      'services.respondToApproval': (p) => external.manager.approvals.respond(p.approvalId, p.decision),
      'services.mcp.createClient': (p) => external.mcp.createClient(p.name),
      'services.mcp.listClients': () => ({ clients: external.mcp.listClients() }),
      'services.mcp.revokeClient': async (p) => ({ clients: await external.mcp.revokeClient(p.clientId) }),
      'services.mcp.connectionInfo': (p) => external.mcp.connectionInfo(p.clientId),
      'services.modelApi.createClient': (p) => external.modelApi.createClient(p.name),
      'services.modelApi.listClients': () => ({ clients: external.modelApi.listClients() }),
      'services.modelApi.revokeClient': async (p) => ({ clients: await external.modelApi.revokeClient(p.clientId) }),
      'services.modelApi.connectionInfo': (p) => external.modelApi.connectionInfo(p.clientId),
      'services.modelApi.setAlias': async (p) => ({
        aliases: await external.modelApi.setAlias({
          alias: p.alias,
          capability: p.capability,
          providerId: p.providerId,
          modelId: p.modelId ?? null,
        }),
      }),
      'services.modelApi.removeAlias': async (p) => ({ aliases: await external.modelApi.removeAlias(p.alias) }),
      'services.web.createAccessLink': (p) =>
        external.web.createAccessLink(p.video === undefined ? undefined : webVideoHref(videoTargetOf(videos, space, p.video))),
      'services.web.listSessions': () => ({ sessions: external.web.listSessions() }),
      'services.web.revokeSession': (p) => ({ sessions: external.web.revokeSession(p.sessionId) }),
      'nodes.remove': async (p) => {
        await initiator.remove(p.nodeId);
        refreshModels();
        return {};
      },
    },
    subscribe: (topic, afterSeq, listener) => {
      if (topic === 'space') return space.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      if (topic === 'jobs') return models.topic.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      if (topic === 'models') return models.modelsTopic.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      if (topic === 'settings') return settings.topic.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      if (topic === 'services') return external.manager.topic.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      if (topic === 'library') return library.topic.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      if (topic === 'grants') return models.grants.topic.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      if (topic === 'agent-setup') return setup.subscribe(afterSeq, listener) as TopicSubscription<unknown, unknown>;
      const videoId = parseVideoTopic(topic);
      if (videoId) return videos.subscribe(videoId, afterSeq, listener);
      return harness.subscribe(topic, afterSeq, listener);
    },
  };
}
