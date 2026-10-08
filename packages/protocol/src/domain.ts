import type { AgentMode, RiskLevel } from './access.ts';
import type { TaskContract } from './tasks.ts';
import type { TemplateMessageRef } from './template.ts';
import type { SkillMessageRef } from './skill.ts';
import type { MessageRef } from './message-ref.ts';

/**
 * 会话侧的领域对象（架构设计 §1.5、§3.10）。
 *
 * 这些是 Runtime Store 的权威对象在线上的 DTO。视频、序列、素材等视频领域类型由
 * Rust 单源生成（架构设计 §13.2），0.1 还没有视频引擎，所以这里没有它们。
 */

export type Id = string;

/** 十进制字符串形式的序号（D06：避免 64 位整数在 JSON 中丢精度）。 */
export type Seq = string;

/** 项目：一个目录，也是智能体的工作目录（产品设计 §2.3）。 */
export interface Project {
  id: Id;
  /** 显示名。改名只改登记，不动目录。 */
  name: string;
  path: string;
  createdAt: string;
  lastActiveAt: string;
  pinned: boolean;
  /** 归档只影响列表显示（产品设计 §3.1）。 */
  archived: boolean;
}

/** 会话的活动状态，侧栏徽标由它汇总（架构设计 §11.3）。 */
export type ConversationActivity = 'idle' | 'running' | 'stopping' | 'awaiting-approval' | 'failed';

export interface Conversation {
  id: Id;
  title: string;
  /**
   * 可空：不属于任何项目的会话（架构设计 §3.10）。可以从 null 绑定一次（第一次新建视频时 Runtime 建项目并绑定，经
   * `conversation.upsert` / `conversation.updated` 推送），之后不改绑到另一个项目。
   */
  projectId: Id | null;
  /** 智能体的工作目录：项目目录，或无项目会话的临时目录（绑定项目后换成项目目录）。 */
  cwd: string;
  /** 会话的 Agent。没有任务之前可以换，之后固定（原生会话不能跨 Agent 续）。 */
  driverId: DriverId;
  /** 模型 id，来自 `DriverInfo.models`；null = 不传模型，用 Agent 自己的默认（`configModel`）。下一轮生效。 */
  model: string | null;
  /** 推理强度 id，来自所选模型的 `efforts`；null = 模型默认。下一轮生效。 */
  effort: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  pinned: boolean;
  /** 任务结束后还没被看过：侧栏的「已完成未读」（产品设计 §3.1）。 */
  unread: boolean;
  activity: ConversationActivity;
  activeTaskId: Id | null;
  /**
   * 会话的访问模式（架构设计 §3.12）：用 `conversations.update` 或发送参数切换，对之后的动作生效。
   * null（或旧记录没有）表示还没切换过：每次发送时取 `agent.defaultAccessMode`。
   */
  accessMode?: AgentMode | null;
  /**
   * 从 Space 条目继续会话时附上、还没发出去的引用（`space.continueInConversation`，架构设计 §5.7）。下一次发送时附在消息后面，
   * 发出后清空。没有时省略。
   */
  pendingReferences?: SpaceEntryReference[];
}

/**
 * 会话里对一个 Space 条目的引用（架构设计 §5.7「从条目继续会话」）：只有条目的标识与元数据，不含文件内容；
 * 智能体要内容时经工具按 `entryId`、`videoId` 或 `artifactId` 去取，照常受范围与审批约束。
 */
export interface SpaceEntryReference {
  entryId: Id;
  kind: SpaceEntryKind;
  name: string;
  projectId: Id | null;
  /** 在来源目录里时的相对路径；产物与占位为 null。 */
  relPath: string | null;
  videoId: Id | null;
  artifactId: string | null;
  status: SpaceEntryStatus | null;
  /** 来源摘要：生成或导出它的能力、任务与会话、导出冻结的视频版本。不含生成参数。 */
  origin: Pick<SpaceEntryOrigin, 'source' | 'capability' | 'jobId' | 'conversationId' | 'videoRevision'> | null;
  attachedAt: string;
}

/**
 * 内置的智能体引擎（架构设计 §3.1）。顺序就是设置页与选择器里的顺序：前五个（Claude、Codex、Copilot、Pi、OpenCode）常驻主列表，
 * 后四个（Gemini CLI、Cursor Agent、Grok、Kimi Code）没检测到时在「更多」折叠段里（主列表与折叠段的划分由界面静态持有）。
 * Copilot 与后四个经 Agent Client Protocol（ACP）的同一份实现接入。
 * 表里有不等于这一版已经注册了它：`agents.list` 只列 Runtime 注册了的 Driver。
 */
