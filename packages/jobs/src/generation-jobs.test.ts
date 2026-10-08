import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type EditOperation, type JobRecord, type SpeechModelInfo } from '@baocut/protocol';
import {
  ModelCatalog,
  ProviderFailure,
  type GenerationAttempt,
  type GenerationCapability,
  type GenerationProvider,
  type GenerationRun,
  type GenerationSelection,
  type GenerationSink,
} from '@baocut/models';
import { JobManager, type JobVideos, type TranscribeRouter } from './job-manager.ts';
import type { MediaProbe } from './media-probe.ts';

/**
 * 生成任务在 JobManager 里的生命周期（架构设计 §7.1、§7.3）：冻结参数、校验、发布、导入视频与各种失败。
 * Provider 与解码校验都是假的；真实的适配器与 ffprobe 在 runtime-core 的端到端测试里。
 */

const MODEL: SpeechModelInfo = {
  modelId: 'tts',
  label: 'tts',
  default: true,
  voices: [{ voiceId: 'alloy', label: 'Alloy' }],
  defaultVoice: 'alloy',
  voiceModes: ['preset'],
  languages: 'any',
  maxInputChars: 100,
  formats: ['mp3'],
  defaultFormat: 'mp3',
  acceptsInstructions: false,
  speedRange: null,
  acceptsSeed: false,
  cost: 'unknown',
};

/** 按 `next` 的脚本执行；默认在 staging 里写一个以 ID3 开头的「mp3」。 */
class FakeGenerator implements GenerationProvider {
  readonly id = 'fake';
  readonly runs: GenerationRun[] = [];
  next: (run: GenerationRun, sink: GenerationSink, signal: AbortSignal) => Promise<GenerationAttempt> = async (run, sink) => {
    sink.generating();
    const bytes = Buffer.concat([Buffer.from('ID3'), Buffer.from(run.jobId)]);
    await fs.writeFile(path.join(run.staging, 'output-1.mp3'), bytes);
    sink.progress(1, 1);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return {
      outcome: 'completed',
      workerVersion: 'fake@1',
      outputs: [{ path: 'output-1.mp3', sha256, byteLength: bytes.length, mediaType: 'audio/mpeg' }],
    };
  };

  generate(run: GenerationRun, sink: GenerationSink, signal: AbortSignal): Promise<GenerationAttempt> {
    this.runs.push(run);
    return this.next(run, sink, signal);
  }

  async close(): Promise<void> {}
}

class FakeVideos implements JobVideos {
  open = true;
  revision = 3;
  leases = 0;
  applied: Array<{ commandId: string; expectedRevision: string; operations: EditOperation[] }> = [];
  failNext: Array<RpcError> = [];

  retain(): void {
    this.leases++;
  }

  release(): void {
    this.leases--;
  }

  async source(): Promise<never> {
    throw new RpcError('not-found', '没有素材');
  }

  current() {
    return null;
  }

  videoRevision(videoId: string) {
    return videoId === 'mov_1' && this.open ? String(this.revision) : null;
  }

  async apply(_videoId: string, request: { commandId: string; expectedRevision: string; operations: EditOperation[] }) {
    this.applied.push(request);
    const failure = this.failNext.shift();
    if (failure) {
      this.revision++;
      throw failure;
    }
    this.revision++;
    return { refs: Object.fromEntries(request.operations.map((op, i) => [(op as { ref: string }).ref, `ast_${i + 1}`])) };
  }
}

