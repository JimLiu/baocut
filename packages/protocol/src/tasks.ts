import type { AgentMode } from './access.ts';
import type { EditorContext, Id } from './domain.ts';
import type { Money } from './grants.ts';

/**
 * 任务合同（架构设计 §3.2，产品设计 §6）：一个任务的目标、范围、约束、「不要改动」、交付、访问模式、权限范围、预算与验收检查。
 *
 * - 合同随任务（Run）建立：发送消息时没有显式给出的，Runtime 按编辑器上下文与会话的模式建立默认合同，经会话的
 *   `item.upsert`（任务条目上的 `contract`）与 `tasks` 主题（`contractRevision`）对用户可见。
 * - 每次修改产生新的 `revision`（从 1 起），旧的修订保留可查（`tasks.getContract` 给 `revision`）。
 * - 尚未启动的步骤采用新约束；已经冻结输入的 Job 不在执行中更换内容。
 * - `autonomy` 就是会话的访问模式（§3.12），不是第二套：改合同的 `autonomy` 等于切换会话的模式，切换会话的模式也会给
 *   进行中任务的合同记一个新修订。
 */

export type TaskDeliverableKind = 'preview' | 'video-change' | 'video-file' | 'subtitle' | 'audio' | 'package';
export type TaskDeliverableStage = 'candidate-ready' | 'committed' | 'published';

export interface TaskDeliverable {
  kind: TaskDeliverableKind;
  /** 交付到哪个阶段才算完成：候选就绪、写进视频、发布到项目目录。 */
  requiredStage: TaskDeliverableStage;
  /** BCP 47 语言标签（字幕、配音）。 */
  language?: string;
  /** 画幅变体。 */
  variantId?: Id;
}

/**
 * 任务的上下文范围（首版）：智能体「这个」「这里」指的对象。默认由发送时的编辑器上下文得出。
 * 时间区间按输出时间（秒）；没有时是整个视频。
 */
export interface ContextSelection {
  videoId: Id | null;
  /** 用户发出任务时看到的视频版本。 */
  videoRevision: string | null;
  /** 范围所在的序列；不给时是根序列。 */
  sequenceId: Id | null;
  /** 选中的时间线实例。 */
  itemIds: Id[];
  /** 输出时间上的一段区间（秒）。 */
  timeRange: { fromSeconds: number; toSeconds: number } | null;
}

export type ConstraintKind = 'content' | 'style' | 'duration' | 'format' | 'language' | 'other';

/** 一条内容约束（首版是自然语言，交给智能体；QualityService 不据此自动判断）。 */
export interface ConstraintRef {
  constraintId: Id;
  kind: ConstraintKind;
  text: string;
}

/**
 * 只对这个任务生效的保护（视频格式规范 §3.10 的 target 形状，另把属性单独列出）。智能体在任务里的提交与撤销带上它，
 * VideoEngine 提交时检查，触碰时整笔以 `TASK_PROTECTED` 拒绝；用户与手动的修改不受限制。
 *
 * - `video`：整个视频的任何变化；
 * - `entity`：这个实体本身（创建、修改、删除），不含子实体；
 * - `property`：实体的几个属性，点分隔的路径（`text`、`style.fontSize`、`place.x`）；删除实体算触碰；
 * - `interval`：序列上的一段帧区间：修改前或修改后与它相交的时间线实例（音频按精确起止时刻）；`trackIds` 限定轨道。
 */
export type ProtectionTarget =
  | { kind: 'video' }
  | { kind: 'entity'; entityId: Id }
  | { kind: 'property'; entityId: Id; propertyPaths: string[] }
  | { kind: 'interval'; sequenceId: Id; span: { fromFrame: number; durationFrames: number }; trackIds?: Id[] };

export interface ProtectionRef {
  protectionId: Id;
  videoId: Id;
  target: ProtectionTarget;
  /** 授权来源：用户在哪个合同修订里加上的。有效范围是这个任务（合同的全部后续修订，直到被移除）。 */
  origin: { by: 'user'; revision: number; at: string };
  note?: string;
}

/**
 * 一项验收检查。`review` 由用户或智能体判断后记录结果；`quality` 留给 QualityService 自动执行
 * （首版不执行，只定义与记录，见架构设计 §14）。
 */
export interface CheckDefinition {
  checkId: Id;
  kind: 'review' | 'quality';
  description: string;
  /** 必过：没有记录为通过之前，任务不算满足验收。 */
  required: boolean;
}

export type CheckOutcome = 'passed' | 'failed' | 'skipped';

/** 一次检查结果。按记录先后保留，最新一条是当前结果。 */
export interface CheckResult {
  resultId: Id;
  checkId: Id;
  /** 记录时合同的修订。 */
  contractRevision: number;
  outcome: CheckOutcome;
  note: string | null;
  recordedBy: 'user' | 'agent';
  recordedAt: string;
}

/** 合同的这个修订由谁、因为什么产生。 */
export interface ContractChange {
  by: 'user' | 'agent' | 'runtime';
  /** `created`：建立；`updated`：修改字段；`mode`：切换访问模式；`goal`：改变目标后由旧任务派生。 */
  reason: 'created' | 'updated' | 'mode' | 'goal';
  /** 这个修订改了哪些字段。 */
  fields: Array<keyof TaskContractPatch | 'goal'>;
  at: string;
}

