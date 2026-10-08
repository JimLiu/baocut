import {
  AGENT_READONLY_CONTRACT_FIELDS,
  RpcError,
  defaultContextSelection,
  newId,
  type AgentMode,
  type CheckDefinition,
  type Conversation,
  type ConstraintRef,
  type ContextSelection,
  type ContractChange,
  type EditorContext,
  type Id,
  type ProtectionRef,
  type TaskBudgetLimits,
  type TaskBudgetPolicy,
  type TaskContract,
  type TaskContractInput,
  type TaskContractPatch,
  type TaskDeliverable,
} from '@baocut/protocol';
import { HarnessAgents as HA } from '@baocut/protocol/messages/harness';

/**
 * 任务合同的建立与修订（架构设计 §3.2）。纯函数：存放与事件由 Harness 负责。
 *
 * - 默认合同：目标是用户的消息，范围来自编辑器上下文，有打开的视频时交付是「写进视频的修改」，没有约束、保护与检查；
 * - 修订只追加：给出的字段整体替换，`revision` 加一，`change` 记下谁改了哪些字段；
 * - 保护的来源：新加的记下加入时的修订，沿用的（同一个 `protectionId`）保留原来的来源。
 */

/** 任务预算的账本（Runtime 的授权服务）。Harness 不知道它的实现，只在建立与修改合同时读写。 */
export interface TaskBudgetPort {
  taskBudget(taskId: Id): TaskBudgetPolicy | null;
  setTaskBudget(taskId: Id, limits: TaskBudgetLimits): TaskBudgetPolicy;
}

export const NO_TASK_BUDGET: TaskBudgetLimits = { maxCalls: null, cap: null };

export function buildContract(input: {
  taskId: Id;
  conversation: Conversation;
  goal: string;
  context: EditorContext | undefined;
  autonomy: AgentMode;
  contract: TaskContractInput | undefined;
  budgetPolicyRef: Id | null;
  supersedes: TaskContract['supersedes'];
  by: ContractChange['by'];
  at: string;
}): TaskContract {
  const given = input.contract ?? {};
  const scope: ContextSelection = { ...defaultContextSelection(input.context), ...given.scope };
  const videoId = input.context?.videoId ?? scope.videoId ?? null;
  const deliverables: TaskDeliverable[] = given.deliverables ?? (videoId ? [{ kind: 'video-change', requiredStage: 'committed' }] : []);
  return {
    taskId: input.taskId,
    revision: 1,
    conversationId: input.conversation.id,
    videoId,
    baseVideoRevision: input.context?.revision ?? scope.videoRevision ?? null,
    goal: input.goal,
    scope,
    constraints: constraintsOf(given.constraints),
    protectedRefs: protectionsOf(given.protectedRefs, [], 1, input.at),
    deliverables,
    autonomy: input.autonomy,
    permissionScopeRef: input.conversation.projectId ?? input.conversation.id,
    budgetPolicyRef: input.budgetPolicyRef,
    acceptanceChecks: checksOf(given.acceptanceChecks),
    supersedes: input.supersedes,
    change: { by: input.by, reason: input.supersedes ? 'goal' : 'created', fields: [], at: input.at },
  };
}

/** 智能体改了它不能改的字段时拒绝（`CONTRACT_FIELD_READONLY`）。 */
export function assertAgentPatch(patch: TaskContractPatch): void {
  const fields = Object.keys(patch).filter((key) => (AGENT_READONLY_CONTRACT_FIELDS as readonly string[]).includes(key));
  if (fields.length > 0) {
    throw new RpcError('forbidden', HA.contractFieldsReadonly({ fields: fields.join(HA.listSeparator().text) }), {
      code: 'CONTRACT_FIELD_READONLY',
      fields,
    });
  }
}

/** 由上一个修订与修改得出下一个修订。 */
export function reviseContract(
  previous: TaskContract,
  patch: TaskContractPatch,
  change: { by: ContractChange['by']; reason: ContractChange['reason']; at: string; budgetPolicyRef?: Id | null },
): TaskContract {
  const revision = previous.revision + 1;
  const fields = (Object.keys(patch) as Array<keyof TaskContractPatch>).filter((key) => patch[key] !== undefined);
  const next: TaskContract = {
    ...structuredClone(previous),
    revision,
    change: { by: change.by, reason: change.reason, fields, at: change.at },
  };
  if (patch.scope !== undefined) next.scope = { ...previous.scope, ...patch.scope };
  if (patch.constraints !== undefined) next.constraints = constraintsOf(patch.constraints);
  if (patch.protectedRefs !== undefined)
    next.protectedRefs = protectionsOf(patch.protectedRefs, previous.protectedRefs, revision, change.at);
  if (patch.deliverables !== undefined) next.deliverables = structuredClone(patch.deliverables);
  if (patch.autonomy !== undefined) next.autonomy = patch.autonomy;
  if (patch.acceptanceChecks !== undefined) next.acceptanceChecks = checksOf(patch.acceptanceChecks);
  if (change.budgetPolicyRef !== undefined) next.budgetPolicyRef = change.budgetPolicyRef;
  return next;
}

/** 改变目标时由旧合同派生新任务的合同输入：范围、约束、保护、交付、检查照搬，预算上限照搬（用量从零计）。 */
export function carriedInput(previous: TaskContract, budget: TaskBudgetPolicy | null): TaskContractInput {
  return {
    scope: structuredClone(previous.scope),
    constraints: structuredClone(previous.constraints),
    protectedRefs: previous.protectedRefs.map((p) => ({
      protectionId: p.protectionId,
      videoId: p.videoId,
      target: structuredClone(p.target),
      ...(p.note !== undefined ? { note: p.note } : {}),
    })),
    deliverables: structuredClone(previous.deliverables),
    acceptanceChecks: structuredClone(previous.acceptanceChecks),
    ...(budget ? { budget: { maxCalls: budget.maxCalls, cap: budget.cap } } : {}),
  };
}

/** 交给引擎的保护：只要这个视频的。 */
export function engineProtections(contract: TaskContract | null, videoId: Id): Array<Pick<ProtectionRef, 'protectionId' | 'target'>> {
  if (!contract) return [];
  return contract.protectedRefs
    .filter((p) => p.videoId === videoId)
    .map((p) => ({ protectionId: p.protectionId, target: structuredClone(p.target) }));
}

function constraintsOf(input: TaskContractInput['constraints']): ConstraintRef[] {
  return (input ?? []).map((c) => ({ constraintId: c.constraintId ?? newId('cons'), kind: c.kind, text: c.text.trim() }));
}

function checksOf(input: TaskContractInput['acceptanceChecks']): CheckDefinition[] {
  return (input ?? []).map((c) => ({
    checkId: c.checkId ?? newId('check'),
    kind: c.kind,
    description: c.description.trim(),
    required: c.required,
  }));
}

function protectionsOf(
  input: TaskContractInput['protectedRefs'],
  previous: ProtectionRef[],
  revision: number,
  at: string,
): ProtectionRef[] {
  return (input ?? []).map((p) => {
    const kept = p.protectionId ? previous.find((q) => q.protectionId === p.protectionId) : undefined;
    return {
      protectionId: p.protectionId ?? newId('prot'),
      videoId: p.videoId,
      target: structuredClone(p.target),
      origin: kept ? kept.origin : { by: 'user', revision, at },
      ...(p.note !== undefined ? { note: p.note } : {}),
    };
  });
}
