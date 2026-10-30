import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord, JobWarning } from '@baocut/protocol';
import {
  MANIFEST_FILE,
  MUSIC_BUNDLES,
  ModelCatalog,
  ProviderFailure,
  localMusicModelInfo,
  musicSelfTestParameters,
  type GenerationCapability,
  type GenerationRun,
  type GenerationSelection,
  type GenerationSink,
} from '@baocut/models';
import { JobManager, type JobVideos, type TranscribeRouter } from './job-manager.ts';
import { LocalMusicProvider } from './local-music-provider.ts';
import { LOCAL_MUSIC_DEMAND, localMusicResources } from './resource-profiles.ts';

/**
 * 本地音乐生成（架构设计 §6.1、§6.3、§7.7）：audio.cpp 引擎每个任务一个进程，由 `LocalMusicProvider` 起与收；
 * 引擎是假的（一个按同样命令行写 WAV 的脚本），真实的推理不在这里。
 */

const YUE = MUSIC_BUNDLES[0]!;
const GiB = 1024 * 1024 * 1024;

/** 假引擎：读 `--out-dir` / `--out` 写一段正弦 WAV，时长取 `semantic_max_tokens / 25`（撞上限）或环境变量给的秒数；按环境变量失败或挂起。 */
const FAKE_ENGINE = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const options = args.filter((_, i) => args[i - 1] === '--request-option');
// audio.cpp 0.9.3 defaults to 200 semantic tokens and rejects max < min.
if (process.env.FAKE_VALIDATE_SAMPLING) {
  const numberOption = (key, fallback) => Number((options.find((o) => o.startsWith(key + '=')) ?? (key + '=' + fallback)).split('=')[1]);
  if (numberOption('semantic_max_tokens', 9000) < numberOption('semantic_min_tokens', 200)) {
    process.stderr.write('Yue2 semantic sampling options are invalid');
    process.exit(3);
  }
}
fs.writeFileSync(path.join(flag('--out-dir'), 'args.json'), JSON.stringify(args));
if (process.env.FAKE_FAIL) { process.stderr.write('boom: ' + process.env.FAKE_FAIL + '\\n'); process.exit(3); }
if (process.env.FAKE_HANG) { process.stderr.write('hanging\\n'); setInterval(() => {}, 1000); }
else {
  const tokens = Number((options.find((o) => o.startsWith('semantic_max_tokens=')) ?? 'semantic_max_tokens=25').slice(20));
  const seconds = process.env.FAKE_SECONDS ? Number(process.env.FAKE_SECONDS) : tokens / 25;
  const rate = 44100, frames = Math.round(seconds * rate);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) data.writeInt16LE(Math.round(Math.sin(i / 20) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const name = process.env.FAKE_RENAME ? 'yue2-output.wav' : flag('--out');
  if (!process.env.FAKE_NO_OUTPUT) fs.writeFileSync(path.join(flag('--out-dir'), name), Buffer.concat([h, data]));
}
`;

async function installYue(root: string): Promise<void> {
  const source = YUE.components.music!;
  const dir = path.join(root, ...source.repo.split('/'));
  await fs.mkdir(dir, { recursive: true });
  const entries = [];
  for (const name of [YUE.music!.files.model, YUE.music!.files.vae]) {
    const content = `weights of ${name}`;
    await fs.writeFile(path.join(dir, name), content);
    entries.push({ path: name, size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex'), source_verified: true });
  }
  await fs.writeFile(
    path.join(dir, MANIFEST_FILE),
    JSON.stringify({ format_version: 1, repo: source.repo, revision: source.revision, source: 'https://huggingface.co', files: entries }),
  );
}

class FakeVideos implements JobVideos {
  retain(): void {}
  release(): void {}
  async source(): Promise<never> {
    throw new Error('no asset');
  }
  current() {
    return null;
  }
  videoRevision() {
    return null;
  }
  async apply(): Promise<{ refs: Record<string, string> }> {
    return { refs: {} };
  }
}

describe('本地音乐生成', () => {
  let dir: string;
  let engine: string;
  let catalog: ModelCatalog;
  let env: NodeJS.ProcessEnv;
  let provider: LocalMusicProvider;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-music-jobs-'));
    await fs.writeFile(path.join(dir, 'fake-engine.cjs'), FAKE_ENGINE);
    engine = path.join(dir, 'audiocpp_cli');
    await fs.writeFile(engine, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake-engine.cjs')}" "$@"\n`, { mode: 0o755 });
    await installYue(path.join(dir, 'models'));
    // 引擎随应用内置：模型包装好、找得到引擎就可用。
    catalog = new ModelCatalog({
      root: path.join(dir, 'models'),
      toolsDir: path.join(dir, 'tools'),
      engineAvailable: () => true,
      platform: 'darwin',
      arch: 'arm64',
      workerAvailable: () => false,
    });
    env = { PATH: process.env.PATH ?? '' };
    provider = new LocalMusicProvider({ catalog, engine: () => engine, env: async () => env, threads: 2, cancelGraceMs: 200 });
  });

  afterEach(async () => {
    await provider.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const run = (overrides: Partial<GenerationRun> = {}): GenerationRun => ({
    jobId: 'job_1',
    attempt: 1,
    providerId: 'local',
    modelId: YUE.bundleId,
    parameters: {
      capability: 'generateMusic',
      mode: 'song',
      style: 'upbeat pop',
      lyrics: 'la la la',
      targetDurationSec: null,
      maxDurationSec: 4,
      planning: 'melody',
      format: 'wav',
      seed: 11,
    },
    staging: path.join(dir, 'staging'),
    ...overrides,
  });

  const sink = () => {
    const events: string[] = [];
    const warnings: JobWarning[] = [];
    const s: GenerationSink = {
      generating: () => events.push('generating'),
      progress: (done, total) => events.push(`progress ${done}/${total}`),
      warning: (w) => warnings.push(w),
    };
    return { s, events, warnings };
  };

  describe('Provider', () => {
    beforeEach(async () => {
      await fs.mkdir(path.join(dir, 'staging'), { recursive: true });
    });

    it('起引擎进程：命令行按冻结参数，模型目录是模型包的仓库；输出 music.wav 在 staging，带摘要与 audio/wav；撞上限记警告', async () => {
      const { s, events, warnings } = sink();
      const attempt = await provider.generate(run(), s, new AbortController().signal);
      expect(attempt.outcome).toBe('completed');
      if (attempt.outcome !== 'completed') return;
      expect(attempt.outputs).toHaveLength(1);
      const [output] = attempt.outputs;
      expect(output).toMatchObject({ path: 'music.wav', mediaType: 'audio/wav' });
      const bytes = await fs.readFile(path.join(dir, 'staging', output!.path));
      expect(bytes.length).toBe(output!.byteLength);
      expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(output!.sha256);
      expect(attempt.workerVersion).toContain('audiocpp_cli');
      expect(events).toEqual(['generating', 'progress 1/1']);
      // 假引擎正好写满 token 上限换算的时长：算撞上限。
      expect(warnings).toEqual([expect.objectContaining({ code: 'output-truncated' })]);

      const args = JSON.parse(await fs.readFile(path.join(dir, 'staging', 'args.json'), 'utf8')) as string[];
      const modelDir = catalog.repoDir(YUE.components.music!.repo);
      expect(args[args.indexOf('--model') + 1]).toBe(modelDir);
      expect(args[args.indexOf('--lyrics') + 1]).toBe('la la la');
      expect(args[args.indexOf('--threads') + 1]).toBe('2');
      expect(args).toContain('style=upbeat pop');
      expect(args).toContain('cot=melody');
      expect(args).toContain('seed=11');
      expect(args).toContain('semantic_max_tokens=100');
      expect(args).toContain(`yue2.model_gguf=${YUE.music!.files.model}`);
      expect(args).not.toContain('--backend');
    });

    it('没撞上限不记警告；自检的少步数进命令行；引擎自己改了输出名时退回 staging 里的 WAV', async () => {
      env.FAKE_SECONDS = '1';
      env.FAKE_RENAME = '1';
      const { s, warnings } = sink();
      const attempt = await provider.generateMusic(run({ parameters: musicSelfTestParameters() }), s, new AbortController().signal, { steps: 4 });
      expect(attempt).toMatchObject({ outcome: 'completed', outputs: [{ path: 'music.wav', mediaType: 'audio/wav' }] });
      expect(warnings).toEqual([]);
      const args = JSON.parse(await fs.readFile(path.join(dir, 'staging', 'args.json'), 'utf8')) as string[];
      expect(args).toContain('num_inference_steps=4');
      expect(args[args.indexOf('--lyrics') + 1]).toBe('');
      expect(args).toContain('cot=off');
    });

    it.each([1, 4, 7.96, 8, 10, 120])('semantic sampling accepts a %s-second budget with every planning mode', async (maxDurationSec) => {
      env.FAKE_VALIDATE_SAMPLING = '1';
      env.FAKE_SECONDS = '0.3';
      for (const planning of ['off', 'melody', 'full'] as const) {
        const parameters = { ...musicSelfTestParameters(), maxDurationSec, planning };
        const attempt = await provider.generate(run({ parameters }), sink().s, new AbortController().signal);
        expect(attempt.outcome).toBe('completed');
      }
    });

    it('后端由选项给时进命令行', async () => {
      const withBackend = new LocalMusicProvider({ catalog, engine: () => engine, env: async () => env, threads: 1, backend: 'metal' });
      await withBackend.generate(run(), sink().s, new AbortController().signal);
      const args = JSON.parse(await fs.readFile(path.join(dir, 'staging', 'args.json'), 'utf8')) as string[];
      expect(args.slice(-2)).toEqual(['--backend', 'metal']);
    });

    it('引擎找不到：unavailable；不是音乐模型包：unavailable；别的能力：protocol', async () => {
      const missing = new LocalMusicProvider({ catalog, engine: () => null, env: async () => env });
      await expect(missing.generate(run(), sink().s, new AbortController().signal)).rejects.toMatchObject({
        kind: 'unavailable',
        message: expect.stringContaining('audio.cpp'),
        details: { reason: 'unsupported', bundleId: YUE.bundleId },
      });
      await expect(provider.generate(run({ modelId: 'qwen3-asr-0.6b@mlx-4bit' }), sink().s, new AbortController().signal)).rejects.toMatchObject({
        kind: 'unavailable',
      });
      await expect(
        provider.generate(run({ parameters: { capability: 'generateText' } as unknown as GenerationRun['parameters'] }), sink().s, new AbortController().signal),
      ).rejects.toBeInstanceOf(ProviderFailure);
    });

    it('引擎非零退出：crashed 并带 stderr 的尾巴；退出了没有 WAV：protocol', async () => {
      env.FAKE_FAIL = 'out of memory';
      await expect(provider.generate(run(), sink().s, new AbortController().signal)).rejects.toMatchObject({
        kind: 'crashed',
        message: expect.stringContaining('out of memory'),
      });
      delete env.FAKE_FAIL;
      env.FAKE_NO_OUTPUT = '1';
      await expect(provider.generate(run(), sink().s, new AbortController().signal)).rejects.toMatchObject({ kind: 'protocol' });
    });

    it('取消：结束进程，以 cancelled 兑现；已中止的信号不起进程', async () => {
      env.FAKE_HANG = '1';
      const controller = new AbortController();
      const { s, events } = sink();
      const pending = provider.generate(run(), s, controller.signal);
      await new Promise((r) => setTimeout(r, 300));
      controller.abort();
      expect(await pending).toEqual({ outcome: 'cancelled' });
      expect(events).toEqual(['generating']);
      const aborted = new AbortController();
      aborted.abort();
      expect(await provider.generate(run(), s, aborted.signal)).toEqual({ outcome: 'cancelled' });
    });
  });

  describe('资源需求', () => {
    it('按模型包登记的估计峰值计入任务自己：Apple Silicon 计 GPU 内存，别的平台计内存；没有共用的 holder', () => {
      expect(localMusicResources(YUE.bundleId, { bytes: 10 * GiB, pool: 'gpuMemory' })).toEqual({
        demand: expect.objectContaining({ gpuMemory: 10 * GiB, scratchDisk: LOCAL_MUSIC_DEMAND.scratchDisk }),
      });
      expect(localMusicResources(YUE.bundleId, { bytes: 10 * GiB, pool: 'memory' }).demand).toMatchObject({ memory: 10 * GiB });
      expect(localMusicResources(YUE.bundleId, { bytes: 10 * GiB, pool: 'memory' }).demand.gpuMemory).toBeUndefined();
      expect(localMusicResources(YUE.bundleId, null).demand.scratchDisk).toBe(LOCAL_MUSIC_DEMAND.scratchDisk);
    });
  });

  describe('JobManager', () => {
    let manager: JobManager;

    beforeEach(async () => {
      const info = localMusicModelInfo(YUE, (await catalog.status(YUE.bundleId))!, true, engine);
      const router: TranscribeRouter = {
        selectTranscribe: async () => {
          throw new Error('unused');
        },
        transcriber: () => null,
        executors: () => [],
        selectGeneration: async <C extends GenerationCapability>(capability: C) =>
          ({
            capability,
            providerId: 'local',
            modelId: YUE.bundleId,
            kind: 'local',
            label: YUE.label,
            source: 'factory-default',
            model: info,
            generator: provider,
            queue: { key: YUE.bundleId, concurrency: 1 },
          }) as unknown as GenerationSelection<C>,
        generators: () => [provider],
      };
      manager = new JobManager({
        paths: {
          jobsFile: path.join(dir, 'store', 'jobs.jsonl'),
          stagingDir: path.join(dir, 'staging'),
          artifactsDir: path.join(dir, 'artifacts'),
          diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
        },
        catalog,
        router,
        videos: new FakeVideos(),
        probe: async () => ({ ok: true, media: { kind: 'audio', durationSec: 4, sampleRate: 44_100, channels: 1 } }),
      });
      await manager.open();
    });

    afterEach(async () => {
      await manager.shutdown();
    });

    it('提交：冻结参数（seed 没给时抽一个、上限缺省取模型默认）、模型包记进任务；完成后发布 WAV 产物，撞上限的警告在任务上', async () => {
      env.FAKE_SECONDS = '2';
      const { jobId } = await manager.submitGenerateMusic(
        { mode: 'instrumental', style: 'calm piano', maxDurationSec: 4 },
        { kind: 'connection', id: 'conn_1' },
      );
      await manager.settled(jobId);
      const job: JobRecord = manager.inspect(jobId);
      expect(job).toMatchObject({ kind: 'generateMusic', state: 'completed', providerId: 'local', modelId: YUE.bundleId, bundleId: YUE.bundleId });
      expect(job.result).toMatchObject({ outputs: [{ mediaType: 'audio/wav' }] });
      expect(job.warnings).toEqual([]);
      const spec = manager.inspect(jobId);
      expect(spec.result).not.toBeNull();

      env.FAKE_SECONDS = '';
      const second = await manager.submitGenerateMusic({ mode: 'song', style: 'rock', lyrics: 'yeah', seed: 5 }, { kind: 'connection', id: 'conn_1' });
      await manager.settled(second.jobId);
      const truncated = manager.inspect(second.jobId);
      expect(truncated.state).toBe('completed');
      expect(truncated.warnings).toEqual([expect.objectContaining({ code: 'output-truncated' })]);
      const args = JSON.parse(await fs.readFile(path.join(dir, 'staging', second.jobId, '1', 'args.json'), 'utf8').catch(() => '[]')) as string[];
      if (args.length > 0) expect(args).toContain('seed=5');
    });

    it('提交时检查：歌曲没歌词拒绝，不创建任务', async () => {
      await expect(manager.submitGenerateMusic({ mode: 'song', style: 's' }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
        code: 'invalid-request',
      });
      expect(manager.snapshot().jobs).toHaveLength(0);
    });

    it('引擎失败：任务 failed，不重试', async () => {
      env.FAKE_FAIL = 'no gpu';
      const { jobId } = await manager.submitGenerateMusic({ mode: 'instrumental', style: 'x' }, { kind: 'connection', id: 'c' });
      await manager.settled(jobId);
      expect(manager.inspect(jobId)).toMatchObject({ state: 'failed', attempt: 1 });
    });

    it('取消在途的生成：任务 cancelled', async () => {
      env.FAKE_HANG = '1';
      const { jobId } = await manager.submitGenerateMusic({ mode: 'instrumental', style: 'x' }, { kind: 'connection', id: 'c' });
      for (let i = 0; i < 50 && manager.inspect(jobId).state !== 'running'; i++) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 200));
      await manager.cancel(jobId);
      await manager.settled(jobId);
      expect(manager.inspect(jobId)).toMatchObject({ state: 'cancelled', result: null });
    });
  });
});
