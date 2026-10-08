import os from 'node:os';
import path from 'node:path';

/**
 * Runtime Home 的布局。一个 Runtime Home 对应一个 Runtime 实例（架构设计 §2.1）。
 *
 * ```text
 * <home>/
 *   runtime.json          发现信息（0600）
 *   runtime.lock          实例锁
 *   store/projects.json   项目登记
 *   store/space.json      Space 的用户标记（收藏、显示名、回收站）与删除的视频
 *   store/space-artifacts.json  Space 的产物记录：产出产物的任务的派生用事实，加上只为产物库清扫保留的产物引用
 *                         与清扫起点，不随 Job Ledger 的修剪丢失
 *   store/conversations/<id>.jsonl  会话：只追加的日志，文件头 + 快照 + item/meta 行，膨胀后压缩（架构设计 §3.10）
 *   store/jobs.jsonl      后台任务账本（转写等）：只追加，每次追加 fsync，膨胀后压缩（架构设计 §7.3）
 *   store/applications.jsonl 应用账本：任务结果应用到视频的记录，格式同上
 *   store/node-share.json 共享这台电脑：开关、节点身份、已配对客户端的令牌哈希（0600）
 *   store/nodes.json      用别的电脑：本机的 clientId 与已配对节点（令牌在凭据存储里）（0600）
 *   store/model-services.json   模型服务配置：各 Provider 的开关与端点、各能力的默认值（0600）
 *   store/model-credentials.json 文件后端的凭据：在线 Provider 的密钥与节点令牌，只放密钥（0600）
 *   store/usage.jsonl     在线调用的用量账本：一行一条，只追加（0600，架构设计 §6.10）
 *   store/settings.json   Runtime 持有的偏好设置：只存与默认值不同的取值（架构设计 §5.10）
 *   store/services.json   对外服务的配置：随 Runtime 启动、端口、访问策略、客户端令牌的哈希（架构设计 §4.8）（0600）
 *   store/agent-probes.json Agent 的探测缓存：每个 Driver 最近一次探测的本机事实，启动时先用它（架构设计 §3.11）
 *   staging/jobs/<id>/    任务进行中的 Worker 输出，结束后删除
 *   staging/node-jobs/<id>/ 别的机器提交的远端任务：上传的媒体与结果，随任务删除
 *   artifacts/<sha256>.<扩展名>  内容寻址的产物库：转写结果、合成的音频与图片、导出的文件等，`artifactId` 去掉
 *                         `sha256:` 就是文件名。Runtime 在后台清扫：账本与 Space 产物记录都没有引用、修改时间超过 1 小时
 *                         且不早于清扫起点的删掉，残留的 `.tmp` 超过 1 小时删掉（架构设计 §7.3）
 *   models/<org>/<repo>/  本地模型文件的缺省位置（设置 `models.dir` 可以改，`BAOCUT_MODELS_DIR` 优先）
 *   scratch/<id>/         无项目会话的工作目录；第一次新建视频时搬进新建的项目（架构设计 §3.10）
 *   cache/                派生缓存，总大小有上限（设置 `cache.maxSizeMiB`，默认 2048 MiB）：超过时按修改时间删最旧的，
 *                         降到上限的 90%；`content-index/` 与 `baocut-composition-host/` 不删（`cache-limit.ts`）
 *   cache/media/<摘要>/    素材的分析结果（波形峰值、缩略图、帧），按内容摘要存，删掉会重新生成；`cache/media/playback/`
 *                         是播放用的转码，`cache/media/files/` 是文件的帧
 *   cache/content-index/index.db 跨视频检索的内容索引：SQLite + FTS5（架构设计 §5.11），删掉会重新读；运行中不删
 *   cache/baocut-composition-host/ 代码画面宿主的脚本
 *   library/<glossaries|voices|brand>/<id>/ 用户库的条目（架构设计 §5.9）：条目头、各版本的内容与按摘要命名的文件
 *   logs/runtime.log
 * ```
 *
 * 「新建项目」的目录不在 Home 里，而在 `projectsDir`：默认 `~/BaoCut`，
 * 指定了 `BAOCUT_HOME`（开发、测试）时跟着放到 `<home>/projects`，`BAOCUT_PROJECTS_DIR` 可以覆盖。
 */
