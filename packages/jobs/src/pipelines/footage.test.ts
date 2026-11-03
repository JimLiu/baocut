import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FootageOp, FootageSummary, JobRecord } from '@baocut/protocol';
import { FOOTAGE_PIPELINE_NAMES } from '@baocut/protocol';
import type { JobManager } from '../job-manager.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import { ffmpegFilters, probeMedia, probeVideoDetails } from './ffmpeg.ts';
import { FrameEncoder } from './footage-frames.ts';
import { footagePipeline, footageStabilizer, footageTools, inspectFootageInput, outputName, parseFootageParams, withFrameProgress } from './footage.ts';
import { PipelineRunner } from './pipeline-runner.ts';
import type { UpscaleTool } from './upscale-image.ts';

/**
 * 素材处理（架构设计 §7.9）：真实的 ffmpeg 处理测试里现做的短片，Real-ESRGAN、RIFE 与 `matte` Worker 换成假的（同样的目录与
 * JSON 行合同）。去抖按这台 ffmpeg 编了什么走 vid.stab 或 deshake；没有 ffmpeg 时跳过。
 */

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!hasFfmpeg) console.warn('跳过素材处理的测试：没有 ffmpeg');

const ffmpeg = async () => ({ command: 'ffmpeg', env: process.env });
const ffprobe = async () => ({ command: 'ffprobe', env: process.env });

/** 假 Real-ESRGAN：目录里的每张图原样抄到输出目录（尺寸由编码端缩放），记下参数。 */
const FAKE_UPSCALER = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
for (const name of fs.readdirSync(get('-i'))) fs.copyFileSync(path.join(get('-i'), name), path.join(get('-o'), name));
`;

/**
 * 假 RIFE：与真的同样的输出次序。n 张输出，第 i 张取 floor(i × 输入数 ÷ n) 张输入（真的 RIFE 在 ÷ 不尽时才插值，这里抄前一张），
 * 所以倍数整除时第 倍数 × k 张就是第 k 张输入，最后一张输入之后是它的重复。
 */
const FAKE_RIFE = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
const inputs = fs.readdirSync(get('-i')).sort();
const n = Number(get('-n'));
for (let i = 0; i < n; i++) {
  const from = inputs[Math.floor((i * inputs.length) / n)];
  fs.copyFileSync(path.join(get('-i'), from), path.join(get('-o'), String(i + 1).padStart(8, '0') + '.png'));
}
`;

/** 假 matte：JSON 行；把输入解成 RGBA、alpha 一半，由 ffmpeg 写 PNG。 */
const FAKE_MATTE = `#!/usr/bin/env node
const { execFileSync } = require('node:child_process');
const readline = require('node:readline');
console.log(JSON.stringify({ event: 'ready', params: { loadMs: 1 } }));
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, params } = JSON.parse(line);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', params.input, '-vf', 'format=rgba,colorchannelmixer=aa=0.5', '-frames:v', '1', '-update', '1', params.output]);
  console.log(JSON.stringify({ id, result: { width: 160, height: 90, coverage: process.env.FAKE_COVERAGE ? Number(process.env.FAKE_COVERAGE) : 0.25, ms: 1 } }));
});
`;

