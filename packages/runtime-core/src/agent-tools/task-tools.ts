// i18n-ignore-file: 给模型的工具说明、错误与下一步
import { z } from 'zod';
import { RpcError, newId, type Id, type TaskContractPatch } from '@baocut/protocol';
import { taskContractPatchSchema } from '@baocut/protocol/schemas';
import type { Harness } from '@baocut/harness';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import type { ToolAccess, ToolPrincipal, ToolScope } from './tool-scope.ts';

/**
 * 智能体读写自己的任务合同（架构设计 §3.2）：只给会话里的智能体（`surfaces` 只有 `agent`），对外服务与 CLI 没有任务。
 *
 * - `tasks_contract`：读当前任务的合同、预算用量与验收检查的结果；
 * - `tasks_update_contract`：细化范围、约束、交付与验收检查。访问模式、权限范围、预算与保护范围只由用户决定，
 *   带上它们时整次拒绝（`CONTRACT_FIELD_READONLY`）；修订记为智能体所改，用户能看到；
 * - `tasks_record_check`：记录一项验收检查的结果。
 */

export interface TaskToolsDeps {
  harness: Harness;
  scope: ToolScope;
}

const schemas = {
  tasks_contract: z.strictObject({
    revision: z.number().int().min(1).optional().describe('可选。合同的修订号；不给时是最新修订'),
  }),
  tasks_update_contract: z.strictObject({
    expectedRevision: z.number().int().min(1).describe('读到的合同修订号（tasks_contract 的 contract.revision）'),
    patch: taskContractPatchSchema.describe('要替换的字段：scope、constraints、deliverables、acceptanceChecks；给出的字段整体替换'),
  }),
  tasks_record_check: z.strictObject({
    checkId: z.string().min(1).max(200).describe('合同 acceptanceChecks 里的 checkId'),
    outcome: z.enum(['passed', 'failed', 'skipped']).describe('结果：passed（通过）、failed（不通过）或 skipped（跳过）'),
    note: z.string().max(2000).optional().describe('可选。依据或说明，给用户看'),
  }),
};

const DEFINITIONS: Record<keyof typeof schemas, ToolInfo> = {
  tasks_contract: {
    title: '读取任务合同',
    description: [
      '读取当前任务的合同。',
      '包括目标、范围、约束、用户保护的内容（protectedRefs，不要修改它们）、交付、访问模式、预算与用量、验收检查及已记录的结果。',
      '开始修改之前先读一次；用户改过合同之后（修订号变了）按新的约束做。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [{ title: '读当前合同', args: {} }],
    surfaces: ['agent'],
  },
  tasks_update_contract: {
    title: '细化任务合同',
    description: [
      '把对任务的理解写进合同。',
      '可写的是范围（scope）、约束（constraints）、交付（deliverables）与验收检查（acceptanceChecks）。给出的字段整体替换，产生新的修订。',
      '访问模式、权限范围、预算与保护范围只由用户决定：不要尝试修改，需要时请用户在 BaoCut 里改。expectedRevision 不是最新时以 CONTRACT_REVISION_CONFLICT 拒绝，重新读取后再改。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: '加一项验收检查',
        args: {
          expectedRevision: 1,
          patch: { acceptanceChecks: [{ kind: 'review', description: '双语字幕逐句对照原文', required: true }] },
        },
      },
    ],
    surfaces: ['agent'],
  },
  tasks_record_check: {
    title: '记录验收检查结果',
    description:
      '记录一项验收检查的结果（passed、failed 或 skipped）与依据。按合同里的验收检查核对之后记录；结果会标明由智能体记录，用户能看到。',
    effect: 'mutation',
    examples: [{ title: '记一项通过', args: { checkId: 'check_1', outcome: 'passed', note: '逐句核对过时间轴' } }],
    surfaces: ['agent'],
  },
};

type ContractArgs = z.infer<(typeof schemas)['tasks_contract']>;
type UpdateArgs = z.infer<(typeof schemas)['tasks_update_contract']>;
type CheckArgs = z.infer<(typeof schemas)['tasks_record_check']>;

export class TaskTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #harness: Harness;
  readonly #scope: ToolScope;

  constructor(deps: TaskToolsDeps) {
    this.#harness = deps.harness;
    this.#scope = deps.scope;
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    try {
      switch (name) {
        case 'tasks_contract':
          return this.#contract(args as ContractArgs, principal);
        case 'tasks_update_contract':
          return this.#update(args as UpdateArgs, principal);
        case 'tasks_record_check':
          return this.#record(args as CheckArgs, principal);
        default:
          throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
      }
    } catch (error) {
      throw contractError(error);
    }
  }

  #contract(args: ContractArgs, principal: ToolPrincipal) {
    const taskId = this.#task(this.#scope.authorize(principal, false));
    const view = this.#harness.getContract(taskId, args.revision);
    const { results } = this.#harness.listChecks(taskId);
    return { ...view, checkResults: results };
  }

  #update(args: UpdateArgs, principal: ToolPrincipal) {
    const taskId = this.#task(this.#scope.authorize(principal, false));
    const { contract } = this.#harness.updateContract(
      { taskId, expectedRevision: args.expectedRevision, commandId: newId('cmd'), patch: args.patch as TaskContractPatch },
      'agent',
    );
    return { contract, next: '合同已更新：之后的步骤按新的修订做。' };
  }

  #record(args: CheckArgs, principal: ToolPrincipal) {
    const taskId = this.#task(this.#scope.authorize(principal, false));
    const { result } = this.#harness.recordCheck(
      { taskId, checkId: args.checkId, outcome: args.outcome, ...(args.note !== undefined ? { note: args.note } : {}) },
      'agent',
    );
    return { result };
  }

  #task(access: ToolAccess): Id {
    if (access.submitter.kind !== 'agent' || !access.submitter.taskId) throw new ToolError('UNKNOWN_TOOL', '这个工具只给会话里的智能体');
    return access.submitter.taskId;
  }
}

/** 合同的拒绝带着自己的错误码（`CONTRACT_FIELD_READONLY`、`CONTRACT_REVISION_CONFLICT`、`TASK_NOT_RUNNING`）交给智能体。 */
function contractError(error: unknown): unknown {
  if (!(error instanceof RpcError)) return error;
  const details = error.details as Record<string, unknown> | undefined;
  if (details && typeof details.code === 'string') {
    const { code, ...rest } = details;
    return new ToolError(code, error.message, rest);
  }
  return error;
}
