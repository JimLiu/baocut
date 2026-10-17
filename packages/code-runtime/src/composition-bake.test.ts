import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { inspectBundle } from './bundle-inspect.ts';
import { findBundledBinary } from '@baocut/process-host';
import { bakeComposition, ffprobePathFor, resolveFfmpeg, sampleFrames } from './composition-bake.ts';
import { CompositionHost, resolveElectronBinary } from './composition-host.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ffmpeg = resolveFfmpeg();
const ffprobe = ffprobePathFor(ffmpeg);
const hasFfmpeg = spawnSync(ffmpeg, ['-version']).status === 0 && spawnSync(ffprobe, ['-version']).status === 0;
// 指令烘焙要认识 `canvas-bake` 的 Render Worker（`npm run build:engine`）；旧的 Worker 当作没有。
const worker = (() => {
  const found = process.env.BAOCUT_EXPORT_WORKER || findBundledBinary('export-worker', path.dirname(fileURLToPath(import.meta.url)));
  if (!found) return null;
  const usage = spawnSync(found, [], { encoding: 'utf8' });
  return `${usage.stdout}${usage.stderr}`.includes('canvas-bake') ? found : null;
})();

function probe(file: string) {
  const result = spawnSync(
    ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_frames',
      '-show_entries',
      'stream=codec_name,pix_fmt,width,height,nb_read_frames,r_frame_rate',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout).streams[0];
}

describe('sampleFrames', () => {
  it('均匀取样，含首尾、去重', () => {
    expect(sampleFrames(730, 5)).toEqual([0, 182, 365, 547, 729]);
    expect(sampleFrames(3, 5)).toEqual([0, 1, 2]);
    expect(sampleFrames(1, 5)).toEqual([0]);
  });
});

describe('ffprobePathFor', () => {
  it('同目录换名字，保留扩展名', () => {
    expect(ffprobePathFor('/opt/homebrew/bin/ffmpeg')).toBe('/opt/homebrew/bin/ffprobe');
    expect(ffprobePathFor('C:/tools/ffmpeg.exe')).toBe('C:/tools/ffprobe.exe');
    expect(ffprobePathFor('ffmpeg')).toBe('ffprobe');
  });
});

