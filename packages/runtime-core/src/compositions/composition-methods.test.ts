import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { resolveElectronBinary } from '@baocut/code-runtime';
import { RpcError, type CompositionItem, type Id, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveExportWorkerCommand } from '../exports/video-export.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';

/**
 * `compositions.preview` / `compositions.import` 经 RPC（架构设计 §8）：界面不经过智能体，用技能里的下三分之一样例
 * （lower-third/16x9.html）当内联文件预览、导入；帧回媒体句柄，导入带 `conversationId` 时会话里放变更卡，错误码在 `details`。
 * 需要 engine-host、Render Worker、ffmpeg 与 Electron，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const worker = resolveExportWorkerCommand(engine);
const electron = resolveElectronBinary();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const EXEMPLAR = fileURLToPath(new URL('../../../../skills/motion-graphics/exemplars/lower-third/16x9.html', import.meta.url));
const LONG = { timeoutMs: 600_000 };

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RpcError);
  return error as RpcError;
}

describe.skipIf(!engine || !worker || !ffmpeg || !electron)('代码画面 RPC（桌面连接，真实引擎与 Electron）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;
  let conversationId: Id;
  let videoId: Id;
  let html: string;

  beforeAll(async () => {
    html = await fs.readFile(EXEMPLAR, 'utf8');
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-composition-methods-')));
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '代码画面 RPC' }));
    ({
      conversation: { id: conversationId },
    } = await client.request('conversations.create', { projectId: project.id }));
    const opened = await client.request('videos.create', {
      projectId: project.id,
      name: '下三分之一',
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
    });
    videoId = opened.ref.videoId;
  }, 120_000);

  afterAll(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('compositions.preview：内联文件取帧，帧写在项目的 .baocut-out/frames/<videoId>/，回媒体句柄', async () => {
    const preview = await client.request(
      'compositions.preview',
      { video: videoId, files: [{ path: 'index.html', content: html }], at: ['1', '1', '9'] },
      LONG,
    );
    expect(preview).toMatchObject({ videoId, compositionId: 'main', width: 1920, height: 1080, durationSeconds: 4, alpha: true });
    expect(preview.frames).toHaveLength(3);
    const [a, b, c] = preview.frames;
    expect(a!.sha256).toBe(b!.sha256);
    expect(a!.clamped).toBe(false);
    expect(c!.clamped).toBe(true);
    expect(a!.media).toMatchObject({ mimeType: 'image/png', url: expect.any(String) });
    expect(a!.media.size).toBeGreaterThan(0);
    const framesDir = path.join(project.path, '.baocut-out', 'frames', videoId);
    expect(await fs.readdir(framesDir)).toContain(a!.media.fileName);
  }, 300_000);

  it('compositions.import：内联文件验证、烘焙、导入并放置；带 conversationId 时会话里有变更卡', async () => {
    const before = runtime.videos.mirror(videoId)!.video.revision;
    const imported = await client.request(
      'compositions.import',
      { video: videoId, files: [{ path: 'index.html', content: html }], name: '下三分之一', conversationId },
      LONG,
    );
    expect(imported).toMatchObject({
      status: 'committed',
      videoId,
      revision: { before },
      capabilities: { alpha: true, width: 1920, height: 1080, durationFrames: 120 },
      verification: { status: 'passed' },
      bundle: {
        compositionId: 'main',
        width: 1920,
        height: 1080,
        fps: { num: 30, den: 1 },
        durationFrames: 120,
        synthesizedManifest: true,
      },
      prerender: { frames: 120, hasAlpha: true },
      itemId: expect.any(String),
      trackId: expect.any(String),
    });
    expect('approval' in imported).toBe(false);

    const video = runtime.videos.mirror(videoId)!.video;
    expect(video.revision).toBe(imported.revision.after);
    const item = video.sequences[video.rootSequenceId]!.items.find((i) => i.id === imported.itemId) as CompositionItem;
    expect(item).toMatchObject({
      type: 'composition',
      source: { kind: 'bundle', assetRef: { id: imported.bundle.assetId, revision: imported.bundle.revision } },
      prerender: { id: imported.prerender!.assetId, revision: imported.prerender!.revision },
    });

    const { items } = await client.request('conversations.get', { conversationId });
    const changes = items.filter((i) => i.kind === 'video-change');
    // 两笔提交（导入素材、放置片段），两张卡。
    expect(changes).toHaveLength(2);
    for (const change of changes) expect(change).toMatchObject({ taskId: null, videoId });
  }, 600_000);

  it('错误：视频没打开、path 出了项目目录、会话不存在', async () => {
    const notOpen = await rejection(
      client.request('compositions.import', { video: 'vid_missing', files: [{ path: 'index.html', content: html }] }),
    );
    expect(notOpen.code).toBe('not-found');
    expect(notOpen.details).toMatchObject({ code: 'VIDEO_NOT_OPEN' });

    const outside = await rejection(client.request('compositions.preview', { video: videoId, path: '..', at: ['0'] }, LONG));
    expect(outside.code).toBe('forbidden');
    expect(outside.details).toMatchObject({ code: 'PATH_OUTSIDE_PROJECT', detail: expect.any(String) });

    const revision = runtime.videos.mirror(videoId)!.video.revision;
    const badConversation = await rejection(
      client.request('compositions.import', {
        video: videoId,
        files: [{ path: 'index.html', content: html }],
        conversationId: 'conv_missing',
      }),
    );
    expect(badConversation.code).toBe('not-found');
    expect(runtime.videos.mirror(videoId)!.video.revision).toBe(revision);
  }, 120_000);
});
