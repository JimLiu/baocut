import path from 'node:path';
import { TopicLog, type Logger } from '@baocut/harness';
import {
  JobManager,
  LocalTranscribeProvider,
  MachineCapacity,
  ResourceScheduler,
  PIPELINE_ACTOR_ID,
  PipelineRunner,
  dubPipeline,
  speakersPipeline,
  localDubSeparator,
  resolveSpeechWorkerCommand,
  ffprobeMediaProbe,
  transcodePipeline,
  transcribePipeline,
  translatePipeline,
  translateSubtitlesPipeline,
  type CaptionVideos,
  type MediaVideos,
  type PipelineTranscriber,
  type TranscribeDeps,
  type JobFaults,
  type JobLibrary,
  type DubVideos,
  type FrozenDubParams,
  type JobVideos,
  type PipelineDefinition,
  type PipelineTargets,
  type PipelineVideos,
  type ProbeToolResolver,
  type CapacitySource,
} from '@baocut/jobs';
import {
  LocalProviderSource,
  ModelCatalog,
  ModelServiceStore,
  ModelServices,
  UsageLedger,
  checkTranscribeOptions,
  type ProviderSource,
} from '@baocut/models';
import {
  RpcError,
  type Actor,
  type GrantDataKind,
  type Id,
  type JobsEvent,
  type JobsSnapshot,
  type ModelsEvent,
  type ResourceCapacitySetting,
  type ModelsSnapshot,
} from '@baocut/protocol';
import {
  AgentProviderSource,
  OnlineProviderSource,
  type AgentDrivers,
  type AgentSourceOptions,
  type FfmpegResolver,
  type OnlineSourceOptions,
  type VoiceCloner,
} from '@baocut/providers';
import type { CredentialStore, RuntimeHome } from '@baocut/runtime-storage';
import type { TrustedPrincipal } from '../gateway.ts';
import type { EngineProtection, EngineRun, VideoService } from '../videos/video-service.ts';
import type { ModelWorkerCommand } from './model-worker.ts';
import { ModelInstallService, type ModelInstallServiceOptions } from './model-install-service.ts';
import { ModelsDirService, type ModelsDirServiceOptions, type ModelsDirTestHooks } from './models-dir-service.ts';
import { GrantService } from '../grants/grant-service.ts';
import { grantedTextGenerator, withPipelineGrants } from '../grants/pipeline-grants.ts';
import type { TextPlanResult } from '../exports/export-plan.ts';
import { DUB_DATA_KINDS, dubSpeech, withDubGrantGuidance } from './dub-speech.ts';
import { pipelineTargets, placeLocation, videoPlace, type PipelineTargetsOptions } from '../videos/pipeline-targets.ts';
import { RcModels } from '@baocut/protocol/messages/runtime-core';

/** Runtime 自己写入转写结果、导入生成的素材时的行为者（架构设计 §7.3）。 */
export const JOBS_ACTOR: Actor = { kind: 'system', id: 'system:jobs' };

/** 翻译流程外发的数据：视频的文稿。 */
const TRANSLATE_DATA_KINDS: GrantDataKind[] = ['transcript'];

/** 转录流程外发的数据：素材的音频（与直接提交的 `models.transcribe` 相同）。 */
const TRANSCRIBE_DATA_KINDS: GrantDataKind[] = ['audio'];

/** 固定流程写视频时的行为者（架构设计 §7.9）。 */
export const PIPELINE_ACTOR: Actor = { kind: 'system', id: PIPELINE_ACTOR_ID };

