import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { silentLogger } from '@baocut/harness';
import { fakeSpeechAnswer, resolveSpeechWorkerCommand, speechRequestKind, writeFakeYtDlp } from '@baocut/jobs';
import { chatCompletionReply, startFakeProviderServer, type FakeHandler, type FakeProviderServer } from '@baocut/providers/testing';
import { newId, type AudioItem, type Id, type JobRecord, type LinkImportSummary, type Project, type VideoSnapshot } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { ToolDriver, tool, until } from '../agent-tools/testing/fake-agent.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { EngineHost, resolveEngineHostCommand } from './engine-host.ts';

/**
 * 视频工具的目标（架构设计 §7.9）经网关端到端，真实引擎：
 *
 * - 翻译按 Space 条目（`target.entryId`）：没打开的视频以 Runtime 的租约打开、流程结束后放下（按宽限期关闭）；别的连接已经
 *   打开着时接上那一份；被别的进程锁着时 `pipelines.start` 以 `VIDEO_LOCKED` 拒绝、不建任务；回收站里的、不是视频的条目拒绝；
 *   失败之后放下视频，重试时重新打开。
 * - 从链接导入新建视频（假 yt-dlp、本地生成的小媒体）：项目里多一个视频，素材放在主轨从 0 开始，Space 里记下来源是这次运行。
 * - 智能体的 `download` 新建视频：风险仍是 command，项目默认是会话的，别的项目拒绝；不属于项目的会话新建在会话的
 *   工作目录里（与 `videos_create` 同一处，`videos_list` 看得到）；只下载之后按媒体的 `artifactId` 经 `edits_apply` 导入；
 *   不给目标时也可以转写（文件转写，结果在下载目录）。
 *
 * 只连本机回环地址上的假供应商；密钥是测试里编的字符串。没有 engine-host 时跳过；没有 speech-worker 时跳过要翻译完的几项；
 * 没有 ffprobe 时跳过从链接导入的部分。
 */

const engine = resolveEngineHostCommand();
const speechWorker = resolveSpeechWorkerCommand(engine);
const hasFfprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine) console.warn('跳过视频目标的端到端测试：没有构建 engine-host（npm run build:engine）');

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-targets-0123456789';
const TITLE = `-rf "Fake clip": one/two  it's <ok>`;

const SPEECH = {
  schema: 'baocut.speech/1',
  clock: 'source-asset',
  timescale: 1000,
  engine: null,
  createdAt: null,
  speakers: [],
  words: [
    { id: 'w1', text: '大家好', start: 0, end: 500 },
    { id: 'w2', text: '。', start: 500, end: 600 },
  ],
  sentences: null,
  chapters: [],
};

/** 假 OpenAI：按 Speech Worker 的请求答（`fakeSpeechAnswer`）；`broken` 次数内翻译页回空文档（不合约定）。 */
function translator(state: { broken: number; calls: number }): FakeHandler {
  return (request) => {
    if (request.method === 'GET' && request.path.endsWith('/models')) return { status: 200, json: { object: 'list', data: [] } };
    if (request.method !== 'POST' || !request.path.endsWith('/chat/completions'))
      return { status: 404, json: { error: { message: 'not found' } } };
    state.calls++;
    const messages = (request.json as { messages: Array<{ role: string; content: string }> }).messages;
    const user = messages.find((m) => m.role === 'user')!.content;
    if (state.broken > 0 && speechRequestKind(user) === 'translate') {
      state.broken--;
      return chatCompletionReply(request, '<article></article>');
    }
    return chatCompletionReply(request, fakeSpeechAnswer(user));
  };
}

