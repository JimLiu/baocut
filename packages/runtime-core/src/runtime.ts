import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ClaudeDriver,
  CodexDriver,
  OpenCodeDriver,
  PiDriver,
  acpDrivers,
  createCustomAcpDriver,
  resolveLoginShellPath,
} from '@baocut/agent-drivers';
import { DriverRegistry, Harness, engineProtections, type AgentDriver, type Logger } from '@baocut/harness';
import {
  BUILTIN_DRIVER_IDS,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
  RpcError,
  customAgentProviderView,
  newId,
  nowIso,
  type CustomAgentProvider,
  type Id,
  type RuntimeDiscovery,
  type RuntimeInfo,
  type RuntimeLauncher,
} from '@baocut/protocol';
import type { CapacitySource, JobManager } from '@baocut/jobs';
import {
  AgentPrefsStore,
  AgentProbeStore,
  AgentProviderStore,
  SkillPrefsStore,
  ConversationStore,
  ProjectStore,
  SpaceArtifactStore,
  SpaceMarkStore,
  acquireInstanceLock,
  readDiscovery,
  releaseInstanceLock,
  removeDiscovery,
  resolveRuntimeHome,
  writeDiscovery,
  type RuntimeHome,
} from '@baocut/runtime-storage';
import { AgentSetup, type AgentSetupOptions } from './agent-setup.ts';
import { AgentGrants } from './agent-tools/grants.ts';
import { loadAgentGuidance } from './agent-tools/guidance.ts';
import { TaskTools } from './agent-tools/task-tools.ts';
import { openCredentialStore, type CredentialStoreOptions } from './credentials.ts';
import { McpEndpoint } from './agent-tools/mcp-endpoint.ts';
import { AgentScope } from './agent-tools/agent-scope.ts';
import { LocalScope } from './agent-tools/local-scope.ts';
import { ScopeRouter } from './agent-tools/tool-scope.ts';
import { ModelTools } from './agent-tools/model-tools.ts';
import { GrantTools } from './agent-tools/grant-tools.ts';
import { ToolCatalog, type ToolSet } from './agent-tools/tool-catalog.ts';
import type { ToolScope } from './agent-tools/tool-scope.ts';
import { VideoTools } from './agent-tools/video-tools.ts';
import { Gateway, originAllowed } from './gateway.ts';
import { createHandlers } from './handlers.ts';
import { createFileLogger } from './logger.ts';
import { StorageGc } from './storage-gc.ts';
import { AttachmentStore } from './attachments.ts';
import { MediaRegistry } from './media.ts';
import { MediaAnalysis } from './media-analysis.ts';
import { LibraryService } from './library/library-service.ts';
import { VoiceCloneService } from './library/voice-clone-service.ts';
import { openModelJobs, type ModelJobs, type ModelJobsOptions } from './models/model-jobs.ts';
import { ModelInstallTools } from './agent-tools/model-install-tools.ts';
import { ExportService } from './exports/export-service.ts';
import { FontService } from './fonts/font-service.ts';
import type { FontCatalogue } from './fonts/font-catalogue.ts';
import type { FontDownloadOptions } from './fonts/font-download.ts';
import { sweepLeftovers } from './exports/leftover-files.ts';
import { resolveExportWorkerCommand } from './exports/video-export.ts';
import { ExportTools } from './agent-tools/export-tools.ts';
import { SpaceTools } from './agent-tools/space-tools.ts';
import { VideoDeleteTools } from './agent-tools/video-delete-tools.ts';
import { VideoTrash } from './videos/video-trash.ts';
import { locateFileTarget } from './handlers.ts';
import { resolveModelWorkerCommand, type ModelWorkerCommand } from './models/model-worker.ts';
import { resolveEngineHostCommand } from './videos/engine-host.ts';
import { VideoService } from './videos/video-service.ts';
import { PackageImporter } from './videos/package-import.ts';
import { openNodeInitiator, type NodeInitiatorRuntimeOptions } from './nodes/node-initiator.ts';
import { openNodeShare, type NodeShareOptions } from './nodes/node-share.ts';
import { NodeProviderSource, type NodeInitiator, type NodeService } from '@baocut/nodes';
import type { AgentSourceOptions, OnlineSourceOptions } from '@baocut/providers';
import { SpaceCatalog } from './space-catalog.ts';
import { ContentIndex } from './space/content-index.ts';
import { SpaceThumbnails } from './space/space-thumbnails.ts';
import { openSettings, type RuntimeSettings } from './settings-topic.ts';
import { openServices, type RuntimeServices, type ServicesOptions } from './services/open-services.ts';
import { FileLinkSources, isTerminal, resolveSpeechWorkerCommand, type HostLookup } from '@baocut/jobs';
import { LegacyUpgrade } from './legacy-upgrade.ts';
import { RuntimeActivity, type IdleExitOptions } from './runtime-activity.ts';
import { ExternalToolService, type ExternalToolServiceOptions } from './external-tools/external-tool-service.ts';
import { linkImportDefinition, pruneLinkSources } from './external-tools/link-import-wiring.ts';
import { resolveDownloadsDirectory, resolveSaveDirectory } from './external-tools/downloads-directory.ts';
import { entryPlace } from './videos/pipeline-targets.ts';
import { FlowTools } from './agent-tools/flow-tools.ts';
import { LinkImportTools } from './agent-tools/link-import-tools.ts';
import { DownloadTools } from './agent-tools/download-tools.ts';
import { TemplateCatalog, resolveBuiltinTemplatesDir } from './templates/template-catalog.ts';
import { SkillCatalog, resolveBuiltinSkillsDir } from './skills/skill-catalog.ts';
import { SkillInstaller } from './skills/skill-installer.ts';
import { skillIndexBlock } from './skills/skill-brief.ts';
import { resolveBuiltinAgentSkillsDir } from './skills/agent-skill-renderer.ts';
import { SkillTools } from './agent-tools/skill-tools.ts';
import { JobTools } from './agent-tools/job-tools.ts';
import { ProjectTools } from './agent-tools/project-tools.ts';
import { LibraryTools } from './agent-tools/library-tools.ts';
import { CompositionTools } from './agent-tools/composition-tools.ts';
import { CompositionService, SharedCompositionHost } from './compositions/composition-service.ts';
import { findOnPath } from './external-tools/tool-probe.ts';
import { resolveElectronBinary } from '@baocut/code-runtime';
import type { GithubFetchOptions } from './skills/skill-github.ts';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';

