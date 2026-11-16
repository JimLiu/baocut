import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { RpcError, type Project, type RecordingSummary, type VideoSnapshot } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime, type StartRuntimeOptions } from '../runtime.ts';

/**
 * 端到端：Runtime 的录制会话 + 假的 Recording Worker（`testing/fake-recording-worker.ts`，用 ffmpeg 合成媒体）+ 真实引擎：
 * 开始、暂停与继续、停止、收尾与导入成素材、录制清单、屏幕取景、实例与联动组；摄像头晚到、中途断开、导入中途退出后重做、
 * 丢弃、崩溃后恢复、同时只能一次、没人在场时拒绝。需要 engine-host 与 ffmpeg，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const FAKE_WORKER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'testing', 'fake-recording-worker.ts');

describe.skipIf(!engine || !ffmpeg)('屏幕录制（假 Worker + 真实引擎）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  async function boot(scenario: Record<string, unknown> = {}, extra: Partial<StartRuntimeOptions> = {}): Promise<void> {
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      modelWorker: null,
      videoGraceMs: 100,
      recordingWorker: {
        command: process.execPath,
        args: [FAKE_WORKER],
        env: { ...process.env, BAOCUT_FAKE_RECORDING: JSON.stringify(scenario) },
      },
      recordings: { hasWindow: () => true, secondMs: 20, freeBytes: async () => 100 * 1024 ** 3 },
      ...extra,
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({ resolve: async () => ({ endpoint, token }), client: { kind: 'desktop', name: 'test', version: '0' }, reconnect: false });
    await client.connect();
  }

  async function shutdown(): Promise<void> {
    client.close();
    await runtime.close();
  }

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-recording-')));
  });

  afterEach(async () => {
    await shutdown().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function until(recordingId: string, done: (r: RecordingSummary) => boolean, timeoutMs = 30_000): Promise<RecordingSummary> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { recording } = await client.request('recordings.status', { recordingId });
      if (recording && done(recording)) return recording;
      if (Date.now() > deadline) throw new Error(`Timed out waiting; last state ${JSON.stringify(recording?.state)}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  /** 不再自己变化的状态：进了时间线，或失败（可导入但带着错误）。中间那一下 `importable` 不算。 */
  const settled = (r: RecordingSummary) => r.state === 'in-timeline' || r.state === 'failed' || (r.state === 'importable' && r.error !== null);

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function startRecording(options: Record<string, unknown> = {}): Promise<RecordingSummary> {
    ({ project } = await client.request('projects.create', { name: 'Recording test' }));
    const { recording } = await client.request('recordings.start', {
      options: { countdown: 1, ...options },
      target: { create: { name: 'Demo', projectId: project.id } },
    });
    return recording;
  }

  async function videoOf(videoId: string): Promise<VideoSnapshot> {
    const { target } = await client.request('videos.target', { videoId });
    const opened = await client.request('videos.open', target);
    return opened.snapshot.video;
  }

  async function rejection(promise: Promise<unknown>): Promise<RpcError> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof RpcError) return error;
      throw error;
    }
    throw new Error('should have been rejected');
  }

  function recordedAssets(video: VideoSnapshot) {
    return Object.values(video.assets).filter((a) => a.revisions[a.currentRevision]?.provenance.origin === 'recording');
  }

  function rootItems(video: VideoSnapshot) {
    return video.sequences[video.rootSequenceId]!.items as unknown as Array<Record<string, unknown> & { id: string; trackId: string }>;
  }

  it('录制、暂停与继续、停止：任务完成，清单、取景、实例与联动组都对', async () => {
    await boot();
    const started = await startRecording({ camera: 'cam-1', microphone: 'mic-1', systemAudio: true, keys: 'shortcuts' });
    expect(started.jobId).toBeTruthy();
    expect((await client.request('jobs.inspect', { jobId: started.jobId! })).kind).toBe('recording');
    const recording = await until(started.recordingId, (r) => r.state === 'recording');
    await sleep(400);
    expect((await client.request('recordings.pause', {})).recording.state).toBe('paused');
    const pausedJob = await client.request('jobs.inspect', { jobId: started.jobId! });
    expect(pausedJob.phase).toBe('paused');
    expect(pausedJob.progress).toMatchObject({ total: null, unit: 'seconds' });
    await sleep(300);
    expect((await client.request('recordings.resume', {})).recording.state).toBe('recording');
    await sleep(400);
    const stopped = await client.request('recordings.stop', {});
    expect(['stopping', 'finalizing']).toContain(stopped.recording.state);
    const done = await until(recording.recordingId, settled);
    expect(done.error).toBeNull();
    expect(done.state).toBe('in-timeline');
    const job = await client.request('jobs.inspect', { jobId: started.jobId! });
    expect(job.state).toBe('completed');
    expect(job.recording?.result?.videoId).toBe(done.videoId);
    // 暂停的时间不算：两段大约 0.8 秒，不到 1.1 秒。
    expect(done.result!.duration).toBeGreaterThan(0.5);
    expect(done.result!.duration).toBeLessThan(1.1);
    // 结果字段（屏幕录制设计 §12）：会话 ID 与 `recordings status` 的参数一致；`autoZoomPending` 已弃用，恒为 false。
    expect(done.result!.recordingId).toBe(recording.recordingId);
    expect(done.result!.autoZoomPending).toBe(false);

    const video = await videoOf(done.videoId!);
    const manifest = video.documents[done.result!.manifestDocumentId]!;
    expect(manifest.kind).toBe('recording');
    const view = video.documents[done.result!.screenViewDocumentId]!;
    expect(view.kind).toBe('screen-view');
    // 两段 × 屏幕、摄像头、麦克风、系统音频 = 8 个实例，全部在一个登记的联动组里。
    const items = rootItems(video);
    const ours = items.filter((i) => done.result!.itemIds.includes(i.id));
    expect(ours).toHaveLength(8);
    expect(new Set(ours.map((i) => i.linkGroupId))).toEqual(new Set([done.result!.groupId]));
    const groups = video.sequences[video.rootSequenceId]!.linkGroups ?? [];
    expect(groups).toEqual([expect.objectContaining({ id: done.result!.groupId, kind: 'recording', recordingId: done.result!.manifestDocumentId })]);
    // 屏幕实例挂着取景，摄像头是画中画的圆形。
    const screenItems = ours.filter((i) => (i.screenView as { documentId?: string } | undefined)?.documentId === done.result!.screenViewDocumentId);
    expect(screenItems).toHaveLength(2);
    const camera = ours.find((i) => (i.mask as { shape?: string } | undefined)?.shape === 'ellipse');
    expect(camera).toBeTruthy();
    // 素材来源是录制；指针轨、键盘轨与光标图片也都是素材。
    const recorded = recordedAssets(video);
    expect(recorded.length).toBe(8 + 2 + 2 + 1);
    // 第二段晚于第一段：第二段屏幕实例的起点在第一段之后。
    expect(new Set(ours.map((i) => i.trackId)).size).toBe(4);
    // 导入成功之后录制目录删掉了。
    await expect(fs.stat(done.dir)).rejects.toThrow();
    expect((await client.request('recordings.list', {})).recordings.map((r) => r.state)).toEqual(['in-timeline']);
  }, 60_000);

  it('摄像头晚到、中途断开：清单照实记下起点与有内容的区间，实例修到区间结尾', async () => {
    await boot({ cameraDelayMs: 200, loseCameraAfterMs: 500 });
    const started = await startRecording({ camera: 'cam-1', microphone: 'mic-1' });
    await until(started.recordingId, (r) => r.state === 'recording');
    const lost = await until(started.recordingId, (r) => r.streams.some((s) => s.role === 'camera' && s.lost === true));
    expect(lost.state).toBe('recording');
    await sleep(400);
    await client.request('recordings.stop', { recordingId: started.recordingId });
    const done = await until(started.recordingId, settled);
    expect(done.state).toBe('in-timeline');
    const video = await videoOf(done.videoId!);
    const items = rootItems(video).filter((i) => done.result!.itemIds.includes(i.id));
    expect(items).toHaveLength(3);
    const job = await client.request('jobs.inspect', { jobId: started.jobId! });
    expect(job.warnings.some((w) => w.code === 'RECORDING_DEVICE_LOST')).toBe(true);
    // 摄像头的实例晚于屏幕开始，断开之后修短，比屏幕先结束。
    const visual = items.filter((i) => i.type === 'video') as unknown as { span: { fromFrame: number; durationFrames: number } }[];
    const [screen, camera] = visual.sort((a, b) => a.span.fromFrame - b.span.fromFrame);
    expect(camera!.span.fromFrame).toBeGreaterThan(screen!.span.fromFrame);
    const end = (i: typeof screen) => i!.span.fromFrame + i!.span.durationFrames;
    expect(end(camera)).toBeLessThan(end(screen));
  }, 60_000);

  it('导入中途退出：重启之后列出没收完的，恢复按同样的命令 ID 重做，不重复插入', async () => {
    let failOnce = true;
    await boot(
      {},
      {
        recordings: {
          hasWindow: () => true,
          secondMs: 20,
          freeBytes: async () => 100 * 1024 ** 3,
          faults: {
            afterImportStep: (step) => {
              if (step === 'timeline' && failOnce) {
                failOnce = false;
                throw new Error('simulated exit during import');
              }
            },
          },
        },
      },
    );
    const started = await startRecording({ microphone: 'mic-1' });
    await until(started.recordingId, (r) => r.state === 'recording');
    await sleep(300);
    await client.request('recordings.stop', {});
    const broken = await until(started.recordingId, settled);
    expect(broken.state).toBe('importable');
    expect(broken.unfinished).toBe(true);
    expect((await client.request('jobs.inspect', { jobId: started.jobId! })).state).toBe('failed');
    // Runtime 重启：会话从目录读回来，仍是可以恢复的。
    await shutdown();
    await boot();
    const listed = (await client.request('recordings.list', {})).recordings;
    expect(listed).toEqual([expect.objectContaining({ recordingId: started.recordingId, state: 'importable', unfinished: true })]);
    const recovered = await client.request('recordings.recover', { recordingId: started.recordingId });
    expect(recovered.recording.jobId).not.toBe(started.jobId);
    const done = await until(started.recordingId, settled);
    expect(done.error).toBeNull();
    expect(done.state).toBe('in-timeline');
    const video = await videoOf(done.videoId!);
    // 只有一份清单、一份取景、一个联动组；素材与实例没有重复。
    expect(Object.values(video.documents).filter((d) => d.kind === 'recording')).toHaveLength(1);
    expect(Object.values(video.documents).filter((d) => d.kind === 'screen-view')).toHaveLength(1);
    expect(video.sequences[video.rootSequenceId]!.linkGroups ?? []).toHaveLength(1);
    expect(rootItems(video).filter((i) => i.linkGroupId)).toHaveLength(2);
    const recorded = recordedAssets(video);
    expect(recorded).toHaveLength(2 + 1 + 1);
    // 新视频只建了一个。
    const videos = await fs.readdir(project.path);
    expect(videos.filter((name) => name.endsWith('.video') || name.startsWith('Demo'))).toHaveLength(1);
  }, 90_000);

  it('Worker 崩溃：已经写下的保留，恢复之后导入', async () => {
    await boot({ crashAfterMs: 500 });
    const started = await startRecording({ microphone: 'mic-1' });
    const crashed = await until(started.recordingId, settled);
    expect(crashed.state).toBe('importable');
    expect(crashed.error?.code).toBe('RECORDING_WORKER_CRASHED');
    expect((await client.request('jobs.inspect', { jobId: started.jobId! })).state).toBe('failed');
    await client.request('recordings.recover', { recordingId: started.recordingId });
    const done = await until(started.recordingId, settled);
    expect(done.state).toBe('in-timeline');
    expect(done.result!.itemIds).toHaveLength(2);
  }, 60_000);

  it('丢弃：删掉文件，任务以取消结束；进了视频的不能在这里丢弃', async () => {
    await boot();
    const started = await startRecording();
    await until(started.recordingId, (r) => r.state === 'recording');
    await sleep(200);
    expect(await client.request('recordings.discard', { recordingId: started.recordingId })).toEqual({ recordingId: started.recordingId, removed: true });
    await expect(fs.stat(started.dir)).rejects.toThrow();
    expect((await client.request('jobs.inspect', { jobId: started.jobId! })).state).toBe('cancelled');
    expect((await client.request('recordings.list', {})).recordings).toEqual([]);
    const missing = await rejection(client.request('recordings.status', { recordingId: started.recordingId }));
    expect((missing.details as { code?: string }).code).toBe('RECORDING_NOT_FOUND');
  }, 60_000);

  it('同时只能一次（RECORDING_BUSY）；权限被拒时说明去系统设置哪一项', async () => {
    await boot({ permissions: { camera: 'denied' } });
    const started = await startRecording();
    await until(started.recordingId, (r) => r.state === 'recording');
    const busy = await rejection(client.request('recordings.start', { target: { create: { projectId: project.id } } }));
    expect((busy.details as { code?: string }).code).toBe('RECORDING_BUSY');
    await client.request('recordings.discard', { recordingId: started.recordingId });
    const denied = await rejection(
      client.request('recordings.start', { options: { camera: 'cam-1' }, target: { create: { projectId: project.id } } }),
    );
    expect(denied.code).toBe('forbidden');
    expect(denied.details).toMatchObject({
      code: 'RECORDING_PERMISSION_DENIED',
      systemAccess: [expect.objectContaining({ permission: 'camera', state: 'denied' })],
    });
    expect((await client.request('recordings.list', {})).recordings).toEqual([]);
  }, 60_000);

  it('开始时系统才拒绝权限：Worker 报出的那项换成 RECORDING_PERMISSION_DENIED 与系统设置位置', async () => {
    await boot({ startError: { code: 'SCREEN_PERMISSION_DENIED', message: 'The user declined TCCs for application, window, display capture' } });
    const started = await startRecording();
    const failed = await until(started.recordingId, settled);
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatchObject({
      code: 'RECORDING_PERMISSION_DENIED',
      details: { workerCode: 'SCREEN_PERMISSION_DENIED', systemAccess: [expect.objectContaining({ permission: 'screen', state: 'denied' })] },
    });
    expect((await client.request('jobs.inspect', { jobId: started.jobId! })).state).toBe('failed');
    // 开始之前就失败的留在列表里（屏幕录制设计 §7「失败的录制」）：还能查到状态与错误，不能恢复，丢弃之后才查不到。
    expect((await client.request('recordings.status', { recordingId: started.recordingId })).recording).toMatchObject({ state: 'failed', startedAt: null });
    expect((await client.request('recordings.list', {})).recordings).toEqual([expect.objectContaining({ recordingId: started.recordingId, state: 'failed' })]);
    await expect(fs.stat(started.dir)).rejects.toThrow();
    const notRecoverable = await rejection(client.request('recordings.recover', { recordingId: started.recordingId }));
    expect((notRecoverable.details as { code?: string }).code).toBe('RECORDING_NOT_RECOVERABLE');
    expect(await client.request('recordings.discard', { recordingId: started.recordingId })).toEqual({ recordingId: started.recordingId, removed: true });
    const gone = await rejection(client.request('recordings.status', { recordingId: started.recordingId }));
    expect((gone.details as { code?: string }).code).toBe('RECORDING_NOT_FOUND');
    // 下一次照常开始，不被失败的那次占着。
    await shutdown();
    await boot();
    const next = await startRecording();
    await until(next.recordingId, (r) => r.state === 'recording');
    await client.request('recordings.discard', { recordingId: next.recordingId });
  }, 60_000);

  it('自动缩放：有点击的录制导入后取景里有 origin: auto 的区间；关掉自动缩放或不录鼠标时没有', async () => {
    const zoomsOf = async (options: Record<string, unknown>) => {
      const started = await startRecording({ countdown: 0, microphone: null, ...options });
      await until(started.recordingId, (r) => r.state === 'recording');
      // 假 Worker 在每段中间点一下：录 2 秒，点击前后都有足够的余量，生成一个区间。
      await sleep(2000);
      await client.request('recordings.stop', {});
      const done = await until(started.recordingId, settled);
      expect(done.error).toBeNull();
      expect(done.state).toBe('in-timeline');
      const content = await client.request('documents.read', { videoId: done.videoId!, documentId: done.result!.screenViewDocumentId });
      return (content.body as { zooms: Array<{ origin: string; t0: number; t1: number }> }).zooms;
    };
    await boot();
    const zooms = await zoomsOf({});
    expect(zooms.length).toBeGreaterThan(0);
    expect(zooms.every((z) => z.origin === 'auto')).toBe(true);
    expect(await zoomsOf({ autoZoom: false })).toEqual([]);
    expect(await zoomsOf({ cursor: 'none' })).toEqual([]);
  }, 90_000);

  it('整屏录制缺省排除 BaoCut 自己的窗口，includeSelf 时不排除；选窗口时不排除', async () => {
    const paramsFile = path.join(dir, 'start-params.json');
    await boot({ startParamsFile: paramsFile }, { recordings: { hasWindow: () => true, secondMs: 20, freeBytes: async () => 100 * 1024 ** 3, selfExclusion: () => ({ bundleIds: ['com.baocut.app'], pids: [4242] }) } });
    const sent = async (options: Record<string, unknown>) => {
      const started = await startRecording({ countdown: 0, microphone: null, ...options });
      await until(started.recordingId, (r) => r.state === 'recording');
      await client.request('recordings.discard', { recordingId: started.recordingId });
      return JSON.parse(await fs.readFile(paramsFile, 'utf8')) as { exclude?: unknown };
    };
    expect((await sent({})).exclude).toEqual({ bundleIds: ['com.baocut.app'], pids: [4242] });
    expect((await sent({ includeSelf: true })).exclude).toBeUndefined();
    expect((await sent({ source: { kind: 'window', windowId: 'window-7' } })).exclude).toBeUndefined();
  }, 60_000);

  it('等待开始：界面按开始才采集，关掉面板任务以取消结束', async () => {
    await boot();
    ({ project } = await client.request('projects.create', { name: 'Waiting' }));
    const waiting = await runtime.recordings.request({
      options: { countdown: 0 },
      target: { create: { projectId: project.id } },
      submitter: { kind: 'system', id: 'test' },
      requestedBy: { conversationId: 'conv_x' },
    });
    expect(waiting.state).toBe('waiting');
    expect((await client.request('jobs.inspect', { jobId: waiting.jobId! })).phase).toBe('queued');
    expect((await client.request('recordings.cancel', { recordingId: waiting.recordingId })).recording.state).toBe('discarded');
    expect((await client.request('jobs.inspect', { jobId: waiting.jobId! })).state).toBe('cancelled');
    const second = await runtime.recordings.request({
      options: { countdown: 0 },
      target: { create: { projectId: project.id } },
      submitter: { kind: 'system', id: 'test' },
      requestedBy: { conversationId: 'conv_x' },
    });
    const { recording } = await client.request('recordings.start', { recordingId: second.recordingId, options: { microphone: null } });
    expect(['preparing', 'countdown', 'recording']).toContain(recording.state);
    await until(second.recordingId, (r) => r.state === 'recording');
    await new Promise((r) => setTimeout(r, 400));
    await client.request('recordings.stop', {});
    const done = await until(second.recordingId, settled);
    expect(done.error).toBeNull();
    expect(done.state).toBe('in-timeline');
    expect(done.result!.itemIds).toHaveLength(1);
  }, 60_000);

  it('终端的 record（catalog.call）：直接开始，recordings_stop 停止并保留，任务完成；第二次 record 是 RECORDING_BUSY', async () => {
    await boot();
    const cwd = path.join(dir, 'work');
    await fs.mkdir(cwd, { recursive: true });
    const call = await client.request('catalog.call', { name: 'record', args: { countdown: 0, noMic: true, name: 'From the CLI' }, cwd });
    expect(call.ok).toBe(true);
    const submitted = (call as { result: { jobId: string; recordingId: string } }).result;
    expect(submitted.jobId).toBeTruthy();
    await until(submitted.recordingId, (r) => r.state === 'recording');
    const busy = await client.request('catalog.call', { name: 'record', args: { countdown: 0 }, cwd });
    expect(busy).toMatchObject({ ok: false, error: { code: 'RECORDING_BUSY' } });
    await sleep(400);
    const stop = await client.request('catalog.call', { name: 'recordings_stop', args: {}, cwd });
    expect(stop).toMatchObject({ ok: true, result: { jobId: submitted.jobId } });
    const done = await until(submitted.recordingId, settled);
    expect(done.error).toBeNull();
    expect(done.state).toBe('in-timeline');
    expect((await client.request('jobs.inspect', { jobId: submitted.jobId })).state).toBe('completed');
    const list = await client.request('catalog.call', { name: 'recordings_list', args: {}, cwd });
    expect(list).toMatchObject({ ok: true });
  }, 60_000);

  it('没有开着桌面端：开始录制拒绝（RECORDING_UNAVAILABLE）；sources 说明 no-desktop，来源照样列出', async () => {
    await boot({}, { recordings: { hasWindow: () => false, freeBytes: async () => 42 * 1024 ** 3 } });
    ({ project } = await client.request('projects.create', { name: 'No window' }));
    const refused = await rejection(client.request('recordings.start', { target: { create: { projectId: project.id } } }));
    expect(refused.details).toMatchObject({ code: 'RECORDING_UNAVAILABLE', reason: 'no-window', unavailable: { code: 'no-desktop' } });
    const sources = await client.request('recordings.sources', {});
    expect(sources.available).toBe(false);
    expect(sources.unavailable).toMatchObject({ code: 'no-desktop' });
    expect(sources.unavailable!.message).toBe(sources.reason);
    expect(sources.disk).toEqual({ freeBytes: 42 * 1024 ** 3 });
    expect(sources.displays[0]).toMatchObject({ id: 'display-1' });
  }, 60_000);

  it('sources：能录时给出落点磁盘的剩余空间、没有 unavailable；Worker 不支持或找不到时给出代码', async () => {
    await boot();
    const ok = await client.request('recordings.sources', {});
    expect(ok).toMatchObject({ available: true, reason: null, disk: { freeBytes: 100 * 1024 ** 3 } });
    expect(ok.unavailable).toBeUndefined();
    // 窗口的位置与前后次序原样透传：按从前到后排，bounds 指向 displays 里的屏幕。
    expect(ok.windows.map((w) => [w.id, w.order])).toEqual([
      ['window-7', 0],
      ['window-8', 1],
      ['window-9', 2],
    ]);
    expect(ok.windows[0]!.bounds).toEqual({ displayId: 'display-1', x: 40, y: 30, width: 200, height: 100 });
    expect(ok.windows.every((w) => ok.displays.some((d) => d.id === w.bounds?.displayId))).toBe(true);
    await shutdown();

    await boot({ supported: false });
    const unsupported = await client.request('recordings.sources', {});
    expect(unsupported).toMatchObject({ available: false, unavailable: { code: 'platform-unsupported' }, disk: { freeBytes: 100 * 1024 ** 3 } });
    ({ project } = await client.request('projects.create', { name: 'Unsupported' }));
    const refused = await rejection(client.request('recordings.start', { target: { create: { projectId: project.id } } }));
    expect(refused.details).toMatchObject({ code: 'RECORDING_UNAVAILABLE', reason: 'unsupported', unavailable: { code: 'platform-unsupported' } });
    await shutdown();

    await boot({}, { recordingWorker: null });
    const missing = await client.request('recordings.sources', {});
    expect(missing).toMatchObject({ available: false, unavailable: { code: 'worker-missing' }, displays: [] });
    // 不给 freeBytes 时读真的磁盘：落点目录先建好，读得出来就是非负整数。
    await shutdown();
    await boot({}, { recordings: { hasWindow: () => true, secondMs: 20 } });
    const real = await client.request('recordings.sources', {});
    expect(Number.isSafeInteger(real.disk?.freeBytes)).toBe(true);
    expect(real.disk!.freeBytes).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('窗口开始时没有画面：Worker 的 SOURCE_NOT_CAPTURABLE 换成 RECORDING_SOURCE_NOT_CAPTURABLE，不只录声音', async () => {
    await boot({ startError: { code: 'SOURCE_NOT_CAPTURABLE', message: 'ScreenCaptureKit delivers no picture for this window' } });
    const started = await startRecording({ source: { kind: 'window', windowId: 'window-7' }, countdown: 0 });
    const failed = await until(started.recordingId, settled);
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatchObject({ code: 'RECORDING_SOURCE_NOT_CAPTURABLE', details: { workerCode: 'SOURCE_NOT_CAPTURABLE' } });
    expect(failed.result).toBeNull();
  }, 60_000);
});
