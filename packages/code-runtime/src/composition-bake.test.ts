import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { inspectBundle } from './bundle-inspect.ts';
import { bakeComposition, ffprobePathFor, resolveFfmpeg } from './composition-bake.ts';
import { CompositionHost, resolveElectronBinary } from './composition-host.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ffmpeg = resolveFfmpeg();
const ffprobe = ffprobePathFor(ffmpeg);
const hasFfmpeg = spawnSync(ffmpeg, ['-version']).status === 0 && spawnSync(ffprobe, ['-version']).status === 0;

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
    const probe = spawnSync(
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
        outputFile,
      ],
      { encoding: 'utf8' },
    );
    expect(probe.status, probe.stderr).toBe(0);
    const stream = JSON.parse(probe.stdout).streams[0];
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