export interface StartRuntimeOptions {
  home?: RuntimeHome;
  host?: string;
  port?: number;
  allowedOrigins?: readonly string[];
  /** 同时把日志打到 stderr。 */
  echoLogs?: boolean;
  /** 测试用：替换内置的 Driver。 */
  drivers?: (log: Logger) => AgentDriver[];
  /** 测试用：替换用户添加的 ACP 智能体（`agents.addProvider`）的 Driver 工厂。默认 `createCustomAcpDriver`。 */
  customDriver?: (provider: CustomAgentProvider, log: Logger) => AgentDriver;
  /** 监视来源目录的变化（默认开）。测试里关掉，改用 `space.rescan()`。 */
  watchSpace?: boolean;
  /** 视频引擎可执行文件。默认取 `BAOCUT_ENGINE_HOST` 或仓库里构建出的 `engine-host`。 */
  engineHost?: string | null;
  /** 连接断开后多久关闭它打开的视频（默认 15 秒）。 */
  videoGraceMs?: number;
  /** Model Worker 的命令。默认取 `BAOCUT_MODEL_WORKER` 或仓库里构建出的 `model-worker`；null 表示本地推理不可用。 */
  modelWorker?: ModelWorkerCommand | null;
  /** 模型空闲多久后卸载（默认 10 分钟）。 */
  jobIdleMs?: number;
  /** 资源调度用的机器容量（测试注入假的容量）；不给时按本机探测，偏好设置 `resources.capacity` 可以覆盖。 */
  capacity?: CapacitySource;
  /** 局域网能力共享的节点端（架构设计 §6.7）。测试用回环地址、假的 mDNS 与短期限。 */
  nodes?: NodeShareOptions;
  /** 局域网能力共享的发起端：发现与远端任务的期限。测试用假的发现与短期限。 */
  initiator?: NodeInitiatorRuntimeOptions;
  /** 在线 Provider 的调节项。测试把内置 Provider 的基址指向本机的假服务、缩短退避；不会读取任何环境里的密钥。 */
  online?: Omit<OnlineSourceOptions, 'store' | 'ffmpeg'>;
  /** 智能体 Provider（§6.9）的调节项。测试缩短探测缓存与一次生成的期限。 */
  agentProviders?: Omit<AgentSourceOptions, 'store' | 'drivers'>;
  /**
   * 凭据存储（§6.8）：由构建类型决定，不是用户设置。开发版本 `file`（默认），正式版本 `keychain`；测试可以直接给一个实例，
   * 或给钥匙串后端一个假的助手（`credentialHelper`）。
   */
  credentials?: CredentialStoreOptions['kind'];
  /** 钥匙串后端的助手命令。默认取 `BAOCUT_CREDENTIAL_HELPER`、打包的资源目录或仓库里构建出的 `credential-helper`。 */
  credentialHelper?: CredentialStoreOptions['helper'];
  /** 对外服务（§4.8）的调节项。测试缩短服务审批的时限。 */
  services?: ServicesOptions;
  /** 模型安装（§6.3）的调节项。测试把下载来源指向本机的假服务，注入可用空间、内置清单与自检样本；不访问真实网络。 */
  modelInstall?: ModelJobsOptions['modelInstall'];
  /** 测试用：卡住或打断模型目录的移动、假装跨盘。 */
  modelsDirTesting?: ModelJobsOptions['modelsDirTesting'];
  /**
   * 受管外部工具（§12.9）与从链接导入（§7.9）的调节项。测试给一个只含假工具的搜索路径（不会碰到系统里真实的 yt-dlp）、
   * 不含真实环境变量的覆盖、带已知摘要的假清单与本机的下载来源，以及不访问真实 DNS 的主机名解析。
   */
  externalTools?: Pick<ExternalToolServiceOptions, 'env' | 'overrides' | 'manifests' | 'platform' | 'download'> & { lookup?: HostLookup };
  /** 任务的故障注入（测试用，架构设计 §7.3）：在应用闭环的几个时刻模拟崩溃。 */
  jobFaults?: ModelJobsOptions['faults'];
  /** Agent 的安装动作（§12.9）。测试换掉打开系统终端的方式与运行命令的环境。 */
  agentSetup?: Pick<AgentSetupOptions, 'env' | 'openTerminal' | 'flushMs'>;
  /**
   * 内置创作模板的目录（模板包规范 §6）。默认取 `BAOCUT_TEMPLATES_DIR`、打包的资源目录或仓库根的 `templates/`；null 表示没有内置模板。
   * 用户模板总在 `<home>/templates`。
   */
  templatesDir?: string | null;
  /**
   * 内置 Agent skill 的目录（架构设计 §3.8）。默认取 `BAOCUT_SKILLS_DIR`、打包的资源目录或仓库根的 `skills/`；null 表示没有。
   * 用户添加与导入的 skill 总在 `<home>/skills`。
   */
  skillsDir?: string | null;
  /**
   * 说明书的根目录（里面是 `baocut/`，Agent 面设计 §8.6）：会话内智能体的指导与说明书页由它按工具桥面渲染，`baocut skill install`
   * 按 CLI 面渲染。默认取 `BAOCUT_AGENT_SKILLS_DIR`、打包的资源目录或仓库根的 `agent-skills/`；找不到或渲染不了时 Runtime 启动失败。
   */
  agentSkillsDir?: string | null;
  /** 从 GitHub 导入 skill（§12.9）。测试注入假的 fetch，不访问真实网络。 */
  skillsGithub?: GithubFetchOptions;
  /** 按需下载的字体（§9.1）。测试注入只含几个族的字体目录，并把下载指向本机的假服务；不访问真实网络。 */
  fonts?: { catalogue?: FontCatalogue; download?: FontDownloadOptions };
  /** 谁拉起了这个 Runtime（§2.2）：写进 `RuntimeInfo` 与发现文件，`baocut runtime stop` 据此只停 CLI 拉起的。 */
  launchedBy?: RuntimeLauncher | null;
  /**
   * 空闲退出（§2.2，CLI 拉起的 Runtime）：没有连接、没有任务、没有开着的对外服务满设置 `runtime.idleExitMinutes` 时调用
   * `onIdle`（入口在那里停下 Runtime）。不给时不检查。
   */
  idleExit?: Omit<IdleExitOptions, 'minutes'> | null;
  /** `runtime.stop` 的去处（§2.2）：入口在那里停下 Runtime。不给时 `runtime.stop` 以 `unsupported` 拒绝。 */
  requestStop?: (() => void) | null;
}

