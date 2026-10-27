import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord, UpscaleImageSummary } from '@baocut/protocol';
import type { JobManager } from '../job-manager.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import { parseImageHeader } from './image-header.ts';
import { PipelineRunner } from './pipeline-runner.ts';
import { needsResize, parseUpscaleImageParams, upscaleImagePipeline, type UpscaleTool } from './upscale-image.ts';

/**
 * 图片超分（架构设计 §7.9）：假的 Real-ESRGAN（Node 脚本，按 -s 写出放大后的纯色 PNG）跑整条流程。参数、倍数与权重、
 * 输出的名字与尺寸、工具失败与输出尺寸不对；照片的 2、3 倍要真实的 ffmpeg 缩小，没有时跳过那一条。
 */

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const ffmpeg = async () => ({ command: 'ffmpeg', env: process.env });

/** 一张 RGB 纯色 PNG（真的能解码）。 */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 假工具：记下参数，读输入 PNG 的尺寸，写出乘以 -s 的 PNG。输入名字里有 broken 时报错退出；有 wrong 时少放大一倍
 * （输出尺寸不对）。PNG 的写法同上（脚本里另写一份，不依赖测试代码）。
 */
const FAKE = `
const fs = require('node:fs');
const zlib = require('node:zlib');
const args = process.argv.slice(2);
const get = (flag) => args[args.indexOf(flag) + 1];
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\\n');
const input = get('-i');
if (input.includes('broken')) { process.stderr.write('vkCreateInstance failed -9\\n'); process.exit(255); }
const src = fs.readFileSync(input);
let s = Number(get('-s'));
if (input.includes('wrong')) s -= 1;
const w = src.readUInt32BE(16) * s, h = src.readUInt32BE(20) * s;
function crc(b) { let c = 0xffffffff; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); o.write(t, 4, 'latin1'); d.copy(o, 8); o.writeUInt32BE(crc(Buffer.concat([Buffer.from(t, 'latin1'), d])), 8 + d.length); return o; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
const raw = Buffer.concat(Array.from({ length: h }, () => row));
fs.writeFileSync(get('-o'), Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
`;

