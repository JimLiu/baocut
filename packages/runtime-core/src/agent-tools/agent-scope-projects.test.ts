import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Conversation } from '@baocut/protocol';
import type { Harness } from '@baocut/harness';
import type { JobManager } from '@baocut/jobs';
import type { VideoService } from '../videos/video-service.ts';
import { AgentScope } from './agent-scope.ts';

/*
 * Bot 线程的工作目录是频道文件目录，任务资源里的视频在项目里（技术方案 §7.1、BOT-VE-02）：按 videoId 打开时，在会话另外能用的
 * 项目里找到就按那个项目打开，范围记成项目；没给的项目照旧不让碰。
 */

const VIDEO = 'video_0123456789abcdef';
let dir: string;
let channelDir: string;
let projectDir: string;

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-scope-')));
  channelDir = path.join(dir, 'channel-files');
  projectDir = path.join(dir, 'project');
  await fs.mkdir(path.join(projectDir, 'episode-4'), { recursive: true });
  await fs.mkdir(channelDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function setup(granted: string[]) {
  const conversation = { id: 'conv_t', role: 'thread', cwd: channelDir, projectId: null, folderOf: null, driverId: 'codex' } as unknown as Conversation;
  const harness = {
    agentRun: () => ({ taskId: 'task_1', stopRequested: false, mode: 'auto', conversation }),
    conversationOf: () => conversation,
    listProjects: () => [{ id: 'proj_1', name: 'Show', path: projectDir }],
  } as unknown as Harness;
  const opened: { root: string; file: string; scope: unknown }[] = [];
  const videoPath = path.join(projectDir, 'episode-4');
  const videos = {
    ref: (id: string) => (id === VIDEO ? { videoId: VIDEO, path: videoPath } : null),
    openRefs: () => [{ videoId: VIDEO, path: videoPath }],
    open: async (params: { root: string; file: string; scope: unknown }) => {
      opened.push(params);
      return { ref: { videoId: VIDEO } };
    },
  } as unknown as VideoService;
  const scope = new AgentScope({ harness, videos, jobs: {} as JobManager, videoProjects: () => granted });
  const access = scope.authorize({ kind: 'agent', conversationId: conversation.id, connectionId: 'c', name: 'agent' } as never, false);
  return { scope, access, opened, conversation, videoPath };
}

describe('AgentScope and project videos for bot threads', () => {
  it('a video in a granted project opens with that project as its root and scope', async () => {
    const { scope, access, opened, conversation, videoPath } = setup(['proj_1']);
    await scope.open(VIDEO, access);
    expect(opened).toEqual([{ root: projectDir, file: videoPath, scope: { projectId: 'proj_1' } }]);
    expect(await scope.contains(VIDEO, conversation)).toBe(true);
  });

  it('without the grant the video stays outside the working folder', async () => {
    const { scope, access, opened, conversation } = setup([]);
    await scope.open(VIDEO, access);
    expect(opened[0]).toMatchObject({ root: channelDir, scope: { conversationId: 'conv_t' } });
    expect(await scope.contains(VIDEO, conversation)).toBe(false);
  });
});
