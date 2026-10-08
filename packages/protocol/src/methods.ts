import type { AgentMode, PendingApproval, PendingApprovalDecision } from './access.ts';
import type {
  AgentPolicy,
  AgentPreferences,
  AgentSetupAction,
  AgentSetupRun,
  ApprovalDecision,
  AttachmentRef,
  Autonomy,
  Conversation,
  DriverId,
  DriverInfo,
  DriverInstallOption,
  EditorContext,
  Id,
  Project,
  RuntimeInfo,
  RuntimeStatus,
  SpaceEntry,
  SpaceEntryKind,
  TaskStatus,
} from './domain.ts';
import type { ConversationSnapshot, DirectorySnapshot, SequencedEvent, Topic } from './events.ts';
import type { ExportCreateRequest, ExportRenderTextRequest, ExportRenderTextResult } from './exports.ts';
import type {
  GenerateImageRequest,
  GenerateTextRequest,
  JobReconcileDecision,
  JobRecord,
  JobState,
  SynthesizeSpeechRequest,
  TranscribeRequest,
} from './jobs.ts';
import type { ApprovalGrantChoice, Grant, GrantCreateParams, GrantRevokeResult, GrantUpdateParams, GrantUsageReport } from './grants.ts';
import type { ApplySpeakersParams, PipelineInfo } from './pipelines.ts';
import type {
  CheckDefinition,
  CheckOutcome,
  CheckResult,
  TaskContract,
  TaskContractInput,
  TaskContractPatch,
  TaskContractView,
} from './tasks.ts';
import type { ResourcesSnapshot } from './resources.ts';
import type { CookieBrowserInfo, ExternalToolInstallResult, ExternalToolStatus, ExternalToolUpdateResult } from './external-tools.ts';
import type {
  DownloadedFontFace,
  FontDownloadErrorCode,
  FontDownloadResult,
  FontFaceStyle,
  FontRemoveResult,
  FontSampleResult,
  FontsCatalogueParams,
  FontsCatalogueResult,
  FontsUsageResult,
} from './fonts.ts';
import type { ToolCandidatesParams, ToolCandidatesResult, ToolsListResult } from './tool-catalogue.ts';
import type { CatalogAgentSkill, CatalogCallParams, CatalogCallResult, CatalogListResult } from './catalog.ts';
import type { UsageReport, UsageRequest } from './usage.ts';
import type {
  AddProviderAccountRequest,
  ArrangeProviderAccountsRequest,
  ConfigureProviderRequest,
  UpdateProviderAccountRequest,
  ModelBundleStatus,
  ModelCapabilitiesView,
  ModelInstallResult,
  ModelRemoveResult,
  ModelRef,
  ModelsDirChangeResult,
  ModelsDirInfo,
  ModelsDirInspection,
  ModelsDirMode,
  ModelServiceCapability,
  ProviderRefreshStatus,
  ProviderView,
  SetCapabilityParametersRequest,
  TextCapabilityParameters,
} from './models.ts';
import type {
  LibraryApplyParams,
  LibraryApplyResult,
  LibraryEntry,
  LibraryEntryRef,
  LibraryEntrySummary,
  LibraryExportResult,
  LibraryName,
  LibraryPutParams,
  LibrarySetSelectionParams,
  LibrarySetSelectionResult,
  VideoLibrarySelection,
  VoiceCloneCreateParams,
  VoiceCloneRemoveParams,
  VoiceCloneRemoveResult,
} from './library.ts';
import type { DiscoveredNode, PairedNode, ShareStartParams, ShareStatus } from './nodes.ts';
import type {
  CompositionImportParams,
  CompositionImportResult,
  CompositionPreviewParams,
  CompositionPreviewResult,
} from './code-bundle.ts';
import type { TemplateDetail, TemplateListResult, TemplateSendRef } from './template.ts';
import type { SkillChangeResult, SkillDetail, SkillFileContent, SkillListResult, SkillRemoveResult, SkillSendRef } from './skill.ts';
import type {
  SpaceContinueResult,
  SpaceListParams,
  SpaceListResult,
  SpaceOpenForEditResult,
  SpacePurgeResult,
  SpaceRebuildResult,
  SpaceSearchParams,
  SpaceSearchResult,
  SpaceThumbnail,
  VideoDeleteResult,
  VideoRestoreResult,
} from './space.ts';
import type { SettingInputValues, SettingKey, SettingsSnapshot, SettingsView } from './settings.ts';
import type {
  McpConnectionInfo,
  ModelApiAlias,
  ModelApiConnectionInfo,
  ServiceApprovalDecision,
  ServiceClient,
  ServiceConfigureParams,
  ServiceId,
  ServiceStatus,
} from './services.ts';
import type { WebAccessLink, WebSession } from './web.ts';
import type { Seq } from './domain.ts';
import type { PlaybackCodec } from './limits.ts';
import type {
  DocumentContent,
  EditOperation,
  HistoryEntry,
  MissingAsset,
  VideoRef,
  VideoTopicSnapshot,
  Rate,
  Revision,
  TransactionReceipt,
  UndoState,
  UndoTarget,
} from './video.ts';

/**
 * 公共方法表（架构设计 §4.1）。界面、CLI 与外部智能体发同一组请求。
 *
 * 规则：
 * - 公共请求不携带 `actor` 或任何信任标记；身份由 Runtime 从已认证的连接构造（§4.2）。
 * - 会产生副作用的命令带 `commandId`，同一个 key 重试返回同一份结果。
 */
export interface RpcMethods {
  'runtime.info': { params: Record<string, never>; result: RuntimeInfo };
  /** 连接、任务与空闲退出（架构设计 §2.2）：只给 `cli` 与 `desktop` 连接，其余 `forbidden`。 */
  'runtime.status': { params: Record<string, never>; result: RuntimeStatus };
  /**
   * 请 CLI 拉起的 Runtime 停下（`baocut runtime stop`，架构设计 §2.2）：只给 `cli` 连接；不是 CLI 拉起的 `forbidden`
   * （`details.code: 'RUNTIME_NOT_OWNED'`），有桌面端连着时 `conflict`（`RUNTIME_IN_USE`）。响应先回，随后按停止顺序收尾。
   */
  'runtime.stop': { params: Record<string, never>; result: { stopping: true } };

  /** Agent 列表与偏好（设置 › Agent 提供方）。探测结果短时缓存。 */
  'agents.list': { params: Record<string, never>; result: AgentsView };
  /** 「重新检测」：不用缓存，重新探测安装、版本、登录，并刷新模型表。 */
  'agents.detect': { params: { driverId?: DriverId }; result: AgentsView };
  /** 启用或停用一个 Agent，设它的默认模型与强度，或手动指定可执行文件（null 取消指定）。 */
  'agents.configure': {
    params: {
      driverId: DriverId;
      enabled?: boolean;
      defaultModel?: string | null;
      defaultEffort?: string | null;
      executable?: string | null;
    };
    result: AgentsView;
  };
  /** 新会话默认用哪个 Agent：写偏好设置 `agent.defaultDriver`（架构设计 §3.11、§5.10）。 */
  'agents.setDefault': { params: { driverId: DriverId }; result: AgentsView };
  /**
   * 添加一个说 ACP 的智能体（架构设计 §3.11）：存进 `store/agent-providers.json`，立即注册成 Driver 并在后台探测。
   * `id` 不得与内置的或已添加的重名（重名 `conflict`，`details.code: 'AGENT_PROVIDER_EXISTS'`）；同一个 `commandId` 重试返回同一结果。
   * 浏览器与对外服务不能调用：它决定这台机器上运行什么命令。
   */
  'agents.addProvider': {
    params: { id: DriverId; name: string; command: string[]; env?: Record<string, string>; commandId?: Id };
    result: AgentsView;
  };
  /**
   * 移除一个用户添加的智能体：注销 Driver，一并删掉它的探测缓存、Agent 偏好里它的条目；偏好设置 `agent.defaultDriver` 指向它时清空。
   * 正在用它的任务以失败结束，之后这些会话发送时以 `driver-unavailable` 拒绝。内置的不能移除（`invalid-request`，
   * `details.code: 'AGENT_PROVIDER_BUILTIN'`，用 `agents.configure` 停用）；没有这个 id 为 `not-found`。
   */
  'agents.removeProvider': { params: { id: DriverId }; result: AgentsView };
  /** 放行策略、模型表自动更新这类偏好。 */
  'agents.updatePreferences': {
    params: { policy?: Partial<AgentPolicy>; modelAutoUpdate?: boolean };
    result: AgentsView;
  };
  /** 移除一条「总是允许」规则。不存在时原样返回。 */
  'agents.removeRule': { params: { rule: string }; result: AgentsView };
  /** 处理会话里的一条审批（与 `approvals.respond` 是同一个实现）。`accept-for-session` 在这个任务里不再问同一种动作，`accept-always` 另存一条规则。 */
  'agents.respondToApproval': {
    params: { conversationId: Id; approvalId: Id; decision: ApprovalDecision };
    result: { status: 'accepted' | 'declined' | 'already-resolved' };
  };
  /** 次级操作：只停当前模型回合（D04），待处理的审批按取消处理。主停止按钮走 `tasks.stop`。 */
  'agents.interrupt': {
    params: { conversationId: Id };
    result: { status: 'requested' | 'no-active-turn' };
  };
  /**
   * 在应用内运行一个 Agent 的安装或升级命令（架构设计 §12.9）。调用方先让用户确认将要执行的完整命令。
   *
   * - 参数里没有命令：Runtime 从当前探测结果里按 `kind` 取 `install[].command`（安装）或 `upgrade`（升级）；
   *   没有这种方式时 `invalid-request`。`script` 类（从网络下载并运行脚本）一律 `invalid-request`，只能复制或 `agents.openTerminal`。
   * - 不提权、不读输入：stdin 关闭，要密码的命令会直接失败，界面提示改在终端里运行。
   * - 同一个 Agent 已经有一次在运行时 `busy`；同一个 `commandId` 重试返回同一次运行。
   * - 输出与状态经 `agent-setup` 主题送达；结束后 Runtime 重新探测这个 Agent，再送出终态。
   */
  'agents.runSetup': {
    params: { driverId: DriverId; action: AgentSetupAction; kind: DriverInstallOption['kind']; commandId: Id };
    result: { run: AgentSetupRun };
  };
  /** 停止一次还在运行的 `agents.runSetup`。已经做了的部分不回退。不认识的 `runId` 为 `not-found`。 */
  'agents.cancelSetup': {
    params: { runId: Id };
    result: { status: 'requested' | 'not-running' };
  };
  /**
   * 打开系统终端，在里面运行登录、安装或升级命令（架构设计 §12.9：要密码、要管理员权限的交给系统终端）。
   * 命令同样从探测结果里取：`login` 用 `loginCommand`，`install` / `upgrade` 必须给 `kind`（`script` 类也可以）。
   * 找不到对应的命令时 `invalid-request`。这个平台上打不开终端时返回 `unsupported`，调用方退回复制 `command`。
   * Runtime 只负责打开终端，不知道命令在终端里的结果；之后由界面「重新检测」。
   */
  'agents.openTerminal': {
    params: { driverId: DriverId; action: 'login' | AgentSetupAction; kind?: DriverInstallOption['kind'] };
    result: { status: 'opened' | 'unsupported'; command: string };
  };