export const BUILTIN_DRIVER_IDS = ['claude', 'codex', 'copilot', 'pi', 'opencode', 'gemini', 'cursor', 'grok', 'kimi'] as const;
export type BuiltinDriverId = (typeof BUILTIN_DRIVER_IDS)[number];

/**
 * 智能体引擎的 id：内置的（`BUILTIN_DRIVER_IDS`），或用户添加的 ACP 智能体（`agents.addProvider`）。
 * 都是小写字母开头的小写字母、数字与连字符，最长 63 个字符（`DRIVER_ID_PATTERN`）；自定义的不得与内置的重名。
 */
export type DriverId = string;

/** Driver id 的写法：与偏好设置 `agent.defaultDriver` 的校验一致。 */
export const DRIVER_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;

export function isDriverId(value: unknown): value is DriverId {
  return typeof value === 'string' && DRIVER_ID_PATTERN.test(value);
}

export function isBuiltinDriverId(value: unknown): value is BuiltinDriverId {
  return (BUILTIN_DRIVER_IDS as readonly unknown[]).includes(value);
}

/**
 * 用户添加的 ACP 智能体（`agents.addProvider`，架构设计 §3.11），存在 Runtime Home 的 `store/agent-providers.json`。
 * `command` 的第一个元素是可执行文件（PATH 上的名字或绝对路径），其余是以 ACP（stdio）启动它的参数，
 * 例如 `["npx", "-y", "@google/gemini-cli@0.52.0", "--acp"]`。`env` 是启动它时另加的环境变量，可能含密钥：只在 Runtime 里，
 * 不进 `AgentsView`、不写日志。
 */
export interface CustomAgentProvider {
  id: DriverId;
  name: string;
  command: string[];
  env?: Record<string, string>;
  addedAt: string;
}

/** `AgentsView` 里一个用户添加的智能体的配置：环境变量只给名字，不给值。 */
export interface CustomAgentProviderView {
  command: string[];
  envKeys: string[];
  addedAt: string;
}

export function customAgentProviderView(provider: CustomAgentProvider): CustomAgentProviderView {
  return { command: [...provider.command], envKeys: Object.keys(provider.env ?? {}), addedAt: provider.addedAt };
}

/**
 * 0.1 的自主模式，旧值（产品设计 §7.1）。仍被协议与设置接受，按 `normalizeAgentMode` 换成新的访问模式：
 * `controlled` → `ask`，`authorized` → `fullAccess`，`plan` 不变。新代码用 `AgentMode`（`access.ts`）。
 */
export type Autonomy = 'plan' | 'controlled' | 'authorized';

/**
 * 任务的访问模式从哪里来：发送时显式给出、会话切换过的模式、用户设的默认值（`agent.defaultAccessMode`），或内置默认。
 */
export type AutonomySource = 'request' | 'conversation' | 'setting' | 'default';

export type TaskStatus = 'running' | 'stopping' | 'completed' | 'stopped' | 'failed';

export type ToolCallKind = 'command' | 'file-change' | 'mcp' | 'web-search' | 'other';
/** `interrupted`：回合结束时步骤仍未收到终态，不能当成完成。 */
export type ToolCallStatus = 'running' | 'completed' | 'failed' | 'declined' | 'interrupted';

/**
 * 审批的内容。`tool` 是工具调用（架构设计 §3.12）：BaoCut 自己的工具，或 Agent 自带的工具（Claude 的 WebFetch 之类）；
 * `files` 放目标（视频、文件），`reason` 放参数摘要，只认 `command` 与 `file-change` 的旧界面按文件修改显示它也不出错。
 * `server`：MCP 服务名，BaoCut 自己的是 `baocut`，Agent 自带的工具为 null。
 * `rule`：选「总是允许」时存下的规则（命令取 `bcut <子命令>` 或第一个词，工具取工具名），由 Driver 或工具目录算好；
 * null 或没有表示这一类不提供「总是允许」。
 */
export type ApprovalRequest =
  | { kind: 'command'; command: string; cwd: string | null; reason: string | null; rule?: string | null }
  | { kind: 'file-change'; reason: string | null; files: string[]; rule?: string | null }
  | { kind: 'tool'; tool: string; reason: string | null; files: string[]; server?: string | null; rule?: string | null };

