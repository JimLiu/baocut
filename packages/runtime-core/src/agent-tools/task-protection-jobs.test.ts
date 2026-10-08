import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { writeFakeYtDlp, type FakeYtDlp } from '@baocut/jobs';
import { fakeOpenAiHandler, startFakeProviderServer, type FakeProviderServer } from '@baocut/providers/testing';
import { newId, type Id, type JobRecord } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { ToolDriver, tool, until, type ToolSession } from './testing/fake-agent.ts';

/**
 * 任务下的后台写入受任务保护（架构设计 §3.2、§7.3）：假智能体经真实的 MCP 端点在一个保护了整个视频的任务里提交生成
 * （本机回环地址上的假 OpenAI）与从链接导入（假 yt-dlp），结果应用到视频时带着任务合同的保护，真实引擎整笔拒绝：
 * 生成任务的应用记为 `rejected`（`TASK_PROTECTED`），产物留作候选，用户用 `jobs.reconcile apply` 自己决定应用；
 * 流程停在导入一步（`TASK_PROTECTED`），下载的文件留着。用户自己提交的同类任务照常写入。没有 engine-host 或 ffprobe 时跳过。
 */

const engine = resolveEngineHostCommand();
const ffprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !ffprobe) console.warn('跳过任务保护的后台写入测试：没有 engine-host 或 ffprobe');

const OPENAI_KEY = 'sk-test-ONLY-FOR-TESTS-task-protection-0123456789';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'needs-reconciliation']);

