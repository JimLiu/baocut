// i18n-ignore-file: 给模型的工具说明与错误
import { z } from 'zod';
import { SPACE_LIST_MAX_LIMIT, SPACE_SEARCH_MAX_LIMIT, type JobRecord, type SpaceEntry } from '@baocut/protocol';
import type { SpaceCatalog } from '../space-catalog.ts';
import { USER_VIEWER, listEntries, projectOf, searchContent, videoOf, type SpaceViewer } from '../space/space-queries.ts';
import type { AgentAccess } from './agent-scope.ts';
import type { ServiceAccess } from '../services/service-scope.ts';
import { ToolError, type ToolInfo, type ToolSet } from './tool-catalog.ts';
import type { ToolAccess, ToolPrincipal, ToolScope } from './tool-scope.ts';

/**
 * Space 的只读工具（架构设计 §3.5、§5.7、§5.11）：`space_list` 列条目，`space_search` 跨视频检索文稿、字幕、译文与章节。
 * 风险等级 `read`，规划模式与只读的对外服务都可用。范围由 `ToolScope` 的主体决定（`space/space-queries.ts`）：
 * 会话里的智能体看会话来源目录里的条目；对外服务只看范围之内的视频、由它们生成或导出的条目，任务的产物只看自己提交的。
 */

export interface SpaceToolsDeps {
  /** Space 目录在工具目录之后才建好：调用时再取。 */
  space: () => SpaceCatalog;
  scope: ToolScope;
  jobs: { list(): JobRecord[] };
}

const KINDS = ['video', 'export', 'video-file', 'image', 'audio', 'subtitle', 'document', 'package', 'template'] as const;
const STATUSES = ['generating', 'candidate', 'applied', 'published', 'source-changed', 'missing', 'failed', 'none'] as const;

const schemas = {
  space_list: z.strictObject({
    kind: z
      .array(z.enum(KINDS))
      .min(1)
      .max(9)
      .optional()
      .describe(
        '可选。只列这些种类：video（可编辑的视频）、export（导出的文件）、video-file、image、audio、subtitle、document、package（便携包）、template（模板）',
      ),
    status: z
      .array(z.enum(STATUSES))
      .min(1)
      .max(8)
      .optional()
      .describe('可选。只列这些状态：generating、failed、candidate、applied、published、source-changed、missing；none 是普通文件与视频'),
    videoId: z.string().min(1).max(200).optional().describe('可选。这个视频本身，以及由它生成、导出的条目'),
    favorite: z.boolean().optional().describe('可选。只列收藏的'),
    cursor: z
      .string()
      .regex(/^\d{1,9}$/)
      .optional()
      .describe('可选。上一页结果里的 nextCursor'),
    limit: z.number().int().min(1).max(SPACE_LIST_MAX_LIMIT).optional().describe('可选。一页多少条，默认 50'),
  }),
  space_search: z
    .strictObject({
      query: z.string().max(500).describe('检索词：空白隔开的几个词都要在同一段里出现，不区分大小写；中文按字符匹配，不分词'),
      videoIds: z.array(z.string().min(1).max(200)).min(1).max(200).optional().describe('可选。只在这些视频里找'),
      kinds: z
        .array(z.enum(['speech', 'caption', 'translation', 'chapter']))
        .min(1)
        .max(4)
        .optional()
        .describe('可选。只找这些文档：speech（转写）、caption（字幕）、translation（译文）、chapter（章节）'),
      speaker: z.string().trim().min(1).max(200).optional().describe('可选。说话人的名字里含有这段文字'),
      limit: z.number().int().min(1).max(SPACE_SEARCH_MAX_LIMIT).optional().describe('可选。最多返回多少条命中，默认 30'),
    })
    .refine((p) => p.query.trim().length > 0 || p.speaker !== undefined, '要给检索词或说话人'),
};

type ToolName = keyof typeof schemas;