export interface TaskContract {
  taskId: Id;
  /** 合同的修订号，从 1 开始，每次修改加一。 */
  revision: number;
  conversationId: Id;
  videoId: Id | null;
  baseVideoRevision: string | null;
  goal: string;
  scope: ContextSelection;
  constraints: ConstraintRef[];
  protectedRefs: ProtectionRef[];
  deliverables: TaskDeliverable[];
  /** 就是会话此刻的访问模式（§3.12）。 */
  autonomy: AgentMode;
  /** 权限范围：会话绑定的项目（`projectId`），不属于项目的会话是会话自己（`conversationId`）。随会话的绑定，不经合同修改。 */
  permissionScopeRef: Id;
  /** 任务预算策略（`TaskBudgetPolicy.policyId`）；没有 Runtime 预算账本时 null。 */
  budgetPolicyRef: Id | null;
  acceptanceChecks: CheckDefinition[];
  /** 改变目标时：这个任务接替的旧任务与旧工作的处理。 */
  supersedes: { taskId: Id; previousWork: 'stop' | 'keep' } | null;
  change: ContractChange;
}

/**
 * 任务预算（架构设计 §7.8）：一个任务里所有外发调用（智能体提交的 Job、任务里启动的固定流程与它的子步骤）跨 Provider
 * 合计的次数与金额上限。每次调用在通过授权（Grant）的接纳之后还要通过它；`null` 表示这一项不设上限。
 */
export interface TaskBudgetLimits {
  maxCalls: number | null;
  cap: Money | null;
}

export interface TaskBudgetPolicy extends TaskBudgetLimits {
  policyId: Id;
  taskId: Id;
  usage: TaskBudgetUsage;
  createdAt: string;
  updatedAt: string;
}

/** 任务预算的用量：已结算的按币种分列；金额未知的调用只计次数。 */
export interface TaskBudgetUsage {
  calls: number;
  reservedCalls: number;
  /** 已结算的金额，每个币种一项。 */
  spent: Money[];
  /** 预留中的金额（有上限时，按上限的币种）。 */
  reserved: Money[];
  unknownCostCalls: number;
}

/** 建立任务时给出的合同（都可以不给，不给的按默认）。 */
export interface TaskContractInput {
  scope?: Partial<ContextSelection>;
  constraints?: Array<Omit<ConstraintRef, 'constraintId'> & { constraintId?: Id }>;
  protectedRefs?: ProtectionInput[];
  deliverables?: TaskDeliverable[];
  budget?: TaskBudgetLimits;
  acceptanceChecks?: Array<Omit<CheckDefinition, 'checkId'> & { checkId?: Id }>;
}

export interface ProtectionInput {
  protectionId?: Id;
  videoId: Id;
  target: ProtectionTarget;
  note?: string;
}

/**
 * 合同的修改：给出的字段整体替换。`autonomy` 等于切换会话的访问模式。智能体只能改 `scope`、`constraints`、
 * `deliverables` 与 `acceptanceChecks`：`autonomy`、`budget` 与 `protectedRefs` 只由用户修改（`CONTRACT_FIELD_READONLY`），
 * 权限范围不经合同修改。
 */
export interface TaskContractPatch {
  scope?: Partial<ContextSelection>;
  constraints?: TaskContractInput['constraints'];
  protectedRefs?: ProtectionInput[];
  deliverables?: TaskDeliverable[];
  autonomy?: AgentMode;
  budget?: TaskBudgetLimits;
  acceptanceChecks?: TaskContractInput['acceptanceChecks'];
}

/** 智能体不能修改的合同字段。 */
export const AGENT_READONLY_CONTRACT_FIELDS = ['autonomy', 'budget', 'protectedRefs', 'permissionScopeRef', 'budgetPolicyRef'] as const;

/** 合同与它的预算用量（`tasks.getContract` 的结果）。 */
export interface TaskContractView {
  contract: TaskContract;
  /** 最新的修订号（查旧修订时与 `contract.revision` 不同）。 */
  latestRevision: number;
  budget: TaskBudgetPolicy | null;
}

/** 由编辑器上下文得出默认的范围。 */
export function defaultContextSelection(context: EditorContext | undefined): ContextSelection {
  return {
    videoId: context?.videoId ?? null,
    videoRevision: context?.revision ?? null,
    sequenceId: null,
    itemIds: context ? [...context.selection] : [],
    timeRange: null,
  };
}

/** 任务合同的错误码（命令与协议规范 §11.3）。 */
export const TASK_CONTRACT_ERROR_CODES = [
  'TASK_PROTECTED',
  'TASK_BUDGET_EXCEEDED',
  'TASK_BUDGET_UNVERIFIABLE',
  'CONTRACT_REVISION_CONFLICT',
  'CONTRACT_FIELD_READONLY',
  'TASK_NOT_RUNNING',
] as const;
export type TaskContractErrorCode = (typeof TASK_CONTRACT_ERROR_CODES)[number];