  'projects.list': { params: Record<string, never>; result: { projects: Project[] } };
  /**
   * 把一个已有目录登记为项目（架构设计 §5.1）。项目的标识在目录里的 `.bcut/project.json`，没有时写入：
   * 同一个目录重复打开、移动或改名之后打开，都返回同一个项目；复制出来的目录得到新的项目。
   * 目录不可写而需要写入标记时以 `forbidden` 拒绝（`details.code: 'PROJECT_DIR_READ_ONLY'`）；
   * 标记的版本比这个 Runtime 新时以 `conflict` 拒绝（`details.code: 'PROJECT_MARKER_UNSUPPORTED'`），不改写它。
   */
  'projects.open': { params: { path: string }; result: { project: Project } };
  /** 在 `RuntimeInfo.projectsDir` 下新建一个目录、写入项目标记并登记为项目；重名自动加序号。 */
  'projects.create': { params: { name?: string; commandId?: Id }; result: { project: Project } };
  /** 改显示名、置顶、归档。只改登记，不动目录。 */
  'projects.update': {
    params: { projectId: Id; name?: string; pinned?: boolean; archived?: boolean };
    result: { project: Project };
  };
  /**
   * 列出会话所在目录（属于项目时是项目目录，否则是会话的工作目录）里的文件（架构设计 §11.2）。
   * 不给 `query` 时列 `dir`（相对根目录，默认根目录）这一层；给了就在 `dir` 下按名字递归查找。
   * 跳过隐藏文件与依赖目录；指出根目录的符号链接不列。读文件内容走 `media.resolve` 的 `{ conversationId, path }`。
   */
  'projects.files.list': {
    params: { conversationId: Id; dir?: string; query?: string; limit?: number };
    result: ProjectFilesList;
  };
  /**
   * 在同一个根目录（项目目录，或不属于项目的会话的工作目录；给 `projectId` 时是项目目录）里新建一个文件并写入 UTF-8 文本
   * （新标签页起始页的「新建网页」，产品设计 §3.3）。`dir` 相对根目录、默认根目录，解析符号链接后仍须在根目录内，
   * 不能是隐藏目录、依赖目录或视频目录（及其里面）；`name` 只取最后一段，拒绝空名、`.`、`..` 与以 `.` 开头的名字。
   * 独占创建，不覆盖：重名时依次试 `名字 2.扩展名`、`名字 3.扩展名`……。返回新文件的定位与条目：属于项目时是
   * `{ projectId, path }`，否则是 `{ conversationId, path }`。
   */
  'projects.files.create': {
    params: ({ conversationId: Id } | { projectId: Id }) & { name: string; content: string; dir?: string };
    result: { target: FileTarget; entry: ProjectFileEntry };
  };

  'conversations.list': { params: Record<string, never>; result: DirectorySnapshot };
  /**
   * 新建会话。没给的 Agent、模型、强度取偏好里的默认（`agent.defaultDriver`、那个 Agent 的默认模型与强度），
   * 建好之后固定在会话上，改偏好不影响已有会话（架构设计 §3.11）。`accessMode` 没给（或 null）时会话跟随
   * `agent.defaultAccessMode`（§3.12），给了等于建好后切换一次（接受旧值）。
   */
  'conversations.create': {
    params: {
      projectId?: Id | null;
      title?: string;
      commandId?: Id;
      driverId?: DriverId;
      model?: string | null;
      effort?: string | null;
      accessMode?: AgentMode | Autonomy | null;
    };
    result: { conversation: Conversation };
  };
  'conversations.get': {
    params: { conversationId: Id };
    result: ConversationSnapshot & { seq: Seq };
  };
  /**
   * 改标题、置顶、归档、Agent、模型、强度、访问模式。归档只影响列表显示，不取消任务（产品设计 §2.3）。
   * 模型、强度随时可改，下一轮生效。Agent 只能在会话还没有任务时换，之后换会得到 `conflict`。
   * `accessMode` 切换会话的模式（架构设计 §3.12）：对之后的动作立即生效（任务进行中也是），在会话里记一条提示；
   * 接受旧值（`controlled`、`authorized`），`null` 表示回到跟随 `agent.defaultAccessMode`。`pendingReferences: null` 去掉还没发出的
   * Space 条目引用（`space.continueInConversation`）。
   */
  'conversations.update': {
    params: {
      conversationId: Id;
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      driverId?: DriverId;
      model?: string | null;
      effort?: string | null;
      accessMode?: AgentMode | Autonomy | null;
      pendingReferences?: null;
    };
    result: { conversation: Conversation };
  };
  /** 用户看过了：清掉「已完成未读」。 */
  'conversations.markRead': { params: { conversationId: Id }; result: { conversation: Conversation } };
  /** 只删除 Runtime Store 里的会话记录，不删项目目录里的任何文件（架构设计 §3.10）。 */
  'conversations.delete': { params: { conversationId: Id }; result: { deleted: true } };
  /**
   * 发送一条用户消息，建立任务并启动一个回合。`context`：编辑器里打开的视频与选区，交给智能体作为上下文。
   * `accessMode`（旧名 `autonomy`，两个都给时以 `accessMode` 为准）与会话当前的模式不同时，等于先切换会话的模式（§3.12）；
   * 都不给时用会话的模式，会话没有切换过时用 `agent.defaultAccessMode`。
   * `attachments`：`attachments.prepare` 拿到、已经上传完的图片。会话还有任务在跑时得到 `busy`
   * （界面把消息排进队列，等任务结束再发，或用 `conversations.steer` 插进当前回合）。
   * 任务合同（架构设计 §3.2）随任务建立：`contract` 给出的部分照用，其余按默认（范围来自 `context`、`autonomy` 是此刻的模式）。
   * `template`：挂上的场景模板（模板包规范 §5.2）。Runtime 读目录里当前的模板，把简报引导前言、`prompt.md` 正文与素材清单
   * 附在交给智能体的文字后面；会话里的消息仍是 `text`，另带一个模板标记。没有这个模板时 `not-found`（`TEMPLATE_NOT_FOUND`）；
   * 作品示例（`kind: 'example'`）的正文本来就是用户输入，`invalid-request`（`TEMPLATE_NOT_SCENE`）；`assets` 里有清单没登记的路径时
   * `invalid-request`（`TEMPLATE_FILE_NOT_FOUND`）。
   * `skill`：点选的 skill（架构设计 §3.8），开着的、关着的都可以。Runtime 读目录里当前的 `SKILL.md`，把正文与「同目录还有哪些文件、
   * 用 `skills_read` 取」附在交给智能体的文字后面（在模板段之后）；消息上另带一个 skill 标记。没有这个 skill 时 `not-found`（`SKILL_NOT_FOUND`）。
   */
  'conversations.send': {
    params: {
      conversationId: Id;
      text: string;
      commandId: Id;
      accessMode?: AgentMode | Autonomy;
      autonomy?: AgentMode | Autonomy;
      context?: EditorContext;
      attachments?: Id[];
      contract?: TaskContractInput;
      template?: TemplateSendRef;
      skill?: SkillSendRef;
    };
    result: { taskId: Id };
  };
  /**
   * 把一条消息插进正在运行的回合（Agent 支持时）。不支持或没有运行中的回合时如实返回，由界面决定排队还是先停再发。
   */
  'conversations.steer': {
    params: { conversationId: Id; text: string; commandId: Id; attachments?: Id[] };
    result: { status: 'steered' | 'unsupported' | 'no-active-turn' };
  };

  /**
   * 登记要随消息发送的图片或普通文件，拿到一次性的上传地址（媒体通道同一端口，`PUT` 原始字节，Content-Type 与声明一致）。
   * 大小、格式按 `MAX_ATTACHMENT_BYTES` 与 `ATTACHMENT_UPLOAD_MIME_TYPES` 检查；上传完成前发送会得到 `invalid-params`。
   * 地址一段时间不用就失效。
   */
  'attachments.prepare': {
    params: { fileName: string; mimeType: string; size: number };
    result: { attachment: AttachmentRef; uploadUrl: string };
  };

  /** 主停止（D04）：先禁止新的调用与自动批准，待处理的审批按取消处理，再请求中断回合。 */
  'tasks.stop': { params: { taskId: Id }; result: { status: TaskStatus } };
  /**
   * 以显式的合同建立任务并开始（与带 `contract` 的 `conversations.send` 是同一个实现，`goal` 是发给智能体的消息）。
   * 会话还有任务在运行时 `busy`。
   */
  'tasks.create': {
    params: {
      conversationId: Id;
      goal: string;
      commandId: Id;
      accessMode?: AgentMode;
      context?: EditorContext;
      contract?: TaskContractInput;
    };
    result: { taskId: Id; contract: TaskContract };
  };
  /** 一个任务的合同：默认是最新修订，给 `revision` 时是那个修订；连同任务预算的用量。 */
  'tasks.getContract': { params: { taskId: Id; revision?: number }; result: TaskContractView };
  /** 给 `conversationId`：这个会话每个任务的最新合同，新的在前；给 `taskId`：这个任务的全部修订，旧的在前。 */
  'tasks.listContracts': { params: { conversationId: Id } | { taskId: Id }; result: { contracts: TaskContract[] } };
  /**
   * 修改进行中任务的合同，产生新的修订。`expectedRevision` 不是最新修订时 `conflict`（`CONTRACT_REVISION_CONFLICT`）；
   * 任务已经结束时 `conflict`（`TASK_NOT_RUNNING`）。尚未启动的步骤采用新约束，已经冻结输入的 Job 不变。
   * `autonomy` 等于切换会话的访问模式（§3.12）。同一个 `commandId` 只生效一次。
   */
  'tasks.updateContract': {
    params: { taskId: Id; expectedRevision: number; commandId: Id; patch: TaskContractPatch };
    result: { contract: TaskContract };
  };
  /**
   * 改变目标（§3.2）：`previousWork: 'stop'` 停止旧任务并取消它提交、还没结束的 Job；`keep` 只停下旧任务的回合，已经提交的
   * Job 照常完成、产物留作候选。之后以新目标建立新任务（新的 Run），合同由旧合同派生（`supersedes`），预算上限照搬、用量从零计。
   */
  'tasks.changeGoal': {
    params: { taskId: Id; goal: string; previousWork: 'stop' | 'keep'; commandId: Id };
    result: { taskId: Id; previousTaskId: Id; contract: TaskContract };
  };
  /** 记录一项验收检查的结果（首版由用户或智能体记录；QualityService 的自动执行待定，架构设计 §14）。任务结束后也可以记录。 */
  'tasks.recordCheck': {
    params: { taskId: Id; checkId: Id; outcome: CheckOutcome; note?: string; commandId?: Id };
    result: { result: CheckResult };
  };
  /** 一个任务的验收检查（最新合同里的）与记录过的结果，旧的在前。 */
  'tasks.listChecks': { params: { taskId: Id }; result: { checks: CheckDefinition[]; results: CheckResult[] } };