export interface ModelJobs {
  catalog: ModelCatalog;
  provider: LocalTranscribeProvider;
  /** 模型服务：Provider 注册表、配置与选择（§6.1、§6.2）。 */
  services: ModelServices;
  jobs: JobManager;
  /** 固定流程（§7.9）：父任务与步骤记在 `jobs` 里。 */
  pipelines: PipelineRunner;
  /** `jobs` 主题：快照是保留的任务记录与在跑转录的实时段落，事件是一条记录的新状态或转录新识别出的段落。 */
  topic: TopicLog<JobsSnapshot, JobsEvent>;
  /** `models` 主题：快照是完整的能力视图与模型包状态；事件是新的能力视图，或一个模型包的新状态。 */
  modelsTopic: TopicLog<ModelsSnapshot, ModelsEvent>;
  /** 本地模型包的安装、修复、删除与自检（§6.3）。 */
  installs: ModelInstallService;
  /** 模型目录：在哪里、改到哪里（§6.3）。 */
  dir: ModelsDirService;
  /** 数据外发的授权与预算（§12.5、§7.8）：JobManager 提交外发任务时经它接纳；`grants` 主题。 */
  grants: GrantService;
  /** 一个在线 Provider 的音色克隆接口（§5.9）；没有克隆接口时 null。 */
  voiceCloner(providerId: string): VoiceCloner | null;
  /** 等排队的用量记录（§6.10）与账号的最近使用时间（§6.8）写完；停机时调用。 */
  flushUsage(): Promise<void>;
}

export interface ModelJobsOptions {
  home: RuntimeHome;
  /** 在线 Provider 各账号的密钥（`provider:<providerId>/<accountId>`），与节点令牌共用一个实例（§6.8）。 */
  credentials: CredentialStore;
  videos: VideoService;
  log: Logger;
  /** Model Worker 的命令；null 表示本地推理不可用。 */
  worker: () => ModelWorkerCommand | null;
  /** Speech Worker 的命令（翻译与翻译配音的翻译一步，架构设计 §7.9）；不给时按 `resolveSpeechWorkerCommand` 找。null 表示没有构建。 */
  speechWorker?: () => string | null;
  env: () => Promise<NodeJS.ProcessEnv>;
  idleMs?: number;
  /** 偏好设置 `resources.capacity`（每次准入时读，改了立即生效）。 */
  resourceCapacity?: () => ResourceCapacitySetting | null;
  /** 测试注入的机器容量；不给时按本机探测（磁盘按 staging 所在的卷）。 */
  capacity?: CapacitySource;
  /** 远端节点（§6.7）的 Provider 来源。没有时 `node:*` 一律 `not-found`。 */
  remote?: ProviderSource;
  /** 在线 Provider 准备音频、文件转码（§7.9）用的 ffmpeg。 */
  ffmpeg: FfmpegResolver;
  /** 生成输出（音频、图片）发布前解码校验用的 ffprobe。 */
  ffprobe: ProbeToolResolver;
  /** 用户库（架构设计 §5.9）：转写的术语表、合成的 `library:<id>` 音色。 */
  library?: JobLibrary;
  /** 视频某一步启用、此刻还在库里的术语表（`LibraryService.enabledGlossaries`）：转录流程据此套用转写术语表。 */
  enabledGlossaries?: (videoId: Id, step: 'transcribe') => Promise<{ ids: Id[] }>;
  /** 在线 Provider 的调节项（测试把内置 Provider 的基址指向本机的假服务、缩短退避）。 */
  online?: Omit<OnlineSourceOptions, 'store' | 'ffmpeg'>;
  /** 智能体 Provider（§6.9）用的 Driver 注册表。没有时不列 `agent:*`。 */
  agents?: AgentDrivers;
  /** 智能体 Provider 的调节项（测试缩短探测缓存与期限）。 */
  agentProviders?: Omit<AgentSourceOptions, 'store' | 'drivers'>;
  /** 模型安装用到的设置（下载来源、严格离线）。不给时用默认值。 */
  installSettings?: ModelInstallServiceOptions['settings'];
  /**
   * 设置 `models.dir` 的读写（§6.3）。环境变量 `BAOCUT_MODELS_DIR`（`home.modelsDir` 不是 `<home>/models`）优先于它。
   * 不给时只用 `home.modelsDir`，不能改。
   */
  modelsDirSetting?: ModelsDirServiceOptions['setting'];
  /** 测试用：卡住或打断模型目录的移动、假装跨盘。 */
  modelsDirTesting?: ModelsDirTestHooks;
  /** 模型安装的调节项：测试把下载来源指向本机的假服务、注入可用空间、内置清单与自检样本。 */
  modelInstall?: Pick<ModelInstallServiceOptions, 'installer' | 'selfTestSample' | 'env'>;
  /**
   * 保存位置（§7.9「保存位置」）：没有视频的流程结果（文件转码、字幕文件的翻译、只给文件的转录）不给 `outDir` 时写在这里，
   * 提交时读一次并冻结。不给时（只在单测里）写在源文件旁边。
   */
  saveDirectory?: () => string;
  /** 流程的视频目标（§7.9）：Space 条目的位置与项目目录。不给时流程只接受已打开的 `videoId`。 */
  pipelineTargets?: PipelineTargetsOptions;
  /** 另外登记的固定流程（从链接导入）：拿到任务库、写视频的能力与模型服务之后再建。 */
  extraPipelines?: (context: ExtraPipelineContext) => Array<PipelineDefinition<any, any>>;
  /** 故障注入（测试用）。 */
  faults?: JobFaults;
  /**
   * 智能体任务的合同此刻对一个视频的保护范围（§3.2）：任务下的 Job 与流程步骤把结果应用到视频时带上，引擎照常检查。
   * Harness 比任务账本晚打开：等它就绪再答；任务已经不在了时空列表。不给时任务里的写入也不带保护。
   */
  taskProtections?: (taskId: Id, videoId: Id) => Promise<EngineProtection[]>;
}

