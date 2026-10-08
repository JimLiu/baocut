import { RpcError } from '@baocut/protocol';
import { TOOL_CATALOGUE, toolDefinition } from '@baocut/jobs';
import type { ModelServices } from '@baocut/models';
import type { RpcHandlers } from '../handlers.ts';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { ExternalToolService } from '../external-tools/external-tool-service.ts';
import { viewerOf } from '../space/space-methods.ts';
import { capabilityError, toolStatuses } from './tool-availability.ts';
import { toolCandidates } from './tool-candidates.ts';
import { RcRuntime } from '@baocut/protocol/messages/runtime-core';

export interface ToolCatalogueDeps {
  space: SpaceCatalog;
  services: ModelServices;
  externalTools: () => ExternalToolService;
  offlineStrict: () => boolean;
  /** 解析好的保存位置（§7.9）；不给时结果里没有 `saveDirectory`。 */
  saveDirectory?: () => string;
}

/**
 * `tools.*` 的处理函数（工具目录与候选输入，架构设计 §7.9），由 `handlers.ts` 并进方法表。都是只读的：目录不探测网络，
 * 外部工具用上次探测的结果；候选输入不打开视频，范围与 `space.list` 相同（对外服务不走网关，经 MCP 工具访问 Space）。
 * Web 服务在 `services/web-handlers.ts` 里把执行方法不在白名单的工具标为不可用。
 */
export function toolCatalogueMethods(deps: ToolCatalogueDeps): Pick<RpcHandlers['methods'], 'tools.list' | 'tools.candidates'> {
  const { services } = deps;
  return {
    'tools.list': async () => ({
      tools: await toolStatuses(TOOL_CATALOGUE, {
        capability: (capability) =>
          capabilityError(() => {
            if (capability === 'transcribe') return services.selectTranscribe({});
            if (capability === 'generateText') return services.selectText({});
            if (capability === 'separateAudio') return services.selectSeparate({});
            return services.selectGeneration(capability, {});
          }),
        externalTools: () => deps.externalTools().list(),
        offlineStrict: deps.offlineStrict,
      }),
      ...(deps.saveDirectory ? { saveDirectory: deps.saveDirectory() } : {}),
    }),
    'tools.candidates': (p, principal) => {
      const viewer = viewerOf(principal);
      const tool = toolDefinition(p.toolId);
      if (!tool) throw new RpcError('not-found', RcRuntime.noSuchTool({ toolId: p.toolId }));
      const { toolId: _toolId, ...params } = p;
      return toolCandidates(deps.space, viewer, tool, params);
    },
  };
}