export interface RuntimeHome {
  root: string;
  discoveryFile: string;
  lockFile: string;
  projectsFile: string;
  spaceFile: string;
  /** Space 的产物记录（架构设计 §5.7）。 */
  spaceArtifactsFile: string;
  conversationsDir: string;
  scratchDir: string;
  cacheDir: string;
  logsDir: string;
  projectsDir: string;
  jobsFile: string;
  nodeShareFile: string;
  /** 发起端：已配对的节点；令牌在凭据存储里（节点协议规范 §11）。 */
  nodesFile: string;
  /** 模型服务配置（架构设计 §6.8）。 */
  modelServicesFile: string;
  /** 文件后端的凭据（Provider 密钥与节点令牌），与其余配置分开存放；钥匙串后端只在迁移时读它（架构设计 §6.8）。 */
  modelCredentialsFile: string;
  /** 偏好设置（架构设计 §5.10）。 */
  settingsFile: string;
  /** 对外服务的配置（架构设计 §4.8）。 */
  servicesFile: string;
  /** 数据外发的授权与预算账本（架构设计 §12.5、§7.8）。 */
  grantsFile: string;
  /** 在线调用的用量账本（架构设计 §6.10）。 */
  usageFile: string;
  /** Agent 偏好：各家 Driver 的默认模型、放行策略与「总是允许」规则（默认 Driver 与模式在设置里）。 */
  agentPrefsFile: string;
  /** Agent 的探测缓存：每个 Driver 最近一次探测的本机事实（架构设计 §3.11）。删掉只是下次启动要从头探测。 */
  agentProbesFile: string;
  /** 用户添加的 ACP 智能体（`agents.addProvider`，架构设计 §3.11）。`env` 可能含密钥，文件只给所有者读写。 */
  agentProvidersFile: string;
  /** Agent skill 的开关：只存与来源默认值不同的差量（架构设计 §3.8）。 */
  skillPrefsFile: string;
  /** 用户添加与导入的 Agent skill，一个子目录一个（架构设计 §3.8、§12.9）。 */
  skillsDir: string;
  /** 消息附件（图片）的字节，按附件 id 分目录。 */
  attachmentsDir: string;
  stagingDir: string;
  nodeJobsDir: string;
  artifactsDir: string;
  modelsDir: string;
  /** 用户库（架构设计 §5.9）。不是 Space 的来源目录。 */
  libraryDir: string;
}

export function resolveRuntimeHome(env: NodeJS.ProcessEnv = process.env): RuntimeHome {
  const root = path.resolve(env.BAOCUT_HOME || path.join(os.homedir(), '.baocut'));
  const projectsDir = env.BAOCUT_PROJECTS_DIR
    ? path.resolve(env.BAOCUT_PROJECTS_DIR)
    : env.BAOCUT_HOME
      ? path.join(root, 'projects')
      : path.join(os.homedir(), 'BaoCut');
  return {
    root,
    discoveryFile: path.join(root, 'runtime.json'),
    lockFile: path.join(root, 'runtime.lock'),
    projectsFile: path.join(root, 'store', 'projects.json'),
    spaceFile: path.join(root, 'store', 'space.json'),
    spaceArtifactsFile: path.join(root, 'store', 'space-artifacts.json'),
    conversationsDir: path.join(root, 'store', 'conversations'),
    scratchDir: path.join(root, 'scratch'),
    cacheDir: path.join(root, 'cache'),
    logsDir: path.join(root, 'logs'),
    projectsDir,
    jobsFile: path.join(root, 'store', 'jobs.jsonl'),
    nodeShareFile: path.join(root, 'store', 'node-share.json'),
    nodesFile: path.join(root, 'store', 'nodes.json'),
    modelServicesFile: path.join(root, 'store', 'model-services.json'),
    modelCredentialsFile: path.join(root, 'store', 'model-credentials.json'),
    settingsFile: path.join(root, 'store', 'settings.json'),
    servicesFile: path.join(root, 'store', 'services.json'),
    grantsFile: path.join(root, 'store', 'grants.json'),
    usageFile: path.join(root, 'store', 'usage.jsonl'),
    agentPrefsFile: path.join(root, 'store', 'agent-prefs.json'),
    agentProbesFile: path.join(root, 'store', 'agent-probes.json'),
    agentProvidersFile: path.join(root, 'store', 'agent-providers.json'),
    skillPrefsFile: path.join(root, 'store', 'skill-prefs.json'),
    skillsDir: path.join(root, 'skills'),
    attachmentsDir: path.join(root, 'attachments'),
    stagingDir: path.join(root, 'staging'),
    nodeJobsDir: path.join(root, 'staging', 'node-jobs'),
    artifactsDir: path.join(root, 'artifacts'),
    modelsDir: env.BAOCUT_MODELS_DIR ? path.resolve(env.BAOCUT_MODELS_DIR) : path.join(root, 'models'),
    libraryDir: path.join(root, 'library'),
  };
}
