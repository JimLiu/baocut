import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ModelCatalog, ProviderFailure, inspectWav, sha256File } from '@baocut/models';
import { LocalAudioCppSeparator, routeLocalSeparation, type LocalSeparator } from './local-audio-cpp-separator.ts';
import type { LocalSeparateRun } from './local-provider.ts';
import { writeFakeAudioCpp, type FakeAudioCpp } from './testing/fake-tools.ts';
import { localDubSeparator } from './pipelines/dub-separator.ts';
import { LOCAL_SEPARATE_DEMAND, localSeparateResources, modelWorkerHolder } from './resource-profiles.ts';

/**
 * audio.cpp 的人声与背景分离（架构设计 §6.1 `separateAudio`、§6.3）：添加的 HTDemucs / Mel-Band RoFormer 模型包每次分离起一个
 * 引擎进程。引擎是假的（`fake-audiocpp-cli.ts`：按同样的命令行把输入按比例写成各轨的 32 位浮点 WAV），解码与合成两路用真的
 * ffmpeg。
 */

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const ffmpeg = async () => ({ command: 'ffmpeg' });
const ffprobe = async () => ({ command: 'ffprobe' });

describe.skipIf(!hasFfmpeg || process.platform === 'win32')('audio.cpp 人声分离（假引擎）', () => {
  let dir: string;
  let engine: string;
  let fake: FakeAudioCpp;
  let catalog: ModelCatalog;
  let input: string;
  let separator: LocalAudioCppSeparator;
  const env = async () => ({ PATH: process.env.PATH ?? '' });
  const HTDEMUCS = 'custom-htdemucs@audio-cpp';
  const MEL = 'custom-mel@audio-cpp';

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-audiocpp-sep-'));
    fake = await writeFakeAudioCpp(path.join(dir, 'audiocpp'));
    engine = fake.cli;
    catalog = new ModelCatalog({
      root: path.join(dir, 'models'),
      toolsDir: path.join(dir, 'tools'),
      engineAvailable: () => true,
      workerAvailable: () => false,
      bundles: [],
    });
    // 与「添加 audio.cpp 模型」指定这台电脑上的 GGUF 时一样：原地引用的文件，各轨的对应见 `SEP_FAMILIES`。
    for (const [bundleId, family, background] of [
      [HTDEMUCS, 'htdemucs', ['drums', 'bass', 'other']],
      [MEL, 'mel_band_roformer', ['instrumental']],
    ] as const) {
      const file = path.join(dir, 'gguf', `${family}.gguf`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'weights');
      catalog.register({
        definition: {
          bundleId,
          capability: 'separate',
          backend: 'audio-cpp',
          device: 'auto',
          label: family,
          components: { separator: { family: 'audio-cpp-gguf', repo: `audio-cpp-added/${family}`, revision: 'local', local: { path: file, size: 7 } } },
          separation: { family, file: path.basename(file), vocals: ['vocals'], background, peakBytes: 3 * 1024 ** 3 },
        },
        manifest: null,
        info: { kind: 'local-file', family, familyName: family, source: file },
      });
    }
    // 48 kHz 单声道的输入：引擎只收 44.1 kHz 立体声，先解码换算。
    input = path.join(dir, 'input.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-af', 'volume=0.5', '-ac', '1', input]);
    separator = new LocalAudioCppSeparator({ catalog, engine: () => engine, env, ffmpeg, threads: 2, cancelGraceMs: 200 });
  });

  afterEach(async () => {
    await separator.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const run = async (bundleId: string, sampleRate: number | null = 48_000): Promise<LocalSeparateRun> => {
    const staging = path.join(dir, 'staging', bundleId.replace(/@.*/, ''));
    await fs.mkdir(staging, { recursive: true });
    return { bundleId, jobId: 'job_1', input: { file: input, contentHash: 'sha256:x', track: 0 }, sampleRate, staging };
  };
  const rms = async (file: string) => {
    const wav = inspectWav(await fs.readFile(file));
    if (!wav.ok) throw new Error(wav.problem);
    return wav.wav;
  };

  it('HTDemucs：鼓、贝斯、其他三轨相加（不归一化）成背景，两路写成 16 位立体声、采样率取请求的，中间文件删掉', async () => {
    const request = await run(HTDEMUCS);
    const outcome = await separator.separate(request, new AbortController().signal);
    expect(outcome.outcome).toBe('completed');
    if (outcome.outcome !== 'completed') return;
    expect(outcome.vocals).toBe(path.join(request.staging, 'vocals.wav'));
    expect(outcome.background).toBe(path.join(request.staging, 'background.wav'));
    const vocals = await rms(outcome.vocals);
    const background = await rms(outcome.background);
    expect(vocals).toMatchObject({ sampleRate: 48_000, channels: 2, bitsPerSample: 16, encoding: 'pcm' });
    expect(background).toMatchObject({ sampleRate: 48_000, channels: 2, bitsPerSample: 16 });
    expect(Math.abs(vocals.durationSec - 2)).toBeLessThan(0.02);
    expect(background.rms / vocals.rms).toBeCloseTo(0.3, 1);
    expect(outcome.result.audio).toEqual({ sampleRate: 48_000, channels: 2, durationSec: vocals.durationSec });
    expect(outcome.result.stems!.vocals).toEqual({
      path: outcome.vocals,
      sha256: `sha256:${await sha256File(outcome.vocals)}`,
      byteLength: (await fs.stat(outcome.vocals)).size,
    });
    // 引擎的输入与各轨已经删掉。
    expect((await fs.readdir(request.staging)).sort()).toEqual(['background.wav', 'vocals.wav']);
    const args = (await fake.recorded('sep'))[0]!.args!;
    expect(args.slice(0, 4)).toEqual(['--task', 'sep', '--family', 'htdemucs']);
    expect(args[args.indexOf('--model') + 1]).toBe(path.join(dir, 'gguf', 'htdemucs.gguf'));
    expect(args).toEqual(expect.arrayContaining(['--out-format', 'float32', '--metrics', '--threads', '2']));
    expect(args).not.toContain('--backend');
  });

  it('Mel-Band RoFormer：伴奏就是背景；不指定采样率时是引擎的 44.1 kHz；给了后端就传', async () => {
    const withBackend = new LocalAudioCppSeparator({ catalog, engine: () => engine, env, ffmpeg, backend: 'metal' });
    const request = await run(MEL, null);
    const outcome = await withBackend.separate(request, new AbortController().signal);
    await withBackend.close();
    if (outcome.outcome !== 'completed') throw new Error('not completed');
    const background = await rms(outcome.background);
    expect(background.sampleRate).toBe(44_100);
    expect(background.rms / (await rms(outcome.vocals)).rms).toBeCloseTo(0.25, 1);
    const args = (await fake.recorded('sep'))[0]!.args!;
    expect(args[args.indexOf('--family') + 1]).toBe('mel_band_roformer');
    expect(args[args.indexOf('--backend') + 1]).toBe('metal');
  });

  it('引擎缺一轨是协议错误，非零退出是崩溃，找不到引擎与不是 audio.cpp 的模型包不可用；失败也删掉中间文件', async () => {
    await fake.control({ sepSkip: 'bass' });
    let request = await run(HTDEMUCS);
    const missing = await separator.separate(request, new AbortController().signal).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(ProviderFailure);
    expect(missing).toMatchObject({ kind: 'protocol' });
    expect((missing as Error).message).toContain('bass');
    expect(await fs.readdir(request.staging)).toEqual([]);

    await fake.control({ sepFail: 'boom' });
    request = await run(MEL);
    await expect(separator.separate(request, new AbortController().signal)).rejects.toMatchObject({ kind: 'crashed', details: { exitCode: 3 } });

    const noEngine = new LocalAudioCppSeparator({ catalog, engine: () => null, env, ffmpeg });
    await expect(noEngine.separate(await run(MEL), new AbortController().signal)).rejects.toMatchObject({
      kind: 'unavailable',
      details: { reason: 'unsupported' },
    });
    await expect(separator.separate({ ...(await run(MEL)), bundleId: 'htdemucs-ft@mlx' }, new AbortController().signal)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('读不了的输入是 input-unreadable', async () => {
    await fs.writeFile(input, 'not audio');
    await expect(separator.separate(await run(HTDEMUCS), new AbortController().signal)).rejects.toMatchObject({ kind: 'input-unreadable' });
  });

  it('取消：结束引擎进程，以 cancelled 兑现', async () => {
    await fake.control({ sepHang: true });
    const controller = new AbortController();
    const pending = separator.separate(await run(HTDEMUCS), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 600));
    controller.abort();
    await expect(pending).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('按模型包分派：audio.cpp 的交给引擎，别的交给 Model Worker；配音的分离执行者带上进程峰值', async () => {
    const calls: string[] = [];
    const worker: LocalSeparator = {
      separate: async (r) => {
        calls.push(r.bundleId);
        return { outcome: 'cancelled' };
      },
    };
    const routed = routeLocalSeparation(worker, separator);
    await routed.separate({ ...(await run(MEL)), bundleId: 'htdemucs-ft@mlx' }, new AbortController().signal);
    expect(calls).toEqual(['htdemucs-ft@mlx']);
    expect((await routed.separate(await run(MEL), new AbortController().signal)).outcome).toBe('completed');
    expect(calls).toEqual(['htdemucs-ft@mlx']);

    const peak = catalog.separationPeak(MEL)!;
    expect(peak.bytes).toBeGreaterThan(0);
    expect(catalog.separationPeak('nope')).toBeNull();
    expect(await catalog.workerWeightBytes(MEL)).toBeNull();
    const dub = localDubSeparator({ provider: routed, bundleId: MEL, workerWeightBytes: null, processPeak: peak, ffmpeg, ffprobe });
    expect(dub.processPeak).toEqual(peak);
  });
});

describe('audio.cpp 分离的资源', () => {
  it('引擎进程只在这一步里活着：峰值计入这一步，没有 holder', () => {
    const GiB = 1024 ** 3;
    expect(localSeparateResources('m@audio-cpp', null, { bytes: 3 * GiB, pool: 'gpuMemory' })).toEqual({
      demand: { ...LOCAL_SEPARATE_DEMAND, cpuThreads: 2, gpuMemory: 3 * GiB },
    });
    expect(localSeparateResources('m@audio-cpp', null, { bytes: 3 * GiB, pool: 'memory' })).toEqual({
      demand: { ...LOCAL_SEPARATE_DEMAND, cpuThreads: 2, memory: LOCAL_SEPARATE_DEMAND.memory! + 3 * GiB },
    });
    expect(localSeparateResources('htdemucs-ft@mlx', 100, null).holder!.id).toBe(modelWorkerHolder('htdemucs-ft@mlx'));
  });
});
