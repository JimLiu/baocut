import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUT_OFFSET_SEC,
  TIMING_RATE,
  buildTimingFixtures,
  canBuildTimingFixtures,
  f32leSamples,
  startDrift,
  type TimingFixtures,
} from '@baocut/process-host/testing';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import {
  detectFilterScriptOption,
  MIX_PROGRESS_SHARE,
  mixArgs,
  renderAudio,
  runTool,
  ToolFailure,
  type AudioOutputSettings,
  type MasterRequest,
  type MasterRunner,
} from './audio-export.ts';
import type { AudioPlan, PlannedAsset } from './export-plan.ts';
import { masterRunner, resolveExportWorkerCommand } from './video-export.ts';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

describe('滤镜图文件参数的能力探测', () => {
  const actualSpawn = vi.importActual<typeof import('node:child_process')>('node:child_process');
  let attempts: Array<{ command: string; args: string[]; graph: string; kill: (signal?: NodeJS.Signals) => boolean; complete: (code: number) => void }>;
  let supported: Set<string>;
  let missing: boolean;
  let deferredOption: string | null;
  let command: string;
  let serial = 0;

  beforeEach(() => {
    attempts = [];
    supported = new Set();
    missing = false;
    deferredOption = null;
    command = `ffmpeg-probe-test-${serial++}`;
    vi.mocked(spawn).mockImplementation((executable, args) => {
      const argv = args as string[];
      const option = argv[3]!;
      const graph = argv[4]!;
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      const kill = vi.fn((_signal?: NodeJS.Signals) => {
        queueMicrotask(() => child.emit('close', null));
        return true;
      });
      Object.assign(child, { kill });
      attempts.push({ command: executable, args: [...argv], graph: readFileSync(graph, 'utf8'), kill, complete: (code) => child.emit('close', code) });
      queueMicrotask(() => {
        if (option === deferredOption) return;
        if (missing) child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' }));
        else {
          if (!supported.has(option)) child.stderr.write(`Unrecognized option '${option.slice(1)}'.`);
          child.emit('close', supported.has(option) ? 0 : 8);
        }
      });
      return child as unknown as ReturnType<typeof spawn>;
    });
  });

  afterEach(async () => {
    vi.mocked(spawn).mockImplementation((await actualSpawn).spawn);
    for (const attempt of attempts) {
      await expect(fs.access(path.dirname(attempt.args[4]!))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it.each([
    { label: '旧版只支持旧参数', options: ['-filter_complex_script'], expected: '-filter_complex_script', count: 2 },
    { label: '新旧参数均可用', options: ['-/filter_complex', '-filter_complex_script'], expected: '-/filter_complex', count: 1 },
    { label: 'FFmpeg 9 只支持新参数且帮助未列出', options: ['-/filter_complex'], expected: '-/filter_complex', count: 1 },
  ])('$label：根据实际执行结果选择参数', async ({ options, expected, count }) => {
    supported = new Set(options);
    expect(await detectFilterScriptOption({ command })).toBe(expected);
    expect(attempts).toHaveLength(count);
    expect(attempts.map((attempt) => attempt.args[3])).toEqual(
      count === 2 ? ['-/filter_complex', '-filter_complex_script'] : ['-/filter_complex'],
    );
    for (const attempt of attempts) {
      expect(attempt.graph).toBe('anullsrc=r=8000:cl=mono,atrim=end_sample=1[out]');
      expect(attempt.args).not.toContain('-h');
      expect(attempt.args.slice(5)).toEqual(['-map', '[out]', '-frames:a', '1', '-f', 'null', '-']);
    }
  });

  it('并发与后续调用共用成功的探测', async () => {
    supported.add('-/filter_complex');
    const tool = { command };
    const first = detectFilterScriptOption(tool);
    expect(detectFilterScriptOption(tool)).toBe(first);
    expect(await first).toBe('-/filter_complex');
    expect(await detectFilterScriptOption(tool)).toBe('-/filter_complex');
    expect(attempts).toHaveLength(1);
  });

  it('同一命令的不同执行环境分别探测', async () => {
    supported.add('-/filter_complex');
    expect(await detectFilterScriptOption({ command, env: { PATH: '/modern' } })).toBe('-/filter_complex');
    supported = new Set(['-filter_complex_script']);
    expect(await detectFilterScriptOption({ command, env: { PATH: '/legacy' } })).toBe('-filter_complex_script');
    expect(attempts).toHaveLength(3);
  });

  it('两种参数都失败时保留错误，不缓存猜测，后续调用可以重试', async () => {
    await expect(detectFilterScriptOption({ command })).rejects.toMatchObject({ kind: 'failed' });
    expect(attempts).toHaveLength(2);
    supported.add('-/filter_complex');
    expect(await detectFilterScriptOption({ command })).toBe('-/filter_complex');
    expect(attempts).toHaveLength(3);
  });

  it('程序不存在时直接报告缺失，恢复后重新探测', async () => {
    missing = true;
    await expect(detectFilterScriptOption({ command })).rejects.toBeInstanceOf(ToolFailure);
    expect(attempts).toHaveLength(1);
    missing = false;
    supported.add('-/filter_complex');
    expect(await detectFilterScriptOption({ command })).toBe('-/filter_complex');
    expect(attempts).toHaveLength(2);
  });

  it.each(['-/filter_complex', '-filter_complex_script'])('%s 探测等待进程结果，并发共用，完成后清理并缓存', async (option) => {
    deferredOption = option;
    const pending = detectFilterScriptOption({ command });
    expect(detectFilterScriptOption({ command })).toBe(pending);
    try {
      const count = option === '-/filter_complex' ? 1 : 2;
      await vi.waitFor(() => expect(attempts).toHaveLength(count));
      const attempt = attempts.at(-1)!;
      expect(attempt.args[3]).toBe(option);
      await expect(fs.access(path.dirname(attempt.args[4]!))).resolves.toBeUndefined();
      expect(attempt.kill).not.toHaveBeenCalled();
      expect(detectFilterScriptOption({ command })).toBe(pending);

      attempt.complete(0);
      expect(await pending).toBe(option);
      await expect(fs.access(path.dirname(attempt.args[4]!))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await detectFilterScriptOption({ command })).toBe(option);
      expect(attempts).toHaveLength(count);
    } finally {
      // 即使断言失败也结束替身进程，让探测收束并清理临时目录。
      deferredOption = null;
      for (const attempt of attempts) attempt.complete(0);
      await pending.catch(() => {});
    }
  });
});

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

  it('检测出的写法在本机 ffmpeg 上能读取滤镜图并完成混音', async () => {
    const option = await detectFilterScriptOption({ command: 'ffmpeg' });
    const file = path.join(staging, 'mix.graph');
    const out = path.join(staging, `${option.replace(/\W/g, '')}.wav`);
    const { args, graph } = mixArgs(silent, new Map(), 48_000, 2, out, { option, file });
    await fs.writeFile(file, graph);
    await runTool({ command: 'ffmpeg' }, args);
    expect((await fs.stat(out)).size).toBeGreaterThanOrEqual(DURATION * 48_000 * 2 * 4);
  });
});

/**
 * Where a segment lands, against the source: the mix has no timestamps to check, so the reference is the source WAV itself.
 * Output is mono at the source rate, so no resampler stands between them.
 */
describe.skipIf(!ffmpeg || !canBuildTimingFixtures())('a mixed segment sits on its source', () => {
  let dir: string;
  let files: TimingFixtures;
  let source: Float32Array;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-mix-timing-'));
    files = buildTimingFixtures(dir);
    source = wavSamples(await fs.readFile(files.wav));
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const SETTINGS: AudioOutputSettings = { format: 'wav', sampleRate: TIMING_RATE, channels: 1, bitrateKbps: 192, loudness: null };

  async function mix(file: string, segment: { start: number; end: number; sourceStart: number; sourceRate: number }): Promise<Float32Array> {
    const asset: PlannedAsset = {
      assetId: 'a',
      revision: '1',
      name: path.basename(file),
      path: file,
      storage: 'linked',
      mediaType: 'audio/mp4',
      contentHash: 'sha256:0',
      byteLength: 1,
      modifiedAt: null,
      audio: { sampleRate: TIMING_RATE, channels: 1 },
    };
    const plan: AudioPlan = {
      ...silent,
      range: { startSeconds: 0, endSeconds: 2, durationSeconds: 2 },
      segments: [{ itemId: 'i1', source: 'audio', asset: { id: 'a', revision: '1' }, trackOrder: 0, gainDb: 0, ...segment }],
    };
    const staging = await fs.mkdtemp(path.join(dir, 'staging-'));
    const result = await renderAudio({
      plan,
      assets: new Map([['a@1', asset]]),
      settings: SETTINGS,
      staging,
      outName: 'mix.wav',
      ffmpeg: { command: 'ffmpeg' },
      ffprobe: { command: 'ffprobe' },
      signal: new AbortController().signal,
    });
    return wavSamples(await fs.readFile(result.file));
  }

  const POSITION = 0.25;
  const LENGTH = 0.5;
  const placed = { start: POSITION, end: POSITION + LENGTH, sourceRate: 1 };
  const at = (seconds: number) => Math.round(seconds * TIMING_RATE);

  it.each([0, 0.3, 1, 1.5, 2, 2.5, 3, 5.5])('from an M4A at %s s', async (sourceStart) => {
    const mixed = await mix(files.m4a, { ...placed, sourceStart });
    expect(startDrift(source, mixed.subarray(at(POSITION), at(POSITION + LENGTH)), at(sourceStart))).toBe(0);
    // Nothing leaks in around the segment, and the segment does not run short.
    expect(Math.max(...mixed.subarray(0, at(POSITION)).map(Math.abs))).toBe(0);
    expect(Math.max(...mixed.subarray(at(POSITION + LENGTH)).map(Math.abs))).toBe(0);
    expect(Math.abs(mixed[at(POSITION + LENGTH) - 1]!) + Math.abs(mixed[at(POSITION + LENGTH) - 2]!)).toBeGreaterThan(0);
  });

  it.each([2, 2.01, 3, 5.5])('from AAC in a video, around a keyframe at %s s', async (sourceStart) => {
    const mixed = await mix(files.video, { ...placed, sourceStart });
    expect(startDrift(source, mixed.subarray(at(POSITION), at(POSITION + LENGTH)), at(sourceStart))).toBe(0);
  });

  it.each([0.5, 1.5, 3, 5.5])('from a file cut with -c copy at %s s', async (sourceStart) => {
    const mixed = await mix(files.cut, { ...placed, sourceStart });
    expect(startDrift(source, mixed.subarray(at(POSITION), at(POSITION + LENGTH)), at(CUT_OFFSET_SEC + sourceStart))).toBe(0);
  });

  /**
   * `atempo` has to receive exactly the window. Its splice points follow the signal, so its output cannot be lined up against
   * another encoding of the source, but it is deterministic: the same window gives the same samples. So the reference decodes
   * from the top of the file, where no seek can lose anything.
   */
  it.each([1.5, 2, 3, 5.5])('hands atempo the window from the top of the file at %s s', async (sourceStart) => {
    const rate = 2;
    const reference = f32leSamples(
      execFileSync(
        'ffmpeg',
        [
          ...['-nostdin', '-v', 'error', '-t', String(sourceStart + LENGTH * rate + 0.1), '-i', `file:${files.m4a}`],
          ...['-af', `atrim=start=${sourceStart},asetpts=PTS-STARTPTS,atempo=${rate}`, '-f', 'f32le', '-'],
        ],
        { maxBuffer: 1 << 28 },
      ),
    );
    const mixed = await mix(files.m4a, { start: 0, end: LENGTH, sourceStart, sourceRate: rate });
    const frames = at(LENGTH);
    expect(reference.length).toBeGreaterThanOrEqual(frames);
    // The mix goes through 16-bit PCM on its way out.
    for (let i = 0; i < frames; i += 1) expect(Math.abs(mixed[i]! - reference[i]!)).toBeLessThan(1e-3);
  });
});
