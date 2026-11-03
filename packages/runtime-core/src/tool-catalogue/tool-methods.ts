import path from 'node:path';
import { RpcError, type ToolInputFacts, type ToolInspectInput } from '@baocut/protocol';
import { TOOL_CATALOGUE, footageStabilizer, inspectFootageInput, toolDefinition, type ProbeToolResolver } from '@baocut/jobs';
import type { ModelServices } from '@baocut/models';
import type { RpcHandlers } from '../handlers.ts';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { ExternalToolService } from '../external-tools/external-tool-service.ts';
import { IMAGE_ENTRY_KINDS, MEDIA_ENTRY_KINDS } from '../space/space-inputs.ts';
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
  /** `tools.inspectInputs` 用的 ffmpeg 与 ffprobe（同流程）。 */
  mediaTools: { ffmpeg: ProbeToolResolver; ffprobe: ProbeToolResolver };
}

const unreadable = (name: string): ToolInputFacts => ({ name, kind: 'unreadable', bytes: null, durationSec: null, width: null, height: null, frameRate: null, hdr: false, hasAudio: false });

/** 读一个输入的事实：Space 条目换成它的文件；条目不能用、不是绝对路径（同流程的 `inputs`）、文件读不出都只算这一项 `unreadable`。 */
async function inspectInput(deps: ToolCatalogueDeps, input: ToolInspectInput): Promise<ToolInputFacts> {
  let file: string;
  let name: string;
  if (typeof input === 'string') {
    if (!path.isAbsolute(input)) return unreadable(path.basename(input));
    file = input;
    name = path.basename(input);
  } else {
    try {
      const resolved = deps.space.resolveFile(input.entryId, [...MEDIA_ENTRY_KINDS, ...IMAGE_ENTRY_KINDS]);
      file = resolved.file;
      name = resolved.entry.name;
    } catch {
      return unreadable(input.entryId);
    }
  }
  return { name, ...(await inspectFootageInput(deps.mediaTools.ffprobe, file)) };
}

/**
 * `tools.*` 的处理函数（工具目录、候选输入与输入的事实，架构设计 §7.9），由 `handlers.ts` 并进方法表。都是只读的：目录不探测网络，
 * 外部工具用上次探测的结果；候选输入不打开视频，范围与 `space.list` 相同（对外服务不走网关，经 MCP 工具访问 Space）；
 * 输入的事实跑 `ffprobe`，带本机路径，不对 Web 服务开放。
 * Web 服务在 `services/web-handlers.ts` 里把执行方法不在白名单的工具标为不可用。
 */
export function toolCatalogueMethods(deps: ToolCatalogueDeps): Pick<RpcHandlers['methods'], 'tools.list' | 'tools.candidates' | 'tools.inspectInputs'> {
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
    'tools.inspectInputs': async (p) => ({
      items: await Promise.all(p.inputs.map((input) => inspectInput(deps, input))),
      ...(p.stabilizer ? { stabilizer: await footageStabilizer(deps.mediaTools.ffmpeg) } : {}),
    }),
  };
}