/**
 * - `accept-for-session`：对 Driver 原样转交（原生侧的会话级放行）；对 BaoCut 工具是「这个任务里同一个工具不再问」，
 *   只在内存里，任务结束即失效（架构设计 §3.12）。
 * - `accept-always`：存一条规则到 `AgentPreferences.rules`，以后所有会话都按它自动批准。规则只归 BaoCut 管：
 *   Driver 不得把它写进原生的持久设置（Claude 的 userSettings / projectSettings），否则设置页里「移除规则」是假的；
 *   原生侧最多按本次允许或会话级放行处理。
 */
export type ApprovalDecision = 'accept' | 'accept-for-session' | 'accept-always' | 'decline';
export type ApprovalStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
/**
 * 谁做的决定：用户点的、按访问模式自动（允许或拒绝，架构设计 §3.12 的 `auto`），或按「总是允许」规则自动允许的。
 * `rule` 是在 §3.12 之上加的一层：查表得到「询问」时才看规则，命中就自动允许；查表是「拒绝」的不放行，对外发数据的审批也不看规则。
 */
export type ApprovalDecider = 'user' | 'auto' | 'rule';

interface TimelineBase {
  id: Id;
  createdAt: string;
  /** 所属任务；用户消息与任务卡片自己也带上，便于按任务分组。 */
  taskId: Id | null;
}

/**
 * 会话里的一条内容（产品设计 §3.2.2）：用户消息、智能体回复、执行步骤、审批与任务卡片。
 * 卡片状态来自事件与回执，不来自模型的自然语言（架构设计 §11.3）。
 */
export type TimelineItem =
  | (TimelineBase & {
      kind: 'user-message';
      text: string;
      context?: EditorContext;
      references?: SpaceEntryReference[];
      attachments?: AttachmentRef[];
      /** 发送时挂上的场景模板（模板包规范 §5.2）：只是标记，提示词正文与简报引导只交给智能体，不在 `text` 里。 */
      template?: TemplateMessageRef;
      /** 发送时点选的 skill（架构设计 §3.8）：只是标记，`SKILL.md` 正文只交给智能体，不在 `text` 里。 */
      skill?: SkillMessageRef;
    })
  | (TimelineBase & { kind: 'agent-message'; text: string; streaming: boolean })
  | (TimelineBase & { kind: 'reasoning'; text: string; streaming: boolean })
  | (TimelineBase & {
      kind: 'tool-call';
      tool: ToolCallKind;
      title: string;
      detail: string | null;
      output: string;
      status: ToolCallStatus;
      exitCode: number | null;
      durationMs: number | null;
    })
  | (TimelineBase & {
      kind: 'approval';
      approvalId: Id;
      request: ApprovalRequest;
      status: ApprovalStatus;
      decidedAt: string | null;
      /** 动作的风险等级与当时生效的访问模式（§3.12）。旧记录没有。 */
      risk?: RiskLevel;
      mode?: AgentMode;
      /** 谁做的决定：按模式自动、按「总是允许」规则，或用户。取消的与旧记录没有。 */
      decidedBy?: ApprovalDecider;
      /**
       * 用户点的是哪个答案（只在 `decidedBy: 'user'` 时有）：界面据此把「总是允许」写成「之后 <规则> 不再问」。
       * 早先的记录没有这个字段。
       */
      decision?: ApprovalDecision;
    })
  | (TimelineBase & {
      kind: 'task';
      goal: string;
      status: TaskStatus;
      startedAt: string;
      endedAt: string | null;
      error: string | null;
      /** `error` 的消息引用（message-ref.ts）：BaoCut 自己写的原因带上，界面按当前语言重新生成；Agent 的原话没有。 */
      errorRef?: MessageRef;
      /**
       * 任务开始时的访问模式与它的来源（架构设计 §3.12、§5.10）。旧记录没有，旧值在读入时换成新值。
       * 任务进行中切换模式不改它：切换记在会话的提示（`modeChange`）里。
       */
      autonomy?: { mode: AgentMode; source: AutonomySource };
      /** 可恢复的失败原因，界面据此给出「去登录」「换个模型重发」这类出路。 */
      errorCode?: AgentErrorCode | null;
      /** 任务合同的当前修订（架构设计 §3.2）。旧记录没有，读入时补上默认合同。历史修订经 `tasks.getContract` 查。 */
      contract?: TaskContract;
    })
  | (TimelineBase & {
      kind: 'notice';
      level: 'info' | 'warning' | 'error';
      text: string;
      /** `text` 的消息引用（message-ref.ts）：BaoCut 自己写的提示带上，界面按当前语言重新生成；Agent 的原话没有。 */
      textRef?: MessageRef;
      /** 切换访问模式的记录（§3.12）。 */
      modeChange?: { from: AgentMode; to: AgentMode };
    })
  | (TimelineBase & VideoChange & { kind: 'video-change' })
  | (TimelineBase & VideoCreated & { kind: 'video-created' });

