import path from 'node:path';
import { RpcError, type Id, type PipelineCreateScope, type PipelineCreateTarget, type PipelineVideoTarget } from '@baocut/protocol';
import type { VideoPlace } from '../application-ledger.ts';
import { JobsParams } from '@baocut/protocol/messages/jobs/params.ts';
import { JobsVideoTarget } from '@baocut/protocol/messages/jobs/video-target.ts';
import { invalid } from './params.ts';
import type { PipelineStep } from './pipeline.ts';

/**
 * 视频工具的目标（架构设计 §7.9）：`{ videoId }`、`{ entryId }` 或 `{ create }`。`entryId` 由 `PipelineRunner` 在提交时
 * 解析成视频并以 Runtime 的租约打开（流程结束、取消或失败后放下），记成流程的第一步 `target`；之后的步骤只认 `videoId`。
 * `create` 由接受它的流程自己的步骤新建，在项目里或会话的来源目录里（从链接导入在下载之后新建，名字取页面标题；转录给了
 * `media` 时新建并导入那个文件）。
 */

/** 解析目标这一步的名字：接受 `target` 的流程把 `targetStep()` 放在第一步。 */
export const TARGET_STEP = 'target';

/** 流程持有的一个视频的租约：视频、它的位置（重试时按它重新打开）与放下租约。 */
export interface VideoLease {
  videoId: Id;
  place: VideoPlace;
  release(): void;
}

/** Runtime 给流程的视频目标：找到 Space 条目的位置、以租约打开、在项目或会话里新建。 */
export interface PipelineTargets {
  /**
   * Space 里的视频条目的位置，不打开视频。条目不存在 `not-found`，在回收站里 `conflict`（`SPACE_ENTRY_TRASHED`），
   * 不是视频 `invalid-request`（`SPACE_ENTRY_NOT_VIDEO`）。
   */
  entry(entryId: Id): Promise<VideoPlace>;
  /**
   * 以 Runtime 的租约打开这个位置上的视频（与重启恢复同一条路径）：别的连接已经打开着时直接用那一份；被别的进程锁着时
   * 抛 `conflict`（`VIDEO_LOCKED`）；不在了 `not-found`。
   */
  lease(place: VideoPlace): Promise<VideoLease>;
  /**
   * 在项目目录（或会话的来源目录：会话属于项目时是项目目录，否则是会话的工作目录）里占下新视频的目录（与 `videos.create`
   * 同样按名字挑一个还不存在的目录，先建成空目录）。占下之后别的新建都会跳过它，所以之后在这个位置上出现的视频只能是按这次
   * 占位新建的：流程先把位置记下再新建，重试时按它认回已经建好的视频（`video-create.ts`）。
   */
  reserve(request: PipelineCreateScope & { name: string }): Promise<VideoPlace>;
  /**
   * 在项目或会话的来源目录里新建一个视频并持有它的租约（与 `videos.create`、智能体的 `videos_create` 同一条路径，视频登记在
   * 同一个范围里）。同一个 `commandId` 在一次运行里只新建一次。给了 `place`（`reserve` 占下的）时建在那里；那里已经有视频时
   * （上次新建之后、记下产出之前中断了）认回它，不再新建。
   */
  create(request: PipelineCreateScope & { name: string; commandId: Id; place?: VideoPlace }): Promise<VideoLease>;
}

/** 流程声明它接受哪些目标：`create` 为 false 时 `{ create }` 以 `PIPELINE_TARGET_UNSUPPORTED` 拒绝。 */
export interface PipelineTargetSupport {
  create: false | { media: boolean };
}

/** 校验过的目标（`videoId` 与 `target` 合在一起）；都没给时 null。 */
export type ResolvedTargetParam = { videoId: Id } | { entryId: Id } | { create: PipelineCreateTarget };

/**
 * 读 `pipelines.start` 参数里的 `target` 与顶层 `videoId`：形状不合 `invalid-request`；两者都给且不是同一个视频时
 * `invalid-request`（`entryId` 要解析之后才知道，由调用方再比）；流程不接受新建时 `PIPELINE_TARGET_UNSUPPORTED`。
 */
export function readVideoTarget(raw: Record<string, unknown>, support: PipelineTargetSupport): ResolvedTargetParam | null {
  const videoId = raw.videoId;
  if (raw.target === undefined) return typeof videoId === 'string' && videoId.trim() !== '' ? { videoId } : null;
  const target = checkTarget(raw.target, support);
  if (videoId !== undefined) {
    if ('create' in target) throw invalid('target', JobsParams.createExcludesVideoId());
    if ('videoId' in target && target.videoId !== videoId) throw invalid('target', JobsVideoTarget.notSameVideo());
  }
  return target;
}

