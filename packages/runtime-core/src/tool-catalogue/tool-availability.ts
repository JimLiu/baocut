import {
  refOf,
  RpcError,
  type CapabilityNotConfiguredDetails,
  type ExternalToolStatus,
  type ModelServiceCapability,
  type ToolDefinition,
  type ToolProblem,
  type ToolStatus,
} from '@baocut/protocol';
import { problemRemedy, toolUseProblem } from '../external-tools/external-tool-service.ts';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';

/**
 * 工具此刻能不能用（`tools.list`，架构设计 §7.9）：静态注册表加 Runtime 的状态。原因沿用已有的错误码：
 *
 * - 能力：按提交时的同一套选择判断（不显式指定 Provider 时会用哪个），选不出时 `CAPABILITY_NOT_CONFIGURED`（带 `reason`）；
 * - 外部工具：上次探测的结果（`externalTools.list`，第一次时探测），不能用时 `TOOL_NOT_INSTALLED`、`TOOL_UNAVAILABLE`、
 *   `TOOL_OUTDATED`、`TOOL_CONSENT_REQUIRED`，正在按原安装方式更新时 `TOOL_UPDATING`；
 * - 联网下载：严格离线（`offline.strict`）时 `OFFLINE_STRICT`。
 *
 * 一定要的依赖进 `problems`（不可用），只在某些输入或参数下才用的进 `limitations`（照样可用）。
 */

export interface ToolAvailabilityDeps {
  /** 这种能力此刻选不出 Provider 时的错误（`CAPABILITY_NOT_CONFIGURED`）；选得出时 null。 */
  capability(capability: ModelServiceCapability): Promise<RpcError | null>;
  /** 受管外部工具的状态（上次探测的结果）。 */
  externalTools(): Promise<ExternalToolStatus[]>;
  offlineStrict(): boolean;
}

export async function toolStatuses(catalogue: readonly ToolDefinition[], deps: ToolAvailabilityDeps): Promise<ToolStatus[]> {
  const capabilities = new Map<ModelServiceCapability, ToolProblem | null>();
  const capabilityProblem = async (capability: ModelServiceCapability): Promise<ToolProblem | null> => {
    if (!capabilities.has(capability)) capabilities.set(capability, problemOfCapability(capability, await deps.capability(capability)));
    return capabilities.get(capability)!;
  };
  const tools = new Map((await deps.externalTools()).map((status) => [status.name, status]));
  const toolProblem = (name: string): ToolProblem | null => {
    const status = tools.get(name);
    if (!status) {
      const message = RcRuntime.externalToolNotRegistered({ name });
      return { code: 'TOOL_UNAVAILABLE', message: message.text, messageRef: refOf(message), tool: name };
    }
    const problem = toolUseProblem(status);
    return problem
      ? {
          code: problem.code,
          message: problem.message.text,
          messageRef: refOf(problem.message),
          tool: name,
          ...(String(problem.remedy) ? problemRemedy(problem.remedy) : {}),
        }
      : null;
  };
  const offline = deps.offlineStrict();
  const offlineMessage = RcRuntime.offlineStrictNoDownload();
  const offlineProblem: ToolProblem = {
    code: 'OFFLINE_STRICT',
    message: offlineMessage.text,
    messageRef: refOf(offlineMessage),
    ...problemRemedy(RcRuntime.offlineStrictRemedy()),
  };

  const out: ToolStatus[] = [];
  for (const tool of catalogue) {
    const problems: ToolProblem[] = [];
    const limitations: ToolProblem[] = [];
    for (const capability of tool.capabilities) {
      const problem = await capabilityProblem(capability);
      if (problem) problems.push(problem);
    }
    for (const capability of tool.optionalCapabilities) {
      const problem = await capabilityProblem(capability);
      if (problem) limitations.push(problem);
    }
    for (const name of tool.externalTools) {
      const problem = toolProblem(name);
      if (problem) problems.push(problem);
    }
    for (const name of tool.optionalExternalTools) {
      const problem = toolProblem(name);
      if (problem) limitations.push(problem);
    }
    if (offline && tool.network === 'required') problems.push(offlineProblem);
    if (offline && tool.network === 'optional') limitations.push(offlineProblem);
    out.push({ ...structuredClone(tool), available: problems.length === 0, problems, limitations });
  }
  return out;
}

function problemOfCapability(capability: ModelServiceCapability, error: RpcError | null): ToolProblem | null {
  if (!error) return null;
  const details = error.details as Partial<CapabilityNotConfiguredDetails> | undefined;
  return {
    code: details?.code ?? 'CAPABILITY_NOT_CONFIGURED',
    message: error.message,
    ...(error.messageRef ? { messageRef: error.messageRef } : {}),
    capability,
    ...(details?.reason ? { reason: details.reason } : {}),
    ...(details?.remedy?.hint ? { remedy: details.remedy.hint, ...(details.remedy.hintRef ? { remedyRef: details.remedy.hintRef } : {}) } : {}),
  };
}

/** 选择能力时的异常换成「不可用」：只认 `RpcError`，别的照样抛出。 */
export async function capabilityError(select: () => Promise<unknown>): Promise<RpcError | null> {
  try {
    await select();
    return null;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
}
