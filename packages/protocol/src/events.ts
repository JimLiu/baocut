import type { ApprovalOutcome, PendingApproval } from './access.ts';
import type { AgentSetupRun, Conversation, Id, Project, Seq, SpaceEntry, SpaceScanIssue, TaskSummary, TimelineItem } from './domain.ts';
import type { GrantsEvent, GrantsSnapshot } from './grants.ts';
import type { JobsEvent, JobsSnapshot } from './jobs.ts';
import type { LibraryEvent, LibrarySnapshot } from './library.ts';
import type { AgentsView } from './methods.ts';
import type { ModelsEvent, ModelsSnapshot } from './models.ts';
import type { SettingsEvent, SettingsSnapshot } from './settings.ts';
import type { ServicesEvent, ServicesSnapshot } from './services.ts';
import type { VideoTopicEvent, VideoTopicSnapshot } from './video.ts';

/**
 * 订阅的主题（架构设计 §4.4、§4.5）：按资源订阅，一条连接多路复用。
 *
 * - `directory`：项目与会话列表（侧栏的投影）。
 * - `tasks`：所有会话的任务（任务中心与标题栏的进度），以及会话与对外服务的待处理审批。
 * - `space`：Space 目录（架构设计 §5.7）。
 * - `jobs`：长计算（语音识别等）的状态、阶段与进度（架构设计 §7）。
 * - `models`：模型服务的能力视图（`models.capabilities`，架构设计 §6.8）；配置、默认值、模型包或节点变化时送达新视图。
 * - `settings`：Runtime 持有的偏好设置（架构设计 §5.10）；快照是全部键的有效值与默认值，之后每次变化送 `settings.updated`。
 * - `services`：对外服务的状态与待处理的服务审批（架构设计 §4.8）。
 * - `library`：用户库的条目（架构设计 §5.9）。
 * - `grants`：数据外发的授权与用量（架构设计 §12.5）；快照是全部授权，之后每条授权的变化（发放、用量、撤销）送 `grant.upsert`。
 * - `agent-setup`：应用内运行的 Agent 安装与升级命令（`agents.runSetup`，架构设计 §12.9）的状态与输出。
 * - `agents`：Agent（Driver）的探测结果与偏好（`agents.list` 的视图，架构设计 §3.11）；快照是上次的结果（启动时来自磁盘缓存），
 *   每个 Driver 的后台探测完成、偏好变化时送 `agents.updated`。
 * - `conversation:<id>`：一个会话的内容（卡片投影）。
 * - `video:<id>`：一个已打开的视频的投影（命令与协议规范 §10）。
 *
 * 每个主题有自己的序号，彼此不共用游标。
 */
export type Topic =
  | 'directory'
  | 'tasks'
  | 'space'
  | 'jobs'
  | 'models'
  | 'settings'
  | 'services'
  | 'library'
  | 'grants'
  | 'agent-setup'
  | 'agents'
  | `conversation:${Id}`
  | `video:${Id}`;

export function conversationTopic(conversationId: Id): Topic {
  return `conversation:${conversationId}`;
}

export function parseConversationTopic(topic: string): Id | null {
  return topic.startsWith('conversation:') ? topic.slice('conversation:'.length) : null;
}

export function videoTopic(videoId: Id): Topic {
  return `video:${videoId}`;
}

export function parseVideoTopic(topic: string): Id | null {
  return topic.startsWith('video:') ? topic.slice('video:'.length) : null;
}

export interface DirectorySnapshot {
  projects: Project[];
  conversations: Conversation[];
}

export type DirectoryEvent =
  | { type: 'project.upsert'; project: Project }
  | { type: 'conversation.upsert'; conversation: Conversation }
  | { type: 'conversation.removed'; conversationId: Id };

export interface TasksSnapshot {
  tasks: TaskSummary[];
  /**
   * 待处理的审批，会话的与对外服务的都在这里（架构设计 §3.12），旧的在前。Runtime 总是给出；
   * 可选只是为了让只认任务的旧镜像（没有这个字段）照样能套用 `tasks` 主题的事件。
   */
  approvals?: PendingApproval[];
}

export type TasksEvent =
  | { type: 'task.upsert'; task: TaskSummary }
  | { type: 'task.removed'; taskId: Id }
  | { type: 'approval.upsert'; approval: PendingApproval }
  | { type: 'approval.removed'; approvalId: Id; outcome: ApprovalOutcome };

export interface SpaceSnapshot {
  entries: SpaceEntry[];
  issues: SpaceScanIssue[];
  /** 首次扫描还没完成。 */
  scanning: boolean;
}

/** 增量；整体重扫时发一条 `catalog.replaced`，客户端不必逐条比对。 */
export type SpaceEvent =
  | { type: 'entry.upsert'; entry: SpaceEntry }
  | { type: 'entry.removed'; entryId: Id }
  | { type: 'catalog.replaced'; snapshot: SpaceSnapshot };

export interface ConversationSnapshot {
  conversation: Conversation;
  /** 按出现顺序排列。 */
  items: TimelineItem[];
}

