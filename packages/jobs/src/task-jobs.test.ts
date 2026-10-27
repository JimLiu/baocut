import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelCatalog } from '@baocut/models';
import { JobManager, TaskFailure, type JobVideos, type TaskRun, type TaskSubmission, type TranscribeRouter } from './job-manager.ts';

/**
 * 不经模型的任务（导出）在 JobManager 里的生命周期：排队、staging、取消、失败与重启。执行函数是假的；
 * 真实的导出在 runtime-core 的端到端测试里。
 */

const videos: JobVideos = {
  retain: () => {},
  release: () => {},
  videoRevision: () => '1',
  source: async () => {
    throw new Error('不用');
  },
  apply: async () => {
    throw new Error('不用');
  },
} as unknown as JobVideos;

const router: TranscribeRouter = {
  selectTranscribe: async () => {
    throw new Error('不用');
  },
  transcriber: () => null,
  executors: () => [],
};

describe('不经模型的任务（JobManager.submitTask）', () => {
  let dir: string;
  let paths: { jobsFile: string; stagingDir: string; artifactsDir: string; diagnosticsDir: string };
  let manager: JobManager;

  const open = async () => {
    const next = new JobManager({ paths, catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }), router, videos });
    await next.open();
    return next;
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-task-jobs-'));
    paths = {
      jobsFile: path.join(dir, 'store', 'jobs.jsonl'),
      stagingDir: path.join(dir, 'staging'),
      artifactsDir: path.join(dir, 'artifacts'),
      diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
    };
    manager = await open();
  });

  afterEach(async () => {
    await manager.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function submission(run: TaskSubmission['run'], extra: Partial<TaskSubmission> = {}): TaskSubmission {
    return {
      kind: 'export',
      spec: { task: 'export', snapshotArtifactId: `sha256:${'a'.repeat(64)}` },
      videoId: 'vid_1',
      contentHash: `sha256:${'a'.repeat(64)}`,
      inputHash: `sha256:${'b'.repeat(64)}`,
      providerId: 'local',
      modelId: 'export',
      queue: { key: 'export', concurrency: 2 },
      run,
      ...extra,
    };
  }

  const submitter = { kind: 'connection', id: 'conn_1' } as const;

  it.each(['completed', 'failed', 'cancelled', 'interrupted'] as const)('目标磁盘 staging 在 %s 后删除，只清理本任务目录', async (state) => {
    const destination = path.join(dir, '目标 外置盘');
    await fs.mkdir(destination);
    const userFile = path.join(destination, 'keep.mp4');
    await fs.writeFile(userFile, 'user output');
    let staging = '';
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const { jobId } = manager.submitTask(submission(async (run) => {
      staging = run.staging;
      expect(path.dirname(staging)).toBe(destination);
      await fs.writeFile(path.join(staging, 'out.wav'), 'temporary bytes');
      started();
      if (state === 'completed') return { documentId: null, artifactId: 'sha256:x', outputs: [] };
      if (state === 'failed') throw new TaskFailure('EXPORT_RENDER_FAILED', 'failed');
      await new Promise((_, reject) => run.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      throw new Error('unreachable');
    }, { stagingParent: destination }), submitter);
    await running;
    expect(staging).toBe(path.join(destination, `.baocut-export-${jobId}`));
    if (state === 'cancelled') await manager.cancel(jobId);
    if (state === 'interrupted') await manager.shutdown();
    expect(await manager.settled(jobId)).toBe(state);
    expect(await fs.readdir(destination)).toEqual(['keep.mp4']);
    expect(await fs.readFile(userFile, 'utf8')).toBe('user output');
    // 模拟终态落账后被强杀留下的目录，重启靠账本精确清理，不遍历用户目录。
    await manager.shutdown();
    await fs.mkdir(staging);
    await fs.writeFile(path.join(staging, 'leftover.wav'), 'leftover');
    if (state === 'interrupted') {
      // 模拟异常退出：账本只留下 running，尚未来得及记 interrupted 或清理。
      const lines = (await fs.readFile(paths.jobsFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      const latest = lines.findLast((line) => line.op === 'put' && line.record.jobId === jobId);
      latest.record.state = 'running';
      latest.record.endedAt = null;
      await fs.appendFile(paths.jobsFile, `${JSON.stringify(latest)}\n`);
    }
    manager = await open();
    expect(await fs.readdir(destination)).toEqual(['keep.mp4']);
    if (state === 'interrupted') expect(manager.inspect(jobId).state).toBe('interrupted');
  });

  it('目标盘失联时失败，不递归重建目标目录到系统盘', async () => {
    const destination = path.join(dir, 'disconnected');
    const { jobId } = manager.submitTask(submission(async () => {
      throw new Error('should not run');
    }, { stagingParent: destination }), submitter);
    expect(await manager.settled(jobId)).toBe('failed');
    await expect(fs.stat(destination)).rejects.toThrow();
  });

  it('正常返回即完成：结果、阶段与警告进记录，staging 删除，重启后还查得到', async () => {
    let staging = '';
    const { jobId } = manager.submitTask(
      submission(async (run: TaskRun) => {
        staging = run.staging;
        await fs.writeFile(path.join(run.staging, 'out.srt'), '1\n');
        run.phase('validating');
        run.warn({ code: 'ASS_STYLE_UNMAPPED', detail: 'plate' });
        return { documentId: null, artifactId: 'sha256:x', outputs: [] };
      }),
      submitter,
    );
    expect(await manager.settled(jobId)).toBe('completed');
    const record = manager.inspect(jobId);
    expect(record).toMatchObject({ kind: 'export', state: 'completed', phase: 'done', providerId: 'local', bundleId: null });
    expect(record.result?.artifactId).toBe('sha256:x');
    expect(record.warnings).toEqual([{ code: 'ASS_STYLE_UNMAPPED', detail: 'plate' }]);
    await expect(fs.stat(staging)).rejects.toThrow();

    await manager.shutdown();
    manager = await open();
    expect(manager.inspect(jobId)).toMatchObject({ kind: 'export', state: 'completed' });
  });

  it('TaskFailure 是失败：错误码、详情与已经发布的部分结果都保留', async () => {
    const { jobId } = manager.submitTask(
      submission(async () => {
        throw new TaskFailure(
          'EXPORT_PARTIALLY_PUBLISHED',
          '两个文件里有一个没有发布',
          { failed: ['b.srt'] },
          {
            documentId: null,
            artifactId: 'sha256:a',
            outputs: [],
          },
        );
      }),
      submitter,
    );
    expect(await manager.settled(jobId)).toBe('failed');
    expect(manager.inspect(jobId)).toMatchObject({
      error: { code: 'EXPORT_PARTIALLY_PUBLISHED', details: { failed: ['b.srt'] } },
      result: { artifactId: 'sha256:a' },
    });
  });

  it('运行中取消：执行函数收到信号，任务为 cancelled，staging 删除', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    let staging = '';
    const { jobId } = manager.submitTask(
      submission(
        (run) =>
          new Promise((_, reject) => {
            staging = run.staging;
            run.signal.addEventListener('abort', () => reject(new Error('aborted')));
            started();
          }),
      ),
      submitter,
    );
    await running;
    expect(await manager.cancel(jobId)).toEqual({ state: 'cancelled' });
    await expect(fs.stat(staging)).rejects.toThrow();
  });

  it('排队中取消不执行；同一个 commandId 返回原来的任务', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const busy = manager.submitTask(
      submission(
        async () => {
          await gate;
          return { documentId: null, artifactId: 'sha256:busy' };
        },
        { queue: { key: 'one', concurrency: 1 } },
      ),
      submitter,
    );
    let ran = false;
    const queued = manager.submitTask(
      submission(
        async () => {
          ran = true;
          return { documentId: null, artifactId: 'sha256:q' };
        },
        { queue: { key: 'one', concurrency: 1 }, commandId: 'cmd_q' },
      ),
      submitter,
    );
    expect(
      manager.submitTask(
        submission(async () => ({ documentId: null, artifactId: 'x' }), { commandId: 'cmd_q' }),
        submitter,
      ),
    ).toEqual(queued);
    expect(await manager.cancel(queued.jobId)).toEqual({ state: 'cancelled' });
    release();
    expect(await manager.settled(busy.jobId)).toBe('completed');
    expect(ran).toBe(false);
  });

  it('Runtime 停止时运行中的任务标为 interrupted，重启后不续跑、不当成转写任务；同一个 commandId 仍认回它', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const { jobId } = manager.submitTask(
      submission(
        (run) =>
          new Promise((_, reject) => {
            run.signal.addEventListener('abort', () => reject(new Error('aborted')));
            started();
          }),
        { commandId: 'cmd_run' },
      ),
      submitter,
    );
    await running;
    await manager.shutdown();
    expect(manager.inspect(jobId).state).toBe('interrupted');
    manager = await open();
    expect(manager.inspect(jobId)).toMatchObject({ kind: 'export', state: 'interrupted', error: { code: 'JOB_INTERRUPTED' } });
    // 重发的命令拿回原来的任务（由调用方决定重试），不另建一个、不执行。
    expect(manager.jobForCommand('cmd_run')).toBe(jobId);
    let ran = false;
    const again = manager.submitTask(
      submission(
        async () => {
          ran = true;
          return { documentId: null, artifactId: 'sha256:again' };
        },
        { commandId: 'cmd_run' },
      ),
      submitter,
    );
    expect(again.jobId).toBe(jobId);
    expect(manager.list().filter((job) => job.kind === 'export')).toHaveLength(1);
    expect(ran).toBe(false);
  });
});