export interface ExtraPipelineContext {
  grants: GrantService;
  jobs: JobManager;
  videos: CaptionVideos & MediaVideos;
  /** 流程里的转写（复用 `models.transcribe` 的提交）。 */
  transcriber: PipelineTranscriber;
  services: ModelServices;
  /** 视频目标的打开与新建；没有配置时 null。 */
  targets: PipelineTargets | null;
  /** 视频里启用、此刻还在库里的转写术语表（与转录流程相同）；没有接线时没有。 */
  enabledGlossaries?: (videoId: Id) => Promise<Id[]>;
}

/** 组装模型目录、Provider 注册表与 JobManager，并把任务变化接到 `jobs` 主题、能力视图的变化接到 `models` 主题上。 */
export async function openModelJobs(options: ModelJobsOptions): Promise<ModelJobs> {
  const { home, videos } = options;
  const log = options.log.child('jobs');
  const manifests = options.modelInstall?.installer?.manifests;
  // 模型目录（§6.3）：`home.modelsDir` 不是 `<home>/models` 时是环境变量给的，只读；否则设置 `models.dir` 优先于缺省位置。
  const defaultModelsDir = path.join(home.root, 'models');
  const envModelsDir = path.resolve(home.modelsDir) !== defaultModelsDir ? path.resolve(home.modelsDir) : null;
  const dirSetting = options.modelsDirSetting ?? { get: () => null, set: async () => {} };
  const configuredDir = dirSetting.get();
  const catalog = new ModelCatalog({
    root: envModelsDir ?? (configuredDir ? path.resolve(configuredDir) : defaultModelsDir),
    workerAvailable: () => options.worker() !== null,
    ...(manifests ? { manifests } : {}),
  });
  // 资源调度（§7.6、§7.7）：Model Worker 的进程与所有任务共用一个。
  const resources = new ResourceScheduler({
    capacity:
      options.capacity ??
      new MachineCapacity({ scratchDir: home.stagingDir, ...(options.resourceCapacity ? { override: options.resourceCapacity } : {}) }),
    log,
  });
  const provider = new LocalTranscribeProvider({
    catalog,
    command: options.worker,
    env: options.env,
    log,
    idleMs: options.idleMs,
    resources,
  });
  const store = await ModelServiceStore.open(home, options.credentials, undefined, { log: options.log.child('model-services') });
  // 用量账本（§6.10）：在线与智能体 Provider 的每次真实调用记一条。
  const usageLog = options.log.child('usage');
  const usage = new UsageLedger(home.usageFile, { warn: (message, data) => usageLog.warn(message, data) });
  const online = new OnlineProviderSource({ ...options.online, store, ffmpeg: options.ffmpeg, usage });
  const services = new ModelServices({
    store,
    usage,
    sources: [
      new LocalProviderSource({ catalog, transcriber: provider, speech: provider.speechGenerator(), image: provider.imageGenerator() }),
      ...(options.remote ? [options.remote] : []),
      online,
      ...(options.agents ? [new AgentProviderSource({ ...options.agentProviders, store, drivers: options.agents, usage })] : []),
    ],
  });
  // 授权账本先于任务账本打开：任务账本对账时要结算上次没结束的预留。
  const grants = await GrantService.open({ file: home.grantsFile, services, log: options.log });
  const guard = taskGuard(grants, options.taskProtections);
  const jobs = new JobManager({
    paths: {
      jobsFile: home.jobsFile,
      stagingDir: home.stagingDir,
      artifactsDir: home.artifactsDir,
      diagnosticsDir: path.join(home.logsDir, 'diagnostics'),
    },
    catalog,
    router: services,
    videos: videoAdapter(videos, guard),
    log,
    probe: ffprobeMediaProbe(options.ffprobe),
    ...(options.library ? { library: options.library } : {}),
    ...(options.faults ? { faults: options.faults } : {}),
    admission: grants,
    resources,
  });
  grants.attachJobs(
    () => jobs.snapshot().jobs,
    (jobId) => {
      try {
        return jobs.inspect(jobId);
      } catch {
        return null;
      }
    },
  );
  await jobs.open();
  const targets = options.pipelineTargets ? pipelineTargets(videos, options.pipelineTargets) : null;
  const transcriber = pipelineTranscriber(jobs, services);
  const speechWorker = options.speechWorker ?? (() => resolveSpeechWorkerCommand(null));
  const pipelines = new PipelineRunner({
    jobs,
    stagingDir: home.stagingDir,
    log,
    ...(targets ? { targets } : {}),
    // 流程用到的库里条目（翻译的术语表）以父任务固定到流程结束（§5.9）。
    ...(options.library ? { library: options.library } : {}),
    definitions: [
      transcodePipeline({
        ffmpeg: options.ffmpeg,
        ffprobe: options.ffprobe,
        ...(options.saveDirectory ? { saveDirectory: options.saveDirectory } : {}),
      }),
      // 逐句翻译把文稿交给文本模型：每次调用经授权与预算（§12.5）。
      withPipelineGrants(
        translatePipeline({
          videos: pipelineVideos(videos, guard),
          text: grantedTextGenerator(services.textGenerator(), grants, services, TRANSLATE_DATA_KINDS),
          selectText: (target) => services.selectText(target),
          speechWorker,
          ...(options.library ? { library: options.library } : {}),
          artifacts: jobs.artifacts,
        }),
        grants,
        TRANSLATE_DATA_KINDS,
      ),
      // 字幕文件的翻译：没有视频，字幕文本按 transcript 外发，授权与预算同上。
      withPipelineGrants(
        translateSubtitlesPipeline({
          text: grantedTextGenerator(services.textGenerator(), grants, services, TRANSLATE_DATA_KINDS),
          selectText: (target) => services.selectText(target),
          ...(options.library ? { library: options.library } : {}),
          artifacts: jobs.artifacts,
          ...(options.saveDirectory ? { saveDirectory: options.saveDirectory } : {}),
        }),
        grants,
        TRANSLATE_DATA_KINDS,
      ),
      // 翻译配音：缺译文时的翻译与逐句合成各自经授权与预算；启动前两种外发都要判断。被拒时补上配音的下一步指引。
      withDubGrantGuidance(
        withPipelineGrants(
          dubPipeline({
            videos: dubVideos(videos, guard),
            translation: {
              text: grantedTextGenerator(services.textGenerator(), grants, services, TRANSLATE_DATA_KINDS),
              selectText: (target) => services.selectText(target),
              speechWorker,
              ...(options.library ? { library: options.library } : {}),
              artifacts: jobs.artifacts,
            },
            speech: dubSpeech({ services, grants, library: options.library }),
            // 人声与背景分离（`separateAudio`）：启动时按默认值（没设时出厂默认，§6.2）选本机的分离模型包，执行时用冻结的那只；
            // 没有可用的时要求分离的这一步跳过。
            separator: async (model) => {
              let choice;
              try {
                choice = await services.selectSeparate(model ? { provider: model.providerId, model: model.modelId } : {});
              } catch (error) {
                if (error instanceof RpcError) return null;
                throw error;
              }
              if (choice.providerId !== 'local') return null;
              const bundleId = choice.modelId;
              const workerWeightBytes = await catalog.workerWeightBytes(bundleId);
              return localDubSeparator({ provider, bundleId, workerWeightBytes, ffmpeg: options.ffmpeg, ffprobe: options.ffprobe });
            },
            ffmpeg: options.ffmpeg,
            ffprobe: options.ffprobe,
          }),
          grants,
          DUB_DATA_KINDS,
          (plan) => dubOutbound(plan.params),
        ),
      ),
      // 转录：转写 Job 自己把文稿写进视频，流程再建字幕层。转写子任务提交时照常判断授权并预留；这里在启动前先判断，
      // 缺授权时不新建视频、不导入，在场的用户的拒绝带待批准项（§7.9）。
      withPipelineGrants(
        transcribePipeline({
          videos: pipelineVideos(videos, guard),
          transcriber,
          ...(options.saveDirectory ? { saveDirectory: options.saveDirectory } : {}),
          ...(targets ? { targets } : {}),
          ...(options.enabledGlossaries ? { enabledGlossaries: async (videoId: Id) => (await options.enabledGlossaries!(videoId, 'transcribe')).ids } : {}),
          sources: transcribeSources(videos),
        }),
        grants,
        TRANSCRIBE_DATA_KINDS,
        (plan) => [{ capability: 'transcribe', providerId: plan.providerId, modelId: plan.modelId, dataKinds: TRANSCRIBE_DATA_KINDS }],
      ),
      // 识别说话人：本机的「说话人区分」模型包给已有转写重新区分说话人，结果是提案（`edits.applySpeakers` 应用）。不外发数据，
      // 不经授权。
      speakersPipeline({
        videos: dubVideos(videos, guard),
        pack: async () => (await catalog.list()).find((bundle) => bundle.capability === 'diarize') ?? null,
        footprint: (bundleId) => catalog.workerFootprint(bundleId),
        diarizer: provider,
      }),
      ...(options.extraPipelines?.({
        grants,
        jobs,
        videos: pipelineVideos(videos, guard),
        transcriber,
        services,
        targets,
        ...(options.enabledGlossaries
          ? { enabledGlossaries: async (videoId: Id) => (await options.enabledGlossaries!(videoId, 'transcribe')).ids }
          : {}),
      }) ?? []),
    ],
  });
  await pipelines.open();
  grants.settleOrphans();
  const topic = new TopicLog<JobsSnapshot, JobsEvent>(() => jobs.snapshot(), '0');
  jobs.onChange((job) => topic.publish({ type: 'job.updated', job }));
  jobs.onSegments(({ jobId, from, segments }) => topic.publish({ type: 'job.segments', jobId, from, segments }));
  await services.refresh();
  // 启用着的 Provider 的默认授权（§6.8 的迁移规则）；之后配置变化时再对账。
  grants.reconcile();
  services.onChange(() => grants.reconcile());
  // 模型包状态的快照：模型目录告知变化后读一次新状态（按变化的先后串行），换进快照并发 `bundle.updated`。
  const bundles = new Map((await catalog.list()).map((b) => [b.bundleId, b]));
  const modelsTopic = new TopicLog<ModelsSnapshot, ModelsEvent>(
    () => ({ capabilities: services.view(), bundles: [...bundles.values()] }),
    '0',
  );
  services.onChange((capabilities) => modelsTopic.publish({ type: 'capabilities.updated', capabilities }));
  const pendingBundles = new Set<string>();
  let bundleChain = Promise.resolve();
  catalog.onChange((bundleId) => {
    if (pendingBundles.has(bundleId)) return;
    pendingBundles.add(bundleId);
    bundleChain = bundleChain.then(async () => {
      pendingBundles.delete(bundleId);
      const status = await catalog.status(bundleId).catch(() => null);
      if (!status) return;
      bundles.set(bundleId, status);
      modelsTopic.publish({ type: 'bundle.updated', bundle: status });
    });
  });
  const installs = new ModelInstallService({
    catalog,
    provider,
    jobs,
    log,
    settings: options.installSettings ?? (() => ({ downloadEndpoint: null, offlineStrict: false })),
    ...options.modelInstall,
    refresh: () => void services.refresh().catch(() => {}),
    clearDefaults: (bundleId) => services.clearLocalDefaults(bundleId),
  });
  const dir = new ModelsDirService({
    defaultDir: defaultModelsDir,
    envDir: envModelsDir,
    setting: dirSetting,
    catalog,
    provider,
    jobs,
    log,
    ...(options.modelInstall?.installer?.freeBytes ? { freeBytes: options.modelInstall.installer.freeBytes } : {}),
    ...(options.modelsDirTesting ? { testing: options.modelsDirTesting } : {}),
    refresh: () => void services.refresh().catch(() => {}),
  });
  await dir.recover();
  // 任务失败可能让模型包停用（反复崩溃）：重算视图。
  jobs.onChange((job) => {
    if (job.state === 'failed') void services.refresh().catch(() => {});
  });
  // 恢复矩阵里要等 Provider 与授权就绪的部分（§7.5）：重新排队、补做应用。在后台做，不拖住启动；
  // 预留要在 `settleOrphans` 之后才建（否则会被当成孤儿结算掉）。
  void jobs.recover().catch((error: unknown) => log.error('Recovering tasks failed', { error: String(error) }));
  const voiceCloner = (providerId: string) => online.voiceCloner(providerId);
  const flushUsage = async () => {
    await usage.flush();
    await store.flush();
  };
  return { catalog, provider, services, jobs, pipelines, topic, modelsTopic, installs, dir, grants, voiceCloner, flushUsage };
}