const DEFINITIONS: Record<ToolName, ToolInfo> = {
  space_list: {
    title: '列出 Space 里的条目',
    description: [
      '列出你能访问的 Space 条目。',
      '条目有视频、项目里的素材文件、生成的图片 / 音频 / 文本、导出的文件，以及进行中与失败的生成任务。',
      '按最近活动从新到旧，不含回收站里的。每条带 id、种类、名字、状态、所属项目、关联的 videoId 与相对路径。',
      '还有下一页时带 nextCursor。只读，不打开视频。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '最近的条目', args: {} },
      { title: '一个视频导出的文件', args: { videoId: 'vid_1', kind: ['export'] } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
  },
  space_search: {
    title: '跨视频检索文稿',
    description: [
      '在你能访问的全部视频里按文稿（转写）、字幕、译文、章节与说话人查找。',
      '不用打开视频。每条命中带 videoId、视频名、文档种类与 documentId、时间位置（clock 为 sequence 时是时间线上的秒，source 时是素材的源时间）与命中的片段。',
      '时间以索引时的版本（indexedRevision）为准：要精确定位，用 videos_inspect / documents_read 读当前版本。',
      'complete 为 false 时索引还没覆盖全部视频（刚有修改、正在重建或有视频读不了），结果可能不全，pendingVideos 是个数。',
    ].join('\n'),
    annotations: { readOnlyHint: true },
    effect: 'query',
    examples: [
      { title: '检索一个词', args: { query: '发布会' } },
      { title: '只在译文里找', args: { query: 'launch date', kinds: ['translation'], limit: 10 } },
    ],
    surfaces: ['agent', 'mcp', 'cli'],
    positional: 'query',
  },
};

export class SpaceTools implements ToolSet {
  readonly schemas = schemas;
  readonly definitions = DEFINITIONS;
  readonly #deps: SpaceToolsDeps;

  constructor(deps: SpaceToolsDeps) {
    this.#deps = deps;
  }

  async dispatch(name: string, args: unknown, principal: ToolPrincipal): Promise<unknown> {
    switch (name as ToolName) {
      case 'space_list': {
        const p = args as z.infer<(typeof schemas)['space_list']>;
        const result = listEntries(this.#deps.space(), this.#viewer(principal), {
          ...(p.kind ? { kind: p.kind } : {}),
          ...(p.status ? { status: p.status } : {}),
          ...(p.videoId ? { videoId: p.videoId } : {}),
          ...(p.favorite !== undefined ? { favorite: p.favorite } : {}),
          ...(p.cursor ? { cursor: p.cursor } : {}),
          limit: p.limit ?? 50,
        });
        return {
          entries: result.entries.map(entryOf),
          total: result.total,
          nextCursor: result.nextCursor,
          ...(result.scanning ? { scanning: true } : {}),
        };
      }
      case 'space_search': {
        const p = args as z.infer<(typeof schemas)['space_search']>;
        const result = searchContent(this.#deps.space(), this.#viewer(principal), {
          query: p.query,
          ...(p.videoIds ? { videoIds: p.videoIds } : {}),
          ...(p.kinds ? { kinds: p.kinds } : {}),
          ...(p.speaker ? { speaker: p.speaker } : {}),
          limit: p.limit ?? 30,
        });
        return {
          hits: result.hits.map(({ highlights: _, entryId: __, ...hit }) => hit),
          complete: result.complete,
          pendingVideos: result.pendingVideos,
          truncated: result.truncated,
        };
      }
      default:
        throw new ToolError('UNKNOWN_TOOL', `没有这个工具：${name}`);
    }
  }

  /** 主体 → 能看到的范围。终端里的用户本人与界面相同，看得到全部。 */
  #viewer(principal: ToolPrincipal): SpaceViewer {
    const access: ToolAccess = this.#deps.scope.authorize(principal, false);
    if (access.principal.kind === 'local') return USER_VIEWER;
    if (access.principal.kind === 'agent') {
      const { conversation } = access as AgentAccess;
      return { kind: 'source', projectId: conversation.projectId ?? null, conversationId: conversation.id };
    }
    const { policy } = access as ServiceAccess;
    const records = new Map(this.#deps.jobs.list().map((r) => [r.jobId, r]));
    return {
      kind: 'service',
      videos: policy.videos === 'all' ? 'all' : new Set(policy.videos.ids),
      owns: (record) => this.#deps.scope.owns(record, access),
      jobs: (jobId) => records.get(jobId) ?? null,
    };
  }
}

/** 给智能体的条目：不带来源目录的绝对路径。 */
function entryOf(entry: SpaceEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    status: entry.status,
    ...(entry.statusDetail ? { statusDetail: entry.statusDetail } : {}),
    projectId: projectOf(entry),
    videoId: videoOf(entry),
    ...(entry.source.projectId || entry.source.conversationId ? { path: entry.relPath } : {}),
    size: entry.size,
    lastActivityAt: entry.lastActivityAt,
    ...(entry.origin ? { origin: { source: entry.origin.source, ...(entry.origin.jobId ? { jobId: entry.origin.jobId } : {}) } } : {}),
    ...(entry.user.favorite ? { favorite: true } : {}),
  };
}