export type TimelineItemKind = TimelineItem['kind'];

/**
 * 智能体在这条会话里新建了一部视频（`videos_create`，架构设计 §3.5）：视频一存在，线程里的视频卡就出现，随时能打开编辑器
 * （产品设计 §3.2.2）。固定流程新建的视频（从链接导入、转录的 `target.create`）不另记：父任务记录补上 `videoId` 时界面就看得到。
 * 不是变更卡：新建没有撤销，删视频是 §4.9 的另一个操作。
 */
export interface VideoCreated {
  videoId: Id;
  videoName: string;
  /** 在编辑器里打开这个视频；与 `VideoChange.target` 同一个写法。 */
  target: VideoChange['target'];
  videoRevision: string;
}

/**
 * 回合失败的结构化原因（架构设计 §3.11）。Driver 从原生错误里认出来（Claude 的 `authentication_failed`、
 * `model_not_found`、`billing_error`，Codex 的登录与模型错误），认不出的为 null，界面只显示原文。
 * `AGENT_BILLING_REQUIRED`：账号的余额或付款有问题（Claude 的 `billing_error`），要用户在服务商那边处理，等待不会恢复；
 * 套餐用量到顶、限流仍是 `AGENT_RATE_LIMITED`。
 * `AGENT_ACCESS_MODE_UNSUPPORTED`：这个 Agent 没有逐次审批的通道（`capabilities.approvals` 为 false），只能在 `fullAccess` 下运行；
 * Harness 在发送与切换模式时拒绝（`RpcError.code` 为 `conflict`，放在 `details.code`，§3.12），不替用户改模式。
 */
export const AGENT_ERROR_CODES = [
  'AGENT_AUTH_REQUIRED',
  'AGENT_MODEL_UNAVAILABLE',
  'AGENT_NOT_INSTALLED',
  'AGENT_OUTDATED',
  'AGENT_RATE_LIMITED',
  'AGENT_BILLING_REQUIRED',
  'AGENT_EXITED',
  'AGENT_ACCESS_MODE_UNSUPPORTED',
] as const;
export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

/**
 * 消息里的一张图片（产品设计 §3.2.4）。字节经 `attachments.prepare` 拿到的上传地址 PUT 到 Runtime，
 * 存在 Runtime Home 下；发给 Agent 时 Harness 换成本地路径。
 */
export interface AttachmentRef {
  id: Id;
  kind: 'image' | 'file';
  fileName: string;
  mimeType: string;
  size: number;
}

/**
 * 发送时编辑器里的上下文（产品设计 §5.3、架构设计 §3.4）：打开的视频、看到的版本、选中的片段与播放头。
 * 绑定的是稳定的 ID 与当时的版本，不是屏幕位置。
 */
export interface EditorContext {
  videoId: Id;
  videoName: string;
  /** 视频目录，相对来源目录（项目目录或会话的工作目录）。 */
  videoPath: string;
  revision: string;
  /** 选中的时间线片段。 */
  selection: Id[];
  playheadSeconds: number;
}

/**
 * 变更卡（产品设计 §6.5）：智能体经视频引擎提交的一笔修改。内容全部来自事务回执，不来自模型的说法。
 */
export interface VideoChange {
  videoId: Id;
  videoName: string;
  /** 在编辑器里打开这个视频。 */
  target: { projectId: Id; path: string } | { conversationId: Id; path: string };
  transactionId: Id;
  label: string;
  previousRevision: string;
  videoRevision: string;
  createdIds: Id[];
  updatedIds: Id[];
  deletedIds: Id[];
  durationSeconds: { before: number; after: number };
  /** 这一笔是撤销哪一笔。 */
  undoOf: Id | null;
}

/** 能力的三层（架构设计 §3.6）。 */
export type CapabilityLevel = 'declared' | 'verified' | 'effective';

export type DriverUnavailableReason = 'not-installed' | 'not-connected' | 'no-permission' | 'unsupported' | 'resource';

/**
 * 一个 Agent 在这台电脑上的状态（架构设计 §3.11）。多个问题同时存在时按设计稿的优先级取一个：
 * 没装 > 出错 > 版本太旧 > 没登录 > 已停用 > 可用。
 */
export type DriverState = 'ready' | 'not-installed' | 'outdated' | 'signed-out' | 'error' | 'disabled';

/** 模型的定位：推荐、最强、最快。界面据此排序与标注。 */
export type ModelTier = 'balanced' | 'max' | 'fast';