describe('素材处理的参数', () => {
  it('每种处理补上自己的默认值', () => {
    expect(parseFootageParams('stabilize', { inputs: ['/a.mp4'] })).toEqual({ inputs: ['/a.mp4'], strength: 'medium' });
    expect(parseFootageParams('upscale', { inputs: ['/a.mp4'] })).toEqual({ inputs: ['/a.mp4'], scale: 2, model: 'video' });
    expect(parseFootageParams('interpolate', { inputs: ['/a.mp4'], start: 1, end: 2 })).toEqual({ inputs: ['/a.mp4'], start: 1, end: 2, factor: 2, mode: 'slowmo' });
    expect(parseFootageParams('match-color', { inputs: ['/a.mp4'], reference: '/r.png' })).toEqual({ inputs: ['/a.mp4'], reference: '/r.png', method: 'hm-mkl-hm', amount: 1 });
    expect(parseFootageParams('remove-background', { inputs: ['/a.mp4'] })).toEqual({ inputs: ['/a.mp4'], matteModel: 'fast', temporal: 0.3 });
  });

  it.each<[FootageOp, Record<string, unknown>]>([
    ['stabilize', { inputs: ['a.mp4'] }],
    ['stabilize', { inputs: [] }],
    ['stabilize', { inputs: ['/a.mp4'], outDir: 'rel' }],
    ['stabilize', { inputs: ['/a.mp4'], extra: 1 }],
    ['stabilize', { inputs: ['/a.mp4'], scale: 2 }],
    ['stabilize', { inputs: ['/a.mp4'], strength: 'max' }],
    ['stabilize', { inputs: ['/a.mp4'], start: 3, end: 2 }],
    ['stabilize', { inputs: [{ entryId: 'ent_1' }] }],
    ['upscale', { inputs: ['/a.mp4'], scale: 8 }],
    ['upscale', { inputs: ['/a.mp4'], factor: 2 }],
    ['interpolate', { inputs: ['/a.mp4'], factor: 5 }],
    ['interpolate', { inputs: ['/a.mp4'], strength: 'low' }],
    ['match-color', { inputs: ['/a.mp4'] }],
    ['match-color', { inputs: ['/a.mp4'], reference: 'rel.png' }],
    ['match-color', { inputs: ['/a.mp4'], reference: '/r.png', amount: 2 }],
    ['remove-background', { inputs: ['/a.mp4'], temporal: 1 }],
    ['remove-background', { inputs: ['/a.mp4'], matteModel: 'huge' }],
  ])('%s 拒绝 %j', (op, raw) => {
    expect(() => parseFootageParams(op, raw)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
  });

  it('输出的名字', () => {
    const name = (op: FootageOp, params: Record<string, unknown>, image = false) => outputName(op, { inputs: [], ...params }, image);
    expect(name('stabilize', {})).toMatchObject({ suffix: 'stabilized', ext: '.mp4' });
    expect(name('upscale', { scale: 3 })).toMatchObject({ suffix: 'upscaled-3x', ext: '.mp4' });
    expect(name('interpolate', { factor: 4, mode: 'slowmo' })).toMatchObject({ suffix: 'slowmo-4x', ext: '.mp4' });
    expect(name('interpolate', { factor: 2, mode: 'smooth' })).toMatchObject({ suffix: 'smooth-2x', ext: '.mp4' });
    expect(name('match-color', {}, true)).toMatchObject({ suffix: 'color-matched', ext: '.png', mediaType: 'image/png' });
    expect(name('remove-background', {})).toMatchObject({ suffix: 'cutout', ext: '.mov', mediaType: 'video/quicktime' });
    expect(name('remove-background', {}, true)).toMatchObject({ ext: '.png' });
  });

  it('每种处理要的受管工具', () => {
    expect(footageTools('stabilize')).toEqual([]);
    expect(footageTools('match-color')).toEqual([]);
    expect(footageTools('upscale')).toEqual(['realesrgan-ncnn-vulkan']);
    expect(footageTools('interpolate')).toEqual(['rife-ncnn-vulkan']);
    expect(footageTools('remove-background')).toEqual(['matte-models']);
    expect(footageTools('remove-background', 'general')).toEqual(['matte-models-isnet']);
  });
});

describe.skipIf(!hasFfmpeg || process.platform === 'win32')('素材处理（真实的 ffmpeg，假的外部工具）', () => {
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let log: string;
  let tools: Record<string, UpscaleTool>;

  /** 现做一段 1 秒、10 fps、160×90 的片子，带声音。 */
  async function clip(name: string, lavfi = 'testsrc2=size=160x90:rate=10:duration=1', audio = true): Promise<string> {
    const file = path.join(dir, 'in', name);
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', lavfi],
      ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac'] : []),
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', file],
    ]);
    return file;
  }

  async function run(op: FootageOp, params: Record<string, unknown>): Promise<JobRecord> {
    const { jobId } = await runner.start({ pipeline: FOOTAGE_PIPELINE_NAMES[op], params }, { kind: 'connection', id: 'c' });
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  const summaryOf = (record: JobRecord) => record.pipeline!.summary as unknown as FootageSummary;
  const calls = async () =>
    (await fs.readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
  const frameCount = (file: string) =>
    Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().replace(/,$/, ''));

  /** 一帧的平均 RGB（0–255）。 */
  function meanColor(file: string): [number, number, number] {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=1:1:flags=area,format=rgb24', '-f', 'rawvideo', 'pipe:1']);
    return [raw[0]!, raw[1]!, raw[2]!];
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-footage-'));
    await fs.mkdir(path.join(dir, 'in'));
    await fs.mkdir(path.join(dir, 'bin', 'models'), { recursive: true });
    await fs.mkdir(path.join(dir, 'weights'), { recursive: true });
    log = path.join(dir, 'calls.log');
    const esrgan = path.join(dir, 'bin', 'fake-esrgan.cjs');
    const rife = path.join(dir, 'bin', 'fake-rife.cjs');
    const matte = path.join(dir, 'bin', 'fake-matte.cjs');
    await fs.writeFile(esrgan, FAKE_UPSCALER);
    await fs.writeFile(rife, FAKE_RIFE);
    await fs.writeFile(matte, FAKE_MATTE, { mode: 0o755 });
    const env = { ...process.env, FAKE_LOG: log };
    tools = {
      'realesrgan-ncnn-vulkan': { command: process.execPath, args: [esrgan], version: 'v0.2.5.0', env, modelsDir: path.join(dir, 'bin', 'models') },
      'rife-ncnn-vulkan': { command: process.execPath, args: [rife], version: '20221029', env, modelsDir: path.join(dir, 'bin') },
      'matte-models': { command: path.join(dir, 'weights'), version: 'v0.0.0', env },
      'matte-models-isnet': { command: path.join(dir, 'weights'), version: 'v0.0.0', env },
    };
    jobs = testJobManager(path.join(dir, 'home'));
    await jobs.open();
    const deps = {
      ffmpeg,
      ffprobe,
      tool: async (name: string) => tools[name]!,
      matteWorker: () => matte,
      saveDirectory: () => path.join(dir, 'saved'),
    };
    runner = new PipelineRunner({
      jobs,
      stagingDir: path.join(dir, 'home', 'staging'),
      definitions: (['stabilize', 'upscale', 'interpolate', 'match-color', 'remove-background'] as const).map((op) => footagePipeline(op, deps)),
    });
    await runner.open();
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('去抖：按 ffmpeg 编了什么选引擎，deshake 时提醒；声音与时长都在', async () => {
    const source = await clip('walk.mp4');
    const record = await run('stabilize', { inputs: [source], strength: 'low' });
    expect(record.state).toBe('completed');
    const summary = summaryOf(record);
    const vidstab = (await ffmpegFilters(ffmpeg)).has('vidstabdetect');
    expect(summary.executor.engine).toBe(vidstab ? 'vidstab' : 'deshake');
    expect(summary.warnings.some((w) => w.includes('libvidstab'))).toBe(!vidstab);
    expect(summary.files).toEqual([path.join(dir, 'saved', 'walk-stabilized.mp4')]);
    const media = await probeMedia(ffprobe, summary.files[0]!);
    expect(media.video).toMatchObject({ width: 160, height: 90, codec: 'h264' });
    expect(media.audio?.codec).toBe('aac');
    expect(media.durationSec).toBeGreaterThan(0.9);
  });

  it('超分：逐批过工具，声音照搬，标 BT.709；只处理给的区间', async () => {
    const source = await clip('old.mp4', 'testsrc2=size=160x90:rate=10:duration=6');
    const record = await run('upscale', { inputs: [source], scale: 3, model: 'video', start: 1, end: 6 });
    expect(record).toMatchObject({ state: 'completed', providerId: 'realesrgan-ncnn-vulkan', modelId: 'realesr-animevideov3@v0.2.5.0' });
    const summary = summaryOf(record);
    expect(summary.items[0]).toMatchObject({ width: 160, height: 90, outWidth: 480, outHeight: 270 });
    const file = path.join(dir, 'saved', 'old-upscaled-3x.mp4');
    expect(summary.files).toEqual([file]);
    expect(frameCount(file)).toBe(50);
    expect((await probeMedia(ffprobe, file)).video).toMatchObject({ width: 480, height: 270 });
    expect(await probeVideoDetails(ffprobe, file)).toMatchObject({ space: 'bt709', transfer: 'bt709' });
    // 50 帧、一批 48 帧：两批；给的是模型的原生倍数与权重。
    const made = await calls();
    expect(made).toHaveLength(2);
    expect(made[0]).toEqual(expect.arrayContaining(['-n', 'realesr-animevideov3', '-s', '3', '-m', path.join(dir, 'bin', 'models')]));
  });

  it('超分：模型没有这个倍数时放大到原生倍数，再由编码端缩到目标尺寸', async () => {
    const source = await clip('photo.mp4');
    const record = await run('upscale', { inputs: [source], scale: 2, model: 'photo' });
    expect(record.state).toBe('completed');
    expect((await calls())[0]).toEqual(expect.arrayContaining(['-n', 'realesrgan-x4plus', '-s', '4']));
    expect((await probeMedia(ffprobe, summaryOf(record).files[0]!)).video).toMatchObject({ width: 320, height: 180 });
  });

  it('工具失败：任务失败，带工具的说明，不留下输出', async () => {
    const broken = path.join(dir, 'bin', 'broken.cjs');
    await fs.writeFile(broken, 'console.error("vkCreateInstance failed -9"); process.exit(255);');
    tools['realesrgan-ncnn-vulkan'] = { command: process.execPath, args: [broken], version: 'x', modelsDir: dir };
    const source = await clip('bad.mp4');
    const record = await run('upscale', { inputs: [source] });
    expect(record.state).toBe('failed');
    expect(record.error).toMatchObject({ code: 'FOOTAGE_TOOL_FAILED' });
    expect(record.error!.message).toContain('vkCreateInstance failed -9');
    expect(await fs.stat(path.join(dir, 'saved', 'bad-upscaled-2x.mp4')).catch(() => null)).toBeNull();
  });

  it('慢动作：跨批接得上，(N − 1) × 倍数 + 1 帧，帧率不变，不带声音', async () => {
    // 30 帧：一批 24 帧，第二批从上一批的最后一张接起。
    const source = await clip('jump.mp4', 'testsrc2=size=160x90:rate=10:duration=3');
    const record = await run('interpolate', { inputs: [source], factor: 4, mode: 'slowmo' });
    expect(record).toMatchObject({ state: 'completed', providerId: 'rife-ncnn-vulkan', modelId: 'rife-v4.6@20221029' });
    const file = path.join(dir, 'saved', 'jump-slowmo-4x.mp4');
    expect(summaryOf(record).files).toEqual([file]);
    expect(frameCount(file)).toBe(29 * 4 + 1);
    const media = await probeMedia(ffprobe, file);
    expect(media.audio).toBeNull();
    expect(media.video!.frameRate).toBe('10/1');
    expect(media.durationSec).toBeCloseTo((29 * 4 + 1) / 10, 1);
    const made = await calls();
    expect(made.map((args) => args[args.indexOf('-n') + 1])).toEqual([String(24 * 4), String(7 * 4)]);
    expect(made[0]).toEqual(expect.arrayContaining(['-m', path.join(dir, 'bin', 'rife-v4.6'), '-f', '%08d.png']));
    expect(summaryOf(record).warnings).toHaveLength(2);
    expect(summaryOf(record).warningRefs?.map((r) => r.key)).toEqual(['jobsFootage.interpolateCuts', 'jobsFootage.slowmoNoAudio']);
  });

  it('提高帧率：时长不变，帧率乘倍数，带声音', async () => {
    const source = await clip('smooth.mp4');
    const record = await run('interpolate', { inputs: [source], factor: 2, mode: 'smooth' });
    expect(record.state).toBe('completed');
    const file = path.join(dir, 'saved', 'smooth-smooth-2x.mp4');
    expect(frameCount(file)).toBe(9 * 2 + 1);
    const media = await probeMedia(ffprobe, file);
    expect(media.video!.frameRate).toBe('20/1');
    expect(media.audio?.codec).toBe('aac');
    expect(summaryOf(record).warnings).toHaveLength(1);
  });

  it('对齐颜色：红色的素材对齐到蓝色的参考，视频与图片都收；amount 0 不变', async () => {
    const red = await clip('red.mp4', 'color=c=0xc03020:size=160x90:rate=10:duration=1', false);
    const blue = path.join(dir, 'in', 'blue.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x2040c0:size=64x64', '-frames:v', '1', '-update', '1', blue]);
    const still = path.join(dir, 'in', 'still.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xc03020:size=64x64', '-frames:v', '1', '-update', '1', still]);
    const record = await run('match-color', { inputs: [red, still], reference: blue, method: 'mkl' });
    expect(record.state).toBe('completed');
    const summary = summaryOf(record);
    expect(summary.executor).toMatchObject({ engine: 'lut3d', weights: 'mkl' });
    expect(summary.files).toEqual([path.join(dir, 'saved', 'red-color-matched.mp4'), path.join(dir, 'saved', 'still-color-matched.png')]);
    for (const file of summary.files) {
      const [r, g, b] = meanColor(file);
      expect(Math.abs(r - 0x20)).toBeLessThan(16);
      expect(Math.abs(g - 0x40)).toBeLessThan(16);
      expect(Math.abs(b - 0xc0)).toBeLessThan(16);
    }
    const none = await run('match-color', { inputs: [still], reference: blue, amount: 0, outDir: path.join(dir, 'none') });
    const [r] = meanColor(summaryOf(none).files[0]!);
    expect(Math.abs(r - 0xc0)).toBeLessThan(6);
  });

  it('对齐颜色：只有图片与视频以外的处理不收图片', async () => {
    const still = path.join(dir, 'in', 'still.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=64x64', '-frames:v', '1', '-update', '1', still]);
    await expect(run('stabilize', { inputs: [still] })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(run('match-color', { inputs: [still], reference: still, start: 1 })).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('抠像：视频输出带 alpha 的 ProRes 4444，记下覆盖率；图片输出 PNG', async () => {
    const source = await clip('person.mp4');
    const still = path.join(dir, 'in', 'person.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=160x90', '-frames:v', '1', '-update', '1', still]);
    const record = await run('remove-background', { inputs: [source, still], matteModel: 'fast' });
    expect(record.state).toBe('completed');
    const summary = summaryOf(record);
    expect(summary.executor).toMatchObject({ engine: 'matte', weights: 'u2netp.onnx' });
    expect(summary.warnings).toEqual([]);
    expect(summary.files).toEqual([path.join(dir, 'saved', 'person-cutout.mov'), path.join(dir, 'saved', 'person-cutout.png')]);
    const media = await probeMedia(ffprobe, summary.files[0]!);
    expect(media.video).toMatchObject({ codec: 'prores', width: 160, height: 90 });
    expect(media.video!.pixFmt.startsWith('yuva')).toBe(true);
    expect(media.audio?.codec).toBe('aac');
    expect(summary.items[0]).toMatchObject({ coverage: 0.25, frames: 10 });
  });

  it('工具页读输入的事实：视频、竖拍、图片、音频与读不出的', async () => {
    const video = await inspectFootageInput(ffprobe, await clip('facts.mp4'));
    expect(video).toMatchObject({ kind: 'video', width: 160, height: 90, frameRate: 10, hdr: false, hasAudio: true });
    expect(video.durationSec).toBeGreaterThan(0.5);
    expect(video.bytes).toBeGreaterThan(0);

    const silent = await inspectFootageInput(ffprobe, await clip('silent.mp4', 'testsrc2=size=160x90:rate=10:duration=1', false));
    expect(silent).toMatchObject({ kind: 'video', hasAudio: false });

    const stored = await clip('stored-facts.mp4');
    const rotated = path.join(dir, 'in', 'phone-facts.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-display_rotation', '90', '-i', stored, '-c', 'copy', rotated]);
    expect(await inspectFootageInput(ffprobe, rotated)).toMatchObject({ kind: 'video', width: 90, height: 160 });

    const png = path.join(dir, 'in', 'still.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:size=64x32', '-frames:v', '1', png]);
    expect(await inspectFootageInput(ffprobe, png)).toMatchObject({ kind: 'image', width: 64, height: 32, durationSec: null, hasAudio: false });

    const wav = path.join(dir, 'in', 'tone.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav]);
    const tone = await inspectFootageInput(ffprobe, wav);
    expect(tone).toMatchObject({ kind: 'audio', hasAudio: true, width: null, frameRate: null });
    expect(tone.durationSec).toBeGreaterThan(0.5);

    expect(await inspectFootageInput(ffprobe, path.join(dir, 'in', 'nope.mp4'))).toMatchObject({ kind: 'unreadable', bytes: null });
    const text = path.join(dir, 'in', 'note.txt');
    await fs.writeFile(text, 'not media');
    expect(await inspectFootageInput(ffprobe, text)).toMatchObject({ kind: 'unreadable' });
  });

  it('去抖用哪个滤镜：照 ffmpeg 编了什么说，ffmpeg 不能用时 null', async () => {
    const filters = await ffmpegFilters(ffmpeg);
    expect(await footageStabilizer(ffmpeg)).toBe(filters.has('vidstabdetect') ? 'vidstab' : 'deshake');
    expect(await footageStabilizer(async () => ({ command: 'baocut-no-such-ffmpeg', env: process.env }))).toBeNull();
  });

  it('手机竖拍：带旋转标记的素材按转正的尺寸处理，不被压扁', async () => {
    const stored = await clip('stored.mp4');
    const rotated = path.join(dir, 'in', 'phone.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-display_rotation', '90', '-i', stored, '-c', 'copy', rotated]);
    expect((await probeVideoDetails(ffprobe, rotated)).rotation).toBe(90);
    const record = await run('upscale', { inputs: [rotated], scale: 2 });
    expect(record.state).toBe('completed');
    expect(summaryOf(record).items[0]).toMatchObject({ width: 90, height: 160, outWidth: 180, outHeight: 320 });
    expect((await probeMedia(ffprobe, summaryOf(record).files[0]!)).video).toMatchObject({ width: 180, height: 320 });
    const steady = await run('stabilize', { inputs: [rotated] });
    expect((await probeMedia(ffprobe, summaryOf(steady).files[0]!)).video).toMatchObject({ width: 90, height: 160 });
  });

  it('带 EXIF 方向的 JPEG：按转正的尺寸校验，抠像的结果也是转正的', async () => {
    const plain = path.join(dir, 'in', 'plain.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=64x32', '-frames:v', '1', '-update', '1', plain]);
    // APP1 里的 EXIF：大端、一项 Orientation = 6（顺时针转 90 度）。
    const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
    const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const app1 = Buffer.alloc(4);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(exif.length + 2, 2);
    const bytes = await fs.readFile(plain);
    const turned = path.join(dir, 'in', 'turned.jpg');
    await fs.writeFile(turned, Buffer.concat([bytes.subarray(0, 2), app1, exif, bytes.subarray(2)]));
    const reference = path.join(dir, 'in', 'blue.png');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:size=64x64', '-frames:v', '1', '-update', '1', reference]);
    const matched = await run('match-color', { inputs: [turned], reference });
    expect(matched.state).toBe('completed');
    expect(summaryOf(matched).items[0]).toMatchObject({ width: 32, height: 64 });
    const cut = await run('remove-background', { inputs: [turned] });
    expect(cut.state).toBe('completed');
    expect(summaryOf(cut).items[0]).toMatchObject({ outWidth: 32, outHeight: 64 });
  });

  it('WebP 与扩展名不对的图：抠像先经 ffmpeg 解成 PNG', async () => {
    const png = path.join(dir, 'in', 'mislabeled.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=64x64', '-frames:v', '1', '-update', '1', '-f', 'image2', '-c:v', 'png', png]);
    const record = await run('remove-background', { inputs: [png] });
    expect(record.state).toBe('completed');
  });

  it('声音比画面长：校验不误报，按帧处理的结果不白做', async () => {
    const source = path.join(dir, 'in', 'long-audio.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source],
    ]);
    const record = await run('upscale', { inputs: [source] });
    expect(record.state).toBe('completed');
    expect((await probeMedia(ffprobe, summaryOf(record).files[0]!)).durationSec).toBeGreaterThan(3.5);
  });

  it('对齐颜色：参考的取样时刻没有画面时失败，不拿空的分布算出错误的颜色', async () => {
    const source = await clip('a.mp4');
    const reference = path.join(dir, 'in', 'short-picture.mp4');
    execFileSync('ffmpeg', [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6'],
      ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', reference],
    ]);
    const record = await run('match-color', { inputs: [source], reference, referenceAt: 4 });
    expect(record.state).toBe('failed');
    expect(record.error).toMatchObject({ code: 'INPUT_UNREADABLE' });
  });

  it('路径里有单引号（Home 在 /Users/o\'brien 下）：LUT 与 vid.stab 的文件找得到', async () => {
    const quoted = path.join(dir, "o'brien");
    const quotedJobs = testJobManager(path.join(quoted, 'home'));
    await quotedJobs.open();
    const quotedRunner = new PipelineRunner({
      jobs: quotedJobs,
      stagingDir: path.join(quoted, 'home', 'staging'),
      definitions: [footagePipeline('match-color', { ffmpeg, ffprobe, tool: async () => tools['matte-models']!, saveDirectory: () => path.join(dir, 'saved') })],
    });
    await quotedRunner.open();
    try {
      const source = await clip('q.mp4');
      const reference = path.join(dir, 'in', 'ref.png');
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:size=64x64', '-frames:v', '1', '-update', '1', reference]);
      const { jobId } = await quotedRunner.start({ pipeline: 'match-color', params: { inputs: [source], reference } }, { kind: 'connection', id: 'c' });
      await quotedJobs.settled(jobId);
      await quotedRunner.idle();
      expect(quotedJobs.inspect(jobId)).toMatchObject({ state: 'completed' });
    } finally {
      await quotedRunner.idle();
      await quotedJobs.shutdown();
    }
  });

  it('编码端被信号杀掉：写入失败退出，不会一直等下去', async () => {
    const controller = new AbortController();
    const out = path.join(dir, 'never.mp4');
    const encoder = new FrameEncoder(
      await ffmpeg(),
      ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'png', '-framerate', '10', '-i', 'pipe:0', '-c:v', 'libx264', out],
      controller.signal,
    );
    const frame = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720', '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
    controller.abort(new DOMException('stop', 'AbortError'));
    await new Promise((done) => setTimeout(done, 200));
    await expect(
      (async () => {
        for (let i = 0; i < 200; i++) await encoder.write(frame);
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await encoder.abort();
  });

  it('区间超出素材时拒绝，文件不在时拒绝', async () => {
    const source = await clip('short.mp4');
    await expect(run('stabilize', { inputs: [source], start: 5 })).rejects.toMatchObject({ code: 'invalid-request' });
    await expect(run('stabilize', { inputs: [path.join(dir, 'in', 'nope.mp4')] })).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('不覆盖已有的文件：重名时加序号', async () => {
    const source = await clip('dup.mp4');
    const first = await run('stabilize', { inputs: [source] });
    const second = await run('stabilize', { inputs: [source] });
    expect(summaryOf(first).files).toEqual([path.join(dir, 'saved', 'dup-stabilized.mp4')]);
    expect(summaryOf(second).files).toEqual([path.join(dir, 'saved', 'dup-stabilized-2.mp4')]);
  });
});

describe('withFrameProgress', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-frames-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('工具跑的时候按写出的文件数报，跑完补齐', async () => {
    const reports: number[] = [];
    await withFrameProgress(
      dir,
      4,
      (frames) => reports.push(frames),
      async () => {
        await fs.writeFile(path.join(dir, '1.png'), '');
        await fs.writeFile(path.join(dir, '2.png'), '');
        await new Promise((resolve) => setTimeout(resolve, 80));
      },
      10,
    );
    expect(reports).toEqual([2, 2]);
  });

  it('工具失败时不补齐，错误照抛', async () => {
    const reports: number[] = [];
    await expect(
      withFrameProgress(dir, 4, (frames) => reports.push(frames), () => Promise.reject(new Error('boom')), 10),
    ).rejects.toThrow('boom');
    expect(reports).toEqual([]);
  });
});
