import type { ForkVideoOption, Id, VideoRef, VideoVersionList } from '@baocut/protocol';
import { newId } from '@baocut/protocol';
import type { Logger, TouchedVideo } from '@baocut/harness';
import type { TrustedPrincipal } from './gateway.ts';
import type { VideoLocation, VideoService } from './videos/video-service.ts';

/*
 * 分叉的「把视频回到那时」（产品设计 §3.2.2「分叉」）：这条会话改过或建过、那一轮结束之后又有改动的视频，回到那一轮结束前的最后一版。
 * 版本记录只有项目里的视频有（视频格式规范 §9），无项目的跳过。视频用一个内部打开者打开、用完就关，不碰用户编辑器里的那一份。
 */

/** 一次至多看这么多部（按最后一次改动，新的在前）。 */
export const FORK_VIDEO_LIMIT = 20;

export interface ForkVideoDeps {
  /** 那一轮结束的时刻与这条会话改过的视频（`Harness.forkCandidates`）。 */
  candidates(conversationId: Id, taskId: Id): { endedAt: string; videos: TouchedVideo[] };
  /** 视频此刻在哪：先按 videoId 找（已打开的、Space 登记的），找不到时用会话里记下的位置。 */
  locate(video: TouchedVideo): VideoLocation;
  videos: Pick<VideoService, 'open' | 'close' | 'listVersions' | 'restoreVersion'>;
  log?: Logger;
}

export interface ForkVideoPlan {
  option: ForkVideoOption;
  /** 回到的版本；回不去时 null。 */
  target: number | null;
}

/**
 * 一部视频回不回得去、回到哪一版。那一轮结束之后没有改动时 null（不列）。目标是结束时刻之前最后更新的那一版，
 * 它之后的版本（含用户与别的会话的）都会撤回；中间有读不了的版本文件时链对不上，回不去。
 */
export function planForkVideo(
  video: Pick<TouchedVideo, 'videoId' | 'videoName' | 'createdAt'>,
  endedAt: string,
  list: VideoVersionList,
): ForkVideoPlan | null {
  const base = { videoId: video.videoId, videoName: video.videoName };
  const end = Date.parse(endedAt);
  if (video.createdAt && Date.parse(video.createdAt) > end) return { option: { ...base, state: 'created-after' }, target: null };
  const versions = [...list.versions].sort((a, b) => b.version - a.version);
  if (!versions.some((v) => Date.parse(v.updatedAt) > end)) return null;
  const target = versions.find((v) => Date.parse(v.updatedAt) <= end);
  // 那时之前一版都没有：最早的一版是第 1 版时视频是那之后才有的（别的会话建的），否则是被保留规则清掉了。
  if (!target) return { option: { ...base, state: versions.at(-1)?.version === 1 ? 'created-after' : 'pruned' }, target: null };
  if (list.unreadable.some((n) => n > target.version))
    return { option: { ...base, state: 'chain-broken', version: target.version }, target: null };
  const undone = versions.filter((v) => v.version > target.version).length;
  return { option: { ...base, state: 'ok', version: target.version, undone }, target: target.version };
}

/** `conversations.forkVideos`：这条会话改过的视频里，那一轮之后又有改动的，各自能不能回去。 */
export async function forkVideoOptions(
  deps: ForkVideoDeps,
  params: { conversationId: Id; taskId: Id },
  principal: TrustedPrincipal,
): Promise<ForkVideoOption[]> {
  const { endedAt, videos } = deps.candidates(params.conversationId, params.taskId);
  const options: ForkVideoOption[] = [];
  for (const video of videos.slice(0, FORK_VIDEO_LIMIT)) {
    const plan = await withVideo(deps, video, principal, async (ref) =>
      planForkVideo(video, endedAt, await deps.videos.listVersions(ref.videoId)),
    );
    if (plan) options.push(plan.option);
  }
  return options;
}

/**
 * `conversations.fork` 带 `restoreVideos` 时，分叉之后把这些视频回到那时：按此刻的版本记录重算，回得去的才回；回到本身记成新的一版，
 * 可以再回来。返回回了几部（已经是那个样子的也算）。单部失败只记日志，不影响别的。
 */
export async function restoreForkVideos(
  deps: ForkVideoDeps,
  params: { conversationId: Id; taskId: Id; restoreVideos: readonly Id[] },
  principal: TrustedPrincipal,
): Promise<number> {
  const wanted = new Set(params.restoreVideos);
  const { endedAt, videos } = deps.candidates(params.conversationId, params.taskId);
  let restored = 0;
  for (const video of videos.slice(0, FORK_VIDEO_LIMIT)) {
    if (!wanted.has(video.videoId)) continue;
    const ok = await withVideo(deps, video, principal, async (ref) => {
      const plan = planForkVideo(video, endedAt, await deps.videos.listVersions(ref.videoId));
      if (plan?.target == null) return false;
      await deps.videos.restoreVersion({ videoId: ref.videoId, commandId: newId('cmd'), version: plan.target }, principal);
      return true;
    });
    if (ok) restored++;
  }
  return restored;
}

/** 用内部打开者打开项目里的视频做 `fn`，做完关掉；打不开或不在项目里时 null。 */
async function withVideo<T>(
  deps: ForkVideoDeps,
  video: TouchedVideo,
  principal: TrustedPrincipal,
  fn: (ref: VideoRef) => Promise<T>,
): Promise<T | null> {
  const opener: TrustedPrincipal = { ...principal, connectionId: `${principal.connectionId}#fork` };
  let ref: VideoRef;
  try {
    ref = (await deps.videos.open(deps.locate(video), opener)).ref;
  } catch (error) {
    deps.log?.info('Skipped a video while forking: it could not be opened', { videoId: video.videoId, error: String(error) });
    return null;
  }
  try {
    if (!ref.source.projectId) return null;
    return await fn(ref);
  } catch (error) {
    deps.log?.warn('Fork video step failed', { videoId: ref.videoId, error: String(error) });
    return null;
  } finally {
    await deps.videos.close(ref.videoId, opener).catch(() => {});
  }
}
