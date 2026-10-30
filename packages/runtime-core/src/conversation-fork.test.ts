import { describe, expect, it } from 'vitest';
import type { VideoVersion, VideoVersionList } from '@baocut/protocol';
import type { TouchedVideo } from '@baocut/harness';
import { forkVideoOptions, planForkVideo, restoreForkVideos, type ForkVideoDeps } from './conversation-fork.ts';
import type { TrustedPrincipal } from './gateway.ts';

/** 分叉的「把视频回到那时」（产品设计 §3.2.2「分叉」）：按版本记录算回到哪一版、回不去的原因；视频用内部打开者打开、用完关掉。 */

const at = (min: number) => new Date(Date.UTC(2026, 9, 30, 8, min)).toISOString();
const version = (n: number, startMin: number, endMin: number): VideoVersion =>
  ({
    version: n,
    startedAt: at(startMin),
    updatedAt: at(endMin),
    conversations: [],
    files: [],
    actions: [],
    bytes: 1,
    open: false,
  }) as unknown as VideoVersion;
const list = (versions: VideoVersion[], unreadable: number[] = []): VideoVersionList => ({ versions, unreadable });
const video = { videoId: 'v1', videoName: 'Trailer', createdAt: null };
const ENDED = at(30);

describe('planForkVideo', () => {
  it('回到结束前最后更新的那一版，之后的版本（含别人的）都算撤回', () => {
    const plan = planForkVideo(video, ENDED, list([version(4, 50, 55), version(3, 35, 40), version(2, 20, 29), version(1, 0, 10)]));
    expect(plan).toEqual({ option: { videoId: 'v1', videoName: 'Trailer', state: 'ok', version: 2, undone: 2 }, target: 2 });
  });

  it('那之后没有改动时不列', () => {
    expect(planForkVideo(video, ENDED, list([version(2, 20, 29), version(1, 0, 10)]))).toBeNull();
  });

  it('那时之前的版本被清掉时 pruned；最早一版是第 1 版或这条会话之后才建的是 created-after', () => {
    expect(planForkVideo(video, ENDED, list([version(9, 40, 45), version(8, 35, 38)]))?.option.state).toBe('pruned');
    expect(planForkVideo(video, ENDED, list([version(2, 40, 45), version(1, 35, 38)]))?.option.state).toBe('created-after');
    expect(planForkVideo({ ...video, createdAt: at(31) }, ENDED, list([version(1, 31, 32)]))).toEqual({
      option: { videoId: 'v1', videoName: 'Trailer', state: 'created-after' },
      target: null,
    });
  });

  it('目标之后有读不了的版本文件时链对不上，回不去', () => {
    const plan = planForkVideo(video, ENDED, list([version(4, 50, 55), version(2, 20, 29)], [3]));
    expect(plan).toEqual({ option: { videoId: 'v1', videoName: 'Trailer', state: 'chain-broken', version: 2 }, target: null });
  });
});

describe('forkVideoOptions / restoreForkVideos', () => {
  const principal: TrustedPrincipal = { connectionId: 'conn-1', kind: 'desktop', name: 'BaoCut' } as TrustedPrincipal;
  const touched = (videoId: string): TouchedVideo => ({
    videoId,
    videoName: videoId,
    target: { projectId: 'p1', path: `${videoId}.bcv` },
    createdAt: null,
    lastChangeAt: at(50),
  });

  function deps(projectOf: Record<string, string | null>) {
    const log: string[] = [];
    const d: ForkVideoDeps = {
      candidates: () => ({ endedAt: ENDED, videos: Object.keys(projectOf).map(touched) }),
      locate: (v) => ({ root: '/p', file: `${v.videoId}.bcv`, scope: { projectId: 'p1' } }),
      videos: {
        open: async (location, who) => {
          const videoId = location.file.replace('.bcv', '');
          log.push(`open ${videoId} ${who.connectionId}`);
          if (videoId === 'gone') throw new Error('missing');
          return { ref: { videoId, source: { projectId: projectOf[videoId] ?? null, conversationId: null } } } as never;
        },
        close: async (videoId, who) => {
          log.push(`close ${videoId} ${who.connectionId}`);
          return { closed: true };
        },
        listVersions: async () => list([version(3, 40, 45), version(2, 20, 29)]),
        restoreVersion: async (params, who) => {
          log.push(`restore ${params.videoId} ${params.version} ${who.connectionId}`);
          return { receipt: null, replayed: false, version: null };
        },
      },
    };
    return { d, log };
  }

  it('只列项目里的、打得开的视频；每部都用内部打开者打开并关掉', async () => {
    const { d, log } = deps({ a: 'p1', loose: null, gone: 'p1' });
    const options = await forkVideoOptions(d, { conversationId: 'c', taskId: 't' }, principal);
    expect(options).toEqual([{ videoId: 'a', videoName: 'a', state: 'ok', version: 2, undone: 1 }]);
    expect(log).toEqual([
      'open a conn-1#fork',
      'close a conn-1#fork',
      'open loose conn-1#fork',
      'close loose conn-1#fork',
      'open gone conn-1#fork',
    ]);
  });

  it('只回勾上的、回得去的；回到记在用户名下', async () => {
    const { d, log } = deps({ a: 'p1', b: 'p1' });
    expect(await restoreForkVideos(d, { conversationId: 'c', taskId: 't', restoreVideos: ['b'] }, principal)).toBe(1);
    expect(log).toEqual(['open b conn-1#fork', 'restore b 2 conn-1', 'close b conn-1#fork']);
  });
});
