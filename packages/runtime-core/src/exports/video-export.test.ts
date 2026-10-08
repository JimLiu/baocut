import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import {
  RpcError,
  newId,
  type EditOperation,
  type ExportCreateRequest,
  type ExportSnapshot,
  type JobRecord,
  type Project,
  type SequenceItem,
} from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { FontCatalogue } from '../fonts/font-catalogue.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';
import {
  checkVideo,
  resolveExportWorkerCommand,
  workerInput,
  type ProbedVideo,
  type VideoOutput,
  type VideoPlanResult,
} from './video-export.ts';

/**
 * 成片导出（架构设计 §9.13）。端到端：真实的 Runtime、视频引擎、Render Worker 与 ffmpeg；素材是 ffmpeg 现场生成的
 * 纯色画面加正弦音。导入 → 剪 → 叠一张图片 → 交叉淡化 → 导出 MP4，ffprobe 读流与帧数，解码回来按像素查颜色、
 * 按频率查声音；导出途中编辑不影响结果（冻结）；取消不留半个文件；画不出来的内容默认拒绝、`skip` 时跳过并警告。
 * 缺 engine-host、export-worker 或 ffmpeg 时跳过端到端部分。
 */

const engine = resolveEngineHostCommand();
const worker = resolveExportWorkerCommand(engine);
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine || !worker) console.warn('跳过成片导出端到端测试：没有构建 engine-host / export-worker（npm run build:engine）');
if (!ffmpeg) console.warn('跳过成片导出端到端测试：没有 ffmpeg / ffprobe');

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const SAMPLE_RATE = 48000;

describe('成片的输出尺寸与校验', () => {
  it('Worker 的输入：画面的位置随输出带上；计划里有说话人的区间时原样带上，没有时不写', () => {
    const range = { start: { ticks: '0', timescale: 1 }, end: { ticks: '1', timescale: 1 } };
    const plan = { sequenceId: 'seq', document: {}, documents: [], parts: [{ video: { range } }] } as unknown as VideoPlanResult;
    const output: VideoOutput = {
      format: 'mp4',
      codec: 'h264',
      width: 320,
      height: 320,
      picture: { x: 0, y: 70, width: 320, height: 180 },
      fps: { num: 30, den: 1 },
      crf: null,
      bitrateKbps: null,
      audioBitrateKbps: 192,
    };
    const input = (plan: VideoPlanResult) =>
      workerInput({
        plan,
        part: 0,
        assets: new Map(),
        output,
        outputPath: 'out.mp4',
        audioPath: null,
        burnCaptions: true,
        onUnsupported: 'fail',
        ffmpeg: 'ffmpeg',
        ffprobe: 'ffprobe',
      }) as Record<string, unknown>;
    expect(input(plan).output).toMatchObject({ width: 320, height: 320, picture: { x: 0, y: 70, width: 320, height: 180 } });
    expect(input(plan)).not.toHaveProperty('speakers');
    const speakers = { spk_a: [[0.2, 0.8]] as Array<[number, number]> };
    expect(input({ ...plan, speakers }).speakers).toEqual(speakers);
  });

  it('流、帧数（差一帧以内）、尺寸、帧率、编码与声音的时长', () => {
    const output: VideoOutput = {
      format: 'mp4',
      codec: 'h264',
      width: 320,
      height: 180,
      picture: { x: 0, y: 0, width: 320, height: 180 },
      fps: { num: 30, den: 1 },
      crf: null,
      bitrateKbps: null,
      audioBitrateKbps: 192,
    };
    const good: ProbedVideo = {
      durationSec: 4,
      frames: 120,
      width: 320,
      height: 180,
      fps: '30/1',
      codec: 'h264',
      videoDurationSec: 4,
      audio: { codec: 'aac', durationSec: 4.01 },
      colorSpace: 'bt709',
    };
    const ok = checkVideo(good, { frames: 120, output, audio: true });
    expect(ok.problems).toEqual([]);
    expect(ok.media).toMatchObject({ kind: 'video', frames: 120, videoCodec: 'h264', audioCodec: 'aac' });
    expect(ok.validation.video).toMatchObject({ expectedFrames: 120, streams: ['video', 'audio'] });
    const bad = checkVideo(
      { ...good, frames: 110, width: 640, fps: '25/1', codec: 'hevc', videoDurationSec: 3.6, audio: null },
      { frames: 120, output, audio: true },
    );
    expect(bad.problems).toHaveLength(6);
  });
});

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function rejection(promise: Promise<unknown>): Promise<RpcError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error('应该被拒绝');
}

/** 纯色画面 + 正弦音的视频素材（H.264 太依赖本机编码器，用 mpeg4 高质量）。 */
function colorClip(file: string, color: string, frequency: number, seconds: number): void {
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:size=320x180:rate=30:duration=${seconds}`],
    ...['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}:sample_rate=${SAMPLE_RATE}`],
    ...['-c:v', 'mpeg4', '-q:v', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file],
  ]);
}

/** 第 `k` 帧的 RGB（整帧，rgb24）。 */
function frameAt(file: string, k: number, fps: number, width: number, height: number): Buffer {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 26 },
  );
  expect(raw.length, `第 ${k} 帧（${(k / fps).toFixed(2)} 秒）`).toBe(width * height * 3);
  return raw;
}

function pixel(frame: Buffer, width: number, x: number, y: number): [number, number, number] {
  const i = (y * width + x) * 3;
  return [frame[i]!, frame[i + 1]!, frame[i + 2]!];
}

function samples(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'], {
    maxBuffer: 1 << 28,
  });
  const ints = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  return Float32Array.from(ints, (v) => v / 32768);
}

/** `at` 秒附近 50 毫秒里频率为 `f` 的分量的振幅。 */
function tone(pcm: Float32Array, f: number, at: number): number {
  const from = Math.round((at - 0.025) * SAMPLE_RATE);
  const n = Math.round(0.05 * SAMPLE_RATE);
  let re = 0;
  let im = 0;
  for (let i = 0; i < n; i++) {
    const phase = (2 * Math.PI * f * (from + i)) / SAMPLE_RATE;
    re += pcm[from + i]! * Math.cos(phase);
    im += pcm[from + i]! * Math.sin(phase);
  }
  return (2 * Math.hypot(re, im)) / n;
}

function probe(file: string): {
  streams: Array<{ codec_type: string; codec_name: string; pix_fmt?: string; color_space?: string; width?: number; height?: number }>;
} {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]).toString()) as ReturnType<typeof probe>;
}