  /** 待处理的审批（架构设计 §3.12）：会话的与对外服务的，旧的在前。与 `tasks` 主题快照里的 `approvals` 相同。 */
  'approvals.list': { params: Record<string, never>; result: { approvals: PendingApproval[] } };
  /**
   * 处理一条待处理的审批，会话的或对外服务的都行（与 `agents.respondToApproval`、`services.respondToApproval` 是同一个实现）。
   * 已经处理过、超时或取消的返回 `already-resolved`；不存在的也是（审批结束后不留在列表里）。
   * 带外发授权的审批（`grants`）允许时可以给 `grant`：不给或 `persist: false` 只放行这一次（金额未知）；
   * `persist: true` 同时发放持续授权（架构设计 §12.5），发放的授权经 `grants` 主题送达。审批不带 `grants` 时给 `grant` 是
   * `invalid-request`。
   */
  'approvals.respond': {
    params: { approvalId: Id; decision: PendingApprovalDecision; grant?: ApprovalGrantChoice };
    result: { status: 'allowed' | 'denied' | 'already-resolved' };
  };

  /**
   * 数据外发的授权（架构设计 §12.5）。变化经 `grants` 主题送达。浏览器（Web 服务）调不了 `grants.*`：发放与撤销授权
   * 只在桌面界面与 CLI 里做。
   * `grants.list` 默认只列有效的；`includeEnded: true` 时连撤销、到期、用完的一起列。
   */
  'grants.list': { params: { recipient?: string; videoId?: Id; includeEnded?: boolean }; result: { grants: Grant[] } };
  /** 发放一条持续授权。`free-local` 不能发放（本机计算不需要授权）；`estimate-cap` 要给 `budgetCap`。 */
  'grants.create': { params: GrantCreateParams; result: { grant: Grant } };
  /** 改一条授权（收紧或调整预算）。收紧时 `generation` 加一；已撤销的 `conflict`。 */
  'grants.update': { params: GrantUpdateParams; result: { grant: Grant } };
  /** 撤销：禁止新的调用，排队中的调用开始时被拒绝（`GRANT_REVOKED`）；已经外发与计费的部分如实报告。重复撤销返回同样的结果。 */
  'grants.revoke': { params: { grantId: Id }; result: GrantRevokeResult };
  /** 一条授权的用量：已用次数与金额、预留中的，以及用过它的任务。 */
  'grants.usage': { params: { grantId: Id }; result: GrantUsageReport };

  /** Space 的用户标记（架构设计 §5.7）：收藏、显示名、回收站。只写标记，不碰文件。 */
  'space.update': {
    params: { entryId: Id; favorite?: boolean; displayName?: string | null; trashed?: boolean };
    result: { entry: SpaceEntry };
  };
  /** 立即重扫所有来源目录。 */
  'space.rescan': { params: Record<string, never>; result: { ok: true } };
  /** Space 目录的查询（架构设计 §5.7）：按项目、种类、状态、来源视频筛选，分页。按调用方的范围过滤。 */
  'space.list': { params: SpaceListParams; result: SpaceListResult };
  'space.get': { params: { entryId: Id }; result: { entry: SpaceEntry } };
  /** 跨视频的内容检索（架构设计 §5.11）：查派生的内容索引，不打开视频。 */
  'space.search': { params: SpaceSearchParams; result: SpaceSearchResult };
  /** 把一个文件登记为项目的素材，不放进任何视频。项目之外的文件先复制进项目的 `imports/`。 */
  'space.import': { params: { projectId: Id; path: string; name?: string }; result: { entry: SpaceEntry; copied: boolean } };
  /** 显示名；`null` 恢复文件名。等同于 `space.update` 的 `displayName`。 */
  'space.rename': { params: { entryId: Id; name: string | null }; result: { entry: SpaceEntry } };
  'space.setFavorite': { params: { entryId: Id; favorite: boolean }; result: { entry: SpaceEntry } };
  /** 移入回收站：只写 `user.trashedAt`。 */
  'space.trash': { params: { entryId: Id }; result: { entry: SpaceEntry } };
  'space.restore': { params: { entryId: Id }; result: { entry: SpaceEntry } };
  /**
   * 物理删除（§5.5 的引用图）：只删回收站里的条目（失败的占位例外，清除即可）；仍被引用时不删，返回阻止删除的引用。
   * 删除了的视频（`videos.delete`）在这里物理删除；还在来源目录里的视频条目拒绝。
   */
  'space.purge': { params: { entryId: Id }; result: SpacePurgeResult };
  'space.openForEdit': { params: { entryId: Id }; result: SpaceOpenForEditResult };
  /**
   * 条目的缩略图（产品设计 §4.2–§4.3，网格的卡片与列表的名称列）：画面、正文摘要或没有（`SpaceThumbnail`）。视频的封面取自
   * 当前工作稿，不要求视频已经打开。解不了、读不了的文件回答 `none`，不报错；条目不存在或看不到是 `not-found`。
   */
  'space.thumbnail': { params: { entryId: Id }; result: SpaceThumbnail };
  /**
   * 从条目继续一段会话（§5.7）：属于项目的条目在项目里新建会话，不属于项目的回到条目原来的会话（没有时新建）；
   * 给了 `conversationId` 时用它，它要看得到这个条目。只建会话、附上条目的引用，不启动任务。
   */
  'space.continueInConversation': {
    params: { entryId: Id; conversationId?: Id; commandId?: Id };
    result: SpaceContinueResult;
  };
  /** 丢掉派生的目录与内容索引，从权威来源重建；用户标记不受影响。 */
  'space.rebuildIndex': { params: Record<string, never>; result: SpaceRebuildResult };

  /**
   * 取得一个文件的媒体地址（架构设计 §4.5、§5.6）：受限句柄，限定到这个文件，有期限。
   * 文件来自 Space 条目，或会话工作目录、项目目录里的路径（例如智能体改过的文件）。
   */
  'media.resolve': { params: MediaTarget; result: MediaHandle };
  /**
   * 已签发的文件句柄的播放地址（架构设计 §4.5）：WebM 的编码都在 `playable` 里时直接给原句柄，否则准备兼容副本并轮询；
   * 原始字节始终经 media.resolve。
   */
  'media.playback': { params: { url: string; playable?: PlaybackCodec[] }; result: MediaPlayback };
  /** 与一个视频放在同一目录里的字幕文件（播放器叠加用）。只列出，不读内容。 */
  'media.subtitles': { params: FileTarget; result: { tracks: SubtitleTrack[] } };
  /**
   * 素材声音的峰值（时间线画波形），按素材版本的内容摘要缓存在 Runtime Home 里。只分析音视频素材。
   * 第一次要解码整段声音：没做完时回 `pending`，隔 `retryAfterMs` 再问同一个请求。
   */
  'media.peaks': { params: AssetTarget; result: MediaPeaks };
  /** 视频素材在源时间 `at`（秒）的一帧，缩成小 JPEG（时间线的胶片条）。时间按 0.1 秒取整后缓存。 */
  'media.thumbnail': { params: AssetTarget & { at: number }; result: MediaThumbnail };
  /**
   * 本机字体（架构设计 §9.1）：按「族名、字重、斜体」在本机字体里挑一个 face（与排版引擎同一套匹配），给出它所在文件的
   * 受限读取句柄（同 `media.resolve`）与把它抽成单独字体的做法：编辑器预览按区间只取这一个 face 的表，拼好注入渲染器
   * （字体集合不整个下载）。与成片导出冻结的是同一份解析与抽法。只按给的 face 找，不列字体目录；抽出来的 face 上限 96 MB。
   * 本机没有的族再到下载缓存里找（`source: 'downloaded'`）。`download: true` 时，字体目录里有、这个字重还没下载的 face
   * 按设置 `fonts.autoDownload` 开始下载（不是严格离线、最近没失败过），记为 `missing` 的 `downloading`（带 `jobId`），
   * 下载完再问一次就有；这期间照回退字体画。一次最多 32 个。只开给桌面与 CLI，浏览器不开放。
   */
  'fonts.resolve': { params: { faces: FontFaceQuery[]; download?: boolean }; result: FontsResolveResult };
  /**
   * 选字列表（架构设计 §9.1）：字体目录里的族、随内核发布的族与本机已装的族合在一起，每个族带此刻的状态（随内核、本机、
   * 已下载、可下载、下载中与进度、失败与原因）、分类、文字、字重与许可。按族名、分类、文字与状态筛，分页；随内核的在前，
   * 其次已下载的，然后按目录的热门程度（本机装了的目录字体也在这里），目录里没有的本机字体最后（按族名）。`families`
   * 给了时只查这几个族（不分页）。不联网。
   */
  'fonts.catalogue': { params: FontsCatalogueParams; result: FontsCatalogueResult };
  /**
   * 下载一个族（字体目录里的）：`faces` 不给时下载正体的常规与粗体（按目录对到这个族实际有的字重），给了时按给的字重与斜体
   * 对好再下载。提交下载任务（`kind: 'fontDownload'`），立即返回；已经下载好的 face 不再下载，已经在下载的返回那个任务。
   * 失败之后再调一次就是重试；取消用 `jobs.cancel`。不在目录里时 `not-found`（`FONT_NOT_IN_CATALOGUE`）；随内核或本机已有
   * 的族 `conflict`（`FONT_NOT_DOWNLOADABLE`）；严格离线时 `conflict`（`OFFLINE_STRICT`）。
   */
  'fonts.download': { params: { family: string; faces?: FontFaceStyle[]; commandId?: Id }; result: FontDownloadResult };
  /** 下载缓存里的 face 与总大小；`inUse` 是还没结束的导出用着的族（删不掉，`FONT_IN_USE`）。 */
  'fonts.downloaded': { params: Record<string, never>; result: { faces: DownloadedFontFace[]; totalBytes: number; inUse: string[] } };
  /**
   * 删除一个族下载的 face（`faces` 不给时全部）。还没结束的导出冻结了它、或在等它下载时以 `conflict`（`FONT_IN_USE`，
   * `details.jobIds`）拒绝，一个也不删；在下载的先取消。已经完成的导出不受影响（成片里已经画好了）。
   */
  'fonts.remove': { params: { family: string; faces?: FontFaceStyle[] }; result: FontRemoveResult };
  /** 清空下载缓存：还没结束的导出用着的 face 留下（`kept`），其余删除；在下载的先取消。 */
  'fonts.clear': { params: Record<string, never>; result: FontRemoveResult };
  /**
   * 选字列表的样张（架构设计 §9.1）：一个字体目录里的族、只含族名里那几个字的子集（CSS 接口的 `text` 参数），界面拿它
   * 把族名画成这个族的样子。请求只带族名、常规字重与这几个字，与下载同一套接口设置、主机限制、大小上限、不跟随重定向；
   * 存在字体缓存的 `samples/` 里，下次不再取。严格离线时不取（`data: null`）；不在目录里的族 `data: null`。
   * 取不到（连不上、回应不对）时以 `conflict` 报，`details.code` 是 `FONT_DOWNLOAD_*`。只开给桌面与 CLI。
   */
  'fonts.sample': { params: { family: string }; result: FontSampleResult };
  /**
   * 一个打开着的视频用到的字体（架构设计 §9.1）：与成片导出同一份冻结交给 Render Worker 排一遍字（文字、字幕、模板
   * 生成的内容都在内），每个族给出点了名的 face、此刻的状态与内核此刻用什么画它（回退族）。`download: true` 时，还没
   * 下载的 face 按 `fonts.resolve` 的同一条规则开始下载（自动下载开着、不是严格离线、十分钟内没失败过），`started`
   * 列出这次开始下载的族。缺省整条根序列、烧字幕。只开给桌面与 CLI。
   */
  'fonts.usage': {
    params: { videoId: Id; sequenceId?: Id; burnCaptions?: boolean; download?: boolean };
    result: FontsUsageResult;
  };

