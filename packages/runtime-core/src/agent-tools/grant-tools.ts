import { z } from 'zod';
import { MODEL_SERVICE_CAPABILITIES, type GrantRequestItem, type Id, type ModelServiceCapability } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { ModelJobs } from '../models/model-jobs.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { videoArg } from './video-tools.ts';

/**
 * 一个任务要用到的外发一次申请（架构设计 §12.5）：智能体在开始一串模型调用之前，把要交给哪些服务商、哪些数据、
 * 大约多少次合并成一条审批（风险 `high`），用户批准一次即可，不必逐次确认。
 *
 * - 只给会话里的智能体（`surfaces` 只有 `agent`：对外服务的客户端没有任务，MCP 服务的目录里没有它）；
 * - 批准后每一项发放一条只属于这个任务的授权，次数上限是申请的次数（用户也可以选择发放持续授权）；
 * - 已有授权覆盖的、本机与节点的项不进审批；额度不够的整次以 `BUDGET_EXCEEDED` 拒绝，不进审批；
 * - 它不放宽预算：之后每次调用照样在提交时预留、结算，次数用完就是 `BUDGET_EXCEEDED`。
 */

export interface GrantToolsDeps {
  models: ModelJobs;
  scope: ToolScope;
}

const capabilityArg = z.enum(MODEL_SERVICE_CAPABILITIES as [ModelServiceCapability, ...ModelServiceCapability[]]);

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  grants_request: z.strictObject({
    items: z
      .array(
        z.strictObject({
          capability: capabilityArg.describe('能力：transcribe、synthesizeSpeech、generateImage'),
          provider: z.string().min(1).max(200).optional().describe('可选。Provider；不给时用这种能力的默认值'),
          model: z.string().min(1).max(200).optional().describe('可选。模型 ID'),
          video: videoArg.optional().describe('可选。数据来自（或结果导入）的视频；给了时授权只覆盖这个视频'),
          calls: z.number().int().min(1).max(500).describe('这个任务里预计的调用次数（授权的次数上限）'),
          purpose: z.string().min(1).max(200).describe('用途，给用户看（例如「把第 3 段旁白合成语音」）'),
        }),
      )
      .min(1)
      .max(10)
      .describe('要申请的外发，每项一种能力（同一服务商的同一类数据合成一项），最多 10 项'),
  }),
};

type Args = z.infer<(typeof schemas)['grants_request']>;

const DEFINITIONS: Record<keyof typeof schemas, ToolInfo> = {
  grants_request: {
    title: '申请数据外发授权',
    description: [
      '把一个任务要外发的数据合并成一次授权申请。',
      '一个任务要多次调用在线或智能体服务商（转写、合成语音、生成图片）时，先用它把要交出的数据合并成一次申请，用户批准一次即可。',
      '每一项给出能力、可选的 provider / model / video、预计次数 calls 与用途。批准后得到只属于这个任务、次数上限为 calls 的授权；之后的调用不再逐次要授权，次数用完会以 BUDGET_EXCEEDED 拒绝。',
      '本机模型、已配对的节点与已有授权覆盖的项不需要申请（结果里 status 为 not-needed / covered）。用户拒绝时不要换服务商或别的办法绕过。',
    ].join('\n'),
    effect: 'mutation',
    examples: [
      {
        title: '为一串语音合成申请授权',
        args: { items: [{ capability: 'synthesizeSpeech', provider: 'openai', calls: 12, purpose: '把旁白逐段合成语音' }] },
      },
    ],
    // 授权属于会话的任务：对外服务的客户端没有任务，CLI 是用户本人（启用 Provider 即持续授权）。
    surfaces: ['agent'],
  },
};
// i18n-ignore-end

export class GrantTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #models: ModelJobs;
  readonly #scope: ToolScope;

  constructor(deps: GrantToolsDeps) {
    this.#models = deps.models;
    this.#scope = deps.scope;
  }

  dispatch(_name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    return this.#request(args as Args, principal);
  }

  async #request(args: Args, principal: ToolPrincipal) {
    const access = this.#scope.authorize(principal, true);
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (access.submitter.kind !== 'agent') throw new ToolError('UNKNOWN_TOOL', '这个工具只给会话里的智能体');
    const taskId: Id = access.submitter.taskId;
    await this.#models.services.capabilities();
    const results: Record<string, unknown>[] = [];
    const pending: GrantRequestItem[] = [];
    const slots: number[] = [];
    for (const item of args.items) {
      const videoId = item.video !== undefined ? (await this.#scope.open(item.video, access)).ref.videoId : null;
      const plan = this.#models.grants.plan({
        capability: item.capability,
        providerId: item.provider,
        modelId: item.model,
        videoId,
        taskId,
        purpose: item.purpose,
      });
      if (plan.status === 'none') {
        // i18n-ignore: 给模型的工具说明、错误与下一步
        results.push({ capability: item.capability, status: 'not-needed', note: '本机、节点，或服务商没有启用（提交时会拒绝）' });
      } else if (plan.status === 'covered') {
        results.push({ capability: item.capability, status: 'covered', grantId: plan.grant.grantId, recipient: plan.grant.recipient });
      } else {
        slots.push(results.length);
        results.push({ capability: item.capability, status: 'requested' });
        pending.push({ ...plan.item, maxCalls: item.calls });
      }
    }
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (pending.length === 0) return { items: results, next: '不需要新的授权，直接提交即可。' };
    const approval = await this.#scope.confirm(access, {
      tool: 'grants_request',
      ...confirmSummary(
        RcAgentTools.grantSummary({
          recipients: [...new Set(pending.map((p) => p.recipient))].join(RcAgentTools.listSeparator().text),
          items: pending
            .map((p) => RcAgentTools.grantSummaryItem({ purpose: p.purpose, maxCalls: p.maxCalls }).text)
            .join(RcAgentTools.clauseSeparator().text),
        }),
      ),
      risk: 'high',
      grants: pending,
    });
    const issued = approval?.grant ? this.#models.grants.issueForTask(pending, approval.grant, { approvalId: null, taskId }) : [];
    issued.forEach((grant, i) => {
      results[slots[i]!] = {
        capability: pending[i]!.capability,
        status: 'granted',
        grantId: grant.grantId,
        recipient: grant.recipient,
        dataKinds: grant.dataKinds,
        videoId: grant.scope.videoId,
        maxCalls: grant.maxCalls,
        taskId: grant.taskId,
      };
    });
    return {
      items: results,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '授权已发放：按申请的次数提交；次数用完会以 BUDGET_EXCEEDED 拒绝，那时把情况告诉用户，不要换服务商绕过。',
    };
  }
}