describe('生成任务（JobManager）', () => {
  let dir: string;
  let paths: { jobsFile: string; stagingDir: string; artifactsDir: string; diagnosticsDir: string };
  let generator: FakeGenerator;
  let videos: FakeVideos;
  let manager: JobManager;
  let probe: MediaProbe;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-gen-jobs-'));
    paths = {
      jobsFile: path.join(dir, 'store', 'jobs.json'),
      stagingDir: path.join(dir, 'staging'),
      artifactsDir: path.join(dir, 'artifacts'),
      diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
    };
    generator = new FakeGenerator();
    videos = new FakeVideos();
    probe = async () => ({ ok: true, media: { kind: 'audio', durationSec: 1, sampleRate: 24_000, channels: 1 } });
    const router: TranscribeRouter = {
      selectTranscribe: async () => {
        throw new Error('不用');
      },
      transcriber: () => null,
      executors: () => [],
      selectGeneration: async <C extends GenerationCapability>(capability: C) =>
        ({
          capability,
          providerId: 'fake',
          modelId: 'tts',
          kind: 'online',
          label: 'Fake',
          source: 'user-default',
          model: MODEL,
          generator,
          queue: { key: 'fake', concurrency: 1 },
        }) as unknown as GenerationSelection<C>,
      generators: () => [generator],
    };
    manager = new JobManager({
      paths,
      catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
      router,
      videos,
      probe: (file, mediaType) => probe(file, mediaType),
    });
    await manager.open();
  });

  afterEach(async () => {
    await manager.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function speak(extra: object = {}): Promise<JobRecord> {
    const { jobId } = await manager.submitSynthesizeSpeech({ text: '你好', ...extra }, { kind: 'connection', id: 'conn_1' });
    await manager.settled(jobId);
    return manager.inspect(jobId);
  }

  it('没有视频：发布产物，记下冻结的参数；执行者收到的正是这份参数', async () => {
    const job = await speak();
    expect(job).toMatchObject({
      state: 'completed',
      kind: 'synthesizeSpeech',
      videoId: null,
      generation: { capability: 'synthesizeSpeech', text: '你好', voice: 'alloy', format: 'mp3' },
      progress: { done: 1, total: 1, unit: 'outputs' },
    });
    expect(generator.runs[0]!.parameters).toEqual(job.generation);
    expect(job.result!.outputs).toEqual([
      expect.objectContaining({ mediaType: 'audio/mpeg', assetId: null, media: expect.objectContaining({ kind: 'audio' }) }),
    ]);
    const hex = job.result!.artifactId.replace('sha256:', '');
    expect((await fs.readFile(path.join(paths.artifactsDir, `${hex}.mp3`))).subarray(0, 3).toString()).toBe('ID3');
    expect(videos.applied).toHaveLength(0);
    expect(job.contentHash).toBe(`sha256:${crypto.createHash('sha256').update('你好').digest('hex')}`);
    // 同样的参数是同样的输入摘要。
    expect((await speak()).inputHash).toBe(job.inputHash);
  });

  it('给了视频：一笔事务导入为素材（不上时间线），来源不含原文；视频在读写之间被改过时换命令重试', async () => {
    videos.failNext.push(new RpcError('conflict', '版本冲突'));
    const job = await speak({ videoId: 'mov_1', name: '旁白' });
    expect(job.state).toBe('completed');
    // 执行与应用是两条记录（§7.2）：每次提交换一个命令，应用记下最后那次的命令与回执。
    const [app] = job.applications!;
    expect(videos.applied.map((a) => a.commandId)).toEqual([`cmd_${app!.applicationId}_1`, `cmd_${app!.applicationId}_2`]);
    expect(app).toMatchObject({
      state: 'committed',
      commandId: `cmd_${app!.applicationId}_2`,
      targetRefs: ['output1'],
      receipt: { refs: { output1: 'ast_1' } },
    });
    const [op] = videos.applied[1]!.operations as Array<EditOperation & { name: string; provenance: { source: Record<string, unknown> } }>;
    // 导入默认是链接；产物库里的文件不是用户的原文件，生成结果总是显式收进视频（绝对路径，managed）。
    expect(op).toMatchObject({ type: 'importAsset', name: '旁白', storage: 'managed', provenance: { origin: 'generated' } });
    expect(path.isAbsolute((op as { path: string }).path)).toBe(true);
    expect(op!.provenance.source).not.toHaveProperty('parameters.text');
    expect(JSON.stringify(op)).not.toContain('你好');
    expect(job.result!.outputs![0]!.assetId).toBe('ast_1');
    expect(videos.leases).toBe(0);
  });

  it('导入被引擎拒绝：APPLY_FAILED，产物保留在结果里', async () => {
    videos.failNext.push(new RpcError('invalid-request', '不能导入'));
    const job = await speak({ videoId: 'mov_1' });
    expect(job).toMatchObject({ state: 'failed', error: { code: 'APPLY_FAILED' } });
    expect(job.result!.outputs).toHaveLength(1);
  });

  it('生成期间视频关了：STALE_JOB_INPUT，产物保留', async () => {
    const original = generator.next;
    generator.next = async (run, sink, signal) => {
      videos.open = false;
      return original(run, sink, signal);
    };
    const job = await speak({ videoId: 'mov_1' });
    expect(job).toMatchObject({ state: 'failed', error: { code: 'STALE_JOB_INPUT', details: { artifactIds: [job.result!.artifactId] } } });
    expect(videos.applied).toHaveLength(0);
  });

  it('给了保存位置：发布后写一份按原文开头取名的副本（目录不存在时创建，不覆盖），路径记在输出里；不影响输入摘要', async () => {
    const saveDir = path.join(dir, 'saved', 'nested');
    const text = '  Hello:  world\n第二行 ';
    const job = await speak({ text, saveDir });
    expect(job.state).toBe('completed');
    const copy = path.join(saveDir, 'Hello world 第二行.mp3');
    expect(job.result!.outputs![0]!.path).toBe(copy);
    expect(job.warnings).toEqual([]);
    const artifact = await manager.artifacts.locate(job.result!.artifactId);
    expect(await fs.readFile(copy)).toEqual(await fs.readFile(artifact!));
    // 不是硬链接：改副本不动产物。
    expect((await fs.stat(copy)).ino).not.toBe((await fs.stat(artifact!)).ino);
    const again = await speak({ text, saveDir });
    expect(again.result!.outputs![0]!.path).toBe(path.join(saveDir, 'Hello world 第二行-2.mp3'));
    expect(again.inputHash).toBe((await speak({ text })).inputHash);
    // 没给保存位置：不写副本。
    expect((await speak({ text })).result!.outputs![0]!.path).toBeUndefined();
  });

  it('保存位置不能写：提交时以 OUTPUT_DESTINATION_UNAVAILABLE 拒绝；执行时副本写不成只记警告，任务照样完成', async () => {
    const blocked = path.join(dir, 'blocked');
    await fs.writeFile(blocked, 'x');
    await expect(
      manager.submitSynthesizeSpeech({ text: 'x', saveDir: path.join(blocked, 'sub') }, { kind: 'connection', id: 'c' }),
    ).rejects.toMatchObject({ code: 'conflict', details: { code: 'OUTPUT_DESTINATION_UNAVAILABLE' } });
    expect(manager.list()).toHaveLength(0);

    // 提交之后保存位置被换成了一个文件。
    const saveDir = path.join(dir, 'later');
    const original = generator.next;
    generator.next = async (run, sink, signal) => {
      await fs.rm(saveDir, { recursive: true, force: true });
      await fs.writeFile(saveDir, 'x');
      return original(run, sink, signal);
    };
    const job = await speak({ saveDir });
    expect(job.state).toBe('completed');
    expect(job.result!.outputs![0]!.path).toBeUndefined();
    expect(job.warnings).toEqual([expect.objectContaining({ code: 'save-copy-failed' })]);
  });

  it('提交时视频没有打开：not-found，不创建任务', async () => {
    videos.open = false;
    await expect(manager.submitSynthesizeSpeech({ text: 'x', videoId: 'mov_1' }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(manager.list()).toHaveLength(0);
  });

  it('解码校验不过：MODEL_OUTPUT_INVALID，不发布，原始文件移到诊断目录；不重试', async () => {
    probe = async () => ({ ok: false, problems: ['解不开'] });
    const job = await speak();
    expect(job).toMatchObject({ state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID', details: { problems: ['输出 1：解不开'] } } });
    expect(job.result).toBeNull();
    expect(await fs.readdir(path.join(paths.diagnosticsDir, job.jobId))).toEqual(expect.arrayContaining(['output-1.mp3', 'job.json']));
    expect(await fs.readdir(paths.artifactsDir).catch(() => [])).toEqual([]);
    expect(generator.runs).toHaveLength(1);
  });

  it('声明的媒体类型与请求不符、摘要不符：MODEL_OUTPUT_INVALID', async () => {
    generator.next = async (run) => {
      await fs.writeFile(path.join(run.staging, 'out.wav'), 'RIFF');
      return {
        outcome: 'completed',
        workerVersion: 'x',
        outputs: [{ path: 'out.wav', sha256: '0'.repeat(64), byteLength: 4, mediaType: 'audio/wav' }],
      };
    };
    const job = await speak();
    expect(job.error?.code).toBe('MODEL_OUTPUT_INVALID');
    const problems = (job.error!.details as { problems: string[] }).problems.join('\n');
    expect(problems).toMatch(/sha256/);
    expect(problems).toMatch(/audio\/wav/);
  });

  it('Provider 失败按种类归一化，不重试，不换 Provider', async () => {
    generator.next = async () => {
      throw new ProviderFailure('rejected', '参数不被接受', { code: 'PROVIDER_REJECTED' });
    };
    const job = await speak();
    expect(job).toMatchObject({ state: 'failed', error: { code: 'PROVIDER_REJECTED' }, attempt: 1 });
    expect(generator.runs).toHaveLength(1);
  });

  it('取消：中止在途的生成，任务 cancelled，不发布', async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    generator.next = (_run, sink, signal) =>
      new Promise((resolve) => {
        sink.generating();
        started();
        signal.addEventListener('abort', () => resolve({ outcome: 'cancelled' }));
      });
    const { jobId } = await manager.submitSynthesizeSpeech({ text: 'x', videoId: 'mov_1' }, { kind: 'connection', id: 'c' });
    await running;
    await manager.cancel(jobId);
    await manager.settled(jobId);
    expect(manager.inspect(jobId)).toMatchObject({ state: 'cancelled', result: null });
    expect(videos.applied).toHaveLength(0);
    expect(videos.leases).toBe(0);
  });
});