  /**
   * 新建一个视频（视频格式规范 §1）：在项目目录（或不属于项目的会话的工作目录）下建一个视频目录并打开它。
   * 打开的视频属于这条连接；连接断开一段时间后 Runtime 关闭它，释放写入锁。
   */
  'videos.create': {
    params: { projectId?: Id; conversationId?: Id; name?: string; fps?: Rate; width?: number; height?: number; commandId?: Id };
    result: VideoOpenResult;
  };
  /**
   * 打开一个便携包（视频格式规范 §8）：校验清单（格式版本、每个文件的长度与摘要、路径不越出包），在项目目录或会话工作目录里
   * 建一个新视频（新的 `videoId`，素材全部收进视频）并打开。`path` 是 `.baocut` 文件，绝对路径或相对来源目录；
   * 新视频的目录名取包里的视频名（重名加序号）。Web 服务只接受来源目录里的文件。不给智能体与对外服务。
   */
  'videos.importPackage': {
    params: { projectId?: Id; conversationId?: Id; path: string; commandId?: Id };
    result: VideoOpenResult;
  };
  /** 打开一个视频：Space 里的视频条目，或来源目录里的视频目录。已经打开的返回同一个 `videoId`。 */
  'videos.open': { params: FileTarget; result: VideoOpenResult };
  /** 这条连接不再需要这个视频；没有其他连接打开它时 Runtime 关闭它。 */
  'videos.close': { params: { videoId: Id }; result: { closed: boolean } };
  /**
   * 删除视频（架构设计 §5.5、§5.7）：整个视频目录移进来源目录里的回收站，可以恢复；物理删除走 `space.purge` 或回收站的保留期。
   * 不碰链接素材的原文件。别的连接打开着、有进行中的任务、被别的进程锁着时拒绝（`VIDEO_IN_USE`、`VIDEO_BUSY`、`VIDEO_LOCKED`）。
   */
  'videos.delete': { params: FileTarget | { videoId: Id }; result: VideoDeleteResult };
  /** 把删除了的视频从回收站移回原来的位置。 */
  'videos.restore': { params: { entryId: Id }; result: VideoRestoreResult };
  'videos.history': { params: { videoId: Id; limit?: number }; result: { entries: HistoryEntry[] } };
  /**
   * 已打开视频里此刻读不到的素材版本（视频格式规范 §4.2）：每个素材的当前版本与实例引用的版本里，文件不在、
   * 已经不是登记时的文件，或相对路径越出了项目目录的。视频照常打开；界面据此标出缺失的素材，不必等到 `media.resolve` 失败。
   * 只看文件在不在、长度对不对，不重算摘要。打开视频、收到 `video.replaced`、提交了素材类操作之后各查一次。
   */
  'videos.assetStatus': { params: { videoId: Id }; result: { missing: MissingAsset[] } };
  /** 读一份文档的正文：不给版本时读当前版本。正文不随快照下发，界面画字幕时按需来取。 */
  'documents.read': { params: { videoId: Id; documentId: Id; revision?: Revision }; result: DocumentContent };

  /**
   * 提交一笔编辑事务（命令与协议规范 §4、§5）：全部操作一起生效或全部不生效。
   * `expectedRevision` 与当前版本不一致时返回 `conflict`（`PROJECT_REVISION_CONFLICT`）。
   */
  'edits.apply': {
    params: { videoId: Id; commandId: Id; expectedRevision: Revision; operations: EditOperation[]; label?: string };
    result: EditResult;
  };
  /** 撤销（命令与协议规范 §8）：`undo` / `redo` 指这条连接的操作者自己最近的一步。 */
  'edits.undo': {
    params: { videoId: Id; commandId: Id; target: UndoTarget; expectedRevision?: Revision };
    result: EditResult;
  };
  'edits.undoState': { params: { videoId: Id }; result: UndoState };
  /**
   * 应用一次识别说话人（`speakers` 流程）的提案：一笔编辑事务，转写与有变化的译文各写新版本，`edits.undo` 撤销。
   * 文稿或译文在识别之后改过时 `conflict`（`STALE_JOB_INPUT`）。
   */
  'edits.applySpeakers': { params: ApplySpeakersParams; result: EditResult };
  /**
   * 代码画面（动效图形，架构设计 §8）的预览：界面不经过智能体，按合成内部的时刻取帧（与工具 `compositions_preview` 同一个服务）。
   * 帧写成 PNG，返回各帧的受限读取句柄。视频要已经打开；不改视频。
   */
  'compositions.preview': { params: CompositionPreviewParams; result: CompositionPreviewResult };
  /**
   * 代码画面的导入：验证、烘焙预渲染、导入两个素材并放一个合成片段（两笔可撤销的修改，与工具 `compositions_import` 同一个服务）。
   * 操作者是用户本人（`user_local`，与 `edits.apply` 相同）；给了 `conversationId` 时在会话里放变更卡。烘焙可能要几分钟。
   */
  'compositions.import': { params: CompositionImportParams; result: CompositionImportResult };

