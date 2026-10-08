import { AsyncLocalStorage } from 'node:async_hooks';
import type { PipelineDefinition, PipelinePlan } from '@baocut/jobs';
import type { ModelServices, TextGenerator } from '@baocut/models';
import { refOf, RpcError, type GrantDataKind, type GrantRequestItem, type Id, type ModelServiceCapability } from '@baocut/protocol';
import { combinedGrantError, withPendingGrants } from './grant-errors.ts';
import type { GrantService } from './grant-service.ts';
import { RcGrants } from '@baocut/protocol/messages/runtime-core';

/**
 * 固定流程里的外发调用（架构设计 §7.9、§12.5）：流程的步骤在进程内逐批调用文本模型，不经 JobManager 的提交，
 * 所以在这里接上授权与预算：
 *
 * - 启动（与重试）时先判断：没有授权覆盖、额度不够时 `pipelines.start` 直接以 `GRANT_REQUIRED` / `BUDGET_EXCEEDED` 拒绝，
 *   一次拒绝覆盖流程的全部几种外发（`remedy.commands` 逐项给出）；在场的用户（桌面界面）的拒绝另带 `pendingGrants`；
 * - 执行时每一次调用（含输出不合约定的重发）各预留一次、结束时结算：重试也消耗预算；额度在中途用完时这一步以
 *   `BUDGET_EXCEEDED` 失败，可以在调高上限之后 `pipelines.retry`；
 * - 步骤的子任务 `jobId` 记在预留上（`grants.usage` 看得到），步骤记录本身不带 `grant`（一步有很多次调用）；
 * - 智能体在任务里启动的流程，每次调用同样占用这个任务的预算（经子任务找到任务，`GrantService.begin`）；启动前不看任务预算
 *   （§7.8）：不外发的步骤（下载、导入）照常完成，超出时停在外发的那一步、以 `TASK_BUDGET_EXCEEDED` 失败。
 */

interface StepGrantContext {
  videoId: Id | null;
  jobId: Id;
}

const stepContext = new AsyncLocalStorage<StepGrantContext>();

/** 流程启动前要判断的一种外发：哪种能力、交给哪个 Provider 与模型、外发哪些数据。 */
export interface PipelineOutbound {
  capability: ModelServiceCapability;
  providerId: string;
  modelId: string;
  dataKinds: GrantDataKind[];
}

/**
 * 包一层：步骤在执行期间带上视频与子任务，外发调用据此匹配授权的范围。`outbound` 列出启动前要判断的外发
 * （不给时是冻结的执行者的一次文本生成）；一个流程可以有几种（例如翻译配音的文本生成与语音合成）。
 */
export function withPipelineGrants<P, R>(
  definition: PipelineDefinition<P, R>,
  grants: GrantService,
  dataKinds: GrantDataKind[],
  outbound?: (plan: PipelinePlan<P>) => PipelineOutbound[],
): PipelineDefinition<P, R> {
  return {
    ...definition,
    async prepare(params, options) {
      const plan = await definition.prepare(params, options);
      // 智能体在任务里启动（或重试）的流程：任务只用来匹配只属于它的授权，任务预算留到每一步外发时接纳（§7.8）。
      const taskId = options.submitter ? grants.taskOf(options.submitter) : null;
      const calls = outbound
        ? outbound(plan)
        : [{ capability: 'generateText' as const, providerId: plan.providerId, modelId: plan.modelId, dataKinds }];
      // 启动前的判断：没有授权、额度不够时不创建流程。先判断全部几种外发，一次拒绝说清楚要做的全部；
      // 在场的用户（工具页）的拒绝带上待批准的项，由客户端发放之后用同一个 commandId 重新提交（§7.9）。这里从不发放授权。
      const items: GrantRequestItem[] = [];
      const refusals: RpcError[] = [];
      const purpose = RcGrants.pipelinePurpose({ label: typeof definition.label === 'function' ? definition.label() : definition.label });
      for (const call of calls) {
        const item = grants.pending(
          {
            capability: call.capability,
            providerId: call.providerId,
            modelId: call.modelId,
            videoId: plan.videoId,
            taskId,
            dataKinds: call.dataKinds,
            purpose: purpose.text,
            purposeRef: refOf(purpose),
          },
          { taskBudget: false },
        );
        if (!item || items.some((other) => sameOutbound(other, item))) continue;
        try {
          grants.assertCovered(
            { recipient: item.recipient, dataKinds: item.dataKinds, videoId: plan.videoId, taskId, estimate: item.estimate },
            item.recipient,
            { taskBudget: false },
          );
        } catch (error) {
          if (!(error instanceof RpcError)) throw error;
          items.push(item);
          refusals.push(error);
        }
      }
      if (refusals.length > 0) {
        const refusal = combinedGrantError(refusals);
        throw grants.present(options.submitter) ? withPendingGrants(refusal, items) : refusal;
      }
      return plan;
    },
    steps: definition.steps.map((step) => ({
      ...step,
      run: (context) => stepContext.run({ videoId: videoOf(context.params), jobId: context.jobId }, () => step.run(context)),
    })),
  };
}

/** 流程用的文本生成：每次调用判断、预留并结算。本机与节点的调用不经过授权。 */
export function grantedTextGenerator(
  text: Pick<TextGenerator, 'generate'>,
  grants: GrantService,
  services: ModelServices,
  dataKinds: GrantDataKind[],
): Pick<TextGenerator, 'generate'> {
  return {
    async generate(request, options) {
      const selection = await services.selectText({
        ...(request.provider !== undefined ? { provider: request.provider } : {}),
        ...(request.model !== undefined ? { model: request.model } : {}),
      });
      if (selection.kind === 'local' || selection.kind === 'node') return text.generate(request, options);
      const context = stepContext.getStore();
      grants.ensureDefault(selection.providerId, selection.label, 'generateText');
      const settle = await grants.begin({
        recipient: selection.providerId,
        dataKinds,
        videoId: context?.videoId ?? null,
        taskId: null,
        estimate: null,
        label: selection.label,
        jobId: context?.jobId ?? null,
      });
      try {
        const result = await text.generate({ ...request, provider: selection.providerId, model: selection.modelId }, options);
        settle({ state: 'completed' });
        return result;
      } catch (error) {
        settle({ state: 'failed' });
        throw error;
      }
    },
  };
}

/** 同一个接收方、同样的数据、同一个视频：一条授权就覆盖两者。 */
function sameOutbound(a: GrantRequestItem, b: GrantRequestItem): boolean {
  return (
    a.recipient === b.recipient &&
    a.videoId === b.videoId &&
    a.dataKinds.length === b.dataKinds.length &&
    a.dataKinds.every((k) => b.dataKinds.includes(k))
  );
}

function videoOf(params: unknown): Id | null {
  const videoId = (params as { videoId?: unknown } | null)?.videoId;
  return typeof videoId === 'string' ? videoId : null;
}
