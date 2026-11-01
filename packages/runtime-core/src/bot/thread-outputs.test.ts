import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import { silentLogger } from '@baocut/harness';
import { LINK_IMPORT_PIPELINE } from '@baocut/jobs';
import { newId, type GeneratedOutput, type JobRecord, type JobSubmitter } from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { ToolDriver, tool, until } from '../agent-tools/testing/fake-agent.ts';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import { BotKit } from './testing/bot-kit.ts';
import { attachThreadJobOutputs, publishedFiles } from './thread-outputs.ts';
import { mergeArtifacts } from './work-item-machine.ts';

/** 线程的导出与交出的文件挂到任务产物上（BOT-VE-03、技术方案 §5.4）。 */

const output = (file?: string): GeneratedOutput => ({
  artifactId: 'sha256:x',
  mediaType: 'video/mp4',
  byteLength: 1,
  assetId: null,
  media: { kind: 'file' },
  ...(file ? { path: file } : {}),
});

function job(fields: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_1',
    kind: 'export',
    state: 'completed',
    attempt: 1,
    submitter: { kind: 'agent', id: 'conv_thread', taskId: 'task_1' },
    result: { documentId: null, artifactId: 'sha256:x', outputs: [output('/exports/cut.mp4'), output('/exports/cut.srt')] },
    ...fields,
  } as JobRecord;
}

describe('publishedFiles', () => {
  it('lists the files a finished top-level job published', () => {
    expect(publishedFiles(job({}))).toEqual(['/exports/cut.mp4', '/exports/cut.srt']);
    // 部分发布后失败的导出：已经发布的照样算。
    expect(
      publishedFiles(job({ state: 'failed', result: { documentId: null, artifactId: 'a', outputs: [output('/exports/cut.mp4')] } })),
    ).toEqual(['/exports/cut.mp4']);
  });

  it('skips running jobs, pipeline steps, link downloads and outputs kept in the artifact store', () => {
    expect(publishedFiles(job({ state: 'running', result: null }))).toEqual([]);
    expect(publishedFiles(job({ parentJobId: 'job_parent' }))).toEqual([]);
    expect(publishedFiles(job({ kind: 'pipeline', pipeline: { name: LINK_IMPORT_PIPELINE } as JobRecord['pipeline'] }))).toEqual([]);
    expect(publishedFiles(job({ kind: 'generateImage', result: { documentId: null, artifactId: 'a', outputs: [output()] } }))).toEqual([]);
  });
});

describe('mergeArtifacts', () => {
  it('treats a relative and an absolute path to the same channel file as one output, keeping the newer label', () => {
    const dir = path.resolve('/channels/ch_1/files');
    const auto = { kind: 'file' as const, path: path.join(dir, 'exports/cut.mp4'), label: 'cut.mp4', version: null };
    const video = { kind: 'video' as const, projectId: 'p1', videoId: 'v1', label: 'Ep 12', version: null };
    const merged = mergeArtifacts([auto, video], [{ kind: 'file', path: 'exports/cut.mp4', label: 'Final cut', version: 'v2' }], dir);
    expect(merged).toEqual([{ kind: 'file', path: 'exports/cut.mp4', label: 'Final cut', version: 'v2' }, video]);
  });
});

describe('attachThreadJobOutputs', () => {
  it('hands each finish of an agent job over once', () => {
    let emit: (record: JobRecord) => void = () => {};
    const calls: { submitter: JobSubmitter; files: readonly string[] }[] = [];
    attachThreadJobOutputs(
      { onChange: (fn) => ((emit = fn), () => {}) },
      { recordThreadOutputs: async (submitter, files) => void calls.push({ submitter, files }) },
      silentLogger,
    );
    emit(job({ state: 'running', result: null }));
    emit(job({}));
    emit(job({}));
    emit(job({ jobId: 'job_user', submitter: { kind: 'connection', id: 'conn_ui' } }));
    emit(job({ attempt: 2 }));
    expect(calls.map((c) => c.files)).toEqual([
      ['/exports/cut.mp4', '/exports/cut.srt'],
      ['/exports/cut.mp4', '/exports/cut.srt'],
    ]);
    expect(calls[0]!.submitter).toEqual({ kind: 'agent', id: 'conv_thread', taskId: 'task_1' });
  });
});