  /** 本地模型包与它们的状态（架构设计 §6.3）。 */
  'models.list': { params: Record<string, never>; result: { bundles: ModelBundleStatus[] } };
  /**
   * 转写一个音视频素材（架构设计 §6.6）：立即返回 `jobId`，进度与结果经 `jobs` 主题送达；完成时 Runtime 把结果写成
   * 一份 `speech` 文档。相同输入的任务还在排队或运行时返回同一个 `jobId`。视频要先打开；任务进行期间 Runtime 让它保持打开。
   * Provider 与模型按 §6.2 选择；选中的 Provider 不可用、或什么都没有配置时返回 `conflict`，`details` 为
   * `CapabilityNotConfiguredDetails`，不创建任务。不认识的模型或节点返回 `not-found`。节点的拒绝与失联、在线 Provider 的
   * 认证与配额失败是任务的错误（`REMOTE_NODE_*`、`PROVIDER_*`）。
   */
  'models.transcribe': { params: TranscribeRequest; result: { jobId: Id } };
  /**
   * 合成语音（架构设计 §6.6）：立即返回 `jobId`，进度与结果经 `jobs` 主题送达。Provider 与模型按 §6.2 选择，这种能力没有
   * 出厂默认：没有显式指定、也没有默认值时返回 `conflict`（`CAPABILITY_NOT_CONFIGURED`），不创建任务。文本超过模型上限、
   * 音色或格式不被模型接受时 `invalid-request`。给 `videoId` 时视频要已打开，结果以 `system:jobs` 导入为素材（不上时间线）。
   * 同一个 `commandId` 返回同一个任务；相同参数的两次提交是两个任务（每次生成都可能不同）。
   */
  'models.synthesizeSpeech': { params: SynthesizeSpeechRequest; result: { jobId: Id } };
  /** 生成图片：规则同 `models.synthesizeSpeech`；尺寸、张数与格式要在模型声明的范围内。 */
  'models.generateImage': { params: GenerateImageRequest; result: { jobId: Id } };
  /**
   * 调用一次文本模型（架构设计 §6.1、§6.4）：立即返回 `jobId`；完成时全文发布为产物（`.txt`，结构化输出是校验过的
   * `.json`），结果带产物 ID 与开头一段的预览。选择规则同 `models.synthesizeSpeech`（没有出厂默认）。结构化输出不合 schema、
   * 或因输出上限被截断时任务以 `MODEL_OUTPUT_INVALID` 失败；文本被截断时任务完成并带 `output-truncated` 警告。
   */
  'models.generateText': { params: GenerateTextRequest; result: { jobId: Id } };
  /**
   * 向一个在线 Provider 取可用的模型（与音色）列表，缓存在配置里并记下时间（架构设计 §6.8）。取不到时照旧用内置列表，
   * `refreshed.ok` 为 false 并说明原因；这不是请求的错误。不是在线 Provider 时 `invalid-request`。
   */
  'models.refreshProvider': { params: { providerId: string }; result: { provider: ProviderView; refreshed: ProviderRefreshStatus } };
  /** 设置一种能力的参数默认值（首版只有 `generateText` 的推理强度与并发上限）；null 恢复出厂值。返回补全后的值。 */
  'models.setCapabilityParameters': { params: SetCapabilityParametersRequest; result: { parameters: TextCapabilityParameters } };
  /** 重新启用一个因反复崩溃而停用的模型包，并清掉加载失败的记录。 */
  'models.enable': { params: { bundleId: string }; result: { bundle: ModelBundleStatus } };
  /**
   * 安装一个本地模型包（架构设计 §6.3）：两步。不给 `confirmBytes` 时只返回计划（要下载的组件、文件与字节数），不下载；
   * 把计划里的 `confirmBytes` 原样交回来才提交安装任务（`kind: 'modelInstall'`，进度在 `jobs` 主题，模型包状态在 `models`
   * 主题）。字节数与此刻的计划不一致时 `conflict`（`MODEL_INSTALL_SIZE_CHANGED`，`details.plan` 是新计划）。只下载缺的组件；
   * 暂存区里已经收到并校验过的文件不再下载，没下完的文件按 HTTP Range 续传。都已装好时 `jobId` 为 null。同一个模型包已经在
   * 安装时返回那个任务。严格离线（`offline.strict`）时 `conflict`（`OFFLINE_STRICT`）。
   */
  'models.install': { params: { bundleId: string; confirmBytes?: number; commandId?: Id }; result: ModelInstallResult };
  /**
   * 停下一个模型包的安装（取消它的任务）。默认保留暂存区里已经收到的部分（再次 `models.install` 续传）；`discard: true` 时
   * 一并删掉。没有在安装时只按 `discard` 处理暂存区。
   */
  'models.cancelInstall': { params: { bundleId: string; discard?: boolean }; result: { bundle: ModelBundleStatus } };
  /**
   * 删除一个模型包：删掉它独有的组件，别的模型包还在用的共享组件保留。有任务在用它（排队或进行中的转写、检查、安装，
   * 或 Worker 正在加载、执行）时 `conflict`（`MODEL_IN_USE`，`details.jobIds`）；空闲时先卸载 Worker。
   */
  'models.remove': { params: { bundleId: string }; result: ModelRemoveResult };
  /**
   * 修复一个模型包：逐个文件校验 sha256，只重新下载缺失或损坏的文件。两步确认与 `models.install` 相同（计划里的字节数
   * 要在校验之后才知道，第一步会把文件读一遍）。
   */
  'models.repair': { params: { bundleId: string; confirmBytes?: number; commandId?: Id }; result: ModelInstallResult };
  /**
   * 检查：用随附的固定样本走一遍完整的 Worker 流程（加载、识别或合成、核对输出），结论记在模型包状态的 `selfTest` 上
   * （没通过时带 `code` 与 `facts`）。是一个任务（`kind: 'modelTest'`），失败时 `error.details.check` 是同一个 `code`。
   * 模型包不可用时 `conflict`（`MODEL_UNAVAILABLE`）；随应用分发的样本读不出来时 `conflict`（`APP_FILE_MISSING`）。
   */
  'models.test': { params: { bundleId: string; commandId?: Id }; result: { jobId: Id } };
  /**
   * 模型目录（架构设计 §6.3）：生效的目录、来源（环境变量、设置或缺省）、用量与所在磁盘的可用空间。含本机路径：
   * 不在 Web 服务的白名单里，MCP 对外服务也不提供。
   */
  'models.getDir': { params: Record<string, never>; result: ModelsDirInfo };
  /**
   * 看一个文件夹能不能作模型目录（只读）：在不在、可不可写、可用空间、里面已有的模型（按仓库的 `.bcut-manifest.json` 认），
   * 以及「移过去」要搬多少、放不放得下。`path: null` 看缺省位置。
   */
  'models.inspectDir': { params: { path: string | null }; result: ModelsDirInspection };
  /**
   * 更改模型目录：`path: null` 恢复缺省位置。`switch` 立即换过去（原目录的文件保留）；`move` 提交 `kind: 'modelsMove'` 的
   * 任务，搬完、校验完才换过去，中途失败或取消时回滚、原目录不动。环境变量指定了目录时 `conflict`（`MODELS_DIR_ENV_LOCKED`）；
   * 有排队或进行中的本地模型任务（转写、合成、安装、检查、移动），或 Worker 正忙时 `conflict`（`MODEL_IN_USE`）；
   * 文件夹不存在 `MODELS_DIR_MISSING`、不可写 `MODELS_DIR_NOT_WRITABLE`、与当前目录互相包含 `MODELS_DIR_NESTED`、
   * 放不下 `MODELS_DIR_NO_SPACE`（都是 `conflict`）。就是当前目录时什么都不做。
   */
  'models.setDir': { params: { path: string | null; mode: ModelsDirMode; commandId?: Id }; result: ModelsDirChangeResult };
  /**
   * 模型服务的只读视图（架构设计 §6.8）：每种能力下各 Provider 的模型、限制、默认值、此刻是否可用与原因。
   * 已配对的节点各探测一次健康（每个至多 2 秒，并行）。
   */
  'models.capabilities': { params: Record<string, never>; result: { capabilities: ModelCapabilitiesView } };
  /** 配置一个在线 Provider（`openai`、`google`、`custom:<slug>`）。启用即是持续的授权；密钥只写，从不回显。 */
  'models.configure': { params: ConfigureProviderRequest; result: { provider: ProviderView } };
  /**
   * 删除一个在线 Provider 的配置与它全部账号的密钥（内置的服务商回到未配置，自定义端点整个删掉）。指向它的默认值保留，
   * 报告为不可用。
   */
  'models.removeProvider': { params: { providerId: string }; result: { removed: true } };
  /**
   * 给一个在线 Provider 加一个账号（一把密钥，架构设计 §6.8），加在最后。`verify` 时先用这把密钥向供应商发一个只读请求，
   * 不通过不保存。凭据存储不可用时 `conflict`（`CREDENTIAL_UNAVAILABLE`）。
   */
  'models.addAccount': { params: AddProviderAccountRequest; result: { provider: ProviderView } };
  /** 改一个账号：名字、密钥、开关、region 或账号级的基址。没有这个账号时 `not-found`。 */
  'models.updateAccount': { params: UpdateProviderAccountRequest; result: { provider: ProviderView } };
  /** 删除一个账号与它的密钥。删掉最后一个账号不等于移除服务商：服务商仍启用，但 `credential: 'missing'`。 */
  'models.removeAccount': { params: { providerId: string; accountId: string }; result: { provider: ProviderView } };
  /** 账号的新顺序（「设为首选」）：第一个启用且有密钥的账号生效。`order` 要恰好是现有账号的一个排列。 */
  'models.arrangeAccounts': { params: ArrangeProviderAccountsRequest; result: { provider: ProviderView } };
  /** 用量（只读，架构设计 §6.8）：按时段汇总用量账本，金额分报告、估算与未知。 */
  'models.usage': { params: UsageRequest; result: UsageReport };
  /** 设置或清除（`providerId: null`）一种能力的默认 Provider 与模型；不给 `modelId` 时用该 Provider 的默认模型。 */
  'models.setDefault': {
    params: { capability: ModelServiceCapability; providerId: string | null; modelId?: string };
    result: { default: ModelRef | null };
  };
  'jobs.inspect': { params: { jobId: Id }; result: JobRecord };
  /** 取消一项计算（架构设计 §7.4）：返回取消之后的状态（已经结束的任务返回它的终态）。 */
  'jobs.cancel': { params: { jobId: Id }; result: { state: JobState } };
  /**
   * 新的在前；给 `videoId` 时只列这个视频的。固定流程的步骤（带 `parentJobId` 的子任务）默认折叠在父任务下不列出，
   * `children: true` 时一并列出。
   */
  'jobs.list': { params: { videoId?: Id; children?: boolean }; result: { jobs: JobRecord[] } };
  /**
   * 资源调度的现状（只读，架构设计 §7.6、§7.7）：机器容量与来源、预留、已租出与此刻还能用的量、每份租约、
   * 共用的常驻进程与排队中的任务（各自在等什么）。
   */
  'jobs.resources': { params: Record<string, never>; result: ResourcesSnapshot };
  /**
   * 处理重启后结果不明或没有应用完的任务（架构设计 §7.5）：`retry`、`discard`、`apply` 三种决定，各有合法的状态
   * （见 `JobReconcileDecision`）；不合法时 `conflict`（`RECONCILE_NOT_ALLOWED`，`details` 给出当前状态与允许的决定）。
   * 返回处理之后的记录。智能体不能调用。
   */
  'jobs.reconcile': { params: { jobId: Id; decision: JobReconcileDecision }; result: JobRecord };
  /** 可用的固定流程、它们的步骤与参数的 JSON Schema（架构设计 §7.9）。 */
  'pipelines.list': { params: Record<string, never>; result: { pipelines: PipelineInfo[] } };
  /**
   * 启动一个固定流程：立即返回父任务的 `jobId`，进度与结果经 `jobs` 主题送达。没有这个流程时 `not-found`；参数不合
   * 流程的 schema 时 `invalid-request`；流程需要的能力没有配置时 `conflict`（`CAPABILITY_NOT_CONFIGURED`）。
   */
  'pipelines.start': { params: { pipeline: string; params: Record<string, unknown>; commandId?: string }; result: { jobId: Id } };
  /**
   * 从失败（或被取消、被中断）的那一步重新执行一个流程，复用之前已完成步骤的输出；返回同一个父任务的 `jobId`。
   * 还在进行或已经完成时 `conflict`（`JOB_NOT_RETRYABLE`）。
   */
  'pipelines.retry': { params: { jobId: Id }; result: { jobId: Id } };
  /**
   * 工具目录（架构设计 §7.9）：每个工具的输入、结果、执行方式与依赖，加上此刻能不能用、不能用的原因（只读，不探测网络；
   * 外部工具用上次探测的结果）。浏览器会话里执行方法不在白名单的工具标为不可用（`WEB_METHOD_NOT_ALLOWED`）。
   */
  'tools.list': { params: Record<string, never>; result: ToolsListResult };
  /**
   * 一个工具可选的视频条目与每个条目里可选的文档（只读）：事实来自内容索引与 Space 目录，不打开视频；范围规则与 `space.list`
   * 相同。还没有索引的视频照样列出（`indexed: false`），有它们时 `complete` 为 false。没有这个工具时 `not-found`；
   * 不接受视频输入的工具返回空列表。
   */
  'tools.candidates': { params: ToolCandidatesParams; result: ToolCandidatesResult };
  /**
   * Agent 面的工具目录（架构设计 §3.5、§4.1）：与会话里的智能体、MCP 服务同一份目录，带参数的 JSON Schema、说明、注解与风险。
   * 只给 `cli` 与 `desktop` 连接，其余 `forbidden`。
   */
  'catalog.list': { params: Record<string, never>; result: CatalogListResult };
  /**
   * 按名调用目录里的工具，主体是 `LocalPrincipal`（写入算 `user_local`，不走 BaoCut 的审批）。工具层的结果与拒绝都在返回值里
   * （`ok`），拒绝的形态与 MCP 工具结果的 `error` 相同；只给 `cli` 与 `desktop` 连接，其余 `forbidden`。
   */
  'catalog.call': { params: CatalogCallParams; result: CatalogCallResult };
  /**
   * 给外部 Agent 的说明书按 CLI 面渲染好的文件（Agent 面设计 §8.6），`baocut skill install` 用。来源目录按
   * `BAOCUT_AGENT_SKILLS_DIR` → 打包资源 → 仓库根找；都没有时 `not-found`（`AGENT_SKILL_NOT_FOUND`），标记或占位符写错时
   * `conflict`（`AGENT_SKILL_INVALID`，带文件与行号）。只给 `cli` 与 `desktop` 连接，其余 `forbidden`。
   */
  'catalog.agentSkill': { params: Record<string, never>; result: CatalogAgentSkill };
  /** 受管外部工具（架构设计 §12.9）的状态：上次探测的结果（第一次调用时探测）。只在本机执行 `--version`，不联网。 */
  'externalTools.list': { params: Record<string, never>; result: { tools: ExternalToolStatus[] } };
  /** 重新探测（全部，或 `name` 这一个），返回全部工具的状态。 */
  'externalTools.detect': { params: { name?: string }; result: { tools: ExternalToolStatus[] } };
  /**
   * 下载一个受管工具到 Runtime Home 的 `tools/`：提交安装任务（`kind: 'toolInstall'`），立即返回 `jobId`。要显式的用户同意：
   * 不给 `consent: true` 时以 `conflict`（`TOOL_CONSENT_REQUIRED`，`details.offer` 是来源、版本、大小与许可）拒绝，不下载；
   * 给了就记下同意（`via`，默认 `app`）再提交。清单里摘要未知时 `conflict`（`TOOL_MANIFEST_INCOMPLETE`）；严格离线时
   * `conflict`（`OFFLINE_STRICT`）；不能由 BaoCut 下载的工具（ffmpeg）`invalid-request`（`TOOL_NOT_MANAGED`）。
   * 同一个工具已经在安装时返回那个任务。
   */
  'externalTools.install': {
    params: { name: string; consent?: boolean; via?: 'app' | 'cli'; commandId?: Id };
    result: ExternalToolInstallResult;
  };
  /**
   * 按原安装方式更新系统里的那一份（`status.update`）：提交更新任务（`kind: 'toolUpdate'`），立即返回 `jobId`；输出逐段写进
   * 任务记录的 `command`，结束后重新探测。要用户看过完整命令：`command` 与此刻的 `update.command` 不同或没给时以 `conflict`
   * （`TOOL_UPDATE_CONFIRM_REQUIRED`，`details.update` 是此刻的办法）拒绝，不执行。判断不了安装方式、或是受管副本时
   * `conflict`（`TOOL_UPDATE_UNSUPPORTED`）；要管理员权限等不能代为执行时 `conflict`（`TOOL_UPDATE_MANUAL`，`details.update`）；
   * 严格离线时 `conflict`（`OFFLINE_STRICT`）；正在安装、或有流程正在用它时 `conflict`（`TOOL_IN_USE`）。同一个工具已经在
   * 更新时返回那个任务。
   */
  'externalTools.update': { params: { name: string; command?: string; commandId?: Id }; result: ExternalToolUpdateResult };
  /**
   * 指定（或用 null 清除）一个工具的路径：用户自己装的那一份优先于受管副本与 PATH。先执行一次 `--version` 核对，
   * 不能运行时 `invalid-request`（`TOOL_UNAVAILABLE`）。只记路径，不代表同意使用下载工具。
   */
  'externalTools.setPath': { params: { name: string; path: string | null }; result: { tool: ExternalToolStatus } };
  /** 删除受管副本（不动系统里的与用户指定的）。正在安装、更新，或有流程正在用它时 `conflict`（`TOOL_IN_USE`）。 */
  'externalTools.remove': { params: { name: string }; result: { tool: ExternalToolStatus } };
  /** 记下（`grant: true`）或撤回（`grant: false`）用户对一个工具的同意。撤回之后用它的流程拒绝执行。 */
  'externalTools.consent': { params: { name: string; grant: boolean; via?: 'app' | 'cli' }; result: { tool: ExternalToolStatus } };
  /**
   * 这台机器上下载工具能读到 Cookie 的浏览器（下载视频的「网站登录」）：按 yt-dlp 的查找规则看各浏览器的 Cookie 库在不在，
   * 最近改过的在前。每次调用都重新看；只看文件在不在与修改时间，不读 Cookie 内容，不运行下载工具。`platform` 是 Runtime
   * 所在主机的平台（`process.platform` 的取值：darwin、win32、linux…）：下载在那台主机上运行，界面按它提示系统授权。
   */
  'externalTools.cookieBrowsers': { params: Record<string, never>; result: { platform: string; browsers: CookieBrowserInfo[] } };
  /**
   * 导出（架构设计 §9.11、§9.13）：冻结视频的当前版本并预检，立即返回 `jobId`；之后的编辑不影响这个导出。
   * 预检不过时不创建任务，以 `RpcError.details.code` 给出原因（`EXPORT_*`、`ASSET_MISSING`、`ASSET_CHANGED`，命令与协议规范 §11.4）。
   */
  'exports.create': { params: ExportCreateRequest; result: { jobId: Id } };
  /** 一个导出任务的记录；不是导出的任务 `not-found`。 */
  'exports.get': { params: { jobId: Id }; result: JobRecord };
  /** 导出任务，新的在前；给 `videoId` 时只列这个视频的。 */
  'exports.list': { params: { videoId?: Id }; result: { jobs: JobRecord[] } };
  /**
   * 字幕或文稿的正文，不写文件、不建任务（导出面板文稿页的预览与「复制文本」）：与 `exports.create` 同一套冻结、预检与写法，
   * 正文与同样设置导出的文件逐字节相同；预检的拒绝码也相同（目标目录的那几项除外，这里不碰目标目录）。只读。
   */
  'exports.renderText': { params: ExportRenderTextRequest; result: ExportRenderTextResult };
  /** 一个产物（`sha256:<hex>`）的受限读取句柄，同 `media.resolve`（架构设计 §4.5）。没有这个产物时 `not-found`。 */
  'artifacts.openHandle': { params: { artifactId: string }; result: MediaHandle };