describe.skipIf(!engine)('视频工具的目标（真实引擎）', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;
  let openai: FakeProviderServer;
  let driver: ToolDriver;
  const state = { broken: 0, calls: 0 };

  beforeEach(async () => {
    state.broken = 0;
    state.calls = 0;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-pipeline-targets-'));
    openai = await startFakeProviderServer(translator(state));
    driver = new ToolDriver();
    const emptyPath = path.join(dir, 'empty-path');
    await fs.mkdir(emptyPath);
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      jobIdleMs: 60_000,
      initiator: { discoverer: null },
      nodes: { host: '127.0.0.1', advertiser: null },
      online: { baseUrls: { openai: `${openai.origin}/v1` }, http: { backoffMs: () => 10 } },
      // 搜索路径只有一个空目录、不读真实环境里的覆盖、域名解析是假的：不会用到系统里的 yt-dlp，也不联网。
      externalTools: { env: async () => ({ PATH: emptyPath }), overrides: {}, lookup: async () => ['93.184.216.34'] },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '视频目标' }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await openai.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function configure() {
    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await client.request('models.setDefault', { capability: 'generateText', providerId: 'openai' });
  }

  /** 有一份转写的视频，关掉（等 Runtime 真的关了），返回它和它的 Space 条目。 */
  async function closedVideo(name = '访谈') {
    const created = await client.request('videos.create', { projectId: project.id, name });
    const videoId = created.ref.videoId;
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: created.snapshot.video.revision,
      operations: [{ type: 'putDocument', ref: 'speech', kind: 'speech', name: '转写', language: 'zh', body: SPEECH }],
    });
    await client.request('videos.close', { videoId });
    await until(() => runtime.videos.ref(videoId) === null);
    await settle();
    const entry = (await client.request('space.list', { videoId, kind: 'video' })).entries[0]!;
    return { videoId, relPath: created.ref.relPath, entryId: entry.id };
  }

  async function settle() {
    await client.request('space.rescan', {});
    await runtime.space.idle();
  }

  async function settled(jobId: string): Promise<JobRecord> {
    await runtime.models.jobs.settled(jobId);
    await runtime.models.pipelines.idle();
    return runtime.models.jobs.inspect(jobId);
  }

  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: { code?: string; details?: { code?: string } }) => error.details?.code ?? error.code ?? null,
    );
  const translate = (target: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    client.request('pipelines.start', { pipeline: 'translate', params: { target, targetLanguage: 'en', ...extra } });
  const documentsOf = async (videoId: Id, relPath: string) => {
    const opened = await client.request('videos.open', { projectId: project.id, path: relPath });
    expect(opened.ref.videoId).toBe(videoId);
    const kinds = Object.values(opened.snapshot.video.documents).map((d) => d.kind);
    await client.request('videos.close', { videoId });
    return kinds;
  };

  /** 项目目录里的视频目录。 */
  const videoDirs = async () => {
    const out: string[] = [];
    for (const name of await fs.readdir(project.path)) {
      if (await fs.stat(path.join(project.path, name, 'video.db')).catch(() => null)) out.push(name);
    }
    return out;
  };

  it.skipIf(!speechWorker)('entryId 指向没打开的视频：以租约打开、翻译写进去，流程完成后放下并关闭', async () => {
    await configure();
    const { videoId, relPath, entryId } = await closedVideo();
    const { jobId } = await translate({ entryId });
    const job = await settled(jobId);
    expect(job).toMatchObject({ state: 'completed', videoId });
    expect(job.pipeline!.steps[0]).toMatchObject({
      name: 'target',
      status: 'completed',
      output: { entryId, videoId, place: { scope: { projectId: project.id } } },
    });
    // 租约放下之后没有别的打开者：按宽限期关闭。
    await until(() => runtime.videos.ref(videoId) === null);
    expect(await documentsOf(videoId, relPath)).toContain('translation');
  });

  it.skipIf(!speechWorker)('entryId 指向别的连接已经打开着的视频：接上那一份，完成后它仍由那个连接打开着', async () => {
    await configure();
    const { videoId, relPath, entryId } = await closedVideo();
    await client.request('videos.open', { projectId: project.id, path: relPath });
    const before = runtime.videos.usage(videoId)!;
    expect(before.leases).toBe(0);
    const { jobId } = await translate({ entryId });
    expect(await settled(jobId)).toMatchObject({ state: 'completed', videoId });
    await until(() => runtime.videos.usage(videoId)?.leases === 0);
    expect(runtime.videos.usage(videoId)!.openers).toEqual(before.openers);
    const history = await client.request('videos.history', { videoId });
    expect(history.entries[0]).toMatchObject({ actor: { kind: 'system', id: 'system:pipeline' } });
    await client.request('videos.close', { videoId });
  });

  it('被别的进程锁着：pipelines.start 以 VIDEO_LOCKED 拒绝，不建任务、不动视频目录', async () => {
    await configure();
    const { videoId, relPath, entryId } = await closedVideo();
    const videoDir = path.join(project.path, relPath);
    // SQLite 的 -wal/-shm 随打开与关闭出现、消失：只比视频目录自己的内容。
    const listing = async () => (await fs.readdir(videoDir)).filter((n) => !/-(wal|shm)$/.test(n)).sort();
    const filesBefore = await listing();
    const other = await EngineHost.start({ command: engine!, log: silentLogger, onEvent: () => {}, onExit: () => {} });
    try {
      await other.request('videos.open', { path: videoDir });
      expect(await refusal(translate({ entryId }))).toBe('VIDEO_LOCKED');
      expect(await client.request('jobs.list', { children: true })).toEqual({ jobs: [] });
      expect(runtime.videos.ref(videoId)).toBeNull();
      expect(state.calls).toBe(0);
    } finally {
      await other.close();
    }
    expect(await listing()).toEqual(filesBefore);
    expect(await videoDirs()).toEqual([relPath]);
  });

  it('回收站里的、不是视频的条目拒绝；videoId 与 target 冲突、翻译新建视频都拒绝', async () => {
    await configure();
    const { videoId, entryId } = await closedVideo();
    await fs.writeFile(path.join(project.path, 'notes.srt'), '1\n00:00:00,000 --> 00:00:01,000\n你好\n');
    await settle();
    const file = (await client.request('space.list', {})).entries.find((e) => e.fileName === 'notes.srt')!;
    expect(file.kind).not.toBe('video');
    expect(await refusal(translate({ entryId: file.id }))).toBe('SPACE_ENTRY_NOT_VIDEO');
    expect(await refusal(translate({ videoId }, { videoId: 'video_other' }))).toBe('invalid-request');
    expect(await refusal(translate({ create: { projectId: project.id } }))).toBe('PIPELINE_TARGET_UNSUPPORTED');
    expect(await refusal(translate({ entryId: 'entry_missing' }))).toBe('not-found');

    const deleted = await client.request('videos.delete', { entryId });
    expect(deleted.status).toBe('trashed');
    // 删除之前的条目 id 与回收站里的条目 id 都回答在回收站里。
    expect(await refusal(translate({ entryId }))).toBe('SPACE_ENTRY_TRASHED');
    expect(await refusal(translate({ entryId: deleted.entryId }))).toBe('SPACE_ENTRY_TRASHED');
    expect(await client.request('jobs.list', { children: true })).toEqual({ jobs: [] });
  });

  it.skipIf(!speechWorker)('失败之后放下视频；重试按记下的位置重新打开，不重新解析目标', async () => {
    await configure();
    const { videoId, entryId } = await closedVideo();
    state.broken = 100;
    const { jobId } = await translate({ entryId });
    const failed = await settled(jobId);
    expect(failed).toMatchObject({ state: 'failed', pipeline: { stoppedAt: 'translate' } });
    await until(() => runtime.videos.ref(videoId) === null);

    state.broken = 0;
    expect(await client.request('pipelines.retry', { jobId })).toEqual({ jobId });
    const done = await settled(jobId);
    expect(done).toMatchObject({ state: 'completed', attempt: 2, videoId });
    expect(done.pipeline!.steps[0]).toEqual(failed.pipeline!.steps[0]);
    await until(() => runtime.videos.ref(videoId) === null);
  });

  describe.skipIf(!hasFfprobe)('从链接新建视频（假 yt-dlp）', () => {
    beforeEach(async () => {
      const fake = await writeFakeYtDlp(path.join(dir, 'yt-dlp'));
      await client.request('externalTools.setPath', { name: 'yt-dlp', path: fake.command });
      await client.request('externalTools.consent', { name: 'yt-dlp', grant: true });
    });

    it('新建视频（名字取页面标题），素材放在主轨从 0 开始、覆盖整段；Space 记下来源是这次运行', async () => {
      const { jobId } = await client.request('pipelines.start', {
        pipeline: 'link-import',
        params: { url: 'https://video.example.com/watch?v=abc', target: { create: { projectId: project.id } } },
      });
      const job = await settled(jobId);
      expect(job).toMatchObject({ state: 'completed', pipeline: { stoppedAt: null } });
      const summary = job.pipeline!.summary as unknown as LinkImportSummary;
      expect(summary).toMatchObject({ createdVideo: true, videoId: expect.any(String), assetId: expect.any(String) });
      // 没有设置下载目录：落到主机的下载目录（测试里由 `BAOCUT_DOWNLOADS_DIR` 指到临时目录），不在项目目录里。
      expect(path.dirname(summary.files.media)).toBe(await fs.realpath(process.env.BAOCUT_DOWNLOADS_DIR!));
      const videoId = summary.videoId!;
      expect(job.videoId).toBe(videoId);
      // 流程放下租约之后视频关闭；项目里只有这一个视频。
      await until(() => runtime.videos.ref(videoId) === null);
      const dirs = await videoDirs();
      expect(dirs).toHaveLength(1);

      const opened = await client.request('videos.open', { projectId: project.id, path: dirs[0]! });
      expect(opened.ref.videoId).toBe(videoId);
      const video: VideoSnapshot = opened.snapshot.video;
      expect(video.name).toBe(TITLE);
      const root = video.sequences[video.rootSequenceId]!;
      expect(root.items).toHaveLength(1);
      const item = root.items[0] as AudioItem;
      expect(item).toMatchObject({ type: 'audio', fromFrame: 0, assetRef: { id: summary.assetId } });
      // 覆盖整段媒体。
      const asset = video.assets[summary.assetId!]!;
      expect(item.playDuration).toEqual(asset.revisions[asset.currentRevision]!.duration);
      const track = root.tracks.find((t) => t.id === item.trackId)!;
      expect(track.kind).toBe('audio');
      expect(root.tracks.filter((t) => t.kind === 'audio').sort((a, b) => a.order - b.order)[0]!.id).toBe(track.id);
      await client.request('videos.close', { videoId });

      await settle();
      const entry = (await client.request('space.list', { videoId, kind: 'video' })).entries[0]!;
      expect(entry.origin).toMatchObject({ source: 'imported', projectId: project.id, videoId, jobId, capability: 'link-import' });
    });

    it('智能体新建视频：风险仍是 command、项目默认是会话的；别的项目拒绝，不属于项目的会话先建项目并绑定', async () => {
      const {
        conversation: { id: conversationId },
      } = await client.request('conversations.create', { projectId: project.id });
      await client.request('conversations.send', { conversationId, text: '从链接新建视频', commandId: newId('cmd'), accessMode: 'auto' });
      const session = await until(() => driver.sessions[0]);
      await until(() => session.turnId);

      const { project: other } = await client.request('projects.create', { name: '别的项目' });
      const elsewhere = await tool(session, 'download', {
        url: 'https://video.example.com/watch?v=abc',
        newVideo: true,
        project: other.id,
      });
      expect(elsewhere).toMatchObject({ isError: true, body: { error: { code: 'PROJECT_NOT_FOUND' } } });
      const both = await tool(session, 'download', {
        url: 'https://video.example.com/watch?v=abc',
        newVideo: true,
        video: 'x',
      });
      expect(both.body.error.code).toBe('INVALID_ARGUMENTS');
      expect(runtime.harness.approvals.pending()).toEqual([]);

      const started = await tool(session, 'download', {
        url: 'https://video.example.com/watch?v=abc',
        newVideo: true,
        name: '智能体的视频',
      });
      expect(started).toMatchObject({
        isError: false,
        body: { jobId: expect.stringMatching(/^job_/), approval: { risk: 'command', decidedBy: 'auto' } },
      });
      const job = await settled(started.body.jobId);
      expect(job).toMatchObject({ state: 'completed', submitter: { kind: 'agent' } });
      const summary = job.pipeline!.summary as unknown as LinkImportSummary;
      expect(summary.createdVideo).toBe(true);
      // 智能体新建视频：文件与界面、CLI 一样进下载目录（测试里是 `BAOCUT_DOWNLOADS_DIR`），不进项目；视频链到那里。
      expect(path.dirname(summary.files.media)).toBe(await fs.realpath(process.env.BAOCUT_DOWNLOADS_DIR!));
      await until(() => runtime.videos.ref(summary.videoId!) === null);
      // jobs_inspect 报出的 videoId 可以直接给 videos_inspect：视频关掉了也按来源目录找到。
      const byId = await tool(session, 'videos_inspect', { video: summary.videoId! });
      expect(byId.isError).toBe(false);
      expect(byId.body).toMatchObject({ videoId: summary.videoId, name: '智能体的视频' });
      const dirs = await videoDirs();
      expect(dirs).toHaveLength(1);
      const opened = await client.request('videos.open', { projectId: project.id, path: dirs[0]! });
      expect(opened.snapshot.video.name).toBe('智能体的视频');
      await client.request('videos.close', { videoId: summary.videoId! });
      await settle();
      const entry = (await client.request('space.list', { videoId: summary.videoId!, kind: 'video' })).entries[0]!;
      expect(entry.origin).toMatchObject({ jobId: job.jobId, conversationId });

      // 不属于项目的会话：给了别的项目照样 PROJECT_NOT_FOUND（看不到任何项目），不弹确认。
      const {
        conversation: { id: loose, cwd: looseCwd },
      } = await client.request('conversations.create', { projectId: null });
      await client.request('conversations.send', { conversationId: loose, text: '新建', commandId: newId('cmd'), accessMode: 'ask' });
      const looseSession = await until(() => driver.sessions[1]);
      await until(() => looseSession.turnId);
      const hidden = await tool(looseSession, 'download', {
        url: 'https://video.example.com/watch?v=abc',
        newVideo: true,
        project: project.id,
      });
      expect(hidden).toMatchObject({ isError: true, body: { error: { code: 'PROJECT_NOT_FOUND' } } });
      expect(runtime.harness.approvals.pending()).toEqual([]);

      // 不给项目：与 videos_create 一样，确认之后先建项目并把会话绑定到它（§3.10），流程的新建目标直接是那个项目，文件仍进下载目录。
      const creating = tool(looseSession, 'download', {
        url: 'https://video.example.com/watch?v=abc',
        newVideo: true,
        name: '会话里的视频',
      });
      const approval = await until(() => runtime.harness.approvals.pending()[0]);
      expect(approval).toMatchObject({ action: { name: 'download' }, risk: 'command' });
      expect(approval.action.summary).toContain('新建视频「会话里的视频」并放上时间线');
      // 确认之前不建项目。
      expect(runtime.harness.conversationOf(loose)?.projectId).toBeNull();
      await client.request('approvals.respond', { approvalId: approval.approvalId, decision: 'allow' });
      const looseStarted = await creating;
      expect(looseStarted).toMatchObject({ isError: false, body: { jobId: expect.stringMatching(/^job_/) } });
      expect(looseStarted.body).not.toHaveProperty('notice');
      const boundId = runtime.harness.conversationOf(loose)!.projectId!;
      const boundProject = runtime.harness.listProjects().find((p) => p.id === boundId)!;
      expect(boundProject).toBeTruthy();
      expect(runtime.harness.conversationOf(loose)!.cwd).toBe(boundProject.path);
      const looseJob = await settled(looseStarted.body.jobId);
      expect(looseJob).toMatchObject({
        state: 'completed',
        pipeline: { params: { create: { projectId: boundId, name: '会话里的视频' } } },
      });
      const looseSummary = looseJob.pipeline!.summary as unknown as LinkImportSummary;
      expect(looseSummary).toMatchObject({ createdVideo: true, videoId: expect.any(String), assetId: expect.any(String) });
      expect(path.dirname(looseSummary.files.media)).toBe(await fs.realpath(process.env.BAOCUT_DOWNLOADS_DIR!));
      await until(() => runtime.videos.ref(looseSummary.videoId!) === null);
      // 原来的项目里没有多出视频；视频在新项目里，会话自己的 videos_list 看得到。
      expect(await videoDirs()).toHaveLength(1);
      expect(looseCwd).not.toBe(boundProject.path);
      const listed = await tool(looseSession, 'videos_list', {});
      expect(listed.isError).toBe(false);
      const videos = listed.body.videos as Array<{ path: string }>;
      expect(videos).toHaveLength(1);
      expect(await fs.stat(path.join(boundProject.path, videos[0]!.path, 'video.db'))).toBeTruthy();
      const inspected = await tool(looseSession, 'videos_inspect', { video: videos[0]!.path });
      expect(inspected).toMatchObject({ isError: false, body: { videoId: looseSummary.videoId, name: '会话里的视频' } });
      await settle();
      const looseEntry = (await client.request('space.list', { videoId: looseSummary.videoId!, kind: 'video' })).entries[0]!;
      expect(looseEntry.source).toMatchObject({ projectId: boundId, conversationId: null });
      expect(looseEntry.origin).toMatchObject({ jobId: looseJob.jobId, conversationId: loose });
    });

    it('按不属于项目的会话新建（`create: { conversationId }`）：先建项目并绑定，视频建在项目里；同一命令重复提交不建第二个项目', async () => {
      const {
        conversation: { id: loose, cwd: scratch },
      } = await client.request('conversations.create', { projectId: null, title: '链接里的片' });
      const before = runtime.harness.listProjects().length;
      const commandId = newId('cmd');
      const request = {
        pipeline: 'link-import',
        params: { url: 'https://video.example.com/watch?v=abc', target: { create: { conversationId: loose } } },
        commandId,
      };
      const { jobId } = await client.request('pipelines.start', request);
      const job = await settled(jobId);
      expect(job).toMatchObject({ state: 'completed' });
      const summary = job.pipeline!.summary as unknown as LinkImportSummary;
      const bound = runtime.harness.conversationOf(loose)!;
      const boundProject = runtime.harness.listProjects().find((p) => p.id === bound.projectId)!;
      expect(boundProject).toMatchObject({ name: '链接里的片' });
      expect(bound.cwd).toBe(boundProject.path);
      expect(runtime.harness.listProjects()).toHaveLength(before + 1);
      await until(() => runtime.videos.ref(summary.videoId!) === null);
      const dirs = (await fs.readdir(boundProject.path)).filter((name) => !name.startsWith('.'));
      expect(dirs).toHaveLength(1);
      await fs.access(path.join(boundProject.path, dirs[0]!, 'video.db'));
      // 会话的旧工作目录没有回合在用：删掉了。
      expect(await fs.lstat(scratch).then(() => true, () => false)).toBe(false);
      // 同一命令再提交：同一个任务，不另建项目与视频。
      expect((await client.request('pipelines.start', request)).jobId).toBe(jobId);
      expect(runtime.harness.listProjects()).toHaveLength(before + 1);
      await settle();
      const entry = (await client.request('space.list', { videoId: summary.videoId!, kind: 'video' })).entries[0]!;
      expect(entry.source).toMatchObject({ projectId: boundProject.id, conversationId: null });
    });

    it('不属于项目的会话只下载之后，按媒体的 artifactId 导入视频（bytes 收进视频，来源是这次下载）', async () => {
      const {
        conversation: { id: loose },
      } = await client.request('conversations.create', { projectId: null });
      await client.request('conversations.send', {
        conversationId: loose,
        text: '下载再导入',
        commandId: newId('cmd'),
        accessMode: 'auto',
      });
      const session = await until(() => driver.sessions[0]);
      await until(() => session.turnId);
      const started = await tool(session, 'download', { url: 'https://video.example.com/watch?v=abc' });
      expect(started, JSON.stringify(started.body)).toMatchObject({ isError: false, body: { jobId: expect.stringMatching(/^job_/) } });
      expect(started.body.next).toContain('importAsset');
      const job = await settled(started.body.jobId);
      expect(job).toMatchObject({ state: 'completed', pipeline: { params: { conversationId: loose } } });
      const media = job.result!.outputs![0]!;
      const summary = job.pipeline!.summary as unknown as LinkImportSummary;
      expect(media.path).toBe(summary.files.media);

      const created = await tool(session, 'videos_create', { name: '访谈' });
      expect(created.isError, JSON.stringify(created.body)).toBe(false);
      const applied = await tool(session, 'edits_apply', {
        video: created.body.videoId,
        expectedRevision: created.body.revision,
        label: '导入下载的访谈',
        operations: [
          { type: 'importAsset', artifactId: media.artifactId, name: '访谈原片', ref: 'source' },
          { type: 'addItem', asset: { ref: 'source' }, at: 0 },
        ],
      });
      expect(applied, JSON.stringify(applied.body)).toMatchObject({ isError: false, body: { status: 'committed' } });
      const video = runtime.videos.mirror(created.body.videoId)!.video;
      const assets = Object.values(video.assets);
      expect(assets).toHaveLength(1);
      expect(assets[0]!.name).toBe('访谈原片');
      const revision = assets[0]!.revisions[assets[0]!.currentRevision]!;
      expect(revision.provenance).toMatchObject({
        origin: 'link-import',
        source: { url: 'https://video.example.com/watch?v=abc', jobId: job.jobId },
      });
      // 下载目录里的文件改过之后不再认这个产物。
      await fs.appendFile(summary.files.media, 'x');
      const stale = await tool(session, 'edits_apply', {
        video: created.body.videoId,
        expectedRevision: applied.body.revision.after,
        label: '再导入一次',
        operations: [{ type: 'importAsset', artifactId: media.artifactId }],
      });
      expect(stale).toMatchObject({ isError: true, body: { error: { code: 'ARTIFACT_NOT_FOUND' } } });
    });

    it('智能体在不属于项目的会话里不给目标也可以转写：流程按会话来源提交，transcribe 为 true', async () => {
      await configure();
      await client.request('models.setDefault', { capability: 'transcribe', providerId: 'openai' });
      const {
        conversation: { id: loose },
      } = await client.request('conversations.create', { projectId: null });
      await client.request('conversations.send', { conversationId: loose, text: '转录翻译', commandId: newId('cmd'), accessMode: 'auto' });
      const session = await until(() => driver.sessions[0]);
      await until(() => session.turnId);
      const started = await tool(session, 'download', { url: 'https://video.example.com/watch?v=abc', transcribe: true });
      expect(started, JSON.stringify(started.body)).toMatchObject({ isError: false, body: { jobId: expect.stringMatching(/^job_/) } });
      expect(started.body).not.toHaveProperty('notice');
      expect(started.body.next).toContain('application/x-subrip');
      // 假供应商不答转写请求：流程停在转写一步也无妨，这里只看提交的参数。
      const job = await settled(started.body.jobId);
      expect(job.pipeline!.params).toMatchObject({ conversationId: loose, transcribe: true });
      expect(job.pipeline!.params).not.toHaveProperty('videoId');
      expect(job.pipeline!.params).not.toHaveProperty('create');
    });
  });
});