/**
 * 任务里的写入（§3.2）：这次执行（`run`，Job 自己或流程的父任务）经提交者找到所在的智能体任务时，带上任务与合同对这个视频的
 * 保护范围；引擎对带 taskId 的非用户写入检查保护。不带 `run` 的写入（用户的 `jobs.reconcile apply`）是用户的决定，不带。
 */
type TaskGuard = (videoId: Id, run: EngineRun | undefined) => Promise<{ taskId?: Id; protections?: EngineProtection[] }>;

function taskGuard(grants: GrantService, protections: ModelJobsOptions['taskProtections']): TaskGuard {
  return async (videoId, run) => {
    const taskId = run ? grants.taskOfJob(run.runId) : null;
    if (!taskId) return {};
    return { taskId, protections: (await protections?.(taskId, videoId)) ?? [] };
  };
}

function videoAdapter(videos: VideoService, guard: TaskGuard): JobVideos {
  return {
    retain: (videoId) => videos.retain(videoId),
    release: (videoId) => videos.release(videoId),
    async source(videoId, assetId, revision) {
      const { root, file, record } = await videos.mediaSource(videoId, assetId, revision);
      return { file: path.resolve(root, file), revision: record.revision, contentHash: record.contentHash, mediaType: record.mediaType };
    },
    current(videoId, assetId) {
      const mirror = videos.mirror(videoId);
      if (!mirror) return null;
      const asset = mirror.video.assets[assetId];
      const record = asset?.revisions[asset.currentRevision];
      return {
        videoRevision: mirror.video.revision,
        asset: record ? { revision: record.revision, contentHash: record.contentHash } : null,
      };
    },
    videoRevision(videoId) {
      return videos.mirror(videoId)?.video.revision ?? null;
    },
    async apply(videoId, { run, ...request }) {
      const { receipt } = await videos.applyAs({ videoId, ...request }, JOBS_ACTOR, {
        ...(run ? { run } : {}),
        ...(await guard(videoId, run)),
      });
      return { refs: receipt.refs ?? {}, transactionId: receipt.transactionId, videoRevision: receipt.videoRevision };
    },
    invalidateRun: (videoId, run) => videos.invalidateRun(videoId, run),
    place: (videoId) => videoPlace(videos, videoId),
    async reopen(videoId, place) {
      const location = placeLocation(place);
      if (!location) return 'missing';
      const principal = recoveryPrincipal();
      const opened = await videos.open(location, principal).catch((error: unknown) => {
        // 目录不见了、不再是视频或已经出了来源目录：目标不在了。别的（被锁、引擎不可用）照常抛出。
        if (error instanceof RpcError && (error.code === 'not-found' || error.code === 'forbidden')) return null;
        throw error;
      });
      if (!opened) return 'missing';
      if (opened.ref.videoId !== videoId) {
        await videos.close(opened.ref.videoId, principal);
        return 'mismatch';
      }
      // 换成 Runtime 的租约：恢复用的打开者马上离开，视频由租约保持打开。
      videos.retain(videoId);
      await videos.close(videoId, principal);
      return 'opened';
    },
    async receipt(videoId, commandId) {
      const receipt = await videos.receiptFor(videoId, commandId);
      return receipt ? { transactionId: receipt.transactionId, videoRevision: receipt.videoRevision, refs: receipt.refs ?? {} } : null;
    },
    state(videoId) {
      const video = videos.mirror(videoId)?.video;
      return video ? { revision: video.revision, documents: video.documents } : null;
    },
    async document(videoId, documentId, revision) {
      const content = await videos.document(videoId, documentId, revision);
      return { revision: content.revision, body: content.body };
    },
  };
}