describe('超分参数', () => {
  it('补上默认值（4 倍、photo）；相对路径、不支持的倍数与模型、多余的键拒绝', () => {
    expect(parseUpscaleImageParams({ inputs: ['/a.png'] })).toEqual({ inputs: ['/a.png'], scale: 4, model: 'photo' });
    expect(parseUpscaleImageParams({ inputs: ['/a.png'], scale: 2, model: 'anime', outDir: '/out' })).toEqual({
      inputs: ['/a.png'],
      scale: 2,
      model: 'anime',
      outDir: '/out',
    });
    for (const bad of [
      { inputs: ['a.png'] },
      { inputs: [] },
      { inputs: ['/a.png'], scale: 8 },
      { inputs: ['/a.png'], model: 'face' },
      { inputs: ['/a.png'], outDir: 'rel' },
      { inputs: ['/a.png'], extra: 1 },
      { inputs: [{ entryId: 'ent_1' }] },
    ]) {
      expect(() => parseUpscaleImageParams(bad)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
    }
  });

  it('照片模型只有原生 4 倍，2、3 倍要缩小；动画模型 2、3、4 倍都是原生的', () => {
    expect([2, 3, 4].map((s) => needsResize('photo', s as 2 | 3 | 4))).toEqual([true, true, false]);
    expect([2, 3, 4].map((s) => needsResize('anime', s as 2 | 3 | 4))).toEqual([false, false, false]);
  });
});

describe('图片超分（假 Real-ESRGAN）', () => {
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let tool: UpscaleTool;
  let log: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-upscale-'));
    await fs.mkdir(path.join(dir, 'in'));
    await fs.mkdir(path.join(dir, 'bin', 'models'), { recursive: true });
    const script = path.join(dir, 'bin', 'fake-realesrgan.cjs');
    await fs.writeFile(script, FAKE);
    log = path.join(dir, 'calls.log');
    tool = { command: process.execPath, args: [script], version: 'v0.2.5.0', env: { ...process.env, FAKE_LOG: log }, modelsDir: path.join(dir, 'bin', 'models') };
    jobs = testJobManager(path.join(dir, 'home'));
    await jobs.open();
    runner = new PipelineRunner({
      jobs,
      stagingDir: path.join(dir, 'home', 'staging'),
      definitions: [upscaleImagePipeline({ tool: async () => tool, ffmpeg, saveDirectory: () => path.join(dir, 'saved') })],
    });
    await runner.open();
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function input(name: string, width = 8, height = 6): Promise<string> {
    const file = path.join(dir, 'in', name);
    await fs.writeFile(file, png(width, height));
    return file;
  }

  async function upscale(params: Record<string, unknown>): Promise<JobRecord> {
    const { jobId } = await runner.start({ pipeline: 'upscale-image', params }, { kind: 'connection', id: 'c' });
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  const calls = async () =>
    (await fs.readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);

  it('放大到保存位置：每张起一次工具（权重、倍数、models 目录），输出是正好放大的 PNG，不动原图', async () => {
    const a = await input('a.png');
    const b = await input('b.png', 5, 7);
    const record = await upscale({ inputs: [a, b], model: 'anime', scale: 3 });
    expect(record).toMatchObject({ state: 'completed', providerId: 'realesrgan-ncnn-vulkan', modelId: 'realesr-animevideov3@v0.2.5.0', videoId: null });
    const summary = record.pipeline!.summary as unknown as UpscaleImageSummary;
    const saved = path.join(dir, 'saved');
    expect(summary).toMatchObject({
      model: 'anime',
      scale: 3,
      executor: { tool: 'realesrgan-ncnn-vulkan', version: 'v0.2.5.0', weights: 'realesr-animevideov3', resize: null },
      files: [path.join(saved, 'a-upscaled-3x.png'), path.join(saved, 'b-upscaled-3x.png')],
      warnings: [],
    });
    expect(summary.images.map((i) => [i.width, i.height, i.outWidth, i.outHeight])).toEqual([
      [8, 6, 24, 18],
      [5, 7, 15, 21],
    ]);
    for (const [file, w, h] of [
      [summary.files[0]!, 24, 18],
      [summary.files[1]!, 15, 21],
    ] as const) {
      expect(parseImageHeader(await fs.readFile(file))).toMatchObject({ mediaType: 'image/png', width: w, height: h });
    }
    expect(record.result!.outputs).toEqual([
      expect.objectContaining({ path: summary.files[0], mediaType: 'image/png', media: { kind: 'image', width: 24, height: 18 } }),
      expect.objectContaining({ path: summary.files[1], mediaType: 'image/png', media: { kind: 'image', width: 15, height: 21 } }),
    ]);
    const args = await calls();
    expect(args).toHaveLength(2);
    expect(args[0]).toEqual(expect.arrayContaining(['-i', a, '-n', 'realesr-animevideov3', '-s', '3', '-m', tool.modelsDir!, '-f', 'png']));
    // 原图不动；同名再跑一次不覆盖。
    expect(parseImageHeader(await fs.readFile(a))).toMatchObject({ width: 8, height: 6 });
    const again = await upscale({ inputs: [a], model: 'anime', scale: 3, outDir: saved });
    expect((again.pipeline!.summary as unknown as UpscaleImageSummary).files[0]).not.toBe(summary.files[0]);
    expect((await fs.readdir(saved)).length).toBe(3);
  });

  it.skipIf(!hasFfmpeg)('照片 2 倍：工具放大 4 倍，ffmpeg 缩到目标尺寸', async () => {
    const a = await input('photo.png', 10, 4);
    const out = path.join(dir, 'out');
    const record = await upscale({ inputs: [a], scale: 2, outDir: out });
    expect(record.state).toBe('completed');
    const summary = record.pipeline!.summary as unknown as UpscaleImageSummary;
    expect(summary.executor.weights).toBe('realesrgan-x4plus');
    expect(summary.executor.resize).toMatchObject({ tool: 'ffmpeg' });
    expect((await calls())[0]).toEqual(expect.arrayContaining(['-n', 'realesrgan-x4plus', '-s', '4']));
    expect(parseImageHeader(await fs.readFile(path.join(out, 'photo-upscaled-2x.png')))).toMatchObject({ width: 20, height: 8 });
  });

  it('工具报错时失败并带上它的最后一行；输出尺寸不对时校验失败；都不留下输出', async () => {
    const out = path.join(dir, 'out');
    const broken = await upscale({ inputs: [await input('broken.png')], model: 'anime', outDir: out });
    expect(broken).toMatchObject({ state: 'failed', error: { code: 'UPSCALE_FAILED' } });
    expect(broken.error!.message).toContain('vkCreateInstance failed');
    const wrong = await upscale({ inputs: [await input('wrong.png')], model: 'anime', outDir: out });
    expect(wrong).toMatchObject({ state: 'failed', error: { code: 'EXPORT_VALIDATION_FAILED' } });
    expect(await fs.readdir(out)).toEqual([]);
  });

  it('启动时拒绝：不是图片、放大后超过每边上限、工具不能用', async () => {
    const text = path.join(dir, 'in', 'note.png');
    await fs.writeFile(text, 'not an image');
    await expect(runner.start({ pipeline: 'upscale-image', params: { inputs: [text] } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'INPUT_UNREADABLE' },
    });
    const huge = await input('huge.png', 5000, 2);
    await expect(runner.start({ pipeline: 'upscale-image', params: { inputs: [huge] } }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
      details: { code: 'UPSCALE_OUTPUT_TOO_LARGE' },
    });
    expect(await fs.stat(log).catch(() => null)).toBeNull();
  });
});