export interface DriverEffort {
  /** 原生的强度 id（Claude 与 Codex 都是 `low` / `medium` / `high` 一类）。中文标签由界面映射。 */
  id: string;
  label: string;
}

export interface DriverModel {
  id: string;
  label: string;
  description: string | null;
  tier: ModelTier | null;
  /** Agent 自己标的默认模型。 */
  isDefault: boolean;
  /** 空数组 = 这个模型不分推理强度。 */
  efforts: DriverEffort[];
  defaultEffort: string | null;
}

/**
 * 安装或升级这个 Agent 的一种方式。命令原样给用户看，也可以替用户放进终端，不在后台执行。
 * 「不在后台执行」指不在用户看不见的地方悄悄跑：`brew`、`npm` 类经用户逐次确认后可以由 Runtime 在应用内运行
 * （`agents.runSetup`，输出显示在设置页里并记入日志，架构设计 §12.9）；`script` 类（从网络下载并运行脚本）
 * 只给复制或 `agents.openTerminal`。
 */
export interface DriverInstallOption {
  kind: 'script' | 'brew' | 'npm';
  label: string;
  /** `label` 的消息引用（message-ref.ts）。 */
  labelRef?: MessageRef;
  /** 前提，例如 Homebrew、Node.js。 */
  needs: string | null;
  /** `needs` 的消息引用（message-ref.ts）。 */
  needsRef?: MessageRef;
  command: string;
  upgrade: string;
}

/** 应用内运行的安装动作：安装或升级（登录只在系统终端里做，见 `agents.openTerminal`）。 */
export type AgentSetupAction = 'install' | 'upgrade';

export type AgentSetupState = 'running' | 'completed' | 'failed' | 'cancelled';

/** 一次应用内运行最多保留的输出行数（与设计稿的日志上限一致）；更早的行丢掉，`droppedLines` 记丢了多少。 */
export const AGENT_SETUP_OUTPUT_LINES = 400;

/**
 * 一次应用内运行的安装或升级命令（`agents.runSetup`，架构设计 §12.9）。只在 Runtime 内存里，不持久化。
 * 结束后 Runtime 先重新探测 Agent，再送出终态：收到终态时 `agents.list` 已经是新结果。
 */
export interface AgentSetupRun {
  runId: Id;
  driverId: DriverId;
  action: AgentSetupAction;
  kind: DriverInstallOption['kind'];
  /** 实际运行的完整命令：Runtime 从探测结果里取的，不是客户端给的。 */
  command: string;
  state: AgentSetupState;
  /** 进程的退出码；被信号结束、没能启动时为 null。 */
  exitCode: number | null;
  /** 合并的 stdout 与 stderr，按行，去掉了终端控制序列；只留最后 `AGENT_SETUP_OUTPUT_LINES` 行。 */
  output: string[];
  droppedLines: number;
  startedAt: string;
  endedAt: string | null;
  /** 没能启动之类的原因（非 0 退出不算，看 `exitCode`）。 */
  error: string | null;
}

/**
 * Driver 探测到的事实（不含用户偏好）。`status` / `unavailableReason` 是粗粒度的旧字段，
 * 由 `state` 推出（见 `driverAvailability`），模型服务等只关心能不能用的调用方继续用它们。
 */
export interface DriverProbe {
  id: DriverId;
  name: string;
  /** 终端里敲的名字。 */
  command: string;
  state: Exclude<DriverState, 'disabled'>;
  status: 'available' | 'unavailable';
  version: string | null;
  /** BaoCut 能驱动的最低版本；空串表示没有要求（用户添加的智能体）。 */
  minVersion: string;
  /** 已知的上游最新版本；不知道为 null。 */
  latestVersion: string | null;
  unavailableReason: DriverUnavailableReason | null;
  /** 给人看的问题描述（出错原文、为什么不可用）。 */
  detail: string | null;
  /** `detail` 的消息引用（message-ref.ts）：探测结果会缓存到磁盘，界面按当前语言重新生成。 */
  detailRef?: MessageRef;
  executable: string | null;
  /** 链接解析到底的真实位置，用来认出它归谁管（Homebrew、npm……），推出对应的升级命令。 */
  realExecutable: string | null;
  /** 已登录的账号描述（例如「Claude Pro 订阅」）；没登录或不知道为 null。 */
  account: string | null;
  /** `account` 的消息引用（message-ref.ts）。 */
  accountRef?: MessageRef;
  /** 需要什么订阅，例如「Claude Pro 或 Max 订阅」。 */
  plan: string;
  /** `plan` 的消息引用（message-ref.ts）。 */
  planRef?: MessageRef;
  /** 在终端里登录的命令。 */
  loginCommand: string | null;
  install: DriverInstallOption[];
  models: DriverModel[];
  /** 不传模型时 CLI 自己的配置会选哪个（Codex 读 `~/.codex/config.toml`），以及这一版 CLI 的模型表里有没有它。 */
  configModel: string | null;
  configModelKnown: boolean | null;
  checkedAt: string;
  /**
   * 这个 Driver 经过集成测试（架构设计 §3.11 的 D08）。false 时只显示探测结果，不能用来开始会话：Harness 拒绝发送
   * （`driver-unavailable`）。它是 Driver 这一版的事实，不随本机的安装或登录变化。
   */
  verified: boolean;
  /**
   * 这一家在 BaoCut 里真机跑通过完整会话。同一协议的共享实现（ACP）在一家真机验证通过即算验证（`verified`），其余预设与用户添加的
   * 智能体能开会话，但 `tested` 为 false，界面提示「未在 BaoCut 实测」。与 `verified` 一样是 Driver 这一版的事实。
   */
  tested: boolean;
  capabilities: {
    steer: boolean;
    approvals: boolean;
    resume: boolean;
    images: boolean;
  };
}