/**
 * 会话主题的事件。流式文本以 `item.append` 增量送达，但保留条目身份与完成边界：
 * 终态总以一条 `item.upsert` 收尾（架构设计 §4.5）。
 */
export type ConversationEvent =
  | { type: 'item.upsert'; item: TimelineItem }
  | { type: 'item.append'; itemId: Id; field: 'text' | 'output'; delta: string }
  | { type: 'conversation.updated'; conversation: Conversation }
  | { type: 'conversation.removed' };

/**
 * `agent-setup` 主题。不做成 Job（`jobs` 主题）：JobRecord 没有输出行，必填的是模型计算的字段
 * （内容哈希、Provider、模型包、输入哈希），Job 还会持久化进账本、出现在 `jobs.list` 与智能体的任务工具里。
 * 运行记录只在内存里，留最近的若干次（新的在前）。
 */
export interface AgentSetupSnapshot {
  runs: AgentSetupRun[];
}

export type AgentSetupEvent =
  /** 新的一次运行，或状态变了（运行中 → 终态）；带完整的记录。 */
  | { type: 'setup.updated'; run: AgentSetupRun }
  /** 追加的输出行。客户端追加后只留最后 `AGENT_SETUP_OUTPUT_LINES` 行。 */
  | { type: 'setup.output'; runId: Id; lines: string[] };

/** `agents` 主题：快照就是 `agents.list` 的视图；`checking` 列出还没有任何探测结果、正在首次探测的 Driver（它们不在 `drivers` 里）。 */
export type AgentsSnapshot = AgentsView;
export type AgentsEvent =
  /** 某个 Driver 的探测完成（含后台刷新与纠正）或偏好变化；带完整的新视图，客户端整体替换。 */
  { type: 'agents.updated'; view: AgentsView };

export interface TopicMap {
  directory: { snapshot: DirectorySnapshot; event: DirectoryEvent };
  tasks: { snapshot: TasksSnapshot; event: TasksEvent };
  space: { snapshot: SpaceSnapshot; event: SpaceEvent };
  jobs: { snapshot: JobsSnapshot; event: JobsEvent };
  models: { snapshot: ModelsSnapshot; event: ModelsEvent };
  settings: { snapshot: SettingsSnapshot; event: SettingsEvent };
  services: { snapshot: ServicesSnapshot; event: ServicesEvent };
  library: { snapshot: LibrarySnapshot; event: LibraryEvent };
  grants: { snapshot: GrantsSnapshot; event: GrantsEvent };
  'agent-setup': { snapshot: AgentSetupSnapshot; event: AgentSetupEvent };
  agents: { snapshot: AgentsSnapshot; event: AgentsEvent };
  conversation: { snapshot: ConversationSnapshot; event: ConversationEvent };
  video: { snapshot: VideoTopicSnapshot; event: VideoTopicEvent };
}

export type SnapshotOf<T extends Topic> = T extends 'directory'
  ? DirectorySnapshot
  : T extends 'tasks'
    ? TasksSnapshot
    : T extends 'space'
      ? SpaceSnapshot
      : T extends 'jobs'
        ? JobsSnapshot
        : T extends 'models'
          ? ModelsSnapshot
          : T extends 'settings'
            ? SettingsSnapshot
            : T extends 'services'
              ? ServicesSnapshot
              : T extends 'library'
                ? LibrarySnapshot
                : T extends 'grants'
                  ? GrantsSnapshot
                  : T extends 'agent-setup'
                    ? AgentSetupSnapshot
                    : T extends 'agents'
                      ? AgentsSnapshot
                      : T extends `video:${string}`
                        ? VideoTopicSnapshot
                        : ConversationSnapshot;
export type EventOf<T extends Topic> = T extends 'directory'
  ? DirectoryEvent
  : T extends 'tasks'
    ? TasksEvent
    : T extends 'space'
      ? SpaceEvent
      : T extends 'jobs'
        ? JobsEvent
        : T extends 'models'
          ? ModelsEvent
          : T extends 'settings'
            ? SettingsEvent
            : T extends 'services'
              ? ServicesEvent
              : T extends 'library'
                ? LibraryEvent
                : T extends 'grants'
                  ? GrantsEvent
                  : T extends 'agent-setup'
                    ? AgentSetupEvent
                    : T extends 'agents'
                      ? AgentsEvent
                      : T extends `video:${string}`
                        ? VideoTopicEvent
                        : ConversationEvent;

export interface SequencedEvent<E> {
  seq: Seq;
  event: E;
}

/**
 * 订阅的首个结果：同一水位的快照，或从客户端游标之后的补发（架构设计 §4.4）。
 * 服务端无法证明能补齐时一律给快照，客户端不在缺事件的镜像上继续。
 */
export type SubscribeResult<S, E> = { mode: 'snapshot'; seq: Seq; snapshot: S } | { mode: 'replay'; seq: Seq; events: SequencedEvent<E>[] };
