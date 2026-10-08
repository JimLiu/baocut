import path from 'node:path';
import { z } from 'zod';
import { RpcError } from '@baocut/protocol';
import { RcAgentTools } from '@baocut/protocol/messages/runtime-core';
import type { SpaceCatalog } from '../space-catalog.ts';
import type { VideoService } from '../videos/video-service.ts';
import type { VideoTrash } from '../videos/video-trash.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import { approvalField, confirmSummary, type ToolPrincipal, type ToolScope } from './tool-scope.ts';
import { videoArg } from './video-tools.ts';

/**
 * 删除视频（架构设计 §5.5、§5.7）给会话里的智能体：一个工具 `videos_delete`，风险 `high`，按访问模式问用户。
 * 只能删会话来源目录里的视频；删除是移进回收站，可以在 Space 里恢复，保留期过后才物理删除。`surfaces` 是工具桥与 CLI：
 * MCP 对外服务没有它。
 */

export interface VideoDeleteToolsDeps {
  space: () => SpaceCatalog;
  trash: () => VideoTrash;
  videos: VideoService;
  retentionDays: () => number;
  scope: ToolScope;
}

// i18n-ignore-start: 给模型的工具说明、错误与下一步
const schemas = {
  videos_delete: z.strictObject({ video: videoArg }),
};

const DEFINITIONS: Record<'videos_delete', ToolInfo> = {
  videos_delete: {
    title: '删除视频',
    description: [
      '把一个视频（整个视频目录）移进回收站。',
      '只在用户明确要删除这个视频时用；会向用户确认。',
      '链接素材的原文件不受影响；由它导出、生成的文件也不删。用户可以在 Space 的回收站里恢复，保留期过后才物理删除。',
      '视频在别处开着、有进行中的任务或导出、被别的程序锁着时失败（VIDEO_IN_USE、VIDEO_BUSY、VIDEO_LOCKED）：告诉用户原因，不要用别的方式删除目录。',
    ].join('\n'),
    annotations: { destructiveHint: true, idempotentHint: true },
    effect: 'destructive',
    examples: [{ title: '删除视频', args: { video: 'demo' } }],
    surfaces: ['agent', 'cli'],
    positional: 'video',
  },
};
// i18n-ignore-end

export class VideoDeleteTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: VideoDeleteToolsDeps;

  constructor(deps: VideoDeleteToolsDeps) {
    this.#deps = deps;
  }

  dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    // i18n-ignore: 给模型的工具说明、错误与下一步
    if (name !== 'videos_delete') return Promise.reject(new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`));
    return this.#delete(args as z.infer<(typeof schemas)['videos_delete']>, principal).catch((error: unknown) => {
      throw toolErrorOf(error);
    });
  }

  async #delete(args: { video: string }, principal: ToolPrincipal) {
    const { scope, videos } = this.#deps;
    const space = this.#deps.space();
    const access = scope.authorize(principal, true);
    // 先在会话的来源目录里找到它（范围之外的不弹确认，与不存在的一样回答）。
    const { root, scope: source } = await scope.createRoot(access, undefined, { locate: true });
    const known = videos.ref(args.video);
    const info = await space.videoEntryAt(known ? known.path : path.resolve(root, args.video));
    const sameSource =
      info !== null &&
      ('projectId' in source
        ? 'projectId' in info.scope && info.scope.projectId === source.projectId
        : 'conversationId' in info.scope && info.scope.conversationId === source.conversationId);
    if (!info || !sameSource) {
      // i18n-ignore: 给模型的工具说明、错误与下一步
      throw new ToolError('VIDEO_NOT_FOUND', `找不到视频「${args.video}」：用 videos_list 给出的 path，或已经打开的视频的 videoId`);
    }
    const approval = await scope.confirm(access, {
      tool: 'videos_delete',
      video: info.relPath,
      ...confirmSummary(
        RcAgentTools.deleteVideoSummary({ name: info.entry.name, path: info.relPath, days: this.#deps.retentionDays() }),
      ),
      risk: 'high',
    });
    const result = await this.#deps.trash().delete({ entryId: info.entry.id }, access.principal);
    return {
      ...result,
      ...approvalField(approval),
      // i18n-ignore: 给模型的工具说明、错误与下一步
      next: '视频已移进回收站。用户可以在 Space 的回收站里恢复它；由它导出、生成的条目留在原处。',
    };
  }
}

/** 删除的拒绝（`VIDEO_IN_USE`、`VIDEO_BUSY`、`VIDEO_LOCKED`……）换成工具错误码。 */
function toolErrorOf(error: unknown): unknown {
  if (error instanceof RpcError && typeof error.details === 'object' && error.details !== null) {
    const { code, ...rest } = error.details as Record<string, unknown>;
    if (typeof code === 'string') return new ToolError(code, error.message, rest);
  }
  return error;
}
