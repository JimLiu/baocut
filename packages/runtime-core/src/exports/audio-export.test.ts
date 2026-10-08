import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import {
  detectFilterScriptOption,
  MIX_PROGRESS_SHARE,
  mixArgs,
  renderAudio,
  runTool,
  type AudioOutputSettings,
  type MasterRequest,
  type MasterRunner,
} from './audio-export.ts';
import type { AudioPlan, PlannedAsset } from './export-plan.ts';
import { masterRunner, resolveExportWorkerCommand } from './video-export.ts';

/** 音频导出的混音、母带与编码：真实的 ffmpeg（母带可以是替身，也可以是真的 Render Worker）。缺 ffmpeg 时跳过。 */

const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const worker = resolveExportWorkerCommand(resolveEngineHostCommand());

const DURATION = 2;
const silent: AudioPlan = {
  sequenceId: 'seq',
  sequenceRevision: '1',
  range: { startSeconds: 0, endSeconds: DURATION, durationSeconds: DURATION },
  segments: [],
  notes: [],
};
const loud: AudioOutputSettings = {
  format: 'wav',
  sampleRate: 48_000,
  channels: 2,
  bitrateKbps: 192,
  loudness: { integratedLufs: -16, truePeakDb: -1.2 },
};

describe.skipIf(!ffmpeg)('音频导出的进度', () => {
  let staging: string;
  beforeEach(async () => {
    staging = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-audio-export-'));
  });
  afterEach(async () => {
    await fs.rm(staging, { recursive: true, force: true });
  });

  const render = (settings: AudioOutputSettings, master: MasterRunner | undefined, progress: number[]) =>
    renderAudio({
      plan: silent,
      assets: new Map(),
      settings,
      staging,
      outName: 'out.wav',
      ffmpeg: { command: 'ffmpeg' },
      ffprobe: { command: 'ffprobe' },
      ...(master ? { master } : {}),
      signal: new AbortController().signal,
      progress: (seconds) => progress.push(seconds),
    });

  it('开了响度标准化时混音走到一半，母带跑的时候进度接着走，母带完了才到头；不开时混音走完全程', async () => {
    const progress: number[] = [];
    let atMasterStart = -1;
    const master: MasterRunner = async (inputFile, _signal, onProgress) => {
      atMasterStart = progress.length;
      const request = JSON.parse(await fs.readFile(inputFile, 'utf8')) as MasterRequest;
      await fs.writeFile(request.output, Buffer.alloc(DURATION * request.sampleRate * request.channels * 4));
      const total = 3 * DURATION * request.sampleRate;
      for (const done of [0, total / 2, total]) onProgress?.(done, total);
      return { frames: DURATION * request.sampleRate, inputLufs: -200, lufs: -200, truePeak: -200, staticGainDb: 0 };
    };
    const result = await render(loud, master, progress);
    expect(result.warnings.map((w) => w.code)).toEqual(['LOUDNESS_NOT_MEASURABLE']);
    const share = DURATION * MIX_PROGRESS_SHARE;
    // 混音只报到份额处（母带开始前先报一次份额处）；母带从份额处按它报的比例走到时长。
    expect(Math.max(...progress.slice(0, atMasterStart))).toBeLessThanOrEqual(share);
    expect(progress[atMasterStart - 1]).toBe(share);
    expect(progress.slice(atMasterStart)).toEqual([share, share + (DURATION - share) / 2, DURATION, DURATION]);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    const plain: number[] = [];
    await render({ ...loud, loudness: null }, undefined, plain);
    expect(plain.at(-1)).toBeCloseTo(DURATION, 1);
  });

  it.skipIf(!worker)('Render Worker 的母带进度经 masterRunner 转给调用方', async () => {
    const reports: Array<[number, number]> = [];
    const runner = masterRunner({ command: worker! });
    const progress: number[] = [];
    await render(loud, (file, signal) => runner(file, signal, (done, total) => reports.push([done, total])), progress);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[0]![1]).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(DURATION);
  });
});

/** 16 位 PCM 的 WAV：找到 `data` 块，按声道交错读成 [−1, 1]。 */
function wavSamples(bytes: Buffer): Float32Array {
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    if (id === 'data') {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = bytes.readInt16LE(at + 8 + i * 2) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV 里没有 data 块');
}

describe.skipIf(!ffmpeg)('混音的滤镜图从文件读', () => {
  let staging: string;
  beforeEach(async () => {
    staging = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-audio-graph-'));
  });
  afterEach(async () => {
    await fs.rm(staging, { recursive: true, force: true });
  });

  it('烘焙得很密的包络（滤镜图超过 1 MiB）照样混得出来，按包络压低；用完的滤镜图文件删掉', async () => {
    const tone = path.join(staging, 'tone.wav');
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=3',
      '-ac',
      '1',
      tone,
    ]);
    const asset: PlannedAsset = {
      assetId: 'a',
      revision: '1',
      name: 'tone.wav',
      path: tone,
      storage: 'linked',
      mediaType: 'audio/wav',
      contentHash: 'sha256:0',
      byteLength: 1,
      modifiedAt: null,
      audio: { sampleRate: 48_000, channels: 1 },
    };
    // 前一秒每 0.05 毫秒一个折点、在 0.5 与 1 之间来回；之后静音。
    const envelope: Array<[number, number]> = Array.from({ length: 20_000 }, (_, i) => [i * 0.00005, 0.75 + 0.25 * Math.sin(i / 7)]);
    envelope.push([1.001, 0]);
    const plan: AudioPlan = {
      ...silent,
      segments: [
        {
          itemId: 'i1',
          source: 'audio',
          asset: { id: 'a', revision: '1' },
          trackOrder: 0,
          start: 0,
          end: DURATION,
          sourceStart: 0,
          sourceRate: 1,
          gainDb: 0,
          envelope,
        },
      ],
    };
    const result = await renderAudio({
      plan,
      assets: new Map([['a@1', asset]]),
      settings: { ...loud, loudness: null },
      staging,
      outName: 'dense.wav',
      ffmpeg: { command: 'ffmpeg' },
      ffprobe: { command: 'ffprobe' },
      signal: new AbortController().signal,
    });
    expect(result.media.durationSec).toBeCloseTo(DURATION, 2);
    const samples = wavSamples(await fs.readFile(result.file));
    const peak = (from: number, to: number) => Math.max(...samples.subarray(from * 2 * 48_000, to * 2 * 48_000).map(Math.abs));
    // ffmpeg 的 sine 振幅是 1/8；包络在 0.5 到 1 之间。
    expect(peak(0.1, 0.9)).toBeGreaterThan(0.06);
    expect(peak(1.1, 1.9)).toBe(0);
    expect((await fs.readdir(staging)).sort()).toEqual(['dense.wav', 'tone.wav']);
  });

  it('检测出的写法与旧选项 -filter_complex_script（新版本里弃用但照样执行）在本机的 ffmpeg 上都跑得通', async () => {
    const detected = await detectFilterScriptOption({ command: 'ffmpeg' });
    for (const option of new Set([detected, '-filter_complex_script' as const])) {
      const file = path.join(staging, 'mix.graph');
      const out = path.join(staging, `${option.replace(/\W/g, '')}.wav`);
      const { args, graph } = mixArgs(silent, new Map(), 48_000, 2, out, { option, file });
      await fs.writeFile(file, graph);
      await runTool({ command: 'ffmpeg' }, args);
      expect((await fs.stat(out)).size).toBeGreaterThanOrEqual(DURATION * 48_000 * 2 * 4);
    }
  });
});