/** 转录落点 `new-video` 要的原视频事实：名字、所在的项目或会话，与素材当前版本的文件。 */
function transcribeSources(videos: VideoService): NonNullable<TranscribeDeps['sources']> {
  return {
    video(videoId) {
      const video = videos.mirror(videoId)?.video;
      const place = videoPlace(videos, videoId);
      if (!video || !place) return null;
      const scope = place.scope as { projectId?: Id; conversationId?: Id };
      if (scope.projectId) return { name: video.name, scope: { projectId: scope.projectId } };
      if (scope.conversationId) return { name: video.name, scope: { conversationId: scope.conversationId } };
      return null;
    },
    async assetFile(videoId, assetId) {
      try {
        const { root, file } = await videos.mediaSource(videoId, assetId);
        return path.resolve(root, file);
      } catch {
        return null;
      }
    },
  };
}

/** 重启后补做应用时打开视频的主体（只在打开的一刻用，随即换成租约）。名字按当前语言。 */
function recoveryPrincipal(): TrustedPrincipal {
  return { connectionId: 'system:jobs-recovery', kind: 'cli', name: RcModels.recoveryPrincipalName().text };
}

/** 固定流程读写视频的能力：写入的行为者是 `system:pipeline`，与转写一样经 Application、受版本校验；智能体启动的流程带任务的保护。 */
function pipelineVideos(videos: VideoService, guard: TaskGuard): PipelineVideos & CaptionVideos & MediaVideos {
  return {
    state(videoId) {
      const video = videos.mirror(videoId)?.video;
      return video ? { revision: video.revision, rootSequenceId: video.rootSequenceId, documents: video.documents } : null;
    },
    rootSequence(videoId) {
      const video = videos.mirror(videoId)?.video;
      return video?.sequences[video.rootSequenceId] ?? null;
    },
    async receipt(videoId, commandId) {
      const receipt = await videos.receiptFor(videoId, commandId);
      return receipt ? { refs: receipt.refs ?? {} } : null;
    },
    async document(videoId, documentId, revision) {
      const content = await videos.document(videoId, documentId, revision);
      return { revision: content.revision, body: content.body };
    },
    asset(videoId, assetId) {
      const asset = videos.mirror(videoId)?.video.assets[assetId];
      const record = asset?.revisions[asset.currentRevision];
      if (!record) return null;
      return {
        contentHash: record.contentHash,
        ...(record.duration ? { duration: record.duration } : {}),
        ...(record.audio ? { sampleRate: record.audio.sampleRate } : {}),
      };
    },
    async apply(videoId, { run, ...request }) {
      const { receipt } = await videos.applyAs({ videoId, ...request }, PIPELINE_ACTOR, {
        ...(run ? { run } : {}),
        ...(await guard(videoId, run)),
      });
      return { refs: receipt.refs, transactionId: receipt.transactionId };
    },
  };
}

