import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RpcError, type AssetRevision, type MediaPeaks } from '@baocut/protocol';
import { silentLogger } from '@baocut/harness';
import { MAX_PEAKS, MediaAnalysis, PeakReducer, cacheKeyOf, frameMillis, imageSize, peaksRate, thumbnailMillis } from './media-analysis.ts';

function floats(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => buffer.writeFloatLE(value, i * 4));
  return buffer;
}

describe('峰值与时间的换算', () => {
  it('按格取最大绝对振幅；采样可以从任意字节处切开', () => {
    const reducer = new PeakReducer(8, 2);
    const bytes = floats([0.1, -0.5, 0.2, 0, 1.5, 0.25, -0.75, 0.1, 0.3]);
    reducer.push(bytes.subarray(0, 7));
    reducer.push(bytes.subarray(7, 21));
    reducer.push(bytes.subarray(21));
    expect([...reducer.finish()]).toEqual([128, 255, 77]);
  });

  it('超过上限的格丢掉', () => {
    const reducer = new PeakReducer(1, 1, 2);
    reducer.push(floats([0.5, 0.5, 0.5, 0.5]));
    expect(reducer.finish().length).toBe(2);
  });

  it('长素材降低峰值密度，总格数不超过上限', () => {
    expect(peaksRate(null)).toBe(50);
    expect(peaksRate(60)).toBe(50);
    expect(peaksRate(4 * 3600)).toBe(Math.floor(MAX_PEAKS / (4 * 3600)));
    expect(peaksRate(4 * 3600) * 4 * 3600).toBeLessThanOrEqual(MAX_PEAKS);
    expect(peaksRate(1e9)).toBe(1);
  });

  it('缩略图时间按 0.1 秒取整，留在素材之内', () => {
    expect(thumbnailMillis(1.234, 10)).toBe(1200);
    expect(thumbnailMillis(1.26, 10)).toBe(1300);
    expect(thumbnailMillis(-3, 10)).toBe(0);
    expect(thumbnailMillis(5, 2)).toBe(1900);
    expect(thumbnailMillis(5, null)).toBe(5000);
    expect(thumbnailMillis(1, 0.02)).toBe(0);
  });

  it('缓存目录名只接受 sha256 摘要', () => {
    expect(cacheKeyOf(`sha256:${'a'.repeat(64)}`)).toBe('a'.repeat(64));
    for (const bad of ['sha256:../../etc', `sha256:${'A'.repeat(64)}`, 'md5:abc', `sha256:${'a'.repeat(64)}/x`])
      expect(() => cacheKeyOf(bad)).toThrow(RpcError);
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!hasFfmpeg) console.warn('跳过媒体分析的 ffmpeg 测试：没有 ffmpeg');

describe.skipIf(!hasFfmpeg)('媒体分析（真实 ffmpeg）', () => {
  let dir: string;
  let root: string;
  let cacheDir: string;

  const ffmpeg = async () => ({ command: 'ffmpeg', env: process.env });
  const analysis = (options: Partial<ConstructorParameters<typeof MediaAnalysis>[0]> = {}) =>
    new MediaAnalysis({ cacheDir, log: silentLogger, ffmpeg, ...options });

  function record(patch: Partial<AssetRevision> = {}): AssetRevision {
    return {
      revision: '1',
      contentHash: `sha256:${'1'.repeat(64)}`,
      byteLength: 0,
      mediaType: 'video/mp4',
      storage: { mode: 'managed' },
      duration: { ticks: '2000', timescale: 1000 },
      video: {
        displayWidth: 320,
        displayHeight: 180,
        rotation: 0,
        pixelAspectRatio: { num: 1, den: 1 },
        frameRate: { kind: 'cfr', rate: { num: 30, den: 1 } },
        ptsOrigin: { ticks: '0', timescale: 1 },
        hasAlpha: false,
      },
      audio: { sampleRate: 44100, channels: 1 },
      provenance: { origin: 'test' },
      ...patch,
    };
  }

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-analysis-'));
    root = path.join(dir, 'project');
    cacheDir = path.join(dir, 'cache');
    await fs.mkdir(root);
    // 两秒：前一秒半幅正弦，后一秒静音。
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=30:duration=2',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.5*sin(2*PI*440*t)*lt(t\\,1):d=2:s=44100',
      '-c:v',
      'mpeg4',
      '-c:a',
      'pcm_s16le',
      '-shortest',
      path.join(root, 'clip.mov'),
    ]);
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('峰值：每秒 50 格，有声的部分约半幅、静音的部分是 0；结果写进按摘要分的缓存', async () => {
    const result = await analysis().peaks({ root, file: 'clip.mov', record: record({ mediaType: 'video/quicktime' }) });
    expect(result.status).toBe('ready');
    const { binsPerSecond, peaks } = result as Extract<MediaPeaks, { status: 'ready' }>;
    expect(binsPerSecond).toBe(50);
    const bins = Buffer.from(peaks, 'base64');
    expect(bins.length).toBeGreaterThanOrEqual(98);
    expect(bins.length).toBeLessThanOrEqual(102);
    for (const level of bins.subarray(5, 45)) expect(Math.abs(level - 128)).toBeLessThan(10);
    for (const level of bins.subarray(55, 95)) expect(level).toBe(0);
    const cached = JSON.parse(await fs.readFile(path.join(cacheDir, '1'.repeat(64), 'peaks-v1.json'), 'utf8')) as MediaPeaks;
    expect(cached).toEqual(result);
  });

  it('有缓存时不再运行 ffmpeg', async () => {
    const broken = analysis({ ffmpeg: async () => ({ command: path.join(dir, 'no-ffmpeg'), env: process.env }) });
    const result = await broken.peaks({ root, file: 'clip.mov', record: record({ mediaType: 'video/quicktime' }) });
    expect(result.status).toBe('ready');
  });

  it('没算完先回 pending，算完之后同一个请求拿到结果', async () => {
    const slow = analysis({ peaksWaitMs: 0 });
    const source = { root, file: 'clip.mov', record: record({ mediaType: 'video/quicktime', contentHash: `sha256:${'2'.repeat(64)}` }) };
    expect(await slow.peaks(source)).toEqual({ status: 'pending', retryAfterMs: expect.any(Number) });
    for (let i = 0; i < 200; i++) {
      const result = await slow.peaks(source);
      if (result.status === 'ready') return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('峰值一直没有算完');
  });

  it('素材没有声音时直接回 no-audio', async () => {
    const result = await analysis().peaks({ root, file: 'clip.mov', record: record({ mediaType: 'video/quicktime', audio: undefined }) });
    expect(result).toEqual({ status: 'no-audio' });
  });

  it('缩略图：小 JPEG，时间取整并留在素材之内，写进缓存', async () => {
    const thumbnail = await analysis().thumbnail({ root, file: 'clip.mov', record: record({ mediaType: 'video/quicktime' }) }, 9);
    expect(thumbnail.at).toBe(1.9);
    const bytes = Buffer.from(thumbnail.data, 'base64');
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(bytes.length).toBeLessThan(64 * 1024);
    expect(await fs.readFile(path.join(cacheDir, '1'.repeat(64), 'thumb-1900.jpg'))).toEqual(bytes);
  });

  it('不是音视频、摘要不对、文件在来源目录之外都拒绝', async () => {
    const run = async (promise: Promise<unknown>) =>
      (
        await promise.then(
          () => null,
          (error: RpcError) => error,
        )
      )?.code;
    const a = analysis();
    expect(await run(a.peaks({ root, file: 'clip.mov', record: record({ mediaType: 'image/png' }) }))).toBe('forbidden');
    expect(await run(a.peaks({ root, file: 'clip.mov', record: record({ mediaType: 'application/json' }) }))).toBe('forbidden');
    expect(await run(a.thumbnail({ root, file: 'clip.mov', record: record({ contentHash: 'sha256:../x' }) }, 0))).toBe('invalid-request');
    expect(await run(a.thumbnail({ root, file: '../outside.mov', record: record() }, 0))).toBe('not-found');
    await fs.writeFile(path.join(dir, 'outside.mov'), 'x');
    expect(await run(a.thumbnail({ root, file: path.join(dir, 'outside.mov'), record: record() }, 0))).toBe('forbidden');
  });

  it('只用媒体类型对应的解复用器：改了扩展名的播放列表不会被读进来', async () => {
    const playlist = path.join(root, 'playlist.mp4');
    await fs.writeFile(playlist, `#EXTM3U\n#EXTINF:2,\nfile://${path.join(root, 'clip.mov')}\n`);
    const error = await analysis()
      .thumbnail({ root, file: 'playlist.mp4', record: record({ contentHash: `sha256:${'3'.repeat(64)}` }) }, 0)
      .then(
        () => null,
        (e: RpcError) => e,
      );
    expect(error?.code).toBe('internal');
    expect(error?.message).not.toContain(root);
  });
});

describe.skipIf(!hasFfmpeg)('Space 缩略图的取帧（真实 ffmpeg）', () => {
  let dir: string;
  let root: string;
  let cacheDir: string;
  const ffmpeg = async () => ({ command: 'ffmpeg', env: process.env });
  const noFfmpeg = async () => ({ command: path.join(dir, 'no-ffmpeg'), env: process.env });
  const analysis = (options: Partial<ConstructorParameters<typeof MediaAnalysis>[0]> = {}) =>
    new MediaAnalysis({ cacheDir, log: silentLogger, ffmpeg, ...options });
  const make = (args: string[], file: string) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, path.join(root, file)]);
  const codeOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: RpcError) => error.code,
    );

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-frames-'));
    root = path.join(dir, 'project');
    cacheDir = path.join(dir, 'cache');
    await fs.mkdir(root);
    make(['-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=3', '-c:v', 'mpeg4'], 'clip.mp4');
    make(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=0.5', '-c:v', 'mpeg4'], 'short.mov');
    make(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=640x360,format=rgba', '-frames:v', '1'], 'alpha.png');
    make(['-f', 'lavfi', '-i', 'testsrc=size=1000x500:rate=1:duration=1', '-frames:v', '1'], 'photo.jpg');
    make(['-f', 'lavfi', '-i', 'testsrc=size=400x6000:rate=1:duration=1', '-frames:v', '1'], 'tall.png');
    make(['-f', 'lavfi', '-i', 'testsrc=size=63x31:rate=1:duration=1', '-frames:v', '1'], 'tiny.png');
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('视频：取 at 秒，缩到 320 宽的 JPEG；比 at 短的视频退回第一帧', async () => {
    const frame = await analysis().fileFrame({ root, file: 'clip.mp4' }, { at: 1, width: 320 });
    expect(frame).toMatchObject({ mimeType: 'image/jpeg', width: 320, height: 180 });
    expect(imageSize(frame.data)?.dims).toEqual({ width: 320, height: 180 });
    const short = await analysis().fileFrame({ root, file: 'short.mov' }, { at: 1, width: 320 });
    expect(short).toMatchObject({ mimeType: 'image/jpeg', width: 320, height: 180 });
  });

  it('图片：带透明的 PNG 输出 PNG，JPEG 输出 JPEG；太高的限在 3 倍宽之内，小图不放大', async () => {
    const alpha = await analysis().fileFrame({ root, file: 'alpha.png' }, { at: 0, width: 320 });
    expect(alpha).toMatchObject({ mimeType: 'image/png', width: 320, height: 180 });
    expect(alpha.data.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(alpha.data[25]).toBe(6); // IHDR 的颜色类型：RGBA，透明保留
    expect(await analysis().fileFrame({ root, file: 'photo.jpg' }, { at: 0, width: 320 })).toMatchObject({
      mimeType: 'image/jpeg',
      width: 320,
      height: 160,
    });
    const tall = await analysis().fileFrame({ root, file: 'tall.png' }, { at: 0, width: 320 });
    expect(tall.height).toBeLessThanOrEqual(960);
    expect(tall.width).toBeLessThan(320);
    const tiny = await analysis().fileFrame({ root, file: 'tiny.png' }, { at: 0, width: 320 });
    expect(tiny.width).toBeLessThanOrEqual(63);
  });

  it('按真实路径、大小与修改时间缓存：没变时不再运行 ffmpeg，文件改了重新取', async () => {
    const file = path.join(root, 'changing.png');
    make(['-f', 'lavfi', '-i', 'color=c=blue:s=200x100', '-frames:v', '1'], 'changing.png');
    const first = await analysis().fileFrame({ root, file: 'changing.png' }, { at: 0, width: 320 });
    expect(first).toMatchObject({ width: 200, height: 100 });
    expect(await analysis({ ffmpeg: noFfmpeg }).fileFrame({ root, file: 'changing.png' }, { at: 0, width: 320 })).toEqual(first);
    // 宽不同是另一份缓存。
    expect(await codeOf(analysis({ ffmpeg: noFfmpeg }).fileFrame({ root, file: 'changing.png' }, { at: 0, width: 100 }))).toBe('internal');
    make(['-f', 'lavfi', '-i', 'color=c=blue:s=300x100', '-frames:v', '1'], 'changing.png');
    expect(await analysis().fileFrame({ root, file: 'changing.png' }, { at: 0, width: 320 })).toMatchObject({ width: 300, height: 100 });
    // 大小不变、只改修改时间也重新取。
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(file, later, later);
    expect(await codeOf(analysis({ ffmpeg: noFfmpeg }).fileFrame({ root, file: 'changing.png' }, { at: 0, width: 320 }))).toBe('internal');
  });

  it('不是画面的文件、改了扩展名的别的格式、来源目录之外的都拒绝', async () => {
    await fs.writeFile(path.join(root, 'notes.txt'), 'hello');
    expect(await codeOf(analysis().fileFrame({ root, file: 'notes.txt' }, { at: 0, width: 320 }))).toBe('forbidden');
    await fs.writeFile(path.join(root, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await codeOf(analysis().fileFrame({ root, file: 'vector.svg' }, { at: 0, width: 320 }))).toBe('forbidden');
    await fs.writeFile(path.join(root, 'fake.png'), `#EXTM3U\n#EXTINF:2,\nfile://${path.join(root, 'clip.mp4')}\n`);
    expect(await codeOf(analysis().fileFrame({ root, file: 'fake.png' }, { at: 0, width: 320 }))).toBe('internal');
    await fs.copyFile(path.join(root, 'clip.mp4'), path.join(root, 'clip-as.jpg'));
    expect(await codeOf(analysis().fileFrame({ root, file: 'clip-as.jpg' }, { at: 0, width: 320 }))).not.toBeNull();
    await fs.copyFile(path.join(root, 'photo.jpg'), path.join(dir, 'outside.jpg'));
    expect(await codeOf(analysis().fileFrame({ root, file: path.join(dir, 'outside.jpg') }, { at: 0, width: 320 }))).toBe('forbidden');
  });

  it('素材的帧按内容摘要缓存：缓存里有时不去找文件', async () => {
    const asset = { contentHash: `sha256:${'4'.repeat(64)}`, mediaType: 'video/mp4', durationSec: 3 };
    let located = 0;
    const locate = async () => {
      located++;
      return { root, file: 'clip.mp4' };
    };
    const frame = await analysis().assetFrame(asset, 1.04, 320, locate);
    expect(frame).toMatchObject({ mimeType: 'image/jpeg', width: 320, height: 180 });
    expect(await fs.readdir(path.join(cacheDir, '4'.repeat(64)))).toEqual(['thumb-1000-w320.jpg']);
    expect(await analysis({ ffmpeg: noFfmpeg }).assetFrame(asset, 1, 320, locate)).toEqual(frame);
    expect(located).toBe(1);
    expect(await codeOf(analysis().assetFrame({ ...asset, mediaType: 'image/png' }, 0, 320, locate))).toBe('forbidden');
  });

  it('给智能体看的帧（videoFrame）：按框缩小、不放大，PNG 或 JPEG，毫秒精度并留在时长之内；按内容摘要另行缓存', async () => {
    expect(frameMillis(1.2345, 3)).toBe(1235);
    expect(frameMillis(10, 3)).toBe(2950);
    expect(frameMillis(-1, null)).toBe(0);
    const asset = { contentHash: `sha256:${'5'.repeat(64)}`, mediaType: 'video/mp4', durationSec: 3 };
    let located = 0;
    const locate = async () => {
      located++;
      return { root, file: 'clip.mp4' };
    };
    const png = await analysis().videoFrame(asset, 1.25, { width: 640, height: 640, format: 'png' }, locate);
    expect(png).toMatchObject({ mimeType: 'image/png', width: 640, height: 360 });
    const full = await analysis().videoFrame(asset, 1.25, { width: 1920, height: 1920, format: 'jpeg' }, locate);
    expect(full).toMatchObject({ mimeType: 'image/jpeg', width: 1280, height: 720 });
    expect((await fs.readdir(path.join(cacheDir, '5'.repeat(64)))).sort()).toEqual(['frame-1250-1920x1920.jpg', 'frame-1250-640x640.png']);
    expect(await analysis({ ffmpeg: noFfmpeg }).videoFrame(asset, 1.25, { width: 640, height: 640, format: 'png' }, locate)).toEqual(png);
    expect(located).toBe(2);
    expect(
      await codeOf(analysis().videoFrame({ ...asset, mediaType: 'image/png' }, 0, { width: 64, height: 64, format: 'png' }, locate)),
    ).toBe('forbidden');
  });

  it('imageSize 读 PNG 与 JPEG 的尺寸，别的不认', async () => {
    expect(imageSize(await fs.readFile(path.join(root, 'alpha.png')))).toEqual({
      mimeType: 'image/png',
      dims: { width: 640, height: 360 },
    });
    expect(imageSize(await fs.readFile(path.join(root, 'photo.jpg')))).toEqual({
      mimeType: 'image/jpeg',
      dims: { width: 1000, height: 500 },
    });
    expect(imageSize(Buffer.from('not an image'))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});