  /**
   * 用户库（架构设计 §5.9）：术语表、音色与品牌库。条目的变化经 `library` 主题送达。
   * 不给 `library` 时列出全部库；`kind` 只留这一种（例如 `translation`、`image`）。
   */
  'library.list': { params: { library?: LibraryName; kind?: string }; result: { entries: LibraryEntrySummary[] } };
  /** 一个条目的当前版本，或一个还保留着的旧版本（被任务固定的）。没有时 `not-found`。 */
  'library.get': { params: LibraryEntryRef; result: { entry: LibraryEntry } };
  /**
   * 新建或修改一个条目：内容不变时不产生新版本（`changed: false`）。带文件的种类由 `source` 提供文件，Runtime 按内容识别类型，
   * 不看扩展名。内容不合规时 `invalid-request`（`LIBRARY_FORMAT_INVALID`）；`overlayTemplate` 以 `LIBRARY_KIND_RESERVED` 拒绝。
   */
  'library.put': { params: LibraryPutParams; result: { entry: LibraryEntry; created: boolean; changed: boolean } };
  /** 删除一个条目。已经进入视频的拷贝不受影响；音色在各 Provider 上的克隆转为 `stale`。 */
  'library.remove': { params: { library: LibraryName; id: Id }; result: { removed: true } };
  /**
   * 导入一个交换文件，新建一个条目：术语表的 Markdown、音色包 `.bcvoice`、品牌库的媒体文件或 `baocut.library-item` JSON。
   * 类型按内容识别，不看扩展名；认不出或校验不通过时 `invalid-request`（`LIBRARY_FORMAT_INVALID`）。
   */
  'library.import': { params: { path: string; commandId?: Id }; result: { entry: LibraryEntry } };
  /** 把一个条目写成交换文件（格式见架构设计 §5.9）。目标已存在时 `conflict`，不覆盖。 */
  'library.export': { params: { entry: LibraryEntryRef; path: string }; result: LibraryExportResult };
  /**
   * 把一个条目拷进视频：一笔普通的编辑事务。图片、视频、贴纸与字体以 `managed` 方式导入为素材，来源记下库条目与版本；
   * 字幕样式写成一份 `caption-style` 文档（给了 `captionItemIds` 时同一事务里设为这些字幕的样式）。
   * 术语表、音色与颜色不能这样进入视频（`LIBRARY_ENTRY_NOT_APPLICABLE`）。
   */
  'library.applyToVideo': { params: LibraryApplyParams; result: LibraryApplyResult };
  /**
   * 视频里启用的库条目（架构设计 §5.9）：哪一步用哪几张术语表、哪个说话人用哪个音色，记在视频的 `library-selection` 文档里。
   * 新视频建好时按条目的 `defaultEnabled` 写一份（只在有默认启用的术语表时）；之后只经 `setVideoSelection` 改。
   */
  'library.getVideoSelection': { params: { videoId: Id }; result: VideoLibrarySelection };
  /**
   * 改视频里启用的条目：一笔普通的编辑事务。术语表要在库里、种类与步骤相符（`transcribe` 只放转写用，`translate` 只放翻译用），
   * 否则 `LIBRARY_ENTRY_NOT_APPLICABLE`；库里没有的条目 `not-found`；`library:` 音色要在库里，说话人要在那份转写里。
   */
  'library.setVideoSelection': { params: LibrarySetSelectionParams; result: LibrarySetSelectionResult };
  /** 条目文件（品牌库的媒体、音色的参考录音）的短期读取句柄，同 `artifacts.openHandle`。没有文件的条目 `not-found`。 */
  'library.openHandle': { params: LibraryEntryRef; result: MediaHandle };
  /**
   * 在一个 Provider 上克隆库里的音色（架构设计 §5.9）：立即返回任务的 `jobId`（`kind: 'voiceClone'`），进度与结果经 `jobs` 主题。
   * 没有授权声明时 `conflict`（`VOICE_CONSENT_REQUIRED`）；Provider 没有克隆接口时 `invalid-request`（`VOICE_CLONE_UNSUPPORTED`）；
   * 上传参考录音是数据外发（数据种类 `audio`），没有覆盖它的授权时 `forbidden`（`GRANT_REQUIRED`、`BUDGET_EXCEEDED`……）。
   */
  'library.createVoiceClone': { params: VoiceCloneCreateParams; result: { jobId: Id } };
  /**
   * 删除一个克隆：先请求远端删除，成功（或远端已经没有）后清掉记录。远端删除失败时记录保留，以 Provider 的错误码报告
   * （`PROVIDER_*`）。删除了的音色留下的克隆也能这样删。
   */
  'library.removeVoiceClone': { params: VoiceCloneRemoveParams; result: VoiceCloneRemoveResult };