describe('BotService.recordThreadOutputs', () => {
  let kit: BotKit;
  beforeEach(async () => {
    kit = await BotKit.open();
  });
  afterEach(async () => {
    await kit.close();
  });

  it("puts a thread's files on its task once, keeping labels the thread gave", async () => {
    const item = await kit.startTask('Export the cut');
    const threadId = kit.threadOf(item.id);
    const filesDir = kit.harness.conversationOf(threadId)!.cwd;
    const thread: JobSubmitter = { kind: 'agent', id: threadId, taskId: 'task_x' };
    await kit.bot.patchItemContent(
      item.id,
      (i) => ({ ...i, outputs: [{ kind: 'file', path: 'covers/cover.png', label: 'Cover', version: null }] }),
      false,
    );

    await kit.bot.recordThreadOutputs(thread, [
      '/Users/me/Movies/cut.mp4',
      path.join(filesDir, 'covers/cover.png'),
      '/Users/me/Movies/cut.mp4',
    ]);
    const after = kit.item(item.id);
    expect(after.outputs).toEqual([
      { kind: 'file', path: 'covers/cover.png', label: 'Cover', version: null },
      { kind: 'file', path: '/Users/me/Movies/cut.mp4', label: 'cut.mp4', version: null },
    ]);
    expect(after.lastProgressAt).toBe(after.updatedAt);

    // 再交一次同样的文件不改任务。
    await kit.bot.recordThreadOutputs(thread, ['/Users/me/Movies/cut.mp4']);
    expect(kit.item(item.id).updatedAt).toBe(after.updatedAt);
  });

  it('ignores files from the channel conversation and from other submitters', async () => {
    const item = await kit.startTask('Export the cut');
    const before = kit.item(item.id);
    await kit.bot.recordThreadOutputs({ kind: 'agent', id: kit.main.conversationId, taskId: 'task_x' }, ['/Users/me/Movies/cut.mp4']);
    await kit.bot.recordThreadOutputs({ kind: 'connection', id: 'conn_ui' }, ['/Users/me/Movies/cut.mp4']);
    expect(kit.item(item.id).outputs).toEqual(before.outputs);
  });
});

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !ffmpeg) console.warn('Skipping the thread export test: no engine-host or ffmpeg');

describe.skipIf(!engine || !ffmpeg)('a thread export in the running Runtime (real engine)', () => {
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let driver: ToolDriver;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-thread-outputs-'));
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
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('puts the exported subtitles on the task without the thread listing them', async () => {
    const audio = path.join(dir, 'voice.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', audio]);
    const { project } = await client.request('projects.create', { name: 'Thread export' });
    const opened = await client.request('videos.create', { projectId: project.id, name: 'cut' });
    await client.request('edits.apply', {
      videoId: opened.ref.videoId,
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
          body: {
            schema: 'baocut.speech/1',
            clock: 'source-asset',
            timescale: 1000,
            speakers: [],
            words: [{ id: 'w1', start: 0, end: 500, text: 'Hi.' }],
            sentences: null,
            chapters: [],
          },
        },
      ],
    });
    const { channel } = await client.request('channels.create', { name: 'Exports', driverId: 'codex' });
    const { item } = await client.request('workItems.create', { channelId: channel.id, title: 'Export the subtitles', owner: 'agent' });
    await client.request('workItems.update', {
      id: item.id,
      patch: { resources: [{ kind: 'video', projectId: project.id, videoId: opened.ref.videoId }] },
    });
    await client.request('workItems.transition', { id: item.id, event: { type: 'start' } });

    const thread = await until(() =>
      driver.sessions.find((s) => s.turnId && s.inputs.some((text) => text.includes('Export the subtitles'))),
    );
    const submitted = await tool(thread, 'export', { video: opened.ref.videoId, kind: 'subtitles', format: 'srt' });
    expect(submitted.isError).toBe(false);
    const job = await until(async () => {
      const { body } = await tool(thread, 'jobs_inspect', { jobId: submitted.body.jobId });
      return body.state === 'completed' ? body : null;
    }, 15_000);
    const file = job.outputs[0].path as string;

    const outputs = await until(async () => {
      const { item: after } = await client.request('workItems.get', { id: item.id });
      return after.outputs.length ? after.outputs : null;
    });
    expect(outputs).toEqual([{ kind: 'file', path: file, label: path.basename(file), version: null }]);
  });
});