/** 流程里的转写：选定 Provider 与模型、提交 `transcribe` Job（提交者是父任务）、等待与取消。 */
function pipelineTranscriber(jobs: JobManager, services: ModelServices): PipelineTranscriber {
  return {
    check: async ({ hint, ...target } = {}) => {
      const selection = await services.selectTranscribe(target);
      if (hint) checkTranscribeOptions(selection, { hint, assertedLanguage: null });
      return { providerId: selection.providerId, modelId: selection.modelId };
    },
    submit: (request, submitter) => jobs.submitTranscribe(request, submitter),
    submitFile: ({ language, ...request }, submitter) =>
      jobs.submitTranscribeWithoutVideo(
        { ...request, ...(language !== undefined ? { language: { mode: 'assert', tag: language } } : {}) },
        submitter,
      ),
    settled: (jobId) => jobs.settled(jobId),
    cancel: (jobId) => jobs.cancel(jobId),
    inspect: (jobId) => jobs.inspect(jobId),
    list: () => jobs.list(),
  };
}

/** 翻译配音启动前要判断的外发：逐句合成，加上缺译文时的翻译。 */
function dubOutbound(params: FrozenDubParams) {
  return [
    {
      capability: 'synthesizeSpeech' as const,
      providerId: params.voice.providerId,
      modelId: params.voice.modelId,
      dataKinds: DUB_DATA_KINDS,
    },
    ...(params.translationId === null
      ? [
          {
            capability: 'generateText' as const,
            providerId: params.translate.provider,
            modelId: params.translate.model,
            dataKinds: TRANSLATE_DATA_KINDS,
          },
        ]
      : []),
  ];
}