describe.skipIf(!resolveElectronBinary() || !hasFfmpeg)('bakeComposition', { timeout: 180_000 }, () => {
  const tmpDirs: string[] = [];
  afterAll(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hyperframes-basic 烘焙成带 alpha 的 ProRes 4444', async () => {
    const bundle = await inspectBundle(path.join(fixtures, 'hyperframes-basic'), { manifest: { alpha: true } });
    tmpDirs.push(bundle.root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-bake-test-'));
    tmpDirs.push(out);
    const outputFile = path.join(out, 'baked.mov');
    const host = await CompositionHost.start();
    const progress: number[] = [];
    try {
      const result = await bakeComposition(host, bundle, {
        fps: { num: 30, den: 1 },
        outputFile,
        ffmpeg,
        alpha: true,
        onProgress: (done) => progress.push(done),
      });
      // hyperframes/1 不录制：auto 回退到像素，原因写在 bake.fallback。
      expect(result.bake).toMatchObject({ renderer: 'browser-pixels', fallback: { reason: expect.stringContaining('hyperframes/1') } });
      expect(result).toMatchObject({
        file: outputFile,
        frames: 60,
        durationSeconds: 2,
        encoding: { container: 'mov', codec: 'prores_ks', pixelFormat: 'yuva444p10le', alpha: true, fps: { num: 30, den: 1 }, frames: 60 },
      });
      expect(result.frameHashes).toHaveLength(60);
      expect(new Set(result.frameHashes).size).toBeGreaterThan(50);
      expect(progress.at(-1)).toBe(60);
      for (const hash of [result.outputProfileHash, result.timeMapHash, result.parameterValuesHash]) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await host.close();
    }
    const stream = probe(outputFile);
    expect(stream).toMatchObject({ codec_name: 'prores', width: 1280, height: 720, r_frame_rate: '30/1' });
    // 编码输入是 yuva444p10le；ProRes 4444 解码端报告 yuva444p12le。导入端只看 `yuva` 前缀判定透明。
    expect(stream.pix_fmt).toMatch(/^yuva444p1[02]le$/);
    expect(Number(stream.nb_read_frames)).toBe(60);
  });

  it('中止信号 → 停止并拒绝', async () => {
    const bundle = await inspectBundle(path.join(fixtures, 'hyperframes-basic'));
    tmpDirs.push(bundle.root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-bake-test-'));
    tmpDirs.push(out);
    const host = await CompositionHost.start();
    const controller = new AbortController();
    try {
      const baking = bakeComposition(host, bundle, {
        fps: { num: 30, den: 1 },
        outputFile: path.join(out, 'aborted.mov'),
        ffmpeg,
        alpha: false,
        signal: controller.signal,
        onProgress: (done) => {
          if (done === 5) controller.abort();
        },
      });
      await expect(baking).rejects.toThrow();
      expect(host.alive).toBe(true);
    } finally {
      await host.close();
    }
  });
});

describe.skipIf(!resolveElectronBinary() || !hasFfmpeg || !worker)('bakeComposition（指令）', { timeout: 180_000 }, () => {
  const tmpDirs: string[] = [];
  afterAll(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('baocut/1 的 Canvas 画面录成指令、Worker 光栅并编成 ProRes 422 HQ', async () => {
    const bundle = await inspectBundle(path.join(fixtures, 'baocut-canvas'), { manifest: { contract: 'baocut/1' } });
    tmpDirs.push(bundle.root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-bake-test-'));
    tmpDirs.push(out);
    const outputFile = path.join(out, 'ops.mov');
    const host = await CompositionHost.start();
    const progress: number[] = [];
    try {
      const result = await bakeComposition(host, bundle, {
        fps: { num: 30, den: 1 },
        outputFile,
        ffmpeg,
        alpha: false,
        mode: 'ops',
        worker,
        onProgress: (done) => progress.push(done),
      });
      expect(result.bake).toMatchObject({ renderer: 'drawop-cpu' });
      expect(result.bake.fallback).toBeUndefined();
      expect(result).toMatchObject({ file: outputFile, frames: 30, encoding: { pixelFormat: 'yuv422p10le', alpha: false, frames: 30 } });
      expect(result.encoding.codec).toMatch(/^prores_(videotoolbox|ks)$/);
      expect(result.frameHashes).toHaveLength(30);
      expect(new Set(result.frameHashes).size).toBe(30);
      expect(progress.at(-1)).toBe(30);
      // 录制目录在烘焙后删掉，只留输出。
      expect(fs.readdirSync(out)).toEqual(['ops.mov']);
    } finally {
      await host.close();
    }
    expect(probe(outputFile)).toMatchObject({
      codec_name: 'prores',
      width: 640,
      height: 360,
      pix_fmt: 'yuv422p10le',
      nb_read_frames: '30',
    });
  });

  it('带 alpha 时编成 ProRes 4444', async () => {
    const bundle = await inspectBundle(path.join(fixtures, 'baocut-canvas'), { manifest: { contract: 'baocut/1', alpha: true } });
    tmpDirs.push(bundle.root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-bake-test-'));
    tmpDirs.push(out);
    const outputFile = path.join(out, 'alpha.mov');
    const host = await CompositionHost.start();
    try {
      const result = await bakeComposition(host, bundle, {
        fps: { num: 15, den: 1 },
        outputFile,
        ffmpeg,
        alpha: true,
        mode: 'ops',
        worker,
      });
      expect(result).toMatchObject({
        frames: 15,
        bake: { renderer: 'drawop-cpu' },
        encoding: { pixelFormat: 'yuva444p10le', alpha: true },
      });
    } finally {
      await host.close();
    }
    const stream = probe(outputFile);
    expect(stream).toMatchObject({ codec_name: 'prores', nb_read_frames: '15', r_frame_rate: '15/1' });
    expect(stream.pix_fmt).toMatch(/^yuva444p1[02]le$/);
  });

  it('WebGL 画面录不了：auto 回退像素，带 alpha 编成 ProRes 4444', async () => {
    const bundle = await inspectBundle(path.join(fixtures, 'baocut-webgl'), { manifest: { contract: 'baocut/1', alpha: true } });
    tmpDirs.push(bundle.root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-bake-test-'));
    tmpDirs.push(out);
    const host = await CompositionHost.start();
    try {
      const outputFile = path.join(out, 'webgl.mov');
      const result = await bakeComposition(host, bundle, { fps: { num: 30, den: 1 }, ffmpeg, alpha: true, worker, outputFile });
      expect(result.bake).toMatchObject({ renderer: 'browser-pixels', fallback: { reason: expect.stringContaining('recording') } });
      expect(result.frames).toBe(30);
      expect(new Set(result.frameHashes).size).toBeGreaterThan(25);
      const stream = probe(outputFile);
      expect(stream).toMatchObject({ codec_name: 'prores', width: 640, height: 360 });
      expect(stream.pix_fmt).toMatch(/^yuva444p1[02]le$/);
    } finally {
      await host.close();
    }
  });

  it('DOM 画面录不了：auto 回退像素并写明原因，ops 直接失败', async () => {
    const bundle = await inspectBundle(path.join(fixtures, 'baocut-native'), { manifest: { contract: 'baocut/1', alpha: false } });
    tmpDirs.push(bundle.root);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-bake-test-'));
    tmpDirs.push(out);
    const host = await CompositionHost.start();
    try {
      const options = { fps: { num: 30, den: 1 }, ffmpeg, alpha: false, worker };
      const auto = await bakeComposition(host, bundle, { ...options, outputFile: path.join(out, 'auto.mov') });
      expect(auto.bake).toMatchObject({ renderer: 'browser-pixels', fallback: { reason: expect.stringContaining('recording') } });
      expect(auto.frames).toBe(60);
      await expect(bakeComposition(host, bundle, { ...options, outputFile: path.join(out, 'ops.mov'), mode: 'ops' })).rejects.toThrow(
        /instruction bake/,
      );
    } finally {
      await host.close();
    }
  });
});