/** 一个智能体引擎的能力快照条目（架构设计 §3.6、§3.11）：探测结果加上用户偏好。 */
export interface DriverInfo extends Omit<DriverProbe, 'state'> {
  state: DriverState;
  /** `builtin`：BaoCut 自带的 Driver；`custom`：用户添加的 ACP 智能体，可以用 `agents.removeProvider` 移除。 */
  source: 'builtin' | 'custom';
  /** 用户添加的智能体的配置；内置的为 null。 */
  custom: CustomAgentProviderView | null;
  enabled: boolean;
  /** 新会话默认用它。 */
  isDefault: boolean;
  /**
   * 新会话起手用的模型：用户设过的模型 id（从模型表里消失了也原样给出，新会话改用推荐模型）；没设过时是推荐模型
   * （`recommendedDriverModel`，还没有模型表时为 null）；null = 用户明确选了「Agent 默认模型」，不传模型，按 CLI 配置。
   * 默认 Agent 没设过时先看偏好设置 `agent.defaultModel`。
   */
  defaultModel: string | null;
  /** 新会话的默认强度；null = 模型自己的默认。 */
  defaultEffort: string | null;
  /** 用户手动指定的可执行文件。 */
  executableOverride: string | null;
}

/**
 * 「Agent 默认模型」的存法：Agent 偏好的 `defaultModel` 与偏好设置 `agent.defaultModel` 存这个值，表示用户明确选了
 * 不传模型、按 Agent 自己的 CLI 配置走。null 是没设过，用推荐模型（`recommendedDriverModel`）。不会与原生模型 id 相撞
 * （Cursor 就有一个叫 `auto` 的模型）。只在存储里出现：`DriverInfo.defaultModel` 与会话的 `model` 用 null 表示它，
 * `agents.configure { defaultModel: null }` 存成它。
 */
export const AGENT_DEFAULT_MODEL = '__agent-default__';

/** 各家的推荐系列（2026-09-29 用户裁决）：Claude Code 取 Sonnet，Codex 取 `-sol` 结尾的那一档，免得默认落到最贵的模型上。 */
const RECOMMENDED_FAMILY: Partial<Record<DriverId, (model: DriverModel) => boolean>> = {
  claude: (m) => /sonnet/i.test(m.id),
  codex: (m) => /-sol$/i.test(m.id),
};

/**
 * 推荐模型：没设过默认模型的新会话用它（设计稿 model-agent-setup.js `recommended`）。按这一版 CLI 自己的模型表次序取：
 * Claude Code 第一个 Sonnet、Codex 第一个 `-sol`；其余几家（以及这两家表里没有这一系列时）取第一个标了 `balanced` 的，
 * 再不然是 Agent 标的默认，再不然是第一个。模型表为空时为 null（不传模型）。
 */
export function recommendedDriverModel(driverId: DriverId, models: readonly DriverModel[]): DriverModel | null {
  const family = RECOMMENDED_FAMILY[driverId];
  return (
    (family && models.find(family)) || models.find((m) => m.tier === 'balanced') || models.find((m) => m.isDefault) || models[0] || null
  );
}