describe.skipIf(!engine || !ffprobe)('任务下的后台写入带着任务保护（真实引擎 + 假供应商 + 假 yt-dlp）', () => {
  let dir: string;
  let openai: FakeProviderServer;
  let fake: FakeYtDlp;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let driver: ToolDriver;
  let videoId: Id;
  let conversationId: Id;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-task-protection-'));
    openai = await startFakeProviderServer(fakeOpenAiHandler());
    fake = await writeFakeYtDlp(path.join(dir, 'bin'));
    const emptyPath = path.join(dir, 'empty-path');
    await fs.mkdir(emptyPath);
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: path.join(dir, 'home') }),
      drivers: () => [driver],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      jobIdleMs: 60_000,
      online: { baseUrls: { openai: `${openai.origin}/v1` }, http: { backoffMs: () => 10 } },
      // PATH 只有一个空目录、不读真实环境里的覆盖：用到的 yt-dlp 只有测试指定的假工具。
      externalTools: { env: async () => ({ PATH: emptyPath }), overrides: {}, lookup: async () => ['93.184.216.34'] },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    await client.request('models.configure', { providerId: 'openai', enabled: true, credential: OPENAI_KEY });
    await client.request('externalTools.setPath', { name: 'yt-dlp', path: fake.command });
    await client.request('externalTools.consent', { name: 'yt-dlp', grant: true });
    const { project } = await client.request('projects.create', { name: '任务保护' });
    videoId = (await client.request('videos.create', { projectId: project.id, name: '受保护' })).ref.videoId;
    ({
      conversation: { id: conversationId },
    } = await client.request('conversations.create', { projectId: project.id }));
  });

  afterEach(async () => {
    client.close();
    await runtime.close();
    await openai.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 建一个保护整个视频的智能体任务，等假智能体的回合开始。 */
  async function protectedTask(): Promise<{ taskId: Id; session: ToolSession }> {
    const { taskId } = await client.request('tasks.create', {
      conversationId,
      goal: '生成旁白，下载素材',
      commandId: newId('cmd'),
      accessMode: 'auto',
      contract: { protectedRefs: [{ protectionId: 'prot_video', videoId, target: { kind: 'video' } }] },
    });
    const session = await until(() => driver.sessions[0]);
    await until(() => session.turnId);
    return { taskId, session };
  }

  async function settled(jobId: Id): Promise<JobRecord> {
    return until(async () => {
      const job = runtime.models.jobs.inspect(jobId);
      if (!TERMINAL.has(job.state)) return null;
      await runtime.models.pipelines.idle();
      return runtime.models.jobs.inspect(jobId);
    }, 30_000);
  }

  const video = () => runtime.videos.mirror(videoId)!.video;

  it('生成任务的结果触碰保护：应用记为被拒、产物留作候选；用户 jobs.reconcile apply 照常写入；用户提交的不受限制', async () => {
    const { session } = await protectedTask();
    const before = video();

    const submitted = await tool(session, 'speak', { text: '受保护的旁白', provider: 'openai', video: videoId });
    expect(submitted.isError, JSON.stringify(submitted.body)).toBe(false);
    const jobId = submitted.body.jobId as Id;
    const job = await settled(jobId);
    expect(job.state).toBe('failed');
    expect(job.error).toMatchObject({
      code: 'APPLY_FAILED',
      details: { reason: 'TASK_PROTECTED', protections: [{ protectionId: 'prot_video' }] },
    });
    expect(job.applications).toEqual([
      expect.objectContaining({
        state: 'rejected',
        videoId,
        error: expect.objectContaining({
          code: 'TASK_PROTECTED',
          details: { protections: [expect.objectContaining({ protectionId: 'prot_video' })] },
        }),
      }),
    ]);
    // 什么都没写；产物还在（是候选）。
    expect(video().revision).toBe(before.revision);
    expect(Object.keys(video().assets)).toEqual(Object.keys(before.assets));
    const artifactId = job.result!.outputs![0]!.artifactId;
    expect(await runtime.models.jobs.artifacts.locate(artifactId)).toBeTruthy();
    expect(openai.requests.filter((r) => r.path.endsWith('/audio/speech'))).toHaveLength(1);

    // 智能体看得到原因，被告知不要绕过。
    const inspected = await tool(session, 'jobs_inspect', { jobId });
    expect(inspected.body).toMatchObject({ state: 'failed', applications: [{ state: 'rejected', videoId }] });
    expect(inspected.body.next).toContain('不要用 edits_apply 再导入');

    // 用户自己决定应用：不受任务保护限制，不再调用供应商。
    const applied = await client.request('jobs.reconcile', { jobId, decision: 'apply' });
    expect(applied).toMatchObject({ state: 'completed', error: null });
    expect(applied.applications!.map((a) => a.state)).toEqual(['rejected', 'committed']);
    const assetId = applied.result!.outputs![0]!.assetId!;
    expect(video().assets[assetId]).toBeTruthy();
    expect(openai.requests.filter((r) => r.path.endsWith('/audio/speech'))).toHaveLength(1);

    // 用户在界面里提交到同一个视频的生成：不在任务里，照常写入。
    const { jobId: userJob } = await client.request('models.synthesizeSpeech', { text: '用户的旁白', provider: 'openai', videoId });
    const done = await settled(userJob);
    expect(done.state, JSON.stringify(done.error)).toBe('completed');
    expect(done.applications!.map((a) => a.state)).toEqual(['committed']);
  });

  it('智能体启动的从链接导入：导入一步触碰保护，流程停在那一步，下载的文件留着；用户启动的照常导入', async () => {
    const { session } = await protectedTask();
    const before = video();

    const started = await tool(session, 'download', { url: 'https://video.example.com/watch?v=guarded', video: videoId });
    expect(started.isError, JSON.stringify(started.body)).toBe(false);
    const job = await settled(started.body.jobId as Id);
    expect(job.state).toBe('failed');
    expect(job.error).toMatchObject({ code: 'TASK_PROTECTED', details: { step: 'import' } });
    const steps = job.pipeline!.steps;
    expect(steps.find((s) => s.name === 'import')!.status).toBe('failed');
    const published = steps.find((s) => s.name === 'publish')!;
    expect(published.status).toBe('completed');
    const media = (published.output as { media: string }).media;
    expect((await fs.stat(media)).isFile()).toBe(true);
    expect(video().revision).toBe(before.revision);
    expect(Object.keys(video().assets)).toEqual(Object.keys(before.assets));
    const inspected = await tool(session, 'jobs_inspect', { jobId: job.jobId });
    expect(inspected.body.next).toContain('不要改动');

    // 用户在界面里启动的同一条流程不在任务里：照常导入。
    const { jobId: userJob } = await client.request('pipelines.start', {
      pipeline: 'link-import',
      params: { url: 'https://video.example.com/watch?v=user', videoId },
    });
    const done = await settled(userJob);
    expect(done.state, JSON.stringify(done.error)).toBe('completed');
    expect(Object.keys(video().assets)).toHaveLength(Object.keys(before.assets).length + 1);
  });
});