export interface RunningRuntime {
  info: RuntimeInfo;
  discovery: RuntimeDiscovery;
  harness: Harness;
  space: SpaceCatalog;
  videos: VideoService;
  models: ModelJobs;
  exports: ExportService;
  /** 用户库（架构设计 §5.9）。 */
  library: LibraryService;
  nodes: NodeService;
  /** 发起端：已配对的节点与远端节点 Provider。 */
  initiator: NodeInitiator;
  /** 偏好设置（架构设计 §5.10）。 */
  settings: RuntimeSettings;
  /** 对外服务（架构设计 §4.8）。 */
  services: RuntimeServices;
  /** 受管外部工具（架构设计 §12.9）。 */
  externalTools: ExternalToolService;
  /** 按需下载的字体（架构设计 §9.1）。 */
  fonts: FontService;
  log: Logger;
  close(): Promise<void>;
}

/** 同一个 Runtime Home 已经有活着的实例。调用方应该连接它，而不是再起一个。 */
export class RuntimeAlreadyRunningError extends Error {
  readonly discovery: RuntimeDiscovery | null;
  readonly pid: number;

  constructor(pid: number, discovery: RuntimeDiscovery | null) {
    super(RcRuntime.alreadyRunning({ pid }).text);
    this.name = 'RuntimeAlreadyRunningError';
    this.pid = pid;
    this.discovery = discovery;
  }
}

/**
 * 停止的顺序。它不是启动顺序的简单反转：对外服务、节点服务与任务最先停（外部请求断开、远端任务不再进队列，在途任务交还视频的租约），网关最后停。
 * 启动时每起好一个服务就把它的停止步骤登记到对应的位置；正常停止（`close()`）与启动中途失败共用这一份顺序，
 * 只跑已经登记的步骤。实例锁与日志在所有步骤之后。
 */
/** 回收站保留期的清理间隔。 */
const TRASH_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const STOP_ORDER = [
  'activity',
  'legacy-upgrade',
  'storage-gc',
  'services',
  'nodes',
  'jobs',
  'grants',
  'usage',
  'initiator',
  'discovery',
  'space',
  'compositions',
  'analysis',
  'videos',
  'setup',
  'harness',
  'attachments',
  'gateway',
] as const;
type StopStep = (typeof STOP_ORDER)[number];

class StopSequence {
  readonly #log: Logger;
  readonly #steps = new Map<StopStep, { stop: () => unknown; failure: string | null }>();

  constructor(log: Logger) {
    this.#log = log;
  }

  /** 登记一步；`failure` 是这一步出错时记的日志，null 表示静默。 */
  add(step: StopStep, stop: () => unknown, failure: string | null): void {
    this.#steps.set(step, { stop, failure });
  }

  /** 按停止顺序跑已登记的步骤，每步只跑一次。一步出错不影响后面的步骤，也不抛出。 */
  async run(): Promise<void> {
    for (const step of STOP_ORDER) {
      const entry = this.#steps.get(step);
      if (!entry) continue;
      this.#steps.delete(step);
      try {
        await entry.stop();
      } catch (error) {
        if (entry.failure) this.#log.error(entry.failure, { error: String(error) });
      }
    }
  }
}

/**
 * 组装并启动 Runtime（架构设计 §2）：实例锁 → 存储 → Harness → Space 目录 → 网关 → 发现文件。
 * 停止顺序见 `STOP_ORDER`；启动中途失败时，已经起来的服务按同样的顺序停掉，再释放实例锁、关日志，抛出原来的错误。
 */