/** `state` 推出旧的粗粒度字段。 */
export function driverAvailability(state: DriverState): Pick<DriverProbe, 'status' | 'unavailableReason'> {
  switch (state) {
    case 'ready':
      return { status: 'available', unavailableReason: null };
    case 'not-installed':
      return { status: 'unavailable', unavailableReason: 'not-installed' };
    case 'outdated':
      return { status: 'unavailable', unavailableReason: 'unsupported' };
    case 'signed-out':
      return { status: 'unavailable', unavailableReason: 'not-connected' };
    case 'disabled':
      return { status: 'unavailable', unavailableReason: 'no-permission' };
    case 'error':
      return { status: 'unavailable', unavailableReason: 'resource' };
  }
}

/**
 * 放行策略的三个开关（设置 › 权限与安全「减少重复询问」，设计稿）。架构设计 §3.12 规定只读动作（`read`）在任何模式下
 * 都直接执行、不经审批，所以 `read` 与 `bcutro` 覆盖的只读工具本来就不问；`loop`（应答环）在这个架构里没有对应的工具。
 * 三个开关只存下用户的选择供设置页显示，不参与审批判定。
 */
export interface AgentPolicy {
  /** 读取视频文件（transcript、project 之类的只读工具）自动允许。 */
  read: boolean;
  /** BaoCut 只读命令（info / status / spec）自动允许。 */
  bcutro: boolean;
  /** Agent 应答环（task claim / task submit）自动允许。 */
  loop: boolean;
}

/**
 * Agent 的用户偏好（设置 › Agent 提供方），存在 Runtime Home 里。新会话默认用哪个 Agent、默认访问模式是偏好设置
 * `agent.defaultDriver`、`agent.defaultAccessMode`（`settings.*`，架构设计 §5.10），不在这里。
 */
export interface AgentPreferences {
  drivers: Partial<Record<DriverId, AgentDriverPreferences>>;
  policy: AgentPolicy;
  /** 启动时和运行期间定期更新各 Agent 的模型表。 */
  modelAutoUpdate: boolean;
  /** 「总是允许」存下的规则，按添加顺序。 */
  rules: string[];
}

export interface AgentDriverPreferences {
  enabled: boolean;
  /** 模型 id；`AGENT_DEFAULT_MODEL` = 明确选了「Agent 默认模型」；null = 没设过，用推荐模型。 */
  defaultModel: string | null;
  defaultEffort: string | null;
  executable: string | null;
}

export interface RuntimeInfo {
  instanceId: Id;
  /** Runtime 的运行代：每次启动不同。客户端发现它变了就丢掉增量游标，重取快照。 */
  epoch: string;
  runtimeVersion: string;
  protocolVersion: string;
  home: string;
  /** 「新建项目」放在这里。 */
  projectsDir: string;
  logsDir: string;
  pid: number;
  startedAt: string;
  /**
   * 谁拉起了这个 Runtime（架构设计 §2.2）：`cli` 是 CLI 自动拉起或 `baocut runtime ensure` 拉起的（空闲满设置
   * `runtime.idleExitMinutes` 自己退出，`baocut runtime stop` 只停这种）；其余（桌面端、`npm run runtime`）为 null。
   */
  launchedBy: RuntimeLauncher | null;
}

export type RuntimeLauncher = 'cli';

/**
 * `runtime.status` 的结果（架构设计 §2.2）：给 `baocut runtime status` 与 `runtime stop` 判断有没有别人在用。
 * 连接只数本机网关上已认证的连接（Web 服务与对外服务走自己的端口，不在这里）。
 */
export interface RuntimeStatus {
  info: RuntimeInfo;
  connections: { desktop: number; cli: number; agent: number };
  /** 还没结束（排队或运行中）的任务数。 */
  activeJobs: number;
  /** 开着的对外服务（MCP、模型接口、Web、局域网共享）。 */
  runningServices: string[];
  /** 空闲退出（只有 CLI 拉起的 Runtime 有）：设置的分钟数，与从什么时候起空闲（不空闲时 null）。 */
  idleExit: { minutes: number; idleSince: string | null } | null;
}

/** 任务中心的一行（产品设计 §2.1）：从会话里的任务卡片派生，不另存。 */
export interface TaskSummary {
  taskId: Id;
  conversationId: Id;
  conversationTitle: string;
  projectId: Id | null;
  goal: string;
  status: TaskStatus;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  /** `error` 的消息引用（message-ref.ts），取自任务卡片的 `errorRef`：界面按当前语言重新生成。 */
  errorRef?: MessageRef;
  /** 任务合同的当前修订号；没有合同的旧任务没有。 */
  contractRevision?: number;
}