/** 配音读写视频：在翻译的基础上，读序列的实例、文稿在时间线上的位置（引擎的文字计划）与素材的源文件。 */
function dubVideos(videos: VideoService, guard: TaskGuard): DubVideos {
  return {
    ...pipelineVideos(videos, guard),
    sequence(videoId, sequenceId) {
      const sequence = videos.mirror(videoId)?.video.sequences[sequenceId];
      return sequence ? { fps: sequence.fps, items: sequence.items } : null;
    },
    async speechOnTimeline(videoId, sequenceId, documentId) {
      const plan = await videos.exportPlan<TextPlanResult>(videoId, {
        kind: 'text',
        sequenceId,
        ranges: [],
        documentIds: [documentId],
        scopeItemIds: [],
      });
      const part = plan.parts[0]?.plans[0];
      if (!part) return { videoRevision: plan.videoRevision, end: 0, words: [] };
      const offset = part.range.startSeconds;
      return {
        videoRevision: plan.videoRevision,
        end: part.range.endSeconds,
        words: part.entries.map((e) => ({ wordId: e.id, itemId: e.scopeItemId ?? null, start: offset + e.start, end: offset + e.end })),
      };
    },
    async assetFile(videoId, assetId) {
      try {
        const { root, file, record } = await videos.mediaSource(videoId, assetId);
        return { file: path.resolve(root, file), revision: record.revision };
      } catch {
        return null;
      }
    },
  };
}
