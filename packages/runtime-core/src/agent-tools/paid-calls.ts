import { RpcError, type ModelServiceCapability, type ProviderKind } from '@baocut/protocol';

/**
 * 可能花钱的调用（Bot 技术方案 §14.2）：交给在线或智能体 Provider 的模型调用按次计费；本机与节点上的不花钱。
 * Bot 里无人在场的回合中，确认带 `paid: true` 的调用一律按 `high` 问，长期授权也不放行。
 *
 * `PAID_TOOLS` 列出能把工作交给在线 Provider 的全部工具。它们的每一处确认都要明确给出 `paid`（按这次实际会用的 Provider 判断）；
 * 漏给时 `confirmRisk` 按付费处理，宁可多问一次。新增会产生费用的工具要加进这里，`paid-tools.test.ts` 逐个检查。
 */
export const PAID_TOOLS: ReadonlySet<string> = new Set([
  'speak',
  'image',
  'music',
  'transcribe',
  'translate',
  'dub',
  // 从链接下载并转写（`transcribe: true`）。
  'download',
  // 外部工具的许可确认与下载是同一次调用，转写同样可能花钱。
  'external_tools_consent',
  // 生成式超分与 AI 修补交给图片模型。
  'upscale',
  'retouch',
  // 重跑流程会再次调用流程冻结的 Provider。
  'jobs_retry',
]);

/** 一次调用会交给的一种模型能力，以及调用方指定的 Provider 与模型（不给时按默认值选）。 */
export interface ModelCall {
  capability: ModelServiceCapability;
  provider?: string | undefined;
  model?: string | undefined;
}

/** 这些调用里有没有会交给在线或智能体 Provider 的（可能花钱）。 */
export type PaidProbe = (calls: readonly ModelCall[]) => Promise<boolean>;

/** 没有接上模型服务时：凡是有模型调用的都按付费处理。 */
export const assumePaid: PaidProbe = async (calls) => calls.length > 0;

/** 按 Provider 的种类判断：本机与节点不花钱。 */
export function isPaidKind(kind: ProviderKind): boolean {
  return kind !== 'local' && kind !== 'node';
}

/** 已经选定的 Provider（`providerId`）是不是会花钱的：`local` 与 `node:<节点>` 之外的都算。 */
export function isPaidProvider(providerId: string): boolean {
  return providerId !== 'local' && !providerId.startsWith('node:');
}

interface Selection {
  kind: ProviderKind;
}

/** 模型服务里用来按调用方的指定与默认值选 Provider 的那几个方法。 */
export interface PaidSelectors {
  selectTranscribe(target: { provider?: string; model?: string }): Promise<Selection>;
  selectText(target: { provider?: string; model?: string }): Promise<Selection>;
  selectGeneration(capability: never, target: { provider?: string; model?: string }): Promise<Selection>;
}

/**
 * 按模型服务此刻的选择判断（与提交时同一套规则）。选不出来（没有配置、不支持）时调用会在启动时被拒，不会花钱，
 * 按不付费；别的错误按付费处理。
 */
export function servicesPaidProbe(services: PaidSelectors): PaidProbe {
  return async (calls) => {
    for (const call of calls) {
      const target = {
        ...(call.provider !== undefined ? { provider: call.provider } : {}),
        ...(call.model !== undefined ? { model: call.model } : {}),
      };
      try {
        const choice =
          call.capability === 'transcribe'
            ? await services.selectTranscribe(target)
            : call.capability === 'generateText'
              ? await services.selectText(target)
              : await services.selectGeneration(call.capability as never, target);
        if (isPaidKind(choice.kind)) return true;
      } catch (error) {
        if (error instanceof RpcError) continue;
        return true;
      }
    }
    return false;
  };
}