/**
 * Space 条目（架构设计 §5.7）。目录是派生索引，条目有四种来源：
 *
 * - 来源目录（登记的项目目录、不属于项目的会话的工作目录）里认得出的文件与视频目录；视频条目带 `ref.videoId`；
 * - Artifact Store 里可交付的产物（生成的图片、音频、文本；不在来源目录里的导出），`id` 是 artifactId；
 * - Job Ledger 里进行中与失败的生成、导出：`generating` / `failed` 的占位，`id` 是 jobId，没有 bytes；
 * - 经 `space.import` 登记的项目文件（与来源目录里的同一个文件是同一个条目，`origin.source` 为 `imported`）。
 *
 * 发布到来源目录里的导出与扫描到的那个文件是同一个条目（`id` 由来源与相对路径决定），带上导出的来源与状态。
 * `status` 为 null 表示没有可说的状态（普通文件、视频）。
 */
export type SpaceEntryKind = 'video' | 'export' | 'video-file' | 'image' | 'audio' | 'subtitle' | 'document' | 'package' | 'template';

export type SpaceEntryStatus = 'generating' | 'candidate' | 'applied' | 'published' | 'source-changed' | 'missing' | 'failed';

/** 条目从哪来（架构设计 §5.7 的 `origin`）。生成参数（原文、提示词）不在这里，只在 Job 记录里。 */
export interface SpaceEntryOrigin {
  source: 'generated' | 'imported' | 'exported';
  /**
   * 所属项目：产物取自产生它的视频或会话所属的项目；不属于任何项目时为 null。bytes 不在来源目录里的条目
   * （`source` 两项都是 null）靠它归到项目，`space.list` 的 `projectId` 筛选同时看两处。
   */
  projectId?: Id | null;
  /** 产生它的视频；导出时另有冻结的视频版本。 */
  videoId?: Id;
  videoRevision?: string;
  conversationId?: Id;
  taskId?: Id;
  jobId?: Id;
  /** 生成或导出它的能力（`synthesizeSpeech`、`generateImage`、`generateText`、`export`）。 */
  capability?: string;
  provider?: { providerId: string; modelId: string };
}

export interface SpaceEntry {
  id: Id;
  kind: SpaceEntryKind;
  /** 显示名：用户改过就是改后的名字，否则是文件名。 */
  name: string;
  fileName: string;
  /**
   * bytes 所在的来源目录：项目，或不属于项目的会话的工作目录。不在任何来源目录里的（Artifact Store 里的产物、来源目录之外的导出、
   * 占位）两者都为 null，这时 `relPath` 只是显示用的文件名，不能按来源目录拼路径；所属项目见 `origin.projectId`。
   */
  source: { projectId: Id | null; conversationId: Id | null };
  /** 相对来源目录的路径，用 `/` 分隔。 */
  relPath: string;
  size: number;
  lastActivityAt: string;
  /** ISO 时间；旧 Runtime 可不提供，无法确定时为 null。创建时间不使用文件的状态变更时间（ctime）。 */
  createdAt?: string | null;
  /** 内容的最近更新时间；与创建时间独立，旧 Runtime 可不提供。 */
  updatedAt?: string | null;
  status: SpaceEntryStatus | null;
  user: { favorite: boolean; displayName: string | null; trashedAt: string | null };
  /** 指向的对象：视频（视频条目）、产物（生成与导出的结果）或任务（占位）。普通文件没有。 */
  ref?: { videoId: Id } | { artifactId: string } | { jobId: Id };
  origin?: SpaceEntryOrigin;
  /** 状态的说明：失败与缺失的原因、进度、成片冻结的版本与视频当前的版本。 */
  statusDetail?: {
    reason?: string;
    code?: string;
    progress?: { done: number; total: number | null };
    currentRevision?: string;
  };
  media?: { mediaType?: string; durationSec?: number; width?: number; height?: number };
  /**
   * 结果写到磁盘上的文件（架构设计 §7.9「保存位置」）：取自任务结果的 `outputs[].path`——文件到文件的流程与导出发布的文件、
   * 直接任务另存的副本。文件不在了时没有；来源目录里扫描到的普通文件也没有（按来源目录与 `relPath` 拼）。
   */
  file?: { path: string };
}

/** 某个来源目录的扫描没有列全（文件太多或读不了），如实告诉界面。 */
export interface SpaceScanIssue {
  sourceKey: string;
  kind: 'truncated' | 'unreadable';
  detail: string;
}

/** Runtime 发现信息（架构设计 §2.2），写在 Runtime Home 下，权限 0600。 */
export interface RuntimeDiscovery extends RuntimeInfo {
  endpoint: string;
  token: string;
}