  /**
   * 创作模板目录（模板包规范 §6）：内置目录与 Runtime Home 下 `templates/` 里的全部可用模板，以及跳过的模板目录与原因。
   * 每次调用都重新读目录，用户放进新模板之后再列一次就能看到。顺序不是合同。每个模板按 `language`（通常是界面语言，
   * 缺省为 Runtime 的界面语言）挑一个语言版本（模板包规范 §3.6），清单的文案已经换成它。
   */
  'templates.list': { params: { language?: string }; result: TemplateListResult };
  /**
   * 一个模板的清单与提示词全文，按 `language` 挑语言版本（同 `templates.list`）。没有这个模板（或它没能加载）时 `not-found`
   * （`TEMPLATE_NOT_FOUND`）。
   */
  'templates.get': { params: { id: string; language?: string }; result: TemplateDetail };
  /**
   * 模板随附文件的短期读取句柄，同 `artifacts.openHandle`。`path` 是清单里登记的 `cover.file`、`preview.file` 或 `assets[].path`；
   * 没登记的路径 `not-found`（`TEMPLATE_FILE_NOT_FOUND`），模板目录里别的文件（含 `prompt.md`）也一样。
   */
  'templates.openHandle': { params: { id: string; path: string }; result: MediaHandle };

  /**
   * Agent 的 skill 目录（架构设计 §3.8）：内置目录与 `<Runtime Home>/skills/` 里的全部可用 skill、各自的开关，以及跳过的目录与原因。
   * 每次调用都重新读目录。顺序不是合同。
   */
  'skills.list': { params: Record<string, never>; result: SkillListResult };
  /** 一个 skill 的摘要、`SKILL.md` 全文与文件清单。没有这个 skill（或它没能加载）时 `not-found`（`SKILL_NOT_FOUND`）。 */
  'skills.get': { params: { id: string }; result: SkillDetail };
  /**
   * 读 skill 目录里的一个文本文件。`path` 必须是 `skills.get` 文件清单里的路径，否则 `not-found`（`SKILL_FILE_NOT_FOUND`）；
   * 超过 `SKILL_LIMITS.readFileBytes` 时 `invalid-request`（`SKILL_FILE_TOO_LARGE`），不是 UTF-8 文本时 `invalid-request`（`SKILL_FILE_NOT_TEXT`）。
   */
  'skills.readFile': { params: { id: string; path: string }; result: SkillFileContent };
  /**
   * 开关一个 skill（内置的也可以）。只存与来源默认值不同的差量。对已经在运行的原生会话不生效：会话开始时的 skill 索引是那时的开关，
   * 之后新开的原生会话才按新的开关（架构设计 §3.8）。
   */
  'skills.setEnabled': { params: { id: string; enabled: boolean }; result: SkillChangeResult };
  /**
   * 从本地文件夹添加（架构设计 §12.9）：把文件夹复制进 `<Runtime Home>/skills/<id>/`，`id` 不给时由文件夹名规范化；归「我的」，默认开。
   * 文件夹不存在时 `not-found`（`SKILL_SOURCE_NOT_FOUND`）；没有 `SKILL.md`、front matter 不合规、含符号链接时 `invalid-request`
   * （`SKILL_INVALID`）；超过文件数或总大小上限时 `invalid-request`（`SKILL_TOO_LARGE`）；目标已存在或与已有 skill 同 id 时
   * `conflict`（`SKILL_EXISTS`），不覆盖。错误的 `details` 带 `skillId` 与将写入的 `path`。Web 会话不开放。
   */
  'skills.add': { params: { path: string; id?: string; commandId?: Id }; result: SkillChangeResult };
  /**
   * 从 GitHub 导入（架构设计 §12.9）：`url` 是 `owner/repo`、`https://github.com/<owner>/<repo>` 或
   * `https://github.com/<owner>/<repo>/tree/<ref>/<子目录>`（`ref` 取 `tree/` 之后的一段）。只取那个目录里的文件，不执行任何内容，
   * 复制进 `<Runtime Home>/skills/<id>/` 并记下地址、`ref` 与提交；归「第三方」，默认关。`id` 不给时由子目录名（仓库根时是仓库名）规范化。
   * 地址不认识时 `invalid-request`（`SKILL_GITHUB_URL_INVALID`）；仓库、`ref` 或子目录不存在时 `not-found`（`SKILL_SOURCE_NOT_FOUND`）；
   * 网络失败或被限流时 `conflict`（`SKILL_GITHUB_NETWORK`、`SKILL_GITHUB_RATE_LIMITED`）；严格离线时 `conflict`（`OFFLINE_STRICT`）；
   * 其余同 `skills.add`（`SKILL_INVALID`、`SKILL_TOO_LARGE`、`SKILL_EXISTS`，冲突在联网之前就查）。Web 会话不开放。
   */
  'skills.importGithub': { params: { url: string; id?: string; commandId?: Id }; result: SkillChangeResult };
  /**
   * 移除一个「我的」或「第三方」skill：删掉 `<Runtime Home>/skills/<id>/` 与它的开关记录。内置的 `invalid-request`
   * （`SKILL_BUILTIN_NOT_REMOVABLE`），只能关。Web 会话不开放。
   */
  'skills.remove': { params: { id: string }; result: SkillRemoveResult };

  /**
   * 共享这台电脑的模型能力（节点协议规范 §10）：开启节点服务并生成一个配对码。已经开着时按新参数重启监听。
   * 端口被占用时不报错：`listening` 为 false，`error` 说明原因。
   */
  'nodes.share.start': { params: ShareStartParams; result: ShareStatus };
  /** 关闭共享：取消并删除全部远端任务，停止监听。已配对的客户端保留。 */
  'nodes.share.stop': { params: Record<string, never>; result: ShareStatus };
  'nodes.share.status': { params: Record<string, never>; result: ShareStatus };
  /** 作废旧配对码并生成新的，同时解除配对锁定。共享没有开启时返回 `conflict`。 */
  'nodes.share.pairingCode': { params: Record<string, never>; result: ShareStatus };
  /** 吊销一个客户端：令牌立即失效，它的远端任务取消并删除。 */
  'nodes.share.revoke': { params: { clientId: string }; result: ShareStatus };
  /**
   * 打开或关闭一种模型能力的共享，立即生效（健康端点随即报告；关闭后新任务以 `403 CAPABILITY_DISABLED` 拒绝，已接受的任务照常跑完）。
   * 状态持久。`capability` 不是节点支持共享的模型能力（`NODE_SHAREABLE_CAPABILITIES`）时 `invalid-request`。
   */
  'nodes.share.setCapability': { params: { capability: string; enabled: boolean }; result: ShareStatus };
  /** 在局域网里找开着共享的节点（macOS 用 mDNS；其他平台返回空列表）。不含这台电脑自己。 */
  'nodes.discover': { params: { timeoutMs?: number }; result: { nodes: DiscoveredNode[] } };
  /**
   * 用节点上显示的配对码配对，令牌只存在本机。失败时返回 `conflict`，`details.code` 为 `REMOTE_NODE_REJECTED`
   * （`details.reason`：`pairing-code-invalid`、`pairing-locked`、`version`、`source-not-allowed`）或 `REMOTE_NODE_LOST`（连接不上）。
   */
  'nodes.pair': { params: { host: string; port: number; code: string; alias?: string }; result: { node: PairedNode } };
  /** 已配对的节点，每个带一次实时的健康探测（2 秒超时）。 */
  'nodes.list': { params: Record<string, never>; result: { nodes: PairedNode[] } };
  /** 只删本机的记录与令牌；节点那边的配对由节点的用户吊销。 */
  'nodes.remove': { params: { nodeId: string }; result: Record<string, never> };

