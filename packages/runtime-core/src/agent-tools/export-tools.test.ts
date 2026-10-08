import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { JobLedger } from '@baocut/jobs';
import { newId, type AgentMode, type Autonomy, type Id, type Project } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { ToolDriver, tool, until, type Loose, type ToolSession } from './testing/fake-agent.ts';

/**
 * `export` 端到端：假智能体经真实的 MCP 端点导出字幕；权限（规划模式只读）、目标目录的约束（不出工作目录、
 * 不进视频目录）与预检错误的形态（错误码 + next）。需要 engine-host 与 ffmpeg，缺了就跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !ffmpeg) console.warn('跳过导出工具测试：没有 engine-host 或 ffmpeg');

describe.skipIf(!engine || !ffmpeg)('导出工具（真实引擎）', () => {
  let fixtures: string;
  let audio: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let driver: ToolDriver;
  let project: Project;
  let conversationId: Id;
  let videoId: Id;
  let videoPath: string;
  let assetId: Id;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-export-tools-fixtures-'));
    audio = path.join(fixtures, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ac', '1', audio]);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-export-tools-'));
    driver = new ToolDriver();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [driver],
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
    ({ project } = await client.request('projects.create', { name: '导出工具' }));
    ({
      conversation: { id: conversationId },
    } = await client.request('conversations.create', { projectId: project.id }));
    const opened = await client.request('videos.create', { projectId: project.id, name: '样片' });
    videoId = opened.ref.videoId;
    videoPath = opened.ref.relPath;
    const words = [
      { id: 'w1', start: 0, end: 500, text: 'Hello' },
      { id: 'w2', start: 500, end: 1000, text: 'there.' },
    ];
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: opened.snapshot.video.revision,
      operations: [
        { type: 'importAsset', path: audio, ref: 'a' },
        { type: 'addItem', sequenceId: opened.snapshot.video.rootSequenceId, asset: { ref: 'a' }, alignment: 'nearest-frame' },
        {
          type: 'putDocument',
          kind: 'speech',
          language: 'en',
          sourceAsset: { ref: 'a' },
          body: { schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1000, speakers: [], words, sentences: null, chapters: [] },
        },
      ],
    });
    assetId = Object.keys(runtime.videos.mirror(videoId)!.video.assets)[0]!;
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function send(autonomy?: Autonomy | AgentMode): Promise<ToolSession> {
    await client.request('conversations.send', {
      conversationId,
      text: '导出',
      commandId: newId('cmd'),
      ...(autonomy ? { autonomy } : {}),
    });
    // 换了自主级别的回合可能是新的原生会话：取正在回合里的那个。
    const session = await until(() => driver.sessions.find((s) => s.turnId));
    await until(() => runtime.harness.agentRun(conversationId).taskId);
    return session;
  }

  async function settle(session: ToolSession, jobId: string): Promise<Loose> {
    return until(async () => {
      const { isError, body } = await tool(session, 'jobs_inspect', { jobId });
      expect(isError).toBe(false);
      return ['completed', 'failed', 'cancelled', 'interrupted'].includes(body.state) ? body : null;
    }, 15_000);
  }

  it('规划模式下拒绝；可以修改时导出到工作目录的 exports/，jobs_inspect 给出路径与校验', async () => {
    const plan = await send('plan');
    const refused = await tool(plan, 'export', { video: videoPath, kind: 'subtitles', format: 'srt' });
    expect(refused.body.error.code).toBe('PLAN_ONLY');
    plan.finish();
    await until(() => runtime.harness.agentRun(conversationId).taskId === null);

    // 发送时给出的模式切换了会话的模式：切回 auto 才能修改。
    const session = await send('auto');
    const submitted = await tool(session, 'export', { video: videoPath, kind: 'subtitles', format: 'srt' });
    expect(submitted.isError).toBe(false);
    expect(submitted.body).toMatchObject({
      kind: 'export',
      videoId,
      files: ['样片.en.srt'],
      approval: { mode: 'auto', risk: 'edit', decidedBy: 'auto' },
    });
    const job = await settle(session, submitted.body.jobId);
    expect(job.state).toBe('completed');
    expect(job.submittedBy).toBe('agent');
    expect(job.outputs).toEqual([
      expect.objectContaining({ path: path.join(project.path, 'exports', '样片.en.srt'), format: 'srt', validation: expect.any(Object) }),
    ]);
    expect(job.next).toContain('导出完成');
    expect(await fs.readFile(job.outputs[0].path, 'utf8')).toContain('Hello there.');

    // 工作目录里已有的目录与文件名。
    await fs.mkdir(path.join(project.path, 'out'));
    const named = await tool(session, 'export', {
      video: videoId,
      kind: 'transcript',
      format: 'txt',
      dir: 'out',
      fileName: '稿子',
    });
    expect(named.isError).toBe(false);
    const namedJob = await settle(session, named.body.jobId);
    expect(namedJob.outputs[0].path).toBe(path.join(await fs.realpath(project.path), 'out', '稿子.txt'));

    // 允许覆盖已有文件是 high：默认的 auto 模式下也要问，拒绝时不提交。
    const overwriting = tool(session, 'export', {
      video: videoId,
      kind: 'transcript',
      format: 'txt',
      dir: 'out',
      fileName: '稿子',
      overwrite: true,
    });
    const pending = await until(() => runtime.harness.approvals.pending()[0]);
    expect(pending).toMatchObject({ action: { name: 'export' }, risk: 'high', basis: { kind: 'mode', mode: 'auto' } });
    await client.request('approvals.respond', { approvalId: pending.approvalId, decision: 'deny' });
    expect((await overwriting).body.error).toMatchObject({ code: 'APPROVAL_DENIED', mode: 'auto', risk: 'high' });

    // 成片同一条规则：覆盖时 high，确认里的摘要写明是成片。
    // 声音来源与输出宽高不改变风险：只要原声、横屏出 9:16（加黑边）的成片，覆盖时同样是 high，摘要写明尺寸与来源。
    const overwritingVideo = tool(session, 'export', {
      video: videoId,
      kind: 'video',
      format: 'mp4',
      width: 1080,
      height: 1920,
      source: 'original',
      overwrite: true,
    });
    const pendingVideo = await until(() => runtime.harness.approvals.pending()[0]);
    expect(pendingVideo).toMatchObject({ action: { name: 'export' }, risk: 'high' });
    expect(JSON.stringify(pendingVideo)).toContain('导出成片（mp4，1080×1920，只要原声）');
    await client.request('approvals.respond', { approvalId: pendingVideo.approvalId, decision: 'deny' });
    expect((await overwritingVideo).body.error).toMatchObject({ code: 'APPROVAL_DENIED', risk: 'high' });
  });

  it('内部检查用途经工具冻结进导出记录，文件与后台任务照常完成', async () => {
    const session = await send('auto');
    const submitted = await tool(session, 'export', { video: videoPath, kind: 'subtitles', format: 'srt', purpose: 'preview' });
    expect(submitted.isError).toBe(false);
    expect(submitted.body.purpose).toBe('preview');
    const job = await settle(session, submitted.body.jobId);
    expect(job.state).toBe('completed');
    const record = await client.request('exports.get', { jobId: submitted.body.jobId });
    expect(record.export?.settings.purpose).toBe('preview');
    expect(await fs.readFile(job.outputs[0].path, 'utf8')).toContain('Hello there.');
    const stored = { jobs: (await new JobLedger(path.join(dir, 'store', 'jobs.jsonl')).load()) as Loose[] };
    expect(stored.jobs.find((j: Loose) => j.record.jobId === record.jobId).record.export.settings.purpose).toBe('preview');
  });

  it('智能体自己翻译：documents_read 的转写带 translationBasis，照它写的译文能写入视频', async () => {
    const session = await send('auto');
    const speechId = Object.values(runtime.videos.mirror(videoId)!.video.documents).find((d) => d.kind === 'speech')!.id;
    const read = await tool(session, 'documents_read', { video: videoPath, documentId: speechId });
    expect(read.isError).toBe(false);
    const basis = read.body.translationBasis;
    expect(basis.sourceBasis).toMatchObject({ speechRef: { id: speechId, revision: read.body.revision }, scopeLineage: [] });
    expect(basis.sentences).toEqual([{ id: 's-w1', fingerprint: expect.any(String), text: 'Hello there.', wordIds: ['w1', 'w2'] }]);

    const inspected = await tool(session, 'videos_inspect', { video: videoPath });
    const put = await tool(session, 'edits_apply', {
      video: videoPath,
      expectedRevision: inspected.body.revision,
      label: '写入中文译文',
      operations: [
        {
          type: 'putDocument',
          kind: 'translation',
          language: 'zh-Hans',
          sourceDocument: { documentId: speechId },
          body: {
            schema: 'baocut.translation/2',
            language: 'zh-Hans',
            sourceBasis: basis.sourceBasis,
            units: basis.sentences.map((s: Loose) => ({
              id: `t-${s.id}`,
              sourceSentenceId: s.id,
              sourceFingerprint: s.fingerprint,
              naturalText: '你好。',
              alignment: null,
              status: 'draft',
            })),
          },
        },
      ],
    });
    expect(put.isError).toBe(false);
    // alignment 写成 null 的单元由 Runtime 按句子补成句级对齐（双语导出与 captions_create 按它取成员与时间）。
    expect(put.body.filledAlignments).toBe(1);
    const after = await tool(session, 'videos_inspect', { video: videoPath });
    expect(after.body.documents).toContainEqual(
      expect.objectContaining({ kind: 'translation', language: 'zh-Hans', sourceDocumentId: speechId }),
    );
  });

  it('目标目录不能出工作目录、不能进视频目录；格式与种类要配；预检错误带错误码与 next', async () => {
    const session = await send();
    const codeOf = async (args: Record<string, unknown>) =>
      (await tool(session, 'export', { video: videoPath, kind: 'subtitles', format: 'srt', ...args })).body.error;

    expect((await codeOf({ dir: '../' })).code).toBe('PATH_OUTSIDE_WORKSPACE');
    expect((await codeOf({ dir: '/tmp' })).code).toBe('PATH_OUTSIDE_WORKSPACE');
    expect((await codeOf({ dir: videoPath })).code).toBe('PATH_INSIDE_VIDEO');
    expect((await codeOf({ dir: 'missing' })).code).toBe('INVALID_PATH');
    expect((await codeOf({ fileName: '../x.srt' })).code).toBe('INVALID_PATH');
    expect((await codeOf({ format: 'wav' })).code).toBe('INVALID_ARGUMENTS');
    expect((await codeOf({ kind: 'audio', format: 'srt' })).code).toBe('INVALID_ARGUMENTS');
    expect((await codeOf({ source: 'original' })).code).toBe('INVALID_ARGUMENTS');
    // 文稿独有的选项给了字幕：拒绝，不悄悄丢掉。
    expect((await codeOf({ chapters: true })).code).toBe('INVALID_ARGUMENTS');
    expect((await codeOf({ skipCut: false })).code).toBe('INVALID_ARGUMENTS');
    expect((await codeOf({ kind: 'video', format: 'mp4', width: 9000 })).code).toBe('INVALID_ARGUMENTS');

    const notFound = await codeOf({ language: 'fr' });
    expect(notFound).toMatchObject({ code: 'EXPORT_SOURCE_NOT_FOUND', next: expect.any(String) });

    // 两份转写：列出候选。
    const mirror = runtime.videos.mirror(videoId)!;
    await client.request('edits.apply', {
      videoId,
      commandId: newId('cmd'),
      expectedRevision: mirror.video.revision,
      operations: [
        {
          type: 'putDocument',
          kind: 'speech',
          language: 'en',
          sourceAsset: { assetId },
          body: {
            schema: 'baocut.speech/1',
            clock: 'source-asset',
            timescale: 1000,
            speakers: [],
            words: [],
            sentences: null,
            chapters: [],
          },
        },
      ],
    });
    const ambiguous = await codeOf({});
    expect(ambiguous).toMatchObject({
      code: 'EXPORT_SOURCE_AMBIGUOUS',
      candidates: expect.any(Array),
      next: expect.stringContaining('documentId'),
    });
    expect(await client.request('exports.list', { videoId })).toEqual({ jobs: [] });
  });

  it('便携包与工程：同样是 edit（覆盖时 high）；缺素材时逐项列出，不带本机路径', async () => {
    const session = await send('auto');
    const submitted = await tool(session, 'export', { video: videoPath, kind: 'portable', format: 'baocut' });
    expect(submitted.isError).toBe(false);
    expect(submitted.body).toMatchObject({ files: ['样片.baocut'], approval: { risk: 'edit', decidedBy: 'auto' } });
    const job = await settle(session, submitted.body.jobId);
    expect(job.state).toBe('completed');
    expect(job.outputs[0]).toMatchObject({ format: 'baocut', path: path.join(project.path, 'exports', '样片.baocut') });

    const xml = await tool(session, 'export', { video: videoPath, kind: 'project', format: 'xmeml' });
    expect(xml.isError).toBe(false);
    expect((await settle(session, xml.body.jobId)).state).toBe('completed');

    expect((await tool(session, 'export', { video: videoPath, kind: 'portable', format: 'srt' })).body.error.code).toBe(
      'INVALID_ARGUMENTS',
    );
    expect(
      (await tool(session, 'export', { video: videoPath, kind: 'portable', format: 'baocut', range: { start: 0, end: 1 } })).body.error
        .code,
    ).toBe('INVALID_ARGUMENTS');

    const overwriting = tool(session, 'export', { video: videoId, kind: 'portable', format: 'baocut', overwrite: true });
    const pending = await until(() => runtime.harness.approvals.pending()[0]);
    expect(pending).toMatchObject({ action: { name: 'export' }, risk: 'high' });
    expect(JSON.stringify(pending)).toContain('导出便携包（baocut）');
    await client.request('approvals.respond', { approvalId: pending.approvalId, decision: 'deny' });
    expect((await overwriting).body.error).toMatchObject({ code: 'APPROVAL_DENIED', risk: 'high' });

    // 链接的录音不见了：拒绝，items 里有原因与名字，没有绝对路径。
    await fs.rename(audio, `${audio}.gone`);
    try {
      const missing = (await tool(session, 'export', { video: videoPath, kind: 'portable', format: 'baocut' })).body.error;
      expect(missing).toMatchObject({ code: 'ASSET_MISSING', items: [{ reason: 'missing', name: 'voice.wav' }], next: expect.any(String) });
      expect(JSON.stringify(missing)).not.toContain(fixtures);
    } finally {
      await fs.rename(`${audio}.gone`, audio);
    }
  });
});
