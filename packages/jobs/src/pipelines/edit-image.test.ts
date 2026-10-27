import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type EditImageSummary, type JobRecord } from '@baocut/protocol';
import type { JobManager } from '../job-manager.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import { editImagePipeline, filterPath, parseEditImageParams, SEND_MAX_SIDE, type ImageEditor } from './edit-image.ts';
import { parseImageHeader } from './image-header.ts';
import { PipelineRunner } from './pipeline-runner.ts';

/**
 * 图片编辑（架构设计 §7.9）：参数；用真实的 ffmpeg 跑快速填充、AI 修补（假的图像模型：记下收到的图与提示词，回一张纯绿的图）
 * 与扩图，按像素检查只改了选区、原图那一块原样保留。没有 ffmpeg 时跳过跑流程的几条。
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
type Rgb = [number, number, number];

/** RGB PNG，`pixel(x, y)` 给每个像素的颜色。 */
function png(width: number, height: number, pixel: (x: number, y: number) => Rgb): Buffer {
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
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
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

/** 用 ffmpeg 解码成 RGB，按坐标取像素。 */
function pixels(file: string): { width: number; height: number; at: (x: number, y: number) => Rgb } {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const header = parseImageHeader(execFileSync('cat', [file]))!;
  return {
    width: header.width,
    height: header.height,
    at: (x, y) => {
      const i = (y * header.width + x) * 3;
      return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
    },
  };
}

const near = (a: Rgb, b: Rgb, tolerance = 6) => a.every((v, i) => Math.abs(v - b[i]!) <= tolerance);

const GRAY: Rgb = [128, 128, 128];
const GREEN: Rgb = [0, 200, 0];

describe('图片编辑参数', () => {
  it('每个流程收的选区、提示词、补法与张数', () => {
    const mask = { boxes: [{ x: 1, y: 2, width: 3, height: 4 }] };
    expect(parseEditImageParams('erase', { inputs: ['/a.png'], mask })).toEqual({ inputs: ['/a.png'], mask: { ...mask, strokes: [] } });
    expect(parseEditImageParams('watermark', { inputs: ['/a.png', '/b.png'], mask, method: 'model', provider: 'openai', model: 'gpt-image-1' })).toMatchObject({
      method: 'model',
      provider: 'openai',
    });
    expect(parseEditImageParams('repaint', { inputs: ['/a.png'], mask: { strokes: [{ radius: 4, points: [[1, 1]] }] }, prompt: 'a cat' })).toMatchObject({ prompt: 'a cat' });
    expect(parseEditImageParams('expand', { inputs: ['/a.png'], expand: { ratio: '16:9', anchor: 'left' } })).toMatchObject({ expand: { ratio: '16:9', anchor: 'left' } });
    expect(parseEditImageParams('expand', { inputs: ['/a.png'], expand: { margins: { left: 0, top: 10, right: 0, bottom: 10 } } })).toMatchObject({
      expand: { margins: { top: 10 } },
    });
    const bad: Array<[Parameters<typeof parseEditImageParams>[0], Record<string, unknown>]> = [
      ['erase', { inputs: ['/a.png', '/b.png'], mask }],
      ['erase', { inputs: ['/a.png'] }],
      ['erase', { inputs: ['/a.png'], mask: {} }],
      ['erase', { inputs: ['/a.png'], mask: { boxes: [{ x: -1, y: 0, width: 3, height: 3 }] } }],
      ['erase', { inputs: ['/a.png'], mask: { strokes: [{ radius: 4, points: [[1]] }] } }],
      ['erase', { inputs: ['/a.png'], mask, prompt: 'x' }],
      ['repaint', { inputs: ['/a.png'], mask }],
      ['repaint', { inputs: ['/a.png'], mask, prompt: 'x', method: 'fill' }],
      ['expand', { inputs: ['/a.png'] }],
      ['expand', { inputs: ['/a.png'], expand: { ratio: 'wide' } }],
      ['expand', { inputs: ['/a.png'], expand: { ratio: '16:9', margins: { left: 1, top: 1, right: 1, bottom: 1 } } }],
      ['expand', { inputs: ['/a.png'], expand: { ratio: '16:9' }, mask }],
      ['watermark', { inputs: ['a.png'], mask }],
      ['watermark', { inputs: [{ entryId: 'ent_1' }], mask }],
    ];
    for (const [op, raw] of bad) expect(() => parseEditImageParams(op, raw), JSON.stringify(raw)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
  });

  it('滤镜参数里的路径按两层转义', () => {
    expect(filterPath("/tmp/O'Neil, a:b/[m].png")).toBe("/tmp/O\\\\\\'Neil\\, a\\\\:b/\\[m\\].png");
  });
});

describe.skipIf(!hasFfmpeg)('图片编辑（真实 ffmpeg，假的图像模型）', () => {
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let calls: Array<{ image: string; prompt: string; width: number; height: number; providerId: string; modelId: string; send: { width: number; height: number; center: Rgb } }>;
  let editable: boolean;
  let leases: Array<{ label: string; holder: string | null; queue: string | null }>;

  /** 假的图像模型：记下收到的图（尺寸与中心像素）与提示词，回一张 300×200 的纯绿图（尺寸与工作区不同，流程要缩放回去）。 */
  const editor: ImageEditor = {
    async prepare(target) {
      if (!editable) throw new RpcError('invalid-request', 'no edit', { code: 'IMAGE_EDIT_UNSUPPORTED' });
      return { providerId: target.provider ?? 'fake', modelId: target.model ?? 'fake-edit' };
    },
    resources: ({ providerId, modelId }) =>
      providerId === 'local' ? { demand: { scratchDisk: 1 }, holder: { id: `worker:${modelId}`, demand: { memory: 1 } }, queue: { key: modelId, concurrency: 1 } } : null,
    async edit(request) {
      leases.push(...jobs.resources.snapshot().leases.map(({ label, holder, queue }) => ({ label, holder, queue })));
      const sent = pixels(request.image);
      calls.push({ ...request, send: { width: sent.width, height: sent.height, center: sent.at(sent.width >> 1, sent.height >> 1) } });
      const file = path.join(request.staging, `model-${calls.length}.png`);
      await fs.writeFile(file, png(300, 200, () => GREEN));
      return { file };
    },
  };

  beforeEach(async () => {
    // 路径里有空格、撇号与冒号以外的特殊字符：removelogo 的遮罩路径要转义。
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "baocut edit-O'Neil,["));
    await fs.mkdir(path.join(dir, 'in'));
    calls = [];
    leases = [];
    editable = true;
    jobs = testJobManager(path.join(dir, 'home'));
    await jobs.open();
    runner = new PipelineRunner({
      jobs,
      stagingDir: path.join(dir, 'home', 'staging'),
      definitions: (['erase', 'watermark', 'repaint', 'expand'] as const).map((op) =>
        editImagePipeline(op, { ffmpeg, editor, saveDirectory: () => path.join(dir, 'saved') }),
      ),
    });
    await runner.open();
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 灰底，(x0, y0) 起 w×h 的一块白色「水印」。 */
  async function input(name: string, width: number, height: number, logo?: { x: number; y: number; width: number; height: number }): Promise<string> {
    const file = path.join(dir, 'in', name);
    const inLogo = (x: number, y: number) => !!logo && x >= logo.x && x < logo.x + logo.width && y >= logo.y && y < logo.y + logo.height;
    await fs.writeFile(file, png(width, height, (x, y) => (inLogo(x, y) ? [255, 255, 255] : GRAY)));
    return file;
  }

  async function run(pipeline: string, params: Record<string, unknown>): Promise<JobRecord> {
    const { jobId } = await runner.start({ pipeline, params }, { kind: 'connection', id: 'c' });
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  it('快速填充去水印：一组框用于每一张（按尺寸换算），选区里补成四周的颜色，选区外一个像素都不变，不调用模型', async () => {
    const a = await input('a.png', 200, 100, { x: 150, y: 80, width: 40, height: 12 });
    const b = await input('b.png', 400, 200, { x: 300, y: 160, width: 80, height: 24 });
    const record = await run('remove-watermark', { inputs: [a, b], mask: { boxes: [{ x: 148, y: 78, width: 44, height: 16 }] } });
    expect(record).toMatchObject({ state: 'completed', providerId: 'ffmpeg', videoId: null });
    expect(record.modelId).toMatch(/^removelogo@/);
    const summary = record.pipeline!.summary as unknown as EditImageSummary;
    const saved = path.join(dir, 'saved');
    expect(summary).toMatchObject({ op: 'watermark', method: 'fill', executor: { tool: 'ffmpeg', providerId: null }, files: [path.join(saved, 'a-no-watermark.png'), path.join(saved, 'b-no-watermark.png')] });
    expect(summary.images.map((i) => [i.outWidth, i.outHeight, i.region])).toEqual([
      [200, 100, null],
      [400, 200, null],
    ]);
    for (const [file, logo] of [
      [summary.files[0]!, { x: 150, y: 80, width: 40, height: 12 }],
      [summary.files[1]!, { x: 300, y: 160, width: 80, height: 24 }],
    ] as const) {
      const out = pixels(file);
      expect(near(out.at(logo.x + (logo.width >> 1), logo.y + (logo.height >> 1)), GRAY, 12)).toBe(true);
      expect(out.at(10, 10)).toEqual(GRAY);
      expect(out.at(logo.x - 40, logo.y)).toEqual(GRAY);
    }
    expect(calls).toEqual([]);
    // 原图不动。
    expect(pixels(a).at(160, 85)).toEqual([255, 255, 255]);
  });

  it('AI 修补去除物体：只送选区周围的一块（选区涂成品红），回来缩放到那一块，只贴回选区', async () => {
    const a = await input('photo.png', 1200, 800, { x: 1000, y: 700, width: 100, height: 40 });
    const record = await run('remove-object', { inputs: [a], mask: { strokes: [{ radius: 30, points: [[1010, 720], [1090, 720]] }] }, provider: 'acme', model: 'edit-1' });
    expect(record).toMatchObject({ state: 'completed', providerId: 'acme', modelId: 'edit-1' });
    const summary = record.pipeline!.summary as unknown as EditImageSummary;
    expect(summary.method).toBe('model');
    expect(summary.executor).toMatchObject({ providerId: 'acme', modelId: 'edit-1' });
    const region = summary.images[0]!.region!;
    expect(region).toEqual({ x: 688, y: 288, width: 512, height: 512 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ providerId: 'acme', modelId: 'edit-1', width: 512, height: 512, send: { width: 512, height: 512 } });
    expect(calls[0]!.prompt).toContain('magenta');
    const sent = calls[0]!;
    expect(sent.send.center).toEqual(GRAY);
    const out = pixels(summary.files[0]!);
    expect([out.width, out.height]).toEqual([1200, 800]);
    expect(near(out.at(1050, 720), GREEN)).toBe(true);
    expect(out.at(700, 300)).toEqual(GRAY);
    expect(out.at(1050, 790)).toEqual(GRAY);
    expect(out.at(100, 100)).toEqual(GRAY);
  });

  it('本机模型改图：这一步先占模型包的 Worker、排它的执行队列；在线模型不经资源调度', async () => {
    const a = await input('local.png', 800, 600);
    const mask = { strokes: [{ radius: 30, points: [[400, 300]] as [number, number][] }] };
    expect(await run('remove-object', { inputs: [a], mask, provider: 'local', model: 'bundle-edit' })).toMatchObject({ state: 'completed' });
    expect(leases).toEqual([{ label: 'remove-object:edit', holder: 'worker:bundle-edit', queue: 'bundle-edit' }]);
    leases = [];
    expect(await run('remove-object', { inputs: [a], mask, provider: 'acme', model: 'edit-1' })).toMatchObject({ state: 'completed' });
    expect(leases).toEqual([]);
  });

  it('重绘把提示词带给模型；送去的图长边超过上限时缩小', async () => {
    const a = await input('big.png', 3000, 2000);
    const record = await run('repaint-image', { inputs: [a], mask: { boxes: [{ x: 500, y: 500, width: 1000, height: 600 }] }, prompt: 'a red balloon' });
    expect(record, JSON.stringify(record.error)).toMatchObject({ state: 'completed' });
    expect(calls[0]!.prompt).toContain('a red balloon');
    expect([calls[0]!.width, calls[0]!.height]).toEqual([2000, 1200]);
    expect(Math.max(calls[0]!.send.width, calls[0]!.send.height)).toBe(SEND_MAX_SIDE);
    // 选区中心涂成了品红。
    expect(near(calls[0]!.send.center, [255, 0, 255], 4)).toBe(true);
    const out = pixels((record.pipeline!.summary as unknown as EditImageSummary).files[0]!);
    expect(near(out.at(1000, 800), GREEN)).toBe(true);
    expect(out.at(2900, 1900)).toEqual(GRAY);
  });

  it('扩图：新画布按锚点放原图，新增的部分是模型画的，原图那一块原样保留', async () => {
    const a = await input('wide.png', 160, 90, { x: 0, y: 0, width: 160, height: 90 });
    const record = await run('expand-image', { inputs: [a], expand: { ratio: '1:1', anchor: 'bottom' }, prompt: 'more sky' });
    expect(record.state).toBe('completed');
    const summary = record.pipeline!.summary as unknown as EditImageSummary;
    expect(summary.images[0]).toMatchObject({ outWidth: 160, outHeight: 160, region: { x: 0, y: 0, width: 160, height: 160 } });
    expect(summary.files[0]).toBe(path.join(dir, 'saved', 'wide-expanded.png'));
    expect(calls[0]!.prompt).toContain('more sky');
    expect(near(calls[0]!.send.center, [255, 255, 255], 0)).toBe(true);
    const out = pixels(summary.files[0]!);
    expect(near(out.at(80, 10), GREEN)).toBe(true);
    // 原图那一块（160×90，贴底）连边上的像素都不变。
    for (let y = 70; y < 160; y++) for (let x = 0; x < 160; x++) expect(out.at(x, y), `${x},${y}`).toEqual([255, 255, 255]);
    expect(near(out.at(80, 69), GREEN)).toBe(true);
  });

  it('带 EXIF 方向的 JPEG：选区按转正的画面（同界面里看到的），结果是转正的 PNG', async () => {
    const stored = path.join(dir, 'in', 'stored.jpg');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90', '-frames:v', '1', stored]);
    // 方向 6（顺时针转 90°）：存储 160×90，转正后 90×160。
    const tiff = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
    const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const head = Buffer.from([0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff]);
    const jpeg = await fs.readFile(stored);
    const oriented = path.join(dir, 'in', 'oriented.jpg');
    await fs.writeFile(oriented, Buffer.concat([jpeg.subarray(0, 2), head, app1, jpeg.subarray(2)]));
    const record = await run('remove-watermark', { inputs: [oriented], mask: { boxes: [{ x: 30, y: 120, width: 30, height: 20 }] } });
    expect(record, JSON.stringify(record.error)).toMatchObject({ state: 'completed' });
    const summary = record.pipeline!.summary as unknown as EditImageSummary;
    expect(summary.images[0]).toMatchObject({ outWidth: 90, outHeight: 160 });
    expect(summary.warnings ?? []).toEqual([]);
    const out = pixels(summary.files[0]!);
    expect([out.width, out.height]).toEqual([90, 160]);
  });

  it('启动时拒绝：选区太大、在图外、比例本来就一样、扩得太大、模型不能改图、不是图片；都不建任务', async () => {
    const a = await input('a.png', 100, 100);
    const start = (pipeline: string, params: Record<string, unknown>) => runner.start({ pipeline, params }, { kind: 'connection', id: 'c' });
    await expect(start('remove-object', { inputs: [a], mask: { boxes: [{ x: 0, y: 0, width: 90, height: 90 }] } })).rejects.toMatchObject({ details: { code: 'IMAGE_EDIT_MASK_TOO_LARGE' } });
    await expect(start('remove-object', { inputs: [a], mask: { boxes: [{ x: 200, y: 200, width: 9, height: 9 }] } })).rejects.toMatchObject({ details: { code: 'IMAGE_EDIT_MASK_EMPTY', width: 100, height: 100 } });
    await expect(start('expand-image', { inputs: [a], expand: { ratio: '1:1' } })).rejects.toMatchObject({ details: { code: 'IMAGE_EDIT_NOTHING_TO_DO' } });
    await expect(start('expand-image', { inputs: [a], expand: { margins: { left: 5000, top: 0, right: 0, bottom: 0 } } })).rejects.toMatchObject({ details: { code: 'IMAGE_EDIT_TOO_LARGE' } });
    const text = path.join(dir, 'in', 'note.png');
    await fs.writeFile(text, 'not an image');
    await expect(start('remove-watermark', { inputs: [text], mask: { boxes: [{ x: 0, y: 0, width: 9, height: 9 }] } })).rejects.toMatchObject({ details: { code: 'INPUT_UNREADABLE' } });
    editable = false;
    await expect(start('remove-object', { inputs: [a], mask: { boxes: [{ x: 10, y: 10, width: 9, height: 9 }] } })).rejects.toMatchObject({ details: { code: 'IMAGE_EDIT_UNSUPPORTED' } });
    // 快速填充不用模型，照样能启动。
    expect(await run('remove-object', { inputs: [a], mask: { boxes: [{ x: 10, y: 10, width: 9, height: 9 }] }, method: 'fill' })).toMatchObject({ state: 'completed' });
    expect(calls).toEqual([]);
  });

  it('模型回来的不是图片时失败，不留下输出', async () => {
    const broken: ImageEditor = {
      prepare: editor.prepare,
      async edit(request) {
        const file = path.join(request.staging, 'model.png');
        await fs.writeFile(file, 'oops');
        return { file };
      },
    };
    const solo = new PipelineRunner({
      jobs,
      stagingDir: path.join(dir, 'home', 'staging-2'),
      definitions: [editImagePipeline('erase', { ffmpeg, editor: broken })],
    });
    await solo.open();
    const a = await input('a.png', 64, 64);
    const out = path.join(dir, 'out');
    const { jobId } = await solo.start({ pipeline: 'remove-object', params: { inputs: [a], mask: { boxes: [{ x: 10, y: 10, width: 9, height: 9 }] }, outDir: out } }, { kind: 'connection', id: 'c' });
    await jobs.settled(jobId);
    await solo.idle();
    expect(jobs.inspect(jobId)).toMatchObject({ state: 'failed', error: { code: 'MODEL_OUTPUT_INVALID' } });
    expect(await fs.readdir(out)).toEqual([]);
  });
});