  /** 对外服务（架构设计 §4.8）：全部服务的状态。节点服务的状态是 `nodes.share.status` 的投影。 */
  'services.list': { params: Record<string, never>; result: { services: ServiceStatus[] } };
  /**
   * 开启一个服务。已经开着时原样返回。端口被占用时不报错：状态为 `error`，`error` 说明原因。
   * 这个版本没有提供的服务以 `conflict` 拒绝，`details.code` 为 `SERVICE_NOT_AVAILABLE`。节点服务等同 `nodes.share.start`（不带参数）。
   */
  'services.start': { params: { serviceId: ServiceId }; result: { service: ServiceStatus } };
  /** 停止一个服务：断开已有连接，待处理的审批按取消处理；它提交的 Job 保留。 */
  'services.stop': { params: { serviceId: ServiceId }; result: { service: ServiceStatus } };
  /**
   * 改一个服务的配置（随 Runtime 启动、端口、访问策略），原子落盘后生效；开着时改端口会按新端口重启监听。
   * 节点服务以 `invalid-request` 拒绝：它的配置用 `nodes.share.*`。
   */
  'services.configure': { params: ServiceConfigureParams; result: { service: ServiceStatus } };
  /** 处理一条服务审批。已经处理过、超时或取消的返回 `already-resolved`。 */
  'services.respondToApproval': {
    params: { approvalId: Id; decision: ServiceApprovalDecision };
    result: { status: 'allowed' | 'denied' | 'already-resolved' };
  };
  /** 为 MCP 服务发放一个客户端令牌。令牌明文只在这里返回一次，Runtime 只存哈希。 */
  'services.mcp.createClient': { params: { name: string }; result: { client: ServiceClient; token: string } };
  'services.mcp.listClients': { params: Record<string, never>; result: { clients: ServiceClient[] } };
  /** 吊销一个客户端：它的令牌立即失效。没有这个客户端时 `not-found`。 */
  'services.mcp.revokeClient': { params: { clientId: string }; result: { clients: ServiceClient[] } };
  /** 连接信息：地址、请求头形状与可粘贴的配置片段，不含令牌明文。给 `clientId` 时片段里写上客户端名。 */
  'services.mcp.connectionInfo': { params: { clientId?: string }; result: McpConnectionInfo };
  /** 为模型接口服务发放一个客户端令牌：规则同 `services.mcp.createClient`，两个服务的令牌互不通用。 */
  'services.modelApi.createClient': { params: { name: string }; result: { client: ServiceClient; token: string } };
  'services.modelApi.listClients': { params: Record<string, never>; result: { clients: ServiceClient[] } };
  /** 吊销一个客户端：它的令牌立即失效。没有这个客户端时 `not-found`。 */
  'services.modelApi.revokeClient': { params: { clientId: string }; result: { clients: ServiceClient[] } };
  /** 连接信息：基址（OpenAI SDK 的 `baseURL`）、请求头形状与片段，不含令牌明文。 */
  'services.modelApi.connectionInfo': { params: { clientId?: string }; result: ModelApiConnectionInfo };
  /**
   * 设置一条别名（同名的替换）：模型名 → 一种能力下的 Provider 与模型（`modelId` 不给时用该 Provider 的默认模型）。
   * 不检查目标此刻是否可用：不可用时请求按 §4.8 回答 404 或 503。返回整张别名表。
   */
  'services.modelApi.setAlias': {
    params: { alias: string; capability: ModelApiAlias['capability']; providerId: string; modelId?: string };
    result: { aliases: ModelApiAlias[] };
  };
  /** 删除一条别名；没有这条时 `not-found`。返回整张别名表。 */
  'services.modelApi.removeAlias': { params: { alias: string }; result: { aliases: ModelApiAlias[] } };
  /**
   * 为浏览器生成一个访问链接（架构设计 §4.8）：`http://127.0.0.1:<port>/#code=<一次性代码>`。代码放在 fragment 里，
   * 不进服务器日志与 Referer；只能换一次会话，`WEB_ACCESS_CODE_TTL_MS` 之后作废。给 `video`（videoId）时链接直达这个视频的
   * 编辑器：路径与查询是 `webVideoHref` 的结果（`/home?video=<JSON 的 FileTarget>`），fragment 里仍只有代码；找不到这个视频时
   * `not-found`（`details.code: 'VIDEO_NOT_FOUND'`）。Web 服务没有开着时以 `conflict` 拒绝（`details.code: 'SERVICE_NOT_RUNNING'`）。
   * 浏览器会话自己不能调用这个方法。
   */
  'services.web.createAccessLink': { params: { video?: Id }; result: WebAccessLink };
  /** 当前的浏览器会话（不含会话令牌）。 */
  'services.web.listSessions': { params: Record<string, never>; result: { sessions: WebSession[] } };
  /** 吊销一个浏览器会话：它的连接立即断开，cookie 随即失效。没有这个会话时 `not-found`。 */
  'services.web.revokeSession': { params: { sessionId: string }; result: { sessions: WebSession[] } };

  /** Runtime 持有的偏好设置（架构设计 §5.10）。不给 `keys` 时返回全部；不认识的键 `invalid-request`。 */
  'settings.get': { params: { keys?: SettingKey[] }; result: SettingsView };
  /**
   * 改一组设置：整批校验（未知的键、不合 schema 的值整批 `invalid-request`，一个也不保存），校验通过后原子落盘再生效。
   * `null` 表示恢复默认值。返回新的完整视图；有效值变了的键经 `settings` 主题送 `settings.updated`。
   */
  'settings.set': { params: { values: { [K in SettingKey]?: SettingInputValues[K] | null } }; result: SettingsSnapshot };

  subscribe: {
    params: { topic: Topic; afterSeq?: Seq };
    result: { mode: 'snapshot'; seq: Seq; snapshot: unknown } | { mode: 'replay'; seq: Seq; events: SequencedEvent<unknown>[] };
  };
  unsubscribe: { params: { topic: Topic }; result: { ok: true } };
}

/** 一个文件（或视频目录）的定位：Space 条目，或某个会话工作目录、项目目录里的相对路径。 */
export type FileTarget = { entryId: Id } | { conversationId: Id; path: string } | { projectId: Id; path: string };

/** `projects.files.list` 的一项。`path` 相对根目录，用 `/` 分隔，可以原样交给 `{ conversationId, path }`。 */
export interface ProjectFileEntry {
  path: string;
  name: string;
  isDir: boolean;
  /** 文件的字节数；目录为 null。 */
  size: number | null;
  /** 最后修改时间；视频目录取 `video.db` 的修改时间。 */
  modifiedAt: string | null;
  /** 认得出的媒体与文档类型（与 Space 同一套分类）；含 `video.db` 的目录是 `video`；其余为 null。 */
  kind: SpaceEntryKind | null;
}

export interface ProjectFilesList {
  /** 根目录的绝对路径（登记的路径，不解析符号链接）。 */
  root: string;
  entries: ProjectFileEntry[];
  /** 超过 `limit` 或查找的上限，只返回了一部分。 */
  truncated: boolean;
}

/** 一个已打开的视频里的素材版本。不给版本时取当前版本。 */
export interface AssetTarget {
  videoId: Id;
  assetId: Id;
  revision?: Revision;
}

/** 会话里某条用户消息带的附件（`AttachmentRef.id`）。只读：媒体通道核对它确实出现在这条会话的消息里。 */
export interface AttachmentTarget {
  conversationId: Id;
  attachmentId: Id;
}

/**
 * 媒体通道的定位：文件，或一个已打开的视频里的素材（受管理的素材在视频目录的 `blobs/` 里），
 * 或会话里某条消息附的图片。
 */
export type MediaTarget = FileTarget | AssetTarget | AttachmentTarget;

export interface VideoOpenResult {
  ref: VideoRef;
  /** 订阅 `video:<id>` 主题之前的首份快照；界面随后订阅主题，从它的序号接上。 */
  snapshot: VideoTopicSnapshot;
}

export interface EditResult {
  receipt: TransactionReceipt;
  /** 同一个 `commandId` 重试时为 true：返回的是第一次提交的回执，没有再提交一次。 */
  replayed: boolean;
}

export interface SubtitleTrack {
  /** 取这个字幕文件用的定位，与视频同一个来源目录。 */
  target: FileTarget;
  fileName: string;
  /** 与视频同名（去掉扩展名之后相同，或只多出语言之类的后缀）。同名的排在前面。 */
  matched: boolean;
  /** 同名时视频名之后的部分，例如 `zh`、`en.forced`；没有时为 null。 */
  tag: string | null;
}

export type FileContentKind = 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'archive' | 'binary';
export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

/** `progress`：兼容副本编码到了源时长的几成（0–1）；还不知道时省略。 */
export type MediaPlayback = { status: 'pending'; retryAfterMs: number; progress?: number } | { status: 'ready'; media: MediaHandle };

export interface MediaHandle {
  /** Runtime 根据至多 64 KiB 的文件前缀识别；旧 Runtime 可以不提供。 */
  contentKind?: FileContentKind;
  textEncoding?: TextEncoding;
  url: string;
  mimeType: string;
  size: number;
  fileName: string;
  expiresAt: string;
}

/** 要找的一个字体 face：族名、字重（1–1000）与是否斜体（排字时点的名）。 */
export interface FontFaceQuery {
  family: string;
  weight: number;
  italic: boolean;
}

/**
 * 把字体文件里的一个 face 抽成单独的字体：新字体共 `size` 字节，开头是 `header`（十六进制），其余每张表从原文件的
 * `from` 起取 `length` 个字节放到新字体的 `to` 处（表之间的空隙是 0）。
 */
export interface FontFaceLayout {
  faceIndex: number;
  /** 原文件的字节数。 */
  fileSize: number;
  size: number;
  header: string;
  tables: { from: number; length: number; to: number }[];
}

/**
 * 找不到一个 face 的原因：`not-found` 本机与下载缓存都没有这个族（也不在字体目录里）；`too-large` 有，但抽出来超过上限；
 * `downloadable` 在字体目录里、没下载（自动下载关着、严格离线，或这次没要求下载）；`downloading` 正在下载（`jobId`），
 * 下载完再问一次就有；`download-failed` 最近一次下载失败（`code`），过一会儿或用 `fonts.download` 再试。
 */
export type FontMissingReason = 'not-found' | 'too-large' | 'downloadable' | 'downloading' | 'download-failed';

/** `fonts.resolve` 的结果：找到的 face（按请求的次序，重复的只给一次）与它所在文件的读取句柄，找不到的与原因。 */
export interface FontsResolveResult {
  /** `source`：`local` 本机字体，`downloaded` 下载缓存。 */
  faces: (FontFaceQuery & FontFaceLayout & { source: 'local' | 'downloaded'; file: MediaHandle })[];
  missing: (FontFaceQuery & { reason: FontMissingReason; jobId?: Id; code?: FontDownloadErrorCode | 'CANCELLED' })[];
}

/**
 * 素材声音的峰值。`peaks` 是 base64 编码的字节，一个字节一格：那段源时间里（声道混合之后）的最大绝对振幅，
 * 0–255 对应静音到满幅，没有归一化。第 `i` 格从源时间 `i / binsPerSecond` 秒开始。素材没有声音时是 `no-audio`。
 */
export type MediaPeaks =
  { status: 'ready'; binsPerSecond: number; peaks: string } | { status: 'pending'; retryAfterMs: number } | { status: 'no-audio' };

export interface MediaThumbnail {
  mimeType: 'image/jpeg';
  /** base64 编码的图片。 */
  data: string;
  /** 实际取帧的源时间（秒）：请求的时间按 0.1 秒取整、限制在素材时长之内。 */
  at: number;
}

export type RpcMethod = keyof RpcMethods;
export type RpcParams<M extends RpcMethod> = RpcMethods[M]['params'];
export type RpcResult<M extends RpcMethod> = RpcMethods[M]['result'];

/**
 * Agent 列表与偏好：设置页与会话选择器共用。`drivers` 是每个 Driver 最近一次的探测结果（启动时来自磁盘缓存，`checkedAt`
 * 是那次探测的时间）；还没有任何结果、正在首次探测的 Driver 不在里面，列在 `checking`。`agents` 主题推送新视图。
 */
export interface AgentsView {
  drivers: DriverInfo[];
  checking: DriverId[];
  preferences: AgentPreferences;
}