describe.skipIf(!engine || !worker || !ffmpeg)('成片导出（真实引擎 + Render Worker + ffmpeg）', () => {
  let fixtures: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-video-export-fixtures-'));
    colorClip(path.join(fixtures, 'red.mp4'), '0xFF0000', 440, 3);
    colorClip(path.join(fixtures, 'blue.mp4'), '0x0000FF', 1000, 3);
    colorClip(path.join(fixtures, 'long.mp4'), '0x808080', 300, 60);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x00FF00:size=32x32',
      '-frames:v',
      '1',
      path.join(fixtures, 'green.png'),
    ]);
    await fs.writeFile(
      path.join(fixtures, 'logo.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#ff0"/></svg>',
    );
    // 声波用：前 1 秒静音、之后 300 Hz 的单声道 WAV；另一段 200 Hz 的嗡声。
    const wav = (name: string, expression: string, seconds: number) =>
      execFileSync('ffmpeg', [
        ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=${expression}:s=${SAMPLE_RATE}:d=${seconds}`],
        ...['-c:a', 'pcm_s16le', path.join(fixtures, name)],
      ]);
    wav('tone.wav', 'if(gte(t\\,1)\\,0.6*sin(2*PI*300*t)\\,0)', 3);
    wav('hum.wav', '0.5*sin(2*PI*200*t)', 1);
    // 导入不解析 SVG（只认扩展名），到导出预检才发现解不开。
    await fs.writeFile(path.join(fixtures, 'broken.svg'), 'not an svg');
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-video-export-'));
    const home = resolveRuntimeHome({ BAOCUT_HOME: dir });
    runtime = await startRuntime({ home, drivers: () => [], watchSpace: false, engineHost: engine, videoGraceMs: 100, modelWorker: null });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
    ({ project } = await client.request('projects.create', { name: '成片测试' }));
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function fixture(name: string): Promise<string> {
    const target = path.join(project.path, 'media', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(fixtures, name), target);
    return target;
  }

  function video(videoId: string) {
    const mirror = runtime.videos.mirror(videoId)!;
    const sequence = mirror.video.sequences[mirror.video.rootSequenceId]!;
    const start = (item: SequenceItem) => ('span' in item ? item.span.fromFrame : 0);
    return {
      revision: mirror.video.revision,
      sequenceId: mirror.video.rootSequenceId,
      fps: sequence.fps,
      tracks: sequence.tracks,
      items: [...sequence.items].sort((a, b) => start(a) - start(b)),
    };
  }

  async function edit(videoId: string, operations: EditOperation[]) {
    return client.request('edits.apply', { videoId, commandId: newId('cmd'), expectedRevision: video(videoId).revision, operations });
  }

  const at = (seconds: number) => ({ unit: 'seconds' as const, value: String(seconds) });

  async function finish(jobId: string): Promise<JobRecord> {
    return until(async () => {
      const job = await client.request('exports.get', { jobId });
      return TERMINAL.has(job.state) && job;
    }, 120_000);
  }

  async function exportOnce(request: Omit<ExportCreateRequest, 'commandId'>): Promise<JobRecord> {
    const { jobId } = await client.request('exports.create', request);
    const job = await finish(jobId);
    if (job.state !== 'completed') throw new Error(`导出没有完成：${job.state} ${JSON.stringify(job.error)}`);
    return job;
  }

  /**
   * 换一个注入了字体目录与假下载的 Runtime（同一个 Runtime Home）：字体目录只有探针字体 ColrProbe 一个族，Google Fonts 的
   * 地址改写到本机的假服务 `origin`。
   */
  async function restartWithFontDownloads(origin: string): Promise<void> {
    client.close();
    await runtime.close();
    runtime = await startRuntime({
      home: resolveRuntimeHome({ BAOCUT_HOME: dir }),
      drivers: () => [],
      watchSpace: false,
      engineHost: engine,
      videoGraceMs: 100,
      modelWorker: null,
      fonts: {
        catalogue: FontCatalogue.parse({
          schema: 'baocut.google-fonts-catalogue/1',
          families: [{ f: 'ColrProbe', c: 'display', s: ['latin'], w: [400], l: 'OFL-1.1' }],
        }),
        download: {
          fetch: (input, init) => fetch(String(input).replace(/^https:\/\/fonts\.(googleapis|gstatic)\.com/, origin), init),
          retries: 0,
        },
      },
    });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
  }

  /** 新建视频，画布 320×180。 */
  async function newVideo(name: string): Promise<string> {
    const { ref } = await client.request('videos.create', { projectId: project.id, name });
    await edit(ref.videoId, [{ type: 'updateSequence', sequenceId: video(ref.videoId).sequenceId, canvas: { width: 320, height: 180 } }]);
    return ref.videoId;
  }

  /** 新加一条视觉轨道（排在最上面），返回它的 ID。 */
  async function overlayTrack(videoId: string): Promise<string> {
    const before = new Set(video(videoId).tracks.map((t) => t.id));
    await edit(videoId, [{ type: 'addTrack', kind: 'visual' }]);
    return video(videoId).tracks.find((t) => !before.has(t.id))!.id;
  }

  /**
   * 红（440 Hz）[0, 2) 与蓝（1000 Hz，取源的 1–3 秒）[2, 4) 首尾相接，中间 0.5 秒交叉淡化；
   * 上层一张绿色图片（32×32 的正方形）摆成画中画：中心在 (40, 40)、宽 48，也就是左上角在 (16, 16)、48×48，[0, 4)。
   * 位置按画幅的百分比写：x = 40 / 320、y = 40 / 180、w = 48 / 320。
   */
  async function cutVideo(): Promise<{ videoId: string; image: string }> {
    const videoId = await newVideo('成片');
    const red = await fixture('red.mp4');
    const blue = await fixture('blue.mp4');
    const green = await fixture('green.png');
    const { sequenceId } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: red, ref: 'r' },
      { type: 'importAsset', path: blue, ref: 'b' },
      { type: 'addItem', sequenceId, asset: { ref: 'r' }, at: at(0), alignment: 'nearest-frame' },
      { type: 'addItem', sequenceId, asset: { ref: 'b' }, at: at(3), alignment: 'nearest-frame' },
    ]);
    const [r, b] = video(videoId).items;
    await edit(videoId, [
      { type: 'trimItem', sequenceId, itemId: r!.id, edge: 'end', at: at(2), alignment: 'nearest-frame' },
      { type: 'trimItem', sequenceId, itemId: b!.id, edge: 'start', at: at(4), alignment: 'nearest-frame' },
    ]);
    await edit(videoId, [{ type: 'moveItem', sequenceId, itemId: b!.id, at: at(2), alignment: 'nearest-frame' }]);
    await edit(videoId, [
      {
        type: 'setTransition',
        sequenceId,
        leftItemId: r!.id,
        rightItemId: b!.id,
        kind: 'dissolve',
        duration: at(0.5),
        alignment: 'nearest-frame',
        audioCrossfade: true,
      },
    ]);
    const track = await overlayTrack(videoId);
    await edit(videoId, [{ type: 'importAsset', path: green, ref: 'g' }]);
    const assetId = Object.values(runtime.videos.mirror(videoId)!.video.assets).find((a) => a.name.startsWith('green'))!.id;
    await edit(videoId, [{ type: 'addItem', sequenceId, asset: { assetId }, trackId: track, at: at(0), alignment: 'nearest-frame' }]);
    const image = video(videoId).items.find((i) => i.type === 'image')!;
    await edit(videoId, [
      { type: 'trimItem', sequenceId, itemId: image.id, edge: 'end', at: at(4), alignment: 'nearest-frame' },
      { type: 'setStyle', sequenceId, itemId: image.id, mode: 'pip' },
      { type: 'setTransform', sequenceId, itemId: image.id, x: 12.5, y: (40 / 180) * 100, w: 15 },
    ]);
    return { videoId, image: image.id };
  }

  // v2 0d60e31a3 的源编码回归：源素材不必与输出编码相同，未剪辑也不能被原生输入限制挡住。
  it.each([
    ['VP9/AAC MP4', 'libvpx-vp9', 'aac', 'mp4', 'vp9', 'aac'],
    ['VP9/Opus WebM', 'libvpx-vp9', 'libopus', 'webm', 'vp9', 'opus'],
    ['VP8/Vorbis WebM', 'libvpx', 'libvorbis', 'webm', 'vp8', 'vorbis'],
    ['AV1/AAC MP4', 'libaom-av1', 'aac', 'mp4', 'av1', 'aac'],
  ])('默认 MP4 配置导出 %s 源素材，保留画面、声音、尺寸与源文件', async (_label, videoEncoder, audioEncoder, extension, videoCodec, audioCodec) => {
    const videoId = await newVideo('兼容编码');
    const source = path.join(project.path, `source with spaces.${extension}`);
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=0xFF0000:size=320x180:rate=30:duration=1'],
      ...['-f', 'lavfi', '-i', `sine=frequency=440:duration=1:sample_rate=${SAMPLE_RATE}`],
      ...['-c:v', videoEncoder, '-threads', '2', '-pix_fmt', 'yuv420p', '-c:a', audioEncoder, source],
    ]);
    const sourceStreams = probe(source).streams;
    expect(sourceStreams.find((s) => s.codec_type === 'video')?.codec_name).toBe(videoCodec);
    expect(sourceStreams.find((s) => s.codec_type === 'audio')?.codec_name).toBe(audioCodec);
    const hash = async () => createHash('sha256').update(await fs.readFile(source)).digest('hex');
    const originalHash = await hash();
    const { sequenceId } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: source, ref: 'source' },
      { type: 'addItem', sequenceId, asset: { ref: 'source' }, at: at(0), alignment: 'nearest-frame' },
    ]);
    const revision = video(videoId).revision;
    // 不给 codec、画质、尺寸、帧率或范围；完整地走 Runtime 预检、Worker 与发布校验。
    const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4' } });
    const output = job.result!.outputs![0]!;
    expect(output.media).toMatchObject({ kind: 'video', width: 320, height: 180, videoCodec: 'h264', audioCodec: 'aac' });
    expect(Math.abs(output.validation!.durationSec - 1)).toBeLessThan(0.1);
    const streams = probe(output.path!).streams;
    expect(streams.find((s) => s.codec_type === 'video')).toMatchObject({ codec_name: 'h264', width: 320, height: 180 });
    expect(streams.find((s) => s.codec_type === 'audio')?.codec_name).toBe('aac');
    const rate = video(videoId).fps.num / video(videoId).fps.den;
    const [red, green, blue] = pixel(frameAt(output.path!, Math.round(0.5 * rate), rate, 320, 180), 320, 160, 90);
    expect(red).toBeGreaterThan(220);
    expect(green).toBeLessThan(30);
    expect(blue).toBeLessThan(30);
    expect(tone(samples(output.path!), 440, 0.5)).toBeGreaterThan(0.08);
    expect(await hash()).toBe(originalHash);
    expect(video(videoId).revision).toBe(revision);
  }, 120_000);

  // 两次导出：单跑约 7 秒，整套测试一起跑时机器忙，留出余量。
  it('视频 + 图片 + 交叉淡化 + 声音：MP4，流、帧数、颜色与声音都对（A11）', async () => {
    const { videoId } = await cutVideo();
    const { fps } = video(videoId);
    const rate = fps.num / fps.den;
    const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4' } });
    const [out] = job.result!.outputs!;
    expect(out!.path).toBe(path.join(project.path, 'exports', '成片.mp4'));
    expect(out!.mediaType).toBe('video/mp4');
    const frames = Math.ceil(4 * rate);
    expect(out!.media).toMatchObject({ kind: 'video', width: 320, height: 180, frames, videoCodec: 'h264', audioCodec: 'aac' });
    expect(out!.validation!.video).toMatchObject({ expectedFrames: frames, frames, streams: ['video', 'audio'] });

    const streams = probe(out!.path!).streams;
    const v = streams.find((s) => s.codec_type === 'video')!;
    expect(v).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', color_space: 'bt709', width: 320, height: 180 });
    expect(streams.find((s) => s.codec_type === 'audio')).toMatchObject({ codec_name: 'aac' });

    const near = (rgb: [number, number, number], want: [number, number, number], tol = 40) =>
      expect(
        rgb.every((c, i) => Math.abs(c - want[i]!) <= tol),
        `${rgb} ≈ ${want}`,
      ).toBe(true);
    const red = frameAt(out!.path!, Math.round(0.5 * rate), rate, 320, 180);
    near(pixel(red, 320, 200, 120), [255, 0, 0]);
    near(pixel(red, 320, 40, 40), [0, 255, 0]);
    const blue = frameAt(out!.path!, Math.round(3.5 * rate), rate, 320, 180);
    near(pixel(blue, 320, 200, 120), [0, 0, 255]);
    near(pixel(blue, 320, 40, 40), [0, 255, 0]);
    // 交叉淡化的中点：红蓝各一半（在 sRGB 编码值上混合，与 Canvas 2D 一致）。
    const middle = frameAt(out!.path!, Math.round(2 * rate), rate, 320, 180);
    near(pixel(middle, 320, 200, 120), [128, 0, 128], 45);

    // ffmpeg 的正弦音振幅是 1/8。
    const pcm = samples(out!.path!);
    expect(tone(pcm, 440, 0.5)).toBeGreaterThan(0.1);
    expect(tone(pcm, 1000, 0.5)).toBeLessThan(0.01);
    expect(tone(pcm, 1000, 3.5)).toBeGreaterThan(0.1);
    expect(tone(pcm, 440, 3.5)).toBeLessThan(0.01);

    // 范围、输出高度与帧率：1.5–2.5 秒，90 高，15 fps → 15 帧、160×90；WebM（VP9 + Opus）。
    const part = await exportOnce({
      videoId,
      settings: { kind: 'video', format: 'webm', range: { start: 1.5, end: 2.5 }, height: 90, fps: { num: 15, den: 1 } },
    });
    const partOut = part.result!.outputs![0]!;
    expect(partOut.path).toBe(path.join(project.path, 'exports', '成片.webm'));
    expect(partOut.media).toMatchObject({
      kind: 'video',
      width: 160,
      height: 90,
      frames: 15,
      fps: '15/1',
      videoCodec: 'vp9',
      audioCodec: 'opus',
    });

    // 宽高都给、比例与画布不同：160×160 的输出里画面 160×90 居中（上下各 35 的黑边），画面里的摆放按画布缩放、不重排。
    const boxed = await exportOnce({
      videoId,
      settings: { kind: 'video', format: 'mp4', range: { start: 0, end: 1 }, width: 160, height: 160, fps: { num: 15, den: 1 } },
    });
    const boxedOut = boxed.result!.outputs![0]!;
    expect(boxedOut.media).toMatchObject({ kind: 'video', width: 160, height: 160, frames: 15 });
    expect(boxed.warnings ?? []).not.toContainEqual(expect.objectContaining({ code: 'EXPORT_SIZE_ADJUSTED' }));
    const frame = frameAt(boxedOut.path!, 7, 15, 160, 160);
    near(pixel(frame, 160, 80, 10), [0, 0, 0], 20);
    near(pixel(frame, 160, 80, 150), [0, 0, 0], 20);
    near(pixel(frame, 160, 100, 35 + 60), [255, 0, 0]);
    // 画中画的绿图：画布上中心在 (40, 40)，缩一半落在画面的 (20, 20)，也就是输出的 (20, 55)。
    near(pixel(frame, 160, 20, 35 + 20), [0, 255, 0]);
  }, 60_000);

  it('内部检查的三段预览正常渲染、校验与发布，用途保留在快照和任务记录', async () => {
    const { videoId } = await cutVideo();
    const job = await exportOnce({
      videoId,
      settings: {
        kind: 'video',
        format: 'mp4',
        purpose: 'preview',
        ranges: [
          { start: 0, end: 1 },
          { start: 1, end: 2 },
          { start: 2, end: 3 },
        ],
        width: 160,
        fps: { num: 15, den: 1 },
      },
    });
    expect(job.export!.settings.purpose).toBe('preview');
    const snapshot = JSON.parse(
      (await runtime.models.jobs.artifacts.read(job.export!.snapshotArtifactId))!.toString('utf8'),
    ) as ExportSnapshot;
    expect(snapshot.settings.purpose).toBe('preview');
    expect(job.result!.outputs!.map((o) => path.basename(o.path!))).toEqual(['成片.part1.mp4', '成片.part2.mp4', '成片.part3.mp4']);
    for (const output of job.result!.outputs!) {
      expect(output.media).toMatchObject({ durationSec: 1, frames: 15, width: 160, height: 90 });
      expect(output.validation).toMatchObject({ durationSec: 1, video: { frames: 15, streams: ['video', 'audio'] } });
    }
  }, 60_000);

  // 母带在 debug 构建的 Worker 里跑，比别的用例慢。
  it('声音的响度母带：成片的声音做到目标响度与真峰值，实测写进校验', async () => {
    const { videoId } = await cutVideo();
    const job = await exportOnce({
      videoId,
      settings: { kind: 'video', format: 'mp4', audio: { loudness: { integratedLufs: -20, truePeakDb: -2 } } },
    });
    const loudness = job.result!.outputs![0]!.validation!.loudness!;
    expect(loudness.target).toEqual({ integratedLufs: -20, truePeakDb: -2 });
    expect(Math.abs(loudness.measured.integratedLufs + 20)).toBeLessThan(0.5);
    expect(loudness.measured.truePeakDb).toBeLessThanOrEqual(-2);
    expect(job.warnings.map((w) => w.code)).not.toContain('LOUDNESS_NOT_MEASURABLE');
  }, 60_000);

  it('冻结：导出途中删掉所有实例，成片仍是提交时的版本（AT-25）', async () => {
    const { videoId } = await cutVideo();
    const before = video(videoId);
    const { jobId } = await client.request('exports.create', { videoId, settings: { kind: 'video', format: 'mp4' } });
    await edit(videoId, [{ type: 'deleteItems', sequenceId: before.sequenceId, itemIds: before.items.map((i) => i.id) }]);
    const job = await finish(jobId);
    expect(job.state).toBe('completed');
    expect(job.export!.videoRevision).toBe(before.revision);
    const rate = before.fps.num / before.fps.den;
    const frame = frameAt(job.result!.outputs![0]!.path!, Math.round(0.5 * rate), rate, 320, 180);
    expect(pixel(frame, 320, 200, 120)[0]).toBeGreaterThan(200);
    // 现在序列是空的：范围为空。
    const empty = await rejection(client.request('exports.create', { videoId, settings: { kind: 'video', format: 'mp4' } }));
    expect(empty.details).toMatchObject({ code: 'EXPORT_RANGE_EMPTY' });
  });

  it('取消：停下 Worker 与 ffmpeg，清掉 staging，不留半个文件（AT-26）', async () => {
    const videoId = await newVideo('长片');
    const long = await fixture('long.mp4');
    const { sequenceId } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: long, ref: 'l' },
      { type: 'addItem', sequenceId, asset: { ref: 'l' }, at: at(0), alignment: 'nearest-frame' },
    ]);
    const { jobId } = await client.request('exports.create', { videoId, settings: { kind: 'video', format: 'mp4' } });
    await until(async () => {
      const job = await client.request('exports.get', { jobId });
      return job.progress?.unit === 'frames' && job.progress.done > 0;
    });
    const staging = path.join(resolveRuntimeHome({ BAOCUT_HOME: dir }).stagingDir, 'jobs', jobId);
    await client.request('jobs.cancel', { jobId });
    const cancelled = await finish(jobId);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.result).toBeNull();
    await until(async () => !(await fs.stat(staging).catch(() => null)));
    expect(await fs.readdir(path.join(project.path, 'exports')).catch(() => [])).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'Worker 崩溃（被 SIGKILL）：任务失败，staging 清掉，它启动的 ffmpeg 随进程组一起停下',
    async () => {
      const videoId = await newVideo('崩溃');
      const long = await fixture('long.mp4');
      const { sequenceId } = video(videoId);
      await edit(videoId, [
        { type: 'importAsset', path: long, ref: 'l' },
        { type: 'addItem', sequenceId, asset: { ref: 'l' }, at: at(0), alignment: 'nearest-frame' },
      ]);
      const { jobId } = await client.request('exports.create', { videoId, settings: { kind: 'video', format: 'mp4' } });
      await until(async () => {
        const job = await client.request('exports.get', { jobId });
        return job.progress?.unit === 'frames' && job.progress.done > 0;
      });
      // 这次渲染的 Worker（本进程的子进程、自成进程组）与组里的 ffmpeg。
      const processes = () =>
        execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' })
          .split('\n')
          .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
          .filter((m): m is RegExpMatchArray => m !== null)
          .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4]! }));
      const renderer = processes().find((p) => p.ppid === process.pid && p.command.includes('export-worker') && / render /.test(p.command));
      expect(renderer, '找不到渲染中的 export-worker').toBeDefined();
      expect(renderer!.pgid).toBe(renderer!.pid);
      const children = processes().filter((p) => p.pgid === renderer!.pid && p.pid !== renderer!.pid);
      expect(children.some((p) => p.command.includes('ffmpeg'))).toBe(true);

      const staging = path.join(resolveRuntimeHome({ BAOCUT_HOME: dir }).stagingDir, 'jobs', jobId);
      // 先把 ffmpeg 停住：停住的进程不会因为管道断了自己退出，只有 Runtime 杀掉进程组才收得掉（否则就是孤儿）。
      for (const child of children) process.kill(child.pid, 'SIGSTOP');
      process.kill(renderer!.pid, 'SIGKILL');
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      onTestFinished(() => {
        // 测试失败时也不把停住的进程留在机器上。
        for (const child of children.filter((c) => alive(c.pid))) process.kill(child.pid, 'SIGKILL');
      });
      const failed = await finish(jobId);
      expect(failed.state).toBe('failed');
      expect(failed.error).toMatchObject({ code: 'EXPORT_RENDER_FAILED' });
      expect(JSON.stringify(failed.error)).toContain('SIGKILL');
      // 任务结束时组已经被杀掉：ffmpeg 不再存在（给内核一点时间回收）。
      await until(() => children.every((p) => !alive(p.pid)), 3_000);
      await until(async () => !(await fs.stat(staging).catch(() => null)));
      expect(await fs.readdir(path.join(project.path, 'exports')).catch(() => [])).toEqual([]);
    },
  );

  it.skipIf(process.platform === 'win32')('Worker 在提交之后不见了：任务失败，错误指向 Render Worker 而不是叫人装 ffmpeg', async () => {
    // 预检时跑真的 Worker，跑完把自己删掉：任务开始后再启动它就找不到了（像是构建产物在排队期间被清掉）。
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-worker-gone-'));
    const script = path.join(tmp, 'export-worker');
    await fs.writeFile(script, `#!/bin/sh\n"${worker}" "$@"\nstatus=$?\nrm -f "$0"\nexit $status\n`, { mode: 0o755 });
    const previous = process.env.BAOCUT_EXPORT_WORKER;
    process.env.BAOCUT_EXPORT_WORKER = script;
    onTestFinished(async () => {
      if (previous === undefined) delete process.env.BAOCUT_EXPORT_WORKER;
      else process.env.BAOCUT_EXPORT_WORKER = previous;
      await fs.rm(tmp, { recursive: true, force: true });
    });
    const { videoId } = await cutVideo();
    const { jobId } = await client.request('exports.create', { videoId, settings: { kind: 'video', format: 'mp4' } });
    const failed = await finish(jobId);
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatchObject({ code: 'EXPORT_TOOL_MISSING', details: { missing: 'export-worker' } });
    expect(failed.error!.message).toContain('Render Worker');
    expect(JSON.stringify(failed.error)).toContain('BAOCUT_EXPORT_WORKER');
    expect(JSON.stringify(failed.error)).not.toContain('安装 ffmpeg');
  });

  it('图形与文字：按预览的几何画出来，字体随渲染内核发布（T35）', async () => {
    const videoId = await newVideo('图文');
    const { sequenceId } = video(videoId);
    const track = await overlayTrack(videoId);
    const textTrack = await overlayTrack(videoId);
    const span = { fromFrame: 0, durationFrames: 30 };
    // 位置按画幅（320×180）的百分比：x、y 是框中心，w 是框宽。
    const place = (x: number, y: number, w: number) => ({ x: (x / 320) * 100, y: (y / 180) * 100, w: (w / 320) * 100 });
    await edit(videoId, [
      {
        type: 'insertItems',
        sequenceId,
        items: [
          {
            type: 'shape',
            trackId: track,
            span,
            place: place(60, 90, 80),
            shape: { shape: 'rect', fill: '#ff0000' },
          },
          {
            type: 'text',
            trackId: textTrack,
            span,
            place: place(220, 90, 160),
            text: '你好',
            style: { fontSize: 60, fontColor: '#ffffff' },
          },
        ],
      },
    ]);
    const range = { start: 0, end: 0.5 };
    // 字体随渲染内核发布，没有系统字体的机器也画得出文字。
    const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range } });
    const rate = video(videoId).fps.num / video(videoId).fps.den;
    const frame = frameAt(job.result!.outputs![0]!.path!, 0, rate, 320, 180);
    // 红方块中心在画布 (60, 90)，边长 80；方块外是黑底。
    const [r, g, b] = pixel(frame, 320, 60, 90);
    expect(r > 200 && g < 50 && b < 50, `${[r, g, b]}`).toBe(true);
    expect(pixel(frame, 320, 10, 90)[0]).toBeLessThan(40);
    // 文字框中心在 (220, 90)：框里有亮的笔画，框外仍是黑的。
    let bright = 0;
    for (let y = 60; y < 120; y++) for (let x = 160; x < 280; x++) if (pixel(frame, 320, x, y)[1] > 200) bright++;
    expect(bright).toBeGreaterThan(100);
    expect(pixel(frame, 320, 310, 10)[1]).toBeLessThan(40);
  });

  it('本机字体：内置字体之外的族在本机找到的 face 冻结进快照、画进成片，变了以 FONT_MISSING 失败；预览拿得到同一个 face；找不到的照回退字体画并警告', async () => {
    // 本机字体库只扫这个临时目录（测试钩子，引擎与 Render Worker 启动时带上），不依赖这台机器装了什么字体。
    const fonts = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fonts-'));
    const previous = process.env.BAOCUT_FONT_DIRS;
    process.env.BAOCUT_FONT_DIRS = fonts;
    onTestFinished(async () => {
      if (previous === undefined) delete process.env.BAOCUT_FONT_DIRS;
      else process.env.BAOCUT_FONT_DIRS = previous;
      await fs.rm(fonts, { recursive: true, force: true });
    });
    const videoId = await newVideo('本机字体');
    const { sequenceId } = video(videoId);
    const textTrack = await overlayTrack(videoId);
    // 探针字体 ColrProbe（render-raster 的测试夹具）的「A」是红菱形加蓝三角；回退字体画的是白字。
    await edit(videoId, [
      {
        type: 'insertItems',
        sequenceId,
        items: [
          {
            type: 'text',
            trackId: textTrack,
            span: { fromFrame: 0, durationFrames: 30 },
            place: { x: 50, y: 50, w: 80 },
            text: 'A',
            style: { fontSize: 120, fontColor: '#ffffff', fontFamily: 'ColrProbe' },
          },
        ],
      },
    ]);
    const exported = async () => {
      const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range: { start: 0, end: 0.5 } } });
      const rate = video(videoId).fps.num / video(videoId).fps.den;
      const frame = frameAt(job.result!.outputs![0]!.path!, 0, rate, 320, 180);
      let red = 0;
      let white = 0;
      for (let y = 0; y < 180; y++) {
        for (let x = 0; x < 320; x++) {
          const [r, g, b] = pixel(frame, 320, x, y);
          if (r > 180 && g < 70 && b < 70) red++;
          if (r > 200 && g > 200 && b > 200) white++;
        }
      }
      const notes = (job.warnings ?? []).map((w) => w.detail ?? '').filter((d) => d.includes('字体 "ColrProbe"'));
      return { red, white, notes, job };
    };
    const missing = await exported();
    expect(missing.notes).toHaveLength(1);
    expect(missing.notes[0]).toContain('在当前字体库中不可用');
    expect(missing.red).toBe(0);
    expect(missing.white).toBeGreaterThan(100);
    await fs.copyFile(
      new URL('../../../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf', import.meta.url),
      path.join(fonts, 'probe.ttf'),
    );
    const found = await exported();
    expect(found.notes).toEqual([]);
    // 画的是探针字体的彩色图形，不再是白字（画面小、色度抽样后红色的像素不多）。
    expect(found.white).toBeLessThan(missing.white / 4);
    expect(found.red).toBeGreaterThan(5);
    // 冻结快照记下用到的那个 face：文件、第几个与整个文件的摘要；没找到时记的是回退。
    const probe = await fs.readFile(path.join(fonts, 'probe.ttf'));
    const snapshotOf = async (job: JobRecord) =>
      JSON.parse((await runtime.models.jobs.artifacts.read(job.export!.snapshotArtifactId))!.toString('utf8')) as ExportSnapshot;
    expect((await snapshotOf(missing.job)).fonts).toEqual([{ family: 'ColrProbe', weight: 400, italic: false, fallback: 'not-found' }]);
    expect((await snapshotOf(found.job)).fonts).toEqual([
      {
        family: 'ColrProbe',
        weight: 400,
        italic: false,
        path: path.join(fonts, 'probe.ttf'),
        faceIndex: 0,
        contentHash: `sha256:${createHash('sha256').update(probe).digest('hex')}`,
        byteLength: probe.length,
      },
    ]);
    // 冻结之后字体文件变了：执行时按摘要核对出来，整个任务以 FONT_MISSING 失败，不悄悄换成别的字体。
    if (process.platform !== 'win32') {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-font-changed-'));
      const script = path.join(tmp, 'export-worker');
      const file = path.join(fonts, 'probe.ttf');
      await fs.writeFile(script, `#!/bin/sh\nif [ "$1" = render ]; then printf x >> "${file}"; fi\nexec "${worker}" "$@"\n`, {
        mode: 0o755,
      });
      const previousWorker = process.env.BAOCUT_EXPORT_WORKER;
      process.env.BAOCUT_EXPORT_WORKER = script;
      onTestFinished(async () => {
        if (previousWorker === undefined) delete process.env.BAOCUT_EXPORT_WORKER;
        else process.env.BAOCUT_EXPORT_WORKER = previousWorker;
        await fs.rm(tmp, { recursive: true, force: true });
      });
      const { jobId } = await client.request('exports.create', {
        videoId,
        settings: { kind: 'video', format: 'mp4', range: { start: 0, end: 0.5 } },
      });
      const failed = await finish(jobId);
      expect(failed.state).toBe('failed');
      expect(failed.error).toMatchObject({ code: 'FONT_MISSING', details: { family: 'ColrProbe', reason: 'changed' } });
      expect(failed.error!.message).toContain('字体无法复现');
      await fs.writeFile(file, probe);
    }
    // 预览按 face 要字体：引擎用同一份解析找到同一个文件里的同一个 face，发读取句柄与抽法；找不到的给出原因。
    const resolved = await client.request('fonts.resolve', {
      faces: [
        { family: 'ColrProbe', weight: 400, italic: false },
        { family: 'Nowhere Sans', weight: 700, italic: false },
      ],
    });
    expect(resolved.missing).toEqual([{ family: 'Nowhere Sans', weight: 700, italic: false, reason: 'not-found' }]);
    const [face] = resolved.faces;
    expect([face!.family, face!.file.fileName, face!.faceIndex, face!.fileSize]).toEqual(['ColrProbe', 'probe.ttf', 0, probe.length]);
    // 按区间只取一张表：206，字节与文件里那一段相同。
    const table = face!.tables[0]!;
    const response = await fetch(face!.file.url, { headers: { Range: `bytes=${table.from}-${table.from + table.length - 1}` } });
    expect(response.status).toBe(206);
    expect(Buffer.from(await response.arrayBuffer()).equals(probe.subarray(table.from, table.from + table.length))).toBe(true);
    await expect(client.request('fonts.resolve', { faces: [] })).rejects.toThrow();
  });

  it('按需下载的字体：目录里有、本机没有的族在导出任务里下载、冻结、画进成片；关了自动下载时照回退字体画并说明原因', async () => {
    // 本机字体库是空的临时目录；字体服务是本机的假服务，给的是探针字体 ColrProbe（字体目录是注入的，只有它一个族）。
    const systemFonts = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fonts-'));
    const previous = process.env.BAOCUT_FONT_DIRS;
    process.env.BAOCUT_FONT_DIRS = systemFonts;
    const probe = await fs.readFile(new URL('../../../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf', import.meta.url));
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
      requests.push(req.url!);
      if (req.url!.startsWith('/css2?')) {
        return void res
          .writeHead(200)
          .end(
            "@font-face { font-family: 'ColrProbe'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/colrprobe/v1/a.ttf) format('truetype'); }",
          );
      }
      res.writeHead(200, { 'content-length': probe.length }).end(probe);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    onTestFinished(async () => {
      if (previous === undefined) delete process.env.BAOCUT_FONT_DIRS;
      else process.env.BAOCUT_FONT_DIRS = previous;
      server.closeAllConnections();
      server.close();
      await fs.rm(systemFonts, { recursive: true, force: true });
    });
    await restartWithFontDownloads(origin);
    ({ project } = await client.request('projects.create', { name: '下载字体' }));

    const videoId = await newVideo('下载字体');
    const textTrack = await overlayTrack(videoId);
    await edit(videoId, [
      {
        type: 'insertItems',
        sequenceId: video(videoId).sequenceId,
        items: [
          {
            type: 'text',
            trackId: textTrack,
            span: { fromFrame: 0, durationFrames: 30 },
            place: { x: 50, y: 50, w: 80 },
            text: 'A',
            style: { fontSize: 120, fontColor: '#ffffff', fontFamily: 'ColrProbe' },
          },
        ],
      },
    ]);
    const exported = async () => {
      const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range: { start: 0, end: 0.5 } } });
      const rate = video(videoId).fps.num / video(videoId).fps.den;
      const frame = frameAt(job.result!.outputs![0]!.path!, 0, rate, 320, 180);
      let red = 0;
      for (let y = 0; y < 180; y++) {
        for (let x = 0; x < 320; x++) {
          const [r, g, b] = pixel(frame, 320, x, y);
          if (r > 180 && g < 70 && b < 70) red++;
        }
      }
      const snapshot = JSON.parse(
        (await runtime.models.jobs.artifacts.read(job.export!.snapshotArtifactId))!.toString('utf8'),
      ) as ExportSnapshot;
      const warnings = (job.warnings ?? []).filter((w) => w.code === 'FONT_NOT_DOWNLOADED' || w.detail?.includes('ColrProbe'));
      return { red, job, snapshot, warnings };
    };
    // 视频用到的字体：Render Worker 排一遍字清点（随内核的族也在，带回退族）；不带 download 时不下载。
    const before = await client.request('fonts.usage', { videoId });
    expect(before.families.map((f) => [f.family, f.status.state, f.fallback])).toEqual([['ColrProbe', 'downloadable', 'Noto Sans SC']]);
    expect(requests).toEqual([]);
    // 第一次：冻结时还没下载，快照记「要下载」；任务里下载好、冻结进渲染，画的是探针字体。
    const first = await exported();
    expect(first.snapshot.fonts).toEqual([{ family: 'ColrProbe', weight: 400, italic: false, download: 'google-fonts' }]);
    expect(first.warnings).toEqual([]);
    expect(first.red).toBeGreaterThan(5);
    expect(requests).toEqual(['/css2?family=ColrProbe:wght@400', '/s/colrprobe/v1/a.ttf']);
    const { faces } = await client.request('fonts.downloaded', {});
    expect(faces).toMatchObject([{ family: 'ColrProbe', weight: 400, italic: false, licence: 'OFL-1.1', sizeBytes: probe.length }]);
    // 第二次：缓存里有了，冻结时就记下文件（`source: 'downloaded'`），不再请求。
    const second = await exported();
    expect(second.snapshot.fonts).toEqual([
      {
        family: 'ColrProbe',
        weight: 400,
        italic: false,
        path: expect.stringContaining(path.join(dir, 'fonts', 'files')),
        faceIndex: 0,
        contentHash: `sha256:${createHash('sha256').update(probe).digest('hex')}`,
        byteLength: probe.length,
        source: 'downloaded',
      },
    ]);
    expect(second.red).toBeGreaterThan(5);
    expect(requests).toHaveLength(2);
    const resolved = await client.request('fonts.resolve', { faces: [{ family: 'ColrProbe', weight: 400, italic: false }] });
    expect(resolved.faces.map((f) => [f.family, f.source])).toEqual([['ColrProbe', 'downloaded']]);
    // 关了自动下载、清空缓存：照回退字体画，警告说明为什么没下载。
    await client.request('settings.set', { values: { 'fonts.autoDownload': false } });
    expect(await client.request('fonts.clear', {})).toMatchObject({ removed: [{ family: 'ColrProbe' }], kept: [] });
    const off = await exported();
    expect(off.snapshot.fonts).toEqual([{ family: 'ColrProbe', weight: 400, italic: false, fallback: 'not-downloaded' }]);
    expect(off.red).toBe(0);
    const notDownloaded = off.warnings.find((w) => w.code === 'FONT_NOT_DOWNLOADED');
    expect(notDownloaded?.detail).toContain('自动下载字体已关闭');
    expect(notDownloaded?.font).toEqual({
      family: 'ColrProbe',
      weight: 400,
      italic: false,
      fallback: 'Noto Sans SC',
      reason: expect.stringContaining('自动下载字体已关闭'),
    });
    // 视频用到的字体（Render Worker 清点）：关着自动下载时 download 也不下载，状态是可下载、由回退族代替。
    const usage = await client.request('fonts.usage', { videoId, download: true });
    expect(usage).toEqual({
      fallback: 'Noto Sans SC',
      started: [],
      families: [
        {
          family: 'ColrProbe',
          faces: [{ weight: 400, italic: false }],
          status: expect.objectContaining({ state: 'downloadable' }),
          fallback: 'Noto Sans SC',
        },
      ],
    });
    expect(requests).toHaveLength(2);
  });

  it('导出还在等字体下载时取消：任务记为取消，下载停下、不留半个文件，族不卡在下载中，之后可以再下载', async () => {
    const systemFonts = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fonts-'));
    const previous = process.env.BAOCUT_FONT_DIRS;
    process.env.BAOCUT_FONT_DIRS = systemFonts;
    const probe = await fs.readFile(new URL('../../../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf', import.meta.url));
    // 慢的字体文件：每 100 毫秒一小段（`slow` 关掉之后一次给完）。
    const state = { slow: true, files: 0 };
    const server = http.createServer((req, res) => {
      if (req.url!.startsWith('/css2?')) {
        return void res
          .writeHead(200)
          .end(
            "@font-face { font-family: 'ColrProbe'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/colrprobe/v1/a.ttf) format('truetype'); }",
          );
      }
      state.files++;
      res.writeHead(200, { 'content-length': probe.length });
      if (!state.slow) return void res.end(probe);
      let sent = 0;
      const timer = setInterval(() => {
        if (res.destroyed || sent >= probe.length) {
          clearInterval(timer);
          if (!res.destroyed) res.end();
          return;
        }
        res.write(probe.subarray(sent, sent + 64));
        sent += 64;
      }, 100);
      res.on('close', () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    onTestFinished(async () => {
      if (previous === undefined) delete process.env.BAOCUT_FONT_DIRS;
      else process.env.BAOCUT_FONT_DIRS = previous;
      server.closeAllConnections();
      server.close();
      await fs.rm(systemFonts, { recursive: true, force: true });
    });
    await restartWithFontDownloads(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    ({ project } = await client.request('projects.create', { name: '取消等字体的导出' }));

    const videoId = await newVideo('取消等字体的导出');
    const textTrack = await overlayTrack(videoId);
    await edit(videoId, [
      {
        type: 'insertItems',
        sequenceId: video(videoId).sequenceId,
        items: [
          {
            type: 'text',
            trackId: textTrack,
            span: { fromFrame: 0, durationFrames: 30 },
            place: { x: 50, y: 50, w: 80 },
            text: 'A',
            style: { fontSize: 120, fontColor: '#ffffff', fontFamily: 'ColrProbe' },
          },
        ],
      },
    ]);
    const status = async () => (await client.request('fonts.catalogue', { families: ['ColrProbe'] })).families[0]!;
    const { jobId } = await client.request('exports.create', {
      videoId,
      settings: { kind: 'video', format: 'mp4', range: { start: 0, end: 0.5 } },
    });
    // 导出停在下载字体的阶段、已经收到字节：这个族是下载中，下载记在导出任务上。
    await until(async () => {
      const job = await client.request('exports.get', { jobId });
      return job.phase === 'downloading' && job.progress?.unit === 'bytes' && job.progress.done > 0;
    });
    expect(await status()).toMatchObject({ state: 'downloading', job: { jobId } });
    const staging = path.join(dir, 'fonts', '.staging');
    expect(await fs.readdir(staging)).toHaveLength(1);

    await client.request('jobs.cancel', { jobId });
    const cancelled = await finish(jobId);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.result).toBeNull();
    // 下载停下：临时文件删掉，缓存里没有，族不再是下载中（记为取消，可以重试）。
    await until(async () => (await fs.readdir(staging)).length === 0);
    expect((await client.request('fonts.downloaded', {})).faces).toEqual([]);
    expect(await status()).toMatchObject({ state: 'failed', job: null, error: { code: 'CANCELLED' } });
    expect(await fs.readdir(path.join(project.path, 'exports')).catch(() => [])).toEqual([]);

    // 再下载一次：从头下，下完进缓存。
    state.slow = false;
    const again = await client.request('fonts.download', { family: 'ColrProbe' });
    expect(again.jobId).not.toBeNull();
    expect(await runtime.models.jobs.settled(again.jobId!)).toBe('completed');
    expect(state.files).toBe(2);
    expect((await client.request('fonts.downloaded', {})).faces).toMatchObject([{ family: 'ColrProbe', sizeBytes: probe.length }]);
    expect(await status()).toMatchObject({ state: 'downloaded', job: null, error: null });
  });

  it('只给字幕用的字体：字幕不烧进画面时导出不下载它，烧进画面时下载', async () => {
    const systemFonts = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-fonts-'));
    const previous = process.env.BAOCUT_FONT_DIRS;
    process.env.BAOCUT_FONT_DIRS = systemFonts;
    const probe = await fs.readFile(new URL('../../../../crates/render-raster/tests/fixtures/fonts/ColrProbe.ttf', import.meta.url));
    let files = 0;
    const server = http.createServer((req, res) => {
      if (req.url!.startsWith('/css2?')) {
        return void res
          .writeHead(200)
          .end(
            "@font-face { font-family: 'ColrProbe'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/colrprobe/v1/a.ttf) format('truetype'); }",
          );
      }
      files++;
      res.writeHead(200, { 'content-length': probe.length }).end(probe);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    onTestFinished(async () => {
      if (previous === undefined) delete process.env.BAOCUT_FONT_DIRS;
      else process.env.BAOCUT_FONT_DIRS = previous;
      server.closeAllConnections();
      server.close();
      await fs.rm(systemFonts, { recursive: true, force: true });
    });
    await restartWithFontDownloads(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    ({ project } = await client.request('projects.create', { name: '字幕字体' }));

    // 字幕样式用 ColrProbe；画面上没有别的文字。
    const videoId = await newVideo('字幕字体');
    const { sequenceId } = video(videoId);
    const caption = {
      schema: 'baocut.caption/1',
      clock: 'sequence',
      timescale: 1000,
      cues: [{ id: 'c1', start: 0, end: 2000, text: 'A' }],
    };
    await edit(videoId, [
      { type: 'putDocument', ref: 'cap', kind: 'caption', name: '字幕', language: 'en', body: caption },
      {
        type: 'putDocument',
        ref: 'style',
        kind: 'caption-style',
        name: '字幕样式',
        body: { schema: 'baocut.legacy-studio-style/0.1', style: { fontFamily: 'ColrProbe' } },
      },
      { type: 'addTrack', kind: 'subtitle', ref: 'subs' },
      {
        type: 'insertItems',
        sequenceId,
        items: [{ type: 'caption', trackRef: 'subs', documentRef: 'cap', span: { fromFrame: 0, durationFrames: 60 } }],
      },
    ]);
    const itemId = video(videoId).items.find((i) => i.type === 'caption')!.id;
    const styleId = Object.values(runtime.videos.mirror(videoId)!.video.documents).find((d) => d.kind === 'caption-style')!.id;
    await edit(videoId, [{ type: 'setCaptionStyle', sequenceId, itemId, styleDocument: { documentId: styleId } }]);
    expect((await client.request('fonts.usage', { videoId, burnCaptions: false })).families).toEqual([]);

    const range = { start: 0, end: 0.5 };
    await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range, burnCaptions: false } });
    expect(files).toBe(0);
    expect((await client.request('fonts.downloaded', {})).faces).toEqual([]);

    await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range } });
    expect(files).toBe(1);
    expect((await client.request('fonts.downloaded', {})).faces).toMatchObject([{ family: 'ColrProbe' }]);
  });

  it('视频用到的字体只看文字与字幕：没有素材、素材文件不见了或变了，fonts.usage 照样给出清单', async () => {
    const videoId = await newVideo('缺素材');
    const textTrack = await overlayTrack(videoId);
    await edit(videoId, [
      {
        type: 'insertItems',
        sequenceId: video(videoId).sequenceId,
        items: [
          {
            type: 'text',
            trackId: textTrack,
            span: { fromFrame: 0, durationFrames: 30 },
            place: { x: 50, y: 50, w: 80 },
            text: 'A',
            style: { fontSize: 120, fontColor: '#ffffff', fontFamily: 'Noto Sans SC' },
          },
        ],
      },
    ]);
    const families = async () => (await client.request('fonts.usage', { videoId })).families.map((f) => [f.family, f.fallback]);
    // 一个素材都没有：只有文字。
    expect(Object.keys(runtime.videos.mirror(videoId)!.video.assets)).toEqual([]);
    const textOnly = await families();
    expect(textOnly).toEqual([['Noto Sans SC', null]]);
    // 链接的视频与图片素材放进序列，再把文件删掉、改掉：导出会以 ASSET_MISSING / ASSET_CHANGED 拒绝，清点字体不受影响。
    const red = await fixture('red.mp4');
    const green = await fixture('green.png');
    const { sequenceId } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: red, ref: 'r' },
      { type: 'importAsset', path: green, ref: 'g' },
      { type: 'addItem', sequenceId, asset: { ref: 'r' }, at: at(0), alignment: 'nearest-frame' },
      { type: 'addItem', sequenceId, asset: { ref: 'g' }, trackId: textTrack, at: at(1), alignment: 'nearest-frame' },
    ]);
    expect(await families()).toEqual(textOnly);
    await fs.rm(red);
    await fs.writeFile(green, 'changed');
    const refused = await rejection(client.request('exports.create', { videoId, settings: { kind: 'video', format: 'mp4' } }));
    expect(['ASSET_MISSING', 'ASSET_CHANGED']).toContain((refused.details as { code?: string }).code);
    expect(await families()).toEqual(textOnly);
  });

  it('字幕：缺省烧进画面（锚点在画布 86% 高处），burnCaptions: false 时不画', async () => {
    const videoId = await newVideo('字幕');
    const { sequenceId } = video(videoId);
    const caption = {
      schema: 'baocut.caption/1',
      clock: 'sequence',
      timescale: 1000,
      cues: [{ id: 'c1', start: 0, end: 2000, text: '你好，世界。' }],
    };
    await edit(videoId, [
      { type: 'putDocument', ref: 'cap', kind: 'caption', name: '字幕', language: 'zh', body: caption },
      { type: 'addTrack', kind: 'subtitle', ref: 'subs' },
      {
        type: 'insertItems',
        sequenceId,
        items: [{ type: 'caption', trackRef: 'subs', documentRef: 'cap', span: { fromFrame: 0, durationFrames: 60 } }],
      },
    ]);
    const range = { start: 0, end: 0.5 };
    const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range } });
    const rate = video(videoId).fps.num / video(videoId).fps.den;
    const bright = (file: string) => {
      const frame = frameAt(file, 0, rate, 320, 180);
      let count = 0;
      for (let y = 130; y < 180; y++) for (let x = 0; x < 320; x++) if (pixel(frame, 320, x, y)[1] > 128) count++;
      return count;
    };
    // 字号 30（540 短边）在 180 高的画布上是 10 像素；字在 y≈155 附近。
    expect(bright(job.result!.outputs![0]!.path!)).toBeGreaterThan(20);
    const off = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range, burnCaptions: false } });
    expect(bright(off.result!.outputs![0]!.path!)).toBe(0);
    // 导出面板的字体清点跟着同一个选择：字幕不烧进画面时，只给字幕用的族不在清单里。
    const families = async (burnCaptions?: boolean) =>
      (await client.request('fonts.usage', { videoId, ...(burnCaptions === undefined ? {} : { burnCaptions }) })).families.map(
        (f) => f.family,
      );
    const burned = await families();
    expect(burned.length).toBeGreaterThan(0);
    expect(await families(true)).toEqual(burned);
    expect(await families(false)).toEqual([]);
  });

  it('SVG 图片按矢量光栅画进成片', async () => {
    const videoId = await newVideo('带矢量图');
    const red = await fixture('red.mp4');
    const svg = await fixture('logo.svg');
    const { sequenceId } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: red, ref: 'r' },
      { type: 'addItem', sequenceId, asset: { ref: 'r' }, at: at(0), alignment: 'nearest-frame' },
    ]);
    const track = await overlayTrack(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: svg, ref: 's' },
      { type: 'addItem', sequenceId, asset: { ref: 's' }, trackId: track, at: at(0), alignment: 'nearest-frame' },
    ]);
    const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range: { start: 0, end: 1 } } });
    const rate = video(videoId).fps.num / video(videoId).fps.den;
    const [r, g, b] = pixel(frameAt(job.result!.outputs![0]!.path!, Math.round(0.5 * rate), rate, 320, 180), 320, 160, 90);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeLessThan(80);
  });

  it('声波：导出从冻结的声音文件算频谱，跟着声音动；范围外的声音也冻结', async () => {
    const videoId = await newVideo('声波');
    const tone = await fixture('tone.wav');
    const hum = await fixture('hum.wav');
    const { sequenceId } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: tone, ref: 't' },
      { type: 'importAsset', path: hum, ref: 'h' },
      { type: 'addItem', sequenceId, asset: { ref: 't' }, at: at(0), alignment: 'nearest-frame' },
      // 嗡声在导出范围之外：声波听整条序列，它的素材也要冻结、也要算频谱。
      { type: 'addItem', sequenceId, asset: { ref: 'h' }, at: at(4), alignment: 'nearest-frame' },
    ]);
    const track = await overlayTrack(videoId);
    await edit(videoId, [
      {
        type: 'insertItems',
        sequenceId,
        items: [
          {
            type: 'visualizer',
            trackId: track,
            span: { fromFrame: 0, durationFrames: 150 },
            place: { x: 50, y: 50, w: 80 },
            visualizer: { style: 'bars', mainColor: '#ffffff', smoothing: 0 },
          },
        ],
      },
    ]);
    const viz = video(videoId).items.find((i) => i.type === 'visualizer')!;
    const job = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range: { start: 0.5, end: 1.8 } } });
    expect(job.warnings.filter((w) => w.detail?.includes(viz.id))).toEqual([]);
    const rate = video(videoId).fps.num / video(videoId).fps.den;
    const file = job.result!.outputs![0]!.path!;
    const bright = (frame: Buffer) => {
      let n = 0;
      for (let i = 0; i < frame.length; i += 3) if (frame[i]! > 200 && frame[i + 1]! > 200 && frame[i + 2]! > 200) n++;
      return n;
    };
    // 输出第 0 帧是序列的 0.5 秒（静音），第 30 帧是 1.5 秒（300 Hz 在响）。
    const quiet = bright(frameAt(file, 0, rate, 320, 180));
    const loud = bright(frameAt(file, Math.round(1.0 * rate), rate, 320, 180));
    expect(loud, `${quiet} → ${loud}`).toBeGreaterThan(quiet + 200);
  }, 60_000);

  it('画不出来的内容：默认拒绝并逐项列出，不建任务；skip 时跳过并逐项警告（T35）', async () => {
    const videoId = await newVideo('带坏矢量图');
    const red = await fixture('red.mp4');
    const svg = await fixture('broken.svg');
    const { sequenceId } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: red, ref: 'r' },
      { type: 'addItem', sequenceId, asset: { ref: 'r' }, at: at(0), alignment: 'nearest-frame' },
    ]);
    const track = await overlayTrack(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: svg, ref: 's' },
      { type: 'addItem', sequenceId, asset: { ref: 's' }, trackId: track, at: at(0), alignment: 'nearest-frame' },
    ]);
    const svgItem = video(videoId).items.find((i) => i.type === 'image')!;
    const range = { start: 0, end: 1 };

    const refused = await rejection(client.request('exports.create', { videoId, settings: { kind: 'video', format: 'mp4', range } }));
    expect(refused.details).toMatchObject({
      code: 'EXPORT_UNSUPPORTED_CONTENT',
      items: [{ itemId: svgItem.id, scope: 'asset', layerKind: 'image', reason: 'asset-undecodable' }],
    });
    expect((await client.request('exports.list', { videoId })).jobs).toEqual([]);

    const skipped = await exportOnce({ videoId, settings: { kind: 'video', format: 'mp4', range, onUnsupported: 'skip' } });
    expect(skipped.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'EXPORT_CONTENT_SKIPPED', detail: expect.stringContaining(svgItem.id) })]),
    );
    const rate = video(videoId).fps.num / video(videoId).fps.den;
    const frame = frameAt(skipped.result!.outputs![0]!.path!, Math.round(0.5 * rate), rate, 320, 180);
    expect(pixel(frame, 320, 160, 90)[0]).toBeGreaterThan(200);
  });
});