function checkTarget(value: unknown, support: PipelineTargetSupport): PipelineVideoTarget {
  if (!isRecord(value)) throw invalid('target', JobsVideoTarget.targetShapeOneOf());
  const keys = Object.keys(value);
  if (keys.length !== 1) throw invalid('target', JobsVideoTarget.targetShapeOneOf());
  const [key] = keys;
  if (key === 'videoId' || key === 'entryId') {
    const id = value[key];
    if (typeof id !== 'string' || id.trim() === '' || id.length > 200) throw invalid(`target.${key}`, JobsParams.mustBeNonEmptyString());
    return key === 'videoId' ? { videoId: id } : { entryId: id };
  }
  if (key !== 'create') throw invalid('target', JobsVideoTarget.targetShapeOneOf());
  if (!support.create) {
    throw new RpcError('invalid-request', JobsVideoTarget.createUnsupported(), {
      code: 'PIPELINE_TARGET_UNSUPPORTED',
    });
  }
  return { create: readCreateTarget(value.create, support.create.media) };
}

/**
 * `target.create` 的形状：`projectId` 与 `conversationId` 给且只给一个（新建在项目里，或会话的来源目录里），`name` 可选；
 * `media` 只在流程接受时可以给。
 */
export function readCreateTarget(value: unknown, media: boolean): PipelineCreateTarget {
  if (!isRecord(value)) throw invalid('target.create', JobsVideoTarget.createShape());
  for (const key of Object.keys(value)) {
    if (key === 'media' && !media) throw invalid('target.create.media', JobsVideoTarget.mediaNotAllowed());
    if (key !== 'projectId' && key !== 'conversationId' && key !== 'name' && key !== 'media') {
      throw invalid('target.create', JobsVideoTarget.unknownField({ key }));
    }
  }
  const { projectId, conversationId, name } = value;
  if (projectId !== undefined && conversationId !== undefined) throw invalid('target.create', JobsVideoTarget.scopeOnlyOne());
  if (projectId === undefined && conversationId === undefined) throw invalid('target.create', JobsVideoTarget.scopeRequired());
  const scopeKey = conversationId !== undefined ? 'conversationId' : 'projectId';
  const scopeId = value[scopeKey];
  if (typeof scopeId !== 'string' || scopeId.trim() === '' || scopeId.length > 200) {
    throw invalid(`target.create.${scopeKey}`, JobsParams.mustBeNonEmptyString());
  }
  if (name !== undefined && (typeof name !== 'string' || name.trim() === '' || name.length > 200)) {
    throw invalid('target.create.name', JobsVideoTarget.nameLength());
  }
  if (value.media !== undefined && (typeof value.media !== 'string' || !path.isAbsolute(value.media) || value.media.length > 4096)) {
    throw invalid('target.create.media', JobsVideoTarget.mediaPath());
  }
  return {
    ...createScope(scopeKey, scopeId),
    ...(typeof name === 'string' ? { name: name.trim() } : {}),
    ...(typeof value.media === 'string' ? { media: value.media } : {}),
  };
}

function createScope(key: 'projectId' | 'conversationId', id: Id): PipelineCreateScope {
  return key === 'projectId' ? { projectId: id } : { conversationId: id };
}

/** 新建目标的所在（去掉名字与媒体）。 */
export function createScopeOf(create: PipelineCreateTarget): PipelineCreateScope {
  return create.projectId !== undefined ? { projectId: create.projectId } : { conversationId: create.conversationId };
}

/**
 * 解析目标这一步：由 `PipelineRunner` 在提交时完成（`entryId` 的目标记为完成，产出 `{ entryId, videoId, place }`；
 * 别的记为跳过），执行时不会走到 `run`。
 */
export function targetStep<P>(): PipelineStep<P> {
  return {
    name: TARGET_STEP,
    label: () => JobsVideoTarget.stepLabel(),
    holdsVideo: true,
    run: () => Promise.reject(new Error('The target step is resolved by PipelineRunner at submission')),
  };
}

/**
 * `target` 参数的 JSON Schema（`pipelines.list` 交出）：`create` 只在流程接受新建时列出，`media` 只在流程接受媒体时列出；
 * `create` 的 `projectId` 与 `conversationId` 给且只给一个。
 */
export function targetSchema(
  description: string,
  create: { projectId: string; conversationId: string; name: string; media?: string } | null,
): Record<string, unknown> {
  const one = (key: string, value: Record<string, unknown>) => ({
    type: 'object',
    properties: { [key]: value },
    required: [key],
    additionalProperties: false,
  });
  return {
    description,
    oneOf: [
      // i18n-ignore-start: 参数说明（给智能体的 JSON Schema）
      one('videoId', { type: 'string', description: '已打开的视频' }),
      one('entryId', { type: 'string', description: 'Space 里的视频条目（不要求已打开）' }),
      // i18n-ignore-end
      ...(create
        ? [
            one('create', {
              type: 'object',
              properties: {
                projectId: { type: 'string', description: create.projectId },
                conversationId: { type: 'string', description: create.conversationId },
                name: { type: 'string', maxLength: 200, description: create.name },
                ...(create.media ? { media: { type: 'string', maxLength: 4096, description: create.media } } : {}),
              },
              oneOf: [{ required: ['projectId'] }, { required: ['conversationId'] }],
              additionalProperties: false,
            }),
          ]
        : []),
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