export async function startRuntime(options: StartRuntimeOptions = {}): Promise<RunningRuntime> {
  const home = options.home ?? resolveRuntimeHome();
  for (const dir of [
    home.root,
    home.conversationsDir,
    home.scratchDir,
    home.logsDir,
    home.stagingDir,
    home.artifactsDir,
    home.modelsDir,
    home.libraryDir,
    home.attachmentsDir,
  ]) {
    await fs.mkdir(dir, { recursive: true });
  }

  const instanceId = newId('rt');
  const lock = await acquireInstanceLock(home, instanceId);
  if (!lock.ok) throw new RuntimeAlreadyRunningError(lock.holder.pid, await readDiscovery(home).catch(() => null));

  const log = createFileLogger({ file: path.join(home.logsDir, 'runtime.log'), echo: options.echoLogs });
  const stops = new StopSequence(log);
  // Harness 比任务账本晚打开：重启后补做的应用要等它就绪才知道任务的保护范围；启动失败时不让它们一直等。
  let harnessOpened!: (harness: Harness) => void;
  let harnessFailed!: (error: unknown) => void;
  const harnessReady = new Promise<Harness>((resolve, reject) => {
    harnessOpened = resolve;
    harnessFailed = reject;
  });
  harnessReady.catch(() => {});
  try {
    const legacyUpgrade = new LegacyUpgrade({ home, log });
    stops.add('legacy-upgrade', () => legacyUpgrade.stop(), 'Stopping legacy upgrade failed');
    await legacyUpgrade.prepare().catch(() => log.warn('Legacy upgrade preparation deferred'));
    const drivers = new DriverRegistry();
    // 内置 Driver 按 `BUILTIN_DRIVER_IDS` 的顺序注册（注册顺序就是 `agents.list` 的顺序）。
    const builtin = () =>
      [new ClaudeDriver(log), new CodexDriver(log), new PiDriver(log), new OpenCodeDriver(log), ...acpDrivers(log)].sort(
        (a, b) => (BUILTIN_DRIVER_IDS as readonly string[]).indexOf(a.id) - (BUILTIN_DRIVER_IDS as readonly string[]).indexOf(b.id),
      );
    for (const driver of options.drivers?.(log) ?? builtin()) drivers.register(driver);
    // 用户添加的 ACP 智能体（§3.11）：排在内置的后面，按添加顺序；在 Harness 读探测缓存之前注册，缓存里的条目才认得它们。
    // 运行中的添加与移除由 Harness 经同一个存储与工厂处理。
    const customProviders = new AgentProviderStore(home.agentProvidersFile, { log: log.child('agent-providers') });
    const createCustomDriver = (provider: CustomAgentProvider) => (options.customDriver ?? createCustomAcpDriver)(provider, log);
    for (const provider of await customProviders.load()) {
      if (drivers.has(provider.id)) continue;
      drivers.register(createCustomDriver(provider), { custom: customAgentProviderView(provider) });
    }

    // 引擎要 ffprobe、媒体分析要 ffmpeg：桌面应用从访达启动时 PATH 里没有它们，用登录 shell 的 PATH。
    const toolEnv = async () => ({ ...process.env, PATH: await resolveLoginShellPath() });
    const videos = new VideoService({
      log,
      resolveCommand: () => (options.engineHost !== undefined ? options.engineHost : resolveEngineHostCommand()),
      env: toolEnv,
      graceMs: options.videoGraceMs,
      fontCacheDir: path.join(home.root, 'fonts', 'files'),
    });
    stops.add('videos', () => videos.shutdown(), 'Stopping the video engine failed');
    const media = new MediaRegistry({ log, originAllowed: (origin) => originAllowed(origin, options.allowedOrigins) });
    const analysis = new MediaAnalysis({
      cacheDir: path.join(home.cacheDir, 'media'),
      log,
      ffmpeg: async () => ({ command: process.env.BAOCUT_FFMPEG || 'ffmpeg', env: await toolEnv() }),
    });
    stops.add('analysis', () => analysis.close(), 'Stopping media analysis failed');
    const modelWorker = options.modelWorker !== undefined ? options.modelWorker : resolveModelWorkerCommand();
    // 在线 Provider 的密钥与节点令牌共用一个凭据存储；钥匙串后端在这里迁走明文文件里遗留的密钥。
    const credentials = await openCredentialStore(home, log, {
      ...(options.credentials !== undefined ? { kind: options.credentials } : {}),
      ...(options.credentialHelper !== undefined ? { helper: options.credentialHelper } : {}),
    });
    // 发起端在 JobManager 之前：远端节点 Provider 是 JobManager 的 Provider 之一。
    const initiator = await openNodeInitiator(home, credentials, log, options.initiator);
    stops.add('initiator', () => initiator.close(), 'Stopping the node initiator failed');
    // 生成的音频与图片、参考录音都用 ffprobe 解码校验（与引擎同一个 ffprobe）。
    const ffprobe = async () => ({ command: process.env.BAOCUT_FFPROBE || 'ffprobe', env: await toolEnv() });
    // 用户库在 JobManager 之前：转写的术语表与合成的库音色由任务冻结、固定。产物来源在任务库建好之后才有。
    let artifacts: { locate(artifactId: string): Promise<string | null> } | null = null;
    const library = await LibraryService.open({
      dir: home.libraryDir,
      videos,
      media,
      artifacts: { locate: (artifactId) => artifacts?.locate(artifactId) ?? Promise.resolve(null) },
      ffprobe,
    });
    // 新视频采用用户库里默认启用的条目（§5.9）。
    videos.onCreated((videoId, principal) => library.adoptDefaults(videoId, principal));
    // 偏好设置在模型任务之前读入：模型目录（`models.dir`，§6.3）决定模型目录的根。
    const settings = await openSettings(home, log);
    let settingsStore: RuntimeSettings['store'] | null = settings.store;
    // 从链接导入（§7.9）在 JobManager 建好时登记；外部工具服务与 Harness 在后面才有，流程用到时再取。
    let externalToolsRef: ExternalToolService | null = null;
    let harnessRef: Harness | null = null;
    // 流程的 `{ entryId }` 目标按 Space 目录解析（§7.9）：Space 在后面才建，解析时再取。
    let spaceRef: SpaceCatalog | null = null;
    const linkSources = new FileLinkSources(path.join(home.root, 'store', 'link-sources.json'));
    const toolOverrides = options.externalTools?.overrides ?? process.env;
    const requireHarness = () => {
      if (!harnessRef) throw new Error(RcRuntime.harnessNotReady().text);
      return harnessRef;
    };
    const projectRoot = (projectId: Id) => {
      const project = requireHarness()
        .listProjects()
        .find((p) => p.id === projectId);
      if (!project) throw new RpcError('not-found', RcRuntime.projectNotFound());
      return project.path;
    };
    // 会话的来源（与智能体的 `videos_create` 同样的放置，AgentScope.source）：属于项目时是项目目录与项目范围，否则是工作目录。
    const conversationSource = (conversationId: Id): { root: string; scope: { projectId: Id } | { conversationId: Id } } => {
      const { conversation } = requireHarness().getConversation(conversationId);
      if (conversation.projectId) {
        const project = requireHarness()
          .listProjects()
          .find((p) => p.id === conversation.projectId);
        if (project) return { root: project.path, scope: { projectId: project.id } };
      }
      return { root: conversation.cwd, scope: { conversationId: conversation.id } };
    };
    const conversationRoot = (conversationId: Id) => conversationSource(conversationId).root;
    // 流程按会话新建视频（`create: { conversationId }`）：不属于项目的会话先建项目并绑定（§3.10），视频建在项目里。
    const conversationCreateSource = async (conversationId: Id): Promise<{ root: string; scope: { projectId: Id } }> => {
      const project = await requireHarness().ensureConversationProject(conversationId);
      return { root: project.path, scope: { projectId: project.id } };
    };
    const models = await openModelJobs({
      home,
      credentials,
      videos,
      log,
      worker: () => modelWorker,
      // 字幕与翻译核心的 Speech Worker 与引擎宿主同一次 cargo 构建，放在它旁边。
      speechWorker: () => resolveSpeechWorkerCommand(options.engineHost !== undefined ? options.engineHost : resolveEngineHostCommand()),
      env: toolEnv,
      idleMs: options.jobIdleMs,
      ...(options.capacity ? { capacity: options.capacity } : {}),
      // 偏好设置在后面才读入：准入时再取。
      resourceCapacity: () => settingsStore?.get('resources.capacity') ?? null,
      remote: new NodeProviderSource(initiator),
      // 在线 Provider 用 ffmpeg 准备音频（与媒体分析同一个 ffmpeg）。
      ffmpeg: async () => ({ command: process.env.BAOCUT_FFMPEG || 'ffmpeg', env: await toolEnv() }),
      ffprobe,
      library: library.store,
      enabledGlossaries: (videoId, step) => library.enabledGlossaries(videoId, step),
      ...(options.online ? { online: options.online } : {}),
      // 智能体作为 Provider（§6.9）：与会话共用 Driver 注册表，但每次生成开一个专用的原生会话。
      agents: drivers,
      ...(options.agentProviders ? { agentProviders: options.agentProviders } : {}),
      // 偏好设置在后面才读入：安装时再取下载来源与严格离线。
      installSettings: () => ({
        downloadEndpoint: settingsStore?.get('models.downloadEndpoint') ?? null,
        offlineStrict: settingsStore?.get('offline.strict') ?? false,
      }),
      ...(options.modelInstall ? { modelInstall: options.modelInstall } : {}),
      modelsDirSetting: {
        get: () => settings.store.get('models.dir'),
        set: async (value) => {
          await settings.store.set({ 'models.dir': value });
        },
      },
      ...(options.modelsDirTesting ? { modelsDirTesting: options.modelsDirTesting } : {}),
      // 保存位置（§7.9）：偏好设置在后面才读入，提交时再取。
      saveDirectory: () => resolveSaveDirectory({ settings: settingsStore?.get('downloads.directory') ?? null }),
      pipelineTargets: {
        entry: (entryId) => {
          if (!spaceRef) throw new RpcError('busy', RcRuntime.spaceNotReady());
          return entryPlace(spaceRef, entryId);
        },
        projectRoot,
        conversationSource: conversationCreateSource,
      },
      // 任务下的 Job 与流程应用结果时带上任务合同的保护范围（§3.2）。任务已经不在了（会话删掉了）时没有保护。
      taskProtections: async (taskId, videoId) => {
        const harness = await harnessReady;
        try {
          return engineProtections(harness.getContract(taskId).contract, videoId);
        } catch (error) {
          if (error instanceof RpcError && error.code === 'not-found') return [];
          throw error;
        }
      },
      extraPipelines: (context) => [
        linkImportDefinition(
          {
            tools: () => {
              if (!externalToolsRef) throw new Error(RcRuntime.externalToolsNotReady().text);
              return externalToolsRef;
            },
            settings: () => ({
              downloadsDirectory: settingsStore?.get('downloads.directory') ?? null,
              offlineStrict: settingsStore?.get('offline.strict') ?? false,
            }),
            projectRoot,
            conversationRoot,
            videoSource: (videoId) => videos.ref(videoId)?.source ?? null,
            outputsDir: path.join(home.root, 'outputs'),
            sources: linkSources,
            ffprobe,
            // `BAOCUT_FFMPEG` 是绝对路径时告诉 yt-dlp 用它合并音视频；否则 yt-dlp 自己在 PATH 里找。
            ffmpegLocation: async () => {
              const configured = toolOverrides.BAOCUT_FFMPEG;
              return configured && path.isAbsolute(configured) ? configured : null;
            },
            ...(options.externalTools?.lookup ? { lookup: options.externalTools.lookup } : {}),
          },
          context,
        ),
      ],
      ...(options.jobFaults ? { faults: options.jobFaults } : {}),
    });
    artifacts = models.jobs.artifacts;
    library.attachVoiceClones(
      new VoiceCloneService({
        store: library.store,
        jobs: models.jobs,
        grants: models.grants,
        cloner: (providerId) => models.voiceCloner(providerId),
        log: log.child('voice-clone'),
      }),
    );
    // 授权账本在任务停下（结算完）之后写盘。
    stops.add('grants', () => models.grants.flush(), 'Writing the grant ledger failed');
    // 用量账本与账号的最近使用时间同样在任务停下之后写完（§6.10）。
    stops.add('usage', () => models.flushUsage(), 'Writing the usage ledger failed');
    // 受管外部工具（§12.9）：探测、同意与安装；安装是 JobManager 里的 `toolInstall` 任务。
    const externalTools = new ExternalToolService({
      toolsDir: path.join(home.root, 'tools'),
      storeFile: path.join(home.root, 'store', 'external-tools.json'),
      jobs: models.jobs,
      log: log.child('tools'),
      env: toolEnv,
      settings: () => ({
        downloadEndpoint: settingsStore?.get('tools.downloadEndpoint') ?? null,
        offlineStrict: settingsStore?.get('offline.strict') ?? false,
      }),
      ...options.externalTools,
    });
    externalToolsRef = externalTools;
    // 原始链接只留给还能重试的从链接导入流程。
    await pruneLinkSources(models.jobs, linkSources).catch((error) => log.warn('Pruning link sources failed', { error: String(error) }));
    // 停任务会取消在途任务、关掉 Worker 进程。
    stops.add('jobs', () => models.jobs.shutdown(), 'Stopping background tasks failed');
    // 按需下载的字体（§9.1）：缓存在 Runtime Home 的 `fonts/` 下；下载是 JobManager 里的 `fontDownload` 任务。
    const fonts = new FontService({
      dir: path.join(home.root, 'fonts'),
      jobs: models.jobs,
      videos,
      log: log.child('fonts'),
      settings: () => ({
        autoDownload: settingsStore?.get('fonts.autoDownload') ?? true,
        cssEndpoint: settingsStore?.get('fonts.cssEndpoint') ?? null,
        fileEndpoint: settingsStore?.get('fonts.fileEndpoint') ?? null,
        offlineStrict: settingsStore?.get('offline.strict') ?? false,
      }),
      ...options.fonts,
    });
    // 导出是 JobManager 里的 `export` 任务（架构设计 §9.11）；ffmpeg / ffprobe 同媒体分析。
    const exports = new ExportService({
      jobs: models.jobs,
      videos,
      fonts,
      ffmpeg: async () => ({ command: process.env.BAOCUT_FFMPEG || 'ffmpeg', env: await toolEnv() }),
      ffprobe: async () => ({ command: process.env.BAOCUT_FFPROBE || 'ffprobe', env: await toolEnv() }),
      // 成片的 Render Worker 与引擎宿主同一次 cargo 构建，放在它旁边。
      exportWorker: () => resolveExportWorkerCommand(options.engineHost !== undefined ? options.engineHost : resolveEngineHostCommand()),
      log: log.child('exports'),
    });
    // 共享开着的话，节点服务在这里就开始监听（不重新发配对码）；端口被占不影响 Runtime 启动。
    const nodes = await openNodeShare(home, models, log, options.nodes);
    // 停节点服务会取消远端任务、关掉监听、撤下 mDNS 登记：它可能在所有接口上监听，启动失败也不能留着这个对外的端口。
    stops.add('nodes', () => nodes.close(), 'Stopping the node service failed');
    // 智能体的工具通道：会话令牌在原生会话建立时发放、释放时收回（架构设计 §3.5）。
    // Agent 的 skill（§3.8）：开关只存差量；目录每次重读。开着的 skill 的索引在每个原生会话开始时附在指导后面。
    const skillPrefs = new SkillPrefsStore(home.skillPrefsFile, { log: log.child('skill-prefs') });
    await skillPrefs.load();
    const skills = new SkillCatalog({
      builtinDir: options.skillsDir === undefined ? resolveBuiltinSkillsDir() : options.skillsDir,
      userDir: home.skillsDir,
      prefs: skillPrefs,
    });
    const skillInstaller = new SkillInstaller({
      catalog: skills,
      offlineStrict: () => settings.store.get('offline.strict'),
      ...(options.skillsGithub ? { github: options.skillsGithub } : {}),
    });
    const grants = new AgentGrants(
      (principal) => videos.connectionClosed(principal.connectionId),
      async () => skillIndexBlock(await skills.enabled()),
    );
    // 消息里的图片：经网关同一端口上传，发送时交给 Driver（产品设计 §3.2.4）。
    const attachments = new AttachmentStore({
      dir: home.attachmentsDir,
      log,
      originAllowed: (origin) => originAllowed(origin, options.allowedOrigins),
    });
    stops.add('attachments', () => attachments.close(), null);

    // 偏好设置（前面已经读入）：新会话的默认 Driver 与访问模式从这里冻结（§3.11、§3.12）。
    // 改了机器容量：排队的任务按新的容量重新看一遍。
    settings.store.onChange((changed) => {
      if ('resources.capacity' in changed) models.jobs.resources.recheck();
    });
    const harness = await Harness.open({
      home,
      conversations: new ConversationStore(home.conversationsDir, { log: log.child('conversations') }),
      prefs: new AgentPrefsStore(home.agentPrefsFile, { log: log.child('agent-prefs') }),
      probes: new AgentProbeStore(home.agentProbesFile, { log: log.child('agent-probes') }),
      projects: new ProjectStore(home.projectsFile, { log: log.child('projects') }),
      drivers,
      providers: { store: customProviders, create: createCustomDriver },
      settings: settings.store,
      tools: grants,
      // 主停止（§7.4）一并取消这个会话的智能体提交、还没结束的 Job。
      jobs: { cancelSubmittedBy: (conversationId) => cancelAgentJobs(models.jobs, conversationId) },
      attachments,
      // 任务预算（§3.2、§7.8）：合同的预算策略登记在授权账本里，任务里的每次外发调用在授权之外还要通过它。
      budgets: models.grants,
      // 把无项目会话工作目录里的东西搬进项目时（§3.10），打开着的视频目录跳过。
      openVideoDirs: () => videos.openRefs().map((ref) => ref.path),
      log,
    });
    stops.add('harness', () => harness.shutdown(), 'Stopping the Harness failed');
    // 升级前留在会话工作目录里的视频搬进项目，没有会话的工作目录收拾掉（§3.10）。在 Space 首次扫描与客户端连上之前。
    await harness.migrateScratch().catch((error: unknown) => log.warn('Failed to tidy session folders', { error: String(error) }));
    // 默认 Agent 存在偏好设置里（`agent.defaultDriver`，§3.11）：设置页、CLI、`agents.setDefault` 改了它都推送新的 Agent 视图。
    // 默认 Agent 没设过默认模型时 `DriverInfo.defaultModel` 取 `agent.defaultModel`，改了它也推送。
    settings.store.onChange((changed) => {
      if ('agent.defaultDriver' in changed || 'agent.defaultModel' in changed) harness.agentsChanged();
    });
    harnessRef = harness;
    harnessOpened(harness);
    // 应用内运行的安装、升级命令：停 Harness 之前结束它们（结束后的重新探测要用 Harness）。
    const setup = new AgentSetup({ agents: (o) => harness.agents(o), log, ...options.agentSetup });
    stops.add('setup', () => setup.shutdown(), 'Stopping agent setup commands failed');
    // 登记只在内存里：上次没发出去的、会话删除时没删干净的附件目录在这里清掉。
    await attachments.removeOrphans(harness.referencedAttachments());
    // 整份工具目录（§3.5）：同一个工厂按范围构造全部工具组，会话的工具桥用会话的范围（任务、规划模式、来源目录），
    // MCP 服务用服务的范围（访问策略）。每个工具出现在哪些面由目录项的 `surfaces` 决定，这里不挑。
    const packages = new PackageImporter(videos);
    // 代码画面（§8）：Electron 离屏宿主按需拉起，各组工具共用一个；烘焙用的 ffmpeg 与媒体分析同一个（按登录 shell 的 PATH 找）。
    const compositionHost = new SharedCompositionHost({
      electron: resolveElectronBinary(),
      cacheDir: home.cacheDir,
      log: (line) => log.debug('Composition host', { line }),
    });
    stops.add('compositions', () => compositionHost.close(), 'Stopping the composition host failed');
    const compositionFfmpeg = async () =>
      process.env.BAOCUT_FFMPEG || (await findOnPath('ffmpeg', (await toolEnv()).PATH ?? '')) || 'ffmpeg';
    // 导入与预览的主体：工具（会话、终端、对外服务）与界面的 `compositions.*` 共用这一个，宿主也是同一个。
    const compositions = new CompositionService({ videos, ffmpeg: compositionFfmpeg, host: compositionHost, log });
    const toolSets = (toolScope: ToolScope): ToolSet[] => {
      // 从链接下载：`download` 与 `transcribe` 给 `url` 时共用。
      const linkImport = {
        tools: externalTools,
        pipelines: models.pipelines,
        jobs: models.jobs,
        offlineStrict: () => settings.store.get('offline.strict'),
        scope: toolScope,
      };
      return [
        new VideoTools({ videos, scope: toolScope, analysis, packages }),
        new ModelTools({ models, scope: toolScope }),
        new JobTools({ jobs: models.jobs, pipelines: models.pipelines, scope: toolScope }),
        new ExportTools({ exports, scope: toolScope }),
        new ModelInstallTools({ installs: models.installs, catalog: models.catalog, scope: toolScope }),
        new ProjectTools({ harness, videos, scope: toolScope }),
        new LibraryTools({ library, scope: toolScope }),
        // Space 目录在后面才建好：工具调用时再取。
        new SpaceTools({ space: () => space, scope: toolScope, jobs: models.jobs }),
        new SkillTools({ skills, scope: toolScope }),
        new GrantTools({ models, scope: toolScope }),
        new TaskTools({ harness, scope: toolScope }),
        new LinkImportTools(linkImport),
        // 一级动词（transcribe、translate、dub、transcode）：启动固定流程；视频启用的术语表由流程自己读。
        new FlowTools({ pipelines: models.pipelines, scope: toolScope, linkImport }),
        new DownloadTools({
          scope: toolScope,
          downloadsDirectory: () => resolveDownloadsDirectory(settings.store.get('downloads.directory')),
        }),
        new VideoDeleteTools({
          space: () => space,
          trash: () => videoTrash,
          videos,
          retentionDays: () => settings.store.get('space.trashRetentionDays'),
          scope: toolScope,
        }),
        new CompositionTools({ videos, scope: toolScope, compositions }),
      ];
    };
    // 会话的工具桥与网关 `catalog.call`（终端）共用同一组工具实例：`ScopeRouter` 按主体的种类转给会话的范围或终端的范围
    // （用户本人，相对路径按 cwd 解析）；两个面各自是这组工具的一个视图（`surface`）。
    const scope = new ScopeRouter({
      agent: new AgentScope({ harness, videos, jobs: models.jobs }),
      local: new LocalScope({ harness, videos, jobs: models.jobs, space: () => space, projectsDir: home.projectsDir }),
    });
    const tools = new ToolCatalog(toolSets(scope), log, { surface: 'agent' });
    // 会话内智能体的指导（§3.8；Agent 面设计 §8.6）：说明书按工具桥面渲染，`{{tool:…}}` 按这份目录核对。SKILL.md 正文是每个原生会话的
    // 开发者指导，目录页、做法总览与约定登记成内置 skill。渲染不了就让启动失败，不带着空的或过期的指导开会话。
    const agentSkillsDir = options.agentSkillsDir === undefined ? resolveBuiltinAgentSkillsDir() : options.agentSkillsDir;
    const guidance = loadAgentGuidance(agentSkillsDir, { tools: tools.list() });
    grants.setInstructions(guidance.instructions);
    skills.setGuidePages(guidance.pages, guidance.sourceDir);
    const mcp = new McpEndpoint({ grants, tools, log });
    // 对外服务（§4.8）：先登记，网关就绪之后再开启随 Runtime 启动的。停止时排在最前：断开外部连接，取消待处理的服务审批。
    const services = await openServices({
      home,
      harness,
      videos,
      models,
      nodes,
      log,
      toolSets,
      ...(options.services ? { options: options.services } : {}),
    });
    stops.add('services', () => services.manager.close(), 'Stopping external services failed');

    const marks = new SpaceMarkStore(home.spaceFile, { log: log.child('space-marks') });
    await marks.load();
    // Space 的产物记录（§5.7）：产出产物的任务的派生用事实，Job Ledger 修剪之后条目照样在。
    const spaceArtifacts = new SpaceArtifactStore(home.spaceArtifactsFile, { log: log.child('space-artifacts') });
    const retained = await spaceArtifacts.load();
    if (retained.skipped > 0 || retained.quarantined) log.warn('Skipped unreadable parts of the Space output records', retained);
    // 跨视频的内容索引（§5.11）：派生缓存，只经 VideoService 的只读查询读视频；有视频索引完成时 Space 目录重算派生状态。
    const contentIndex = new ContentIndex({
      dir: path.join(home.cacheDir, 'content-index'),
      reader: { readContent: (dir) => videos.readContent(dir), peek: (dir) => videos.peek(dir) },
      log,
    });
    await contentIndex.load();
    const space = new SpaceCatalog({
      harness,
      marks,
      log,
      watch: options.watchSpace,
      jobs: models.jobs,
      artifacts: spaceArtifacts,
      videos,
      index: contentIndex,
    });
    spaceRef = space;
    // 回收站的保留期（§5.7）：首次扫描之后清一次，之后每 6 小时一次；天数每次取当时的设置。
    const sweepTrash = () =>
      void space.ready
        .then(() => space.sweepTrash(settings.store.get('space.trashRetentionDays')))
        .catch((error) => log.warn('Trash retention cleanup failed', { error: String(error) }));
    const trashSweeper = setInterval(sweepTrash, TRASH_SWEEP_INTERVAL_MS);
    trashSweeper.unref();
    stops.add(
      'space',
      () => {
        clearInterval(trashSweeper);
        return space.close();
      },
      null,
    );
    space.start();
    sweepTrash();
    // 上次被强杀留下的导出临时文件与打开便携包的暂存目录（§5.8）：首次扫描之后在后台清一次。
    void space.ready
      .then(() => sweepLeftovers({ jobs: () => models.jobs.list(), sourceRoots: () => space.sourceRoots(), log }))
      .catch((error) => log.warn('Leftover file cleanup failed', { error: String(error) }));
    // 产物库与缓存的后台清理（§5.1、§7.3）：Space 从账本补齐产物记录之后清一轮产物库，之后每次账本淘汰任务后再清；缓存每小时核一次大小。
    const storageGc = new StorageGc({
      jobs: models.jobs,
      spaceArtifacts,
      ready: space.ready,
      artifactSweepBlocked: retained.quarantined ? 'space-artifacts-quarantined' : null,
      cacheDir: home.cacheDir,
      cacheMaxBytes: () => settings.store.get('cache.maxSizeMiB') * 1024 * 1024,
      log: log.child('storage-gc'),
    });
    stops.add('storage-gc', () => storageGc.close(), null);
    storageGc.start();
    const videoTrash = new VideoTrash({
      space,
      videos,
      jobs: models.jobs,
      resolve: (target) => locateFileTarget(harness, space, target),
      log,
    });

    const info: RuntimeInfo = {
      instanceId,
      epoch: instanceId,
      runtimeVersion: RUNTIME_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      home: home.root,
      projectsDir: home.projectsDir,
      logsDir: home.logsDir,
      pid: process.pid,
      startedAt: nowIso(),
      launchedBy: options.launchedBy ?? null,
    };
    // 有没有人在用（§2.2）：`runtime.status` 报告它，CLI 拉起的按它空闲退出。
    const activity = new RuntimeActivity(
      {
        info,
        activeJobs: () => models.jobs.list().filter((job) => !isTerminal(job.state)).length + Number(legacyUpgrade.active),
        runningServices: () =>
          services.manager.list().flatMap((service) => (service.state === 'off' || service.state === 'error' ? [] : [service.serviceId])),
      },
      options.idleExit
        ? {
            ...options.idleExit,
            minutes: () => settings.store.get('runtime.idleExitMinutes'),
            // 先删发现文件再停（§2.2）：停任务与服务要一会儿，这期间来找 Runtime 的 CLI 看不到它、等它放开实例锁后另起一个，
            // 不会连上一个正在退出的。
            onIdle: () =>
              void removeDiscovery(home, instanceId)
                .catch(() => {})
                .finally(() => options.idleExit!.onIdle()),
          }
        : null,
    );
    const token = crypto.randomBytes(32).toString('base64url');
    const handlerDeps = {
      harness,
      setup,
      space,
      media,
      attachments,
      analysis,
      spaceThumbnails: new SpaceThumbnails({
        catalog: space,
        analysis,
        assetFileAt: (dir, assetId, revision) => videos.assetFileAt(dir, assetId, revision),
        log,
      }),
      videos,
      videoTrash,
      models,
      exports,
      library,
      nodes,
      initiator,
      settings,
      services,
      runtime: info,
      externalTools,
      templates: new TemplateCatalog({
        builtinDir: options.templatesDir === undefined ? resolveBuiltinTemplatesDir() : options.templatesDir,
        userDir: path.join(home.root, 'templates'),
      }),
      skills,
      skillInstaller,
      fonts,
      // 代码画面（§8）：界面的 `compositions.*` 与工具共用同一个服务与宿主。
      compositions,
      // 终端的目录视图（§3.5）：同一组工具里 `surfaces` 含 `cli` 的。
      catalog: tools.withView({ surface: 'cli' }),
      agentSkillsDir,
      activity,
      requestStop: options.requestStop ?? null,
    };
    // Web 服务（§4.8）用同一组处理函数，只把媒体句柄换成它自己的（同源地址、要会话）；白名单在它的网关入口上。
    services.web.bind({ runtime: info, handlers: createHandlers({ ...handlerDeps, media: services.web.media }) });
    // 在场的用户（工具页的当场授权，§7.9）：这个网关上的桌面界面连接。CLI、智能体、浏览器与对外服务都不算。
    const present = new Set<string>();
    models.grants.setPresence((submitter) => submitter.kind === 'connection' && present.has(submitter.id));
    const gateway = new Gateway({
      token,
      runtime: info,
      handlers: createHandlers(handlerDeps),
      log,
      allowedOrigins: options.allowedOrigins,
      http: (request, response) => {
        activity.touch();
        return mcp.handle(request, response) || attachments.handle(request, response) || media.handle(request, response);
      },
      onConnect: (principal) => {
        if (principal.kind === 'desktop') present.add(principal.connectionId);
        activity.connected(principal);
      },
      onRequest: (principal, method) => activity.requested(principal, method),
      onDisconnect: (principal) => {
        activity.disconnected(principal);
        present.delete(principal.connectionId);
        videos.connectionClosed(principal.connectionId);
      },
    });
    // 监听失败时网关自己收拾干净；登记在监听之前，是为了之后写发现文件失败时也关掉它。
    stops.add('gateway', () => gateway.close(), 'Stopping the gateway failed');
    const endpoint = await gateway.listen(options.host, options.port);
    media.setBaseUrl(endpoint.replace(/^ws:/, 'http:'));
    attachments.setBaseUrl(endpoint.replace(/^ws:/, 'http:'));
    grants.setEndpoint(`${endpoint.replace(/^ws:/, 'http:')}/mcp`);
    const discovery: RuntimeDiscovery = { ...info, endpoint, token };
    await writeDiscovery(home, discovery);
    stops.add('discovery', () => removeDiscovery(home, instanceId), null);
    // 开启随 Runtime 启动的对外服务：失败（端口被占用）只让那个服务进入 error，不影响 Runtime。
    await services.manager.restore();
    activity.start();
    stops.add('activity', () => activity.stop(), null);
    legacyUpgrade.start({
      models: models.services.store,
      refreshModels: () => models.services.refresh(),
      engine: options.engineHost !== undefined ? options.engineHost : resolveEngineHostCommand(),
      openProject: async (dir, name) => {
        const existed = harness.listProjects().some((project) => project.path === dir);
        const project = await harness.openProject(dir);
        if (!existed && typeof name === 'string' && name.trim()) {
          await harness.updateProject({ projectId: project.id, name: [...name.trim()].slice(0, 200).join('') });
        }
      },
      env: toolEnv,
    });
    log.info('Runtime ready', { instanceId, endpoint, home: home.root, launchedBy: info.launchedBy });

    let closing: Promise<void> | null = null;
    const close = () =>
      (closing ??= (async () => {
        log.info('Runtime stopping');
        await stops.run();
        await releaseInstanceLock(home, instanceId).catch(() => {});
        log.info('Runtime stopped');
        await log.close();
      })());

    return {
      info,
      discovery,
      harness,
      space,
      videos,
      models,
      exports,
      library,
      nodes,
      initiator,
      settings,
      services,
      externalTools,
      fonts,
      log,
      close,
    };
  } catch (error) {
    log.error('Runtime failed to start', { error: String(error) });
    harnessFailed(error);
    await stops.run();
    await releaseInstanceLock(home, instanceId).catch(() => {});
    await log.close().catch(() => {});
    throw error;
  }
}

/**
 * 取消一个会话的智能体提交、还在排队或运行的 Job（§7.4 主停止的第 2 步），走与 `jobs.cancel` 相同的路径。
 * 不等运行中的 Provider 停下，只等引擎确认停止屏障（至多 `BARRIER_ACK_MS`）：兑现时这些 Job 不会再写进视频。
 * 兑现为发出取消的个数。已经结束的 Job 与结果不受影响。
 */
async function cancelAgentJobs(jobs: JobManager, conversationId: Id): Promise<number> {
  const pending = jobs
    .list()
    .filter(
      (job) => job.submitter.kind === 'agent' && job.submitter.id === conversationId && (job.state === 'queued' || job.state === 'running'),
    );
  const barriers = pending.map((job) => jobs.cancelWrites(job.jobId).catch(() => false));
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, BARRIER_ACK_MS);
    timer.unref?.();
  });
  await Promise.race([Promise.all(barriers), timeout]);
  clearTimeout(timer);
  return pending.length;
}

/** 主停止等引擎确认停止屏障的上限：引擎卡住时不拖住停止（之后到的提交仍有 Node 侧的屏障）。 */
const BARRIER_ACK_MS = 5_000;
