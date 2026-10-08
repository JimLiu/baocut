import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BaoCutClient } from '@baocut/client';
import {
  RpcError,
  dbToVolume,
  newId,
  type AudioItem,
  type EditOperation,
  type ExportCreateRequest,
  type JobRecord,
  type Project,
  type SequenceItem,
} from '@baocut/protocol';
import { resolveRuntimeHome } from '@baocut/runtime-storage';
import { startRuntime, type RunningRuntime } from '../runtime.ts';
import { resolveEngineHostCommand } from '../videos/engine-host.ts';

/**
 * 端到端：真实的 Runtime、网关与视频引擎；素材是 ffmpeg 现场生成的正弦波。导入 → 剪掉一段 → 变速 → 导出，
 * 检查字幕的时间线时间、剪掉的词不出现、逐词时间与句级文档、音频的时长与拼接、增益与静音、范围、响度标准化、
 * 冻结、预检、取消与重启。缺 engine-host 或 ffmpeg 时跳过。
 */

const engine = resolveEngineHostCommand();
const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!engine) console.warn('跳过导出端到端测试：没有构建 engine-host（npm run build:engine）');
if (!ffmpeg) console.warn('跳过导出端到端测试：没有 ffmpeg / ffprobe');

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const SAMPLE_RATE = 48000;

async function until<T>(read: () => T | undefined | null | false | Promise<T | undefined | null | false>, timeoutMs = 30_000): Promise<T> {
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

function sine(file: string, frequency: number, seconds: number, rate = SAMPLE_RATE): void {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}:duration=${seconds}:sample_rate=${rate}`,
    '-ac',
    '1',
    file,
  ]);
}

/** 解码成单声道 48 kHz 的样本（-1..1）。 */
function samples(file: string): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE), '-'], {
    maxBuffer: 1 << 28,
  });
  const ints = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  return Float32Array.from(ints, (v) => v / 32768);
}

function window(pcm: Float32Array, from: number, to: number): Float32Array {
  return pcm.subarray(Math.round(from * SAMPLE_RATE), Math.round(to * SAMPLE_RATE));
}

/** 过零次数估计的频率。 */
function frequency(pcm: Float32Array): number {
  let crossings = 0;
  for (let i = 1; i < pcm.length; i++) if (pcm[i - 1]! < 0 !== pcm[i]! < 0) crossings++;
  return crossings / 2 / (pcm.length / SAMPLE_RATE);
}

/** 带声音的视频素材：测试图样 + 一个正弦音（AAC）。 */
function toneClip(file: string, frequency: number, seconds: number): void {
  execFileSync('ffmpeg', [
    ...['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=30:duration=${seconds}`],
    ...['-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${seconds}:sample_rate=${SAMPLE_RATE}`],
    ...['-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', file],
  ]);
}

/** `at` 秒附近 50 毫秒里频率为 `f` 的分量的振幅（与相位无关；两个频率同时在响也能分开量）。 */
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

function rms(pcm: Float32Array): number {
  let sum = 0;
  for (const v of pcm) sum += v * v;
  return Math.sqrt(sum / Math.max(1, pcm.length));
}

function probeDuration(file: string): number {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Number(out.trim());
}

/** SRT / VTT 的时间码 → 秒。 */
function cueTimes(content: string): Array<[number, number]> {
  const pattern = /(\d\d):(\d\d):(\d\d)[,.](\d\d\d) --> (\d\d):(\d\d):(\d\d)[,.](\d\d\d)/g;
  const out: Array<[number, number]> = [];
  for (const m of content.matchAll(pattern)) {
    const t = (i: number) => Number(m[i]) * 3600 + Number(m[i + 1]) * 60 + Number(m[i + 2]) + Number(m[i + 3]) / 1000;
    out.push([t(1), t(5)]);
  }
  return out;
}

/** 词：毫秒。 */
const WORDS = [
  { id: 'w1', start: 0, end: 400, text: 'Hello' },
  { id: 'w2', start: 400, end: 900, text: 'world.' },
  { id: 'w3', start: 1100, end: 1600, text: 'Cutaway' },
  { id: 'w4', start: 1600, end: 2300, text: 'gone.' },
  { id: 'w5', start: 2600, end: 3000, text: 'Keep' },
  { id: 'w6', start: 3000, end: 3600, text: 'this.' },
];

function speechBody(words = WORDS) {
  return { schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1000, speakers: [], words, sentences: null, chapters: [] };
}

describe.skipIf(!engine || !ffmpeg)('导出（真实引擎 + ffmpeg）', () => {
  let fixtures: string;
  let dir: string;
  let runtime: RunningRuntime;
  let client: BaoCutClient;
  let project: Project;
  let home: ReturnType<typeof resolveRuntimeHome>;

  beforeAll(async () => {
    fixtures = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-export-fixtures-'));
    sine(path.join(fixtures, 'a.wav'), 440, 4);
    sine(path.join(fixtures, 'b.wav'), 1000, 1);
    sine(path.join(fixtures, 'a-other.wav'), 660, 4);
    sine(path.join(fixtures, 'long.wav'), 300, 600, 8000);
    toneClip(path.join(fixtures, 'tone-a.mp4'), 440, 3);
    toneClip(path.join(fixtures, 'tone-b.mp4'), 1000, 3);
  });

  afterAll(async () => {
    await fs.rm(fixtures, { recursive: true, force: true });
  });

  async function start(): Promise<void> {
    runtime = await startRuntime({ home, drivers: () => [], watchSpace: false, engineHost: engine, videoGraceMs: 100, modelWorker: null });
    const { endpoint, token } = runtime.discovery;
    client = new BaoCutClient({
      resolve: async () => ({ endpoint, token }),
      client: { kind: 'desktop', name: 'test', version: '0' },
      reconnect: false,
    });
    await client.connect();
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-export-'));
    home = resolveRuntimeHome({ BAOCUT_HOME: dir });
    await start();
    ({ project } = await client.request('projects.create', { name: '导出测试' }));
  });

  afterEach(async () => {
    client?.close();
    await runtime?.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** 素材复制到项目目录里（链接素材；测试会改它）。 */
  async function fixture(name: string): Promise<string> {
    const target = path.join(project.path, 'media', name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(fixtures, name), target);
    return target;
  }

  function video(videoId: string) {
    const mirror = runtime.videos.mirror(videoId)!;
    const sequence = mirror.video.sequences[mirror.video.rootSequenceId]!;
    const fps = sequence.fps;
    const start = (item: SequenceItem) =>
      (item.type === 'audio' ? item.fromFrame : 'span' in item ? item.span.fromFrame : 0) * (fps.den / fps.num);
    return {
      revision: mirror.video.revision,
      sequenceId: mirror.video.rootSequenceId,
      audioTrack: sequence.tracks.find((t) => t.kind === 'audio')!.id,
      items: [...sequence.items].sort((a, b) => start(a) - start(b)),
      documents: mirror.video.documents,
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
    });
  }

  async function exportOnce(request: Omit<ExportCreateRequest, 'commandId'>): Promise<JobRecord> {
    const { jobId } = await client.request('exports.create', request);
    const job = await finish(jobId);
    if (job.state !== 'completed') throw new Error(`导出没有完成：${job.state} ${JSON.stringify(job.error)}`);
    return job;
  }

  /** 一段 4 秒的语音素材与它的转写；剪掉 1–2.5 秒，后一段 2 倍速并接到 1 秒处。 */
  async function speechVideo(): Promise<{ videoId: string; documentId: string }> {
    const a = await fixture('a.wav');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '采访' });
    const videoId = ref.videoId;
    const put = await edit(videoId, [
      { type: 'importAsset', path: a, ref: 'a' },
      { type: 'addItem', sequenceId: video(videoId).sequenceId, asset: { ref: 'a' }, at: at(0), alignment: 'nearest-frame' },
      { type: 'putDocument', kind: 'speech', name: '转写', language: 'en', sourceAsset: { ref: 'a' }, body: speechBody() },
    ]);
    const documentId = put.receipt.createdIds.find((id) => id.startsWith('doc'))!;
    const { sequenceId } = video(videoId);
    await edit(videoId, [{ type: 'splitItem', sequenceId, itemId: video(videoId).items[0]!.id, at: at(1), alignment: 'nearest-frame' }]);
    await edit(videoId, [{ type: 'splitItem', sequenceId, itemId: video(videoId).items[1]!.id, at: at(2.5), alignment: 'nearest-frame' }]);
    const [, middle, last] = video(videoId).items;
    await edit(videoId, [
      { type: 'deleteItems', sequenceId, itemIds: [middle!.id] },
      { type: 'moveItem', sequenceId, itemId: last!.id, at: at(1), alignment: 'nearest-frame' },
      { type: 'setSpeed', sequenceId, itemId: last!.id, rate: { num: 2, den: 1 } },
    ]);
    return { videoId, documentId };
  }

  it('字幕与文稿：时间是时间线时间，剪掉的词不出现，变速后的词时间跟着变（AT-30）', async () => {
    const { videoId, documentId } = await speechVideo();

    const srt = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'srt' } });
    const [srtOut] = srt.result!.outputs!;
    expect(srtOut!.path).toBe(path.join(project.path, 'exports', '采访.en.srt'));
    expect(srtOut!.format).toBe('srt');
    expect(srtOut!.mediaType).toBe('application/x-subrip');
    expect(srtOut!.media).toMatchObject({ kind: 'text', entries: 2 });
    expect(srtOut!.validation).toMatchObject({ expectedEntries: 2, entries: 2 });
    expect(srt.export).toMatchObject({ videoRevision: expect.any(String), destination: { files: ['采访.en.srt'] } });
    const srtText = await fs.readFile(srtOut!.path!, 'utf8');
    expect(srtText).toContain('Hello world.');
    expect(srtText).toContain('Keep this.');
    expect(srtText).not.toContain('Cutaway');
    expect(srtText).not.toContain('gone.');
    // 第二句在源素材的 2.6–3.6 秒：剪掉 1–2.5 秒、2 倍速、接在 1 秒处 → 1.05–1.55 秒。
    expect(cueTimes(srtText)).toEqual([
      [0, 0.9],
      [1.05, 1.55],
    ]);

    // 同名再导出一次：不覆盖，加序号。
    const again = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'srt' } });
    expect(again.result!.outputs![0]!.path).toBe(path.join(project.path, 'exports', '采访.en (2).srt'));
    expect(await fs.readFile(srtOut!.path!, 'utf8')).toBe(srtText);

    const vtt = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'vtt', documentId } });
    const vttText = await fs.readFile(vtt.result!.outputs![0]!.path!, 'utf8');
    expect(vttText.startsWith('WEBVTT')).toBe(true);
    expect(cueTimes(vttText)).toEqual([
      [0, 0.9],
      [1.05, 1.55],
    ]);

    const ass = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'ass' } });
    const assText = await fs.readFile(ass.result!.outputs![0]!.path!, 'utf8');
    expect(assText).toContain('[V4+ Styles]');
    expect(assText).toContain('Dialogue: 0,0:00:01.05,0:00:01.55,Default');

    // JSON：逐词时间（时间线时间）。
    const json = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'json' } });
    const body = JSON.parse(await fs.readFile(json.result!.outputs![0]!.path!, 'utf8')) as {
      wordTiming: string;
      segments: Array<{ text: string; words?: Array<{ text: string; start: number; end: number }> }>;
    };
    expect(body.wordTiming).toBe('word');
    expect(body.segments.flatMap((s) => s.words!.map((w) => [w.text, w.start, w.end]))).toEqual([
      ['Hello', 0, 0.4],
      ['world.', 0.4, 0.9],
      ['Keep', 1.05, 1.25],
      ['this.', 1.25, 1.55],
    ]);

    // 文稿：段落文字，剪掉的不在。
    const md = await exportOnce({ videoId, settings: { kind: 'transcript', format: 'md', timestamps: true } });
    const mdOut = md.result!.outputs![0]!;
    expect(mdOut.path).toBe(path.join(project.path, 'exports', '采访.transcript.md'));
    const mdText = await fs.readFile(mdOut.path!, 'utf8');
    expect(mdText).toContain('Hello world.');
    expect(mdText).toContain('Keep this.');
    expect(mdText).not.toContain('Cutaway');
    expect(mdText).toContain('Keep this. [00:00]');

    // 不跳过剪掉的部分：整份原文，时间是素材时间。
    const whole = await exportOnce({ videoId, settings: { kind: 'transcript', format: 'txt', timestamps: true, skipCut: false } });
    const wholeText = await fs.readFile(whole.result!.outputs![0]!.path!, 'utf8');
    expect(wholeText).toContain('Cutaway gone.');
    expect(whole.result!.outputs![0]!.validation).toMatchObject({ expectedDurationSec: 4 }); // 素材的时长（原文跨度 3.6 秒更短）

    // 范围：只要第二句，时间相对范围起点。
    const ranged = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'srt', range: { start: 1, end: 1.75 } } });
    expect(cueTimes(await fs.readFile(ranged.result!.outputs![0]!.path!, 'utf8'))).toEqual([[0.05, 0.55]]);

    // 几段范围：每段一个文件，各自校验、各自发布。
    const parts = await exportOnce({
      videoId,
      settings: {
        kind: 'subtitles',
        format: 'srt',
        ranges: [
          { start: 0, end: 0.95 },
          { start: 1, end: 1.75 },
        ],
      },
    });
    expect(parts.result!.outputs!.map((o) => path.basename(o.path!))).toEqual(['采访.en.part1.srt', '采访.en.part2.srt']);
    expect(new Set(parts.result!.outputs!.map((o) => o.artifactId)).size).toBe(2);
    expect(cueTimes(await fs.readFile(parts.result!.outputs![1]!.path!, 'utf8'))).toEqual([[0.05, 0.55]]);
  });

  it('exports.renderText：不写文件、不建任务，正文与同样设置导出的文件逐字节相同', async () => {
    const { videoId, documentId } = await speechVideo();
    const exportsDir = path.join(project.path, 'exports');
    const settingsList: ExportCreateRequest['settings'][] = [
      { kind: 'transcript', format: 'md' },
      { kind: 'transcript', format: 'md', documentId, timestamps: true },
      { kind: 'transcript', format: 'txt', timestamps: true },
      { kind: 'transcript', format: 'md', frontmatter: true, chapters: true, speakers: false, timestamps: true },
      { kind: 'transcript', format: 'md', frontmatter: true, skipCut: false, timestamps: true },
      { kind: 'transcript', format: 'txt', skipCut: false, range: { start: 1, end: 1.75 } },
      { kind: 'transcript', format: 'json', skipCut: false },
      { kind: 'subtitles', format: 'srt' },
      { kind: 'subtitles', format: 'json' },
    ];
    const rendered = [];
    for (const settings of settingsList) {
      rendered.push(await client.request('exports.renderText', { videoId, settings: settings as never }));
    }
    // 只排正文：没有建目录、没有任务。
    await expect(fs.stat(exportsDir)).rejects.toThrow();
    expect((await client.request('exports.list', { videoId })).jobs).toEqual([]);

    for (const [i, settings] of settingsList.entries()) {
      const { outputs, warnings } = rendered[i]!;
      const job = await exportOnce({ videoId, settings });
      const file = job.result!.outputs![0]!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0]!.content).toBe(await fs.readFile(file.path!, 'utf8'));
      expect(outputs[0]!.mediaType).toBe(file.mediaType);
      expect(outputs[0]!.entries).toBe((file.media as { entries: number }).entries);
      expect(warnings).toEqual(job.warnings ?? []);
      await fs.rm(file.path!);
      expect(path.basename(file.path!)).toBe(outputs[0]!.fileName);
    }
    const md = rendered[0]!.outputs[0]!;
    expect(md).toMatchObject({ fileName: '采访.transcript.md', format: 'md', mediaType: 'text/markdown', words: 4, cjkCharacters: 0 });
    expect(md.content.startsWith('# 采访\n')).toBe(true);

    // 几段范围：每段一份，与每个文件一一对应。
    const ranges = [
      { start: 0, end: 0.95 },
      { start: 1, end: 1.75 },
    ];
    const parts = await client.request('exports.renderText', { videoId, settings: { kind: 'subtitles', format: 'srt', ranges } });
    const job = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'srt', ranges } });
    expect(parts.outputs.map((o) => o.fileName)).toEqual(job.result!.outputs!.map((o) => path.basename(o.path!)));
    for (const [i, output] of parts.outputs.entries())
      expect(output.content).toBe(await fs.readFile(job.result!.outputs![i]!.path!, 'utf8'));

    // 预检的拒绝与 exports.create 相同；不是字幕或文稿的种类在参数校验就被拒。
    const empty = await rejection(
      client.request('exports.renderText', { videoId, settings: { kind: 'transcript', format: 'md', range: { start: 0.92, end: 1.02 } } }),
    );
    expect(empty).toMatchObject({ code: 'invalid-request', details: { code: 'EXPORT_NOTHING_TO_EXPORT' } });
    const audio = await rejection(client.request('exports.renderText', { videoId, settings: { kind: 'audio', format: 'wav' } as never }));
    expect(audio.code).toBe('invalid-request');
    const closed = await rejection(
      client.request('exports.renderText', { videoId: 'video_missing', settings: { kind: 'transcript', format: 'md' } }),
    );
    expect(closed).toMatchObject({ code: 'not-found', details: { code: 'VIDEO_NOT_OPEN' } });
  });

  it('句级文档不写逐词时间；词时间不可信时也不假装逐词（AT-05）', async () => {
    const { videoId } = await speechVideo();
    const caption = {
      schema: 'baocut.caption/1',
      clock: 'sequence',
      timescale: 1000,
      cues: [{ id: 'c1', start: 0, end: 900, text: '第一句。' }],
    };
    const put = await edit(videoId, [{ type: 'putDocument', kind: 'caption', name: '字幕', language: 'zh', body: caption }]);
    const captionId = put.receipt.createdIds.find((id) => id.startsWith('doc'))!;
    const job = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'json', documentId: captionId } });
    const body = JSON.parse(await fs.readFile(job.result!.outputs![0]!.path!, 'utf8')) as {
      wordTiming: string;
      segments: Array<{ text: string; words?: unknown }>;
    };
    expect(body.wordTiming).toBe('none');
    expect(body.segments).toEqual([expect.objectContaining({ text: '第一句。', start: 0, end: 0.9 })]);
    expect(body.segments[0]!.words).toBeUndefined();

    // 有估计时间的词：整段不写逐词时间。
    const estimated = speechBody(WORDS.map((w) => (w.id === 'w5' ? { ...w, timingQuality: 'estimated' } : w)));
    const { items } = video(videoId);
    const assetId = (items[0] as AudioItem).assetRef.id;
    const second = await edit(videoId, [
      { type: 'putDocument', kind: 'speech', name: '估计', language: 'en', sourceAsset: { assetId }, body: estimated },
    ]);
    const estimatedId = second.receipt.createdIds.find((id) => id.startsWith('doc'))!;
    const partial = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'json', documentId: estimatedId } });
    const partialBody = JSON.parse(await fs.readFile(partial.result!.outputs![0]!.path!, 'utf8')) as {
      wordTiming: string;
      segments: Array<{ text: string; words?: unknown }>;
    };
    expect(partialBody.wordTiming).toBe('partial');
    const keep = partialBody.segments.find((s) => s.text.includes('Keep'))!;
    expect(keep.words).toBeUndefined();
  });

  /** A（440 Hz）在 0–1 秒，B（1000 Hz）在 1–2 秒、-6 dB。 */
  async function spliceVideo(): Promise<{ videoId: string; a: AudioItem; b: AudioItem; aPath: string }> {
    const aPath = await fixture('a.wav');
    const bPath = await fixture('b.wav');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '拼接' });
    const videoId = ref.videoId;
    const { sequenceId, audioTrack } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: aPath, ref: 'a' },
      { type: 'importAsset', path: bPath, ref: 'b' },
      { type: 'addItem', sequenceId, asset: { ref: 'a' }, trackId: audioTrack, at: at(0), alignment: 'nearest-frame' },
    ]);
    const a = video(videoId).items[0] as AudioItem;
    await edit(videoId, [{ type: 'trimItem', sequenceId, itemId: a.id, edge: 'end', at: at(1), alignment: 'nearest-frame' }]);
    const assetB = Object.values(runtime.videos.mirror(videoId)!.video.assets).find((asset) => asset.name.startsWith('b'))!;
    await edit(videoId, [
      { type: 'addItem', sequenceId, asset: { assetId: assetB.id }, trackId: audioTrack, at: at(1), alignment: 'nearest-frame' },
    ]);
    const b = video(videoId).items[1] as AudioItem;
    await edit(videoId, [{ type: 'setAudioMix', sequenceId, itemId: b.id, volume: dbToVolume(-6) }]);
    return { videoId, a, b, aPath };
  }

  it('音频：时长、两段频率的拼接、音量、范围、静音与变速', async () => {
    const { videoId, a } = await spliceVideo();
    const job = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav' } });
    const out = job.result!.outputs![0]!;
    expect(out.path).toBe(path.join(project.path, 'exports', '拼接.audio.wav'));
    expect(out.mediaType).toBe('audio/wav');
    expect(out.media).toMatchObject({ kind: 'audio', sampleRate: 48000, channels: 2 });
    expect(out.validation!.durationSec).toBeCloseTo(2, 2);
    expect(Math.abs(probeDuration(out.path!) - 2)).toBeLessThan(0.01);
    const pcm = samples(out.path!);
    expect(frequency(window(pcm, 0.2, 0.8))).toBeCloseTo(440, -1);
    expect(frequency(window(pcm, 1.2, 1.8))).toBeCloseTo(1000, -1);
    // B 降了 6 dB：振幅约为 A 的一半。
    expect(rms(window(pcm, 1.2, 1.8)) / rms(window(pcm, 0.2, 0.8))).toBeCloseTo(0.501, 1);

    const ranged = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav', range: { start: 0.5, end: 1.5 } } });
    const rangedPath = ranged.result!.outputs![0]!.path!;
    expect(Math.abs(probeDuration(rangedPath) - 1)).toBeLessThan(0.01);
    const rangedPcm = samples(rangedPath);
    expect(frequency(window(rangedPcm, 0.1, 0.4))).toBeCloseTo(440, -1);
    expect(frequency(window(rangedPcm, 0.6, 0.9))).toBeCloseTo(1000, -1);

    const { sequenceId } = video(videoId);
    await edit(videoId, [{ type: 'setAudioMix', sequenceId, itemId: a.id, muted: true }]);
    const muted = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav' } });
    const mutedPcm = samples(muted.result!.outputs![0]!.path!);
    expect(rms(window(mutedPcm, 0.1, 0.9))).toBeLessThan(1e-3);
    expect(rms(window(mutedPcm, 1.2, 1.8))).toBeGreaterThan(0.01);

    // 2 倍速：A 只占 0–0.5 秒，音高不变（同预览：变速不变调）。
    await edit(videoId, [
      { type: 'setAudioMix', sequenceId, itemId: a.id, muted: false },
      { type: 'setSpeed', sequenceId, itemId: a.id, rate: { num: 2, den: 1 } },
    ]);
    const fast = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav', channels: 1, sampleRate: 44100 } });
    const fastOut = fast.result!.outputs![0]!;
    expect(fastOut.media).toMatchObject({ kind: 'audio', sampleRate: 44100, channels: 1 });
    const fastPcm = samples(fastOut.path!);
    expect(frequency(window(fastPcm, 0.1, 0.4))).toBeCloseTo(440, -1);
    expect(rms(window(fastPcm, 0.6, 0.9))).toBeLessThan(1e-3);
    expect(frequency(window(fastPcm, 1.2, 1.8))).toBeCloseTo(1000, -1);
  });

  // 母带在 debug 构建的 Worker 里跑，几次导出要的时间比别的用例长。
  it('音频：响度母带做到目标响度与真峰值，实测与增益写进校验；音量高于预览时提醒', async () => {
    const { videoId, b } = await spliceVideo();
    await edit(videoId, [{ type: 'setAudioMix', sequenceId: video(videoId).sequenceId, itemId: b.id, volume: dbToVolume(3) }]);
    const job = await exportOnce({
      videoId,
      settings: { kind: 'audio', format: 'mp3', bitrateKbps: 128, loudness: { integratedLufs: -20, truePeakDb: -2 } },
    });
    const out = job.result!.outputs![0]!;
    expect(out.format).toBe('mp3');
    expect(out.mediaType).toBe('audio/mpeg');
    expect(Math.abs(probeDuration(out.path!) - 2)).toBeLessThan(0.1);
    const loudness = out.validation!.loudness!;
    expect(loudness.target).toEqual({ integratedLufs: -20, truePeakDb: -2 });
    expect(Math.abs(loudness.measured.integratedLufs + 20)).toBeLessThan(0.5);
    expect(loudness.measured.truePeakDb).toBeLessThanOrEqual(-2);
    expect(loudness.gainDb).toBeCloseTo(-20 - loudness.measured.inputLufs, 0);
    expect(job.warnings.map((w) => w.code)).toContain('GAIN_ABOVE_PREVIEW');

    // WAV 是无损的：解码出来的积分响度（ffmpeg ebur128）就是目标，样本峰值不超过真峰值上限；同一份混音再导出逐位相同。
    const wavSettings = { kind: 'audio', format: 'wav', channels: 1, loudness: { integratedLufs: -20, truePeakDb: -2 } } as const;
    const wav = (await exportOnce({ videoId, settings: wavSettings, destination: { fileName: '母带' } })).result!.outputs![0]!;
    const ebur = execFileSync('sh', ['-c', 'ffmpeg -hide_banner -nostats -i "$0" -af ebur128 -f null - 2>&1', wav.path!], {
      encoding: 'utf8',
    });
    const integrated = Number(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(ebur)![1]);
    expect(Math.abs(integrated + 20)).toBeLessThan(0.5);
    const pcm = samples(wav.path!);
    expect(pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0)).toBeLessThanOrEqual(10 ** (-2 / 20));
    const again = (await exportOnce({ videoId, settings: wavSettings, destination: { fileName: '母带二' } })).result!.outputs![0]!;
    expect((await fs.readFile(again.path!)).equals(await fs.readFile(wav.path!))).toBe(true);

    const m4a = await exportOnce({ videoId, settings: { kind: 'audio', format: 'm4a' }, destination: { fileName: '成品' } });
    expect(m4a.result!.outputs![0]!.path).toBe(path.join(project.path, 'exports', '成品.m4a'));
    expect(Math.abs(probeDuration(m4a.result!.outputs![0]!.path!) - 2)).toBeLessThan(0.1);
  }, 60_000);

  it('音频：转场的声音交叉淡化——出场一侧 cos、入场一侧 sin，各自从剪切点之外取 handles', async () => {
    const aPath = await fixture('tone-a.mp4');
    const bPath = await fixture('tone-b.mp4');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '转场' });
    const videoId = ref.videoId;
    const { sequenceId } = video(videoId);
    const sequence = () => runtime.videos.mirror(videoId)!.video.sequences[sequenceId]!;
    const visualTrack = sequence().tracks.find((t) => t.kind === 'visual')!.id;
    await edit(videoId, [
      { type: 'importAsset', path: aPath, ref: 'a' },
      { type: 'importAsset', path: bPath, ref: 'b' },
      { type: 'addItem', sequenceId, asset: { ref: 'a' }, trackId: visualTrack, at: at(0), alignment: 'nearest-frame' },
    ]);
    const a = video(videoId).items[0]!;
    await edit(videoId, [{ type: 'trimItem', sequenceId, itemId: a.id, edge: 'end', at: at(2), alignment: 'nearest-frame' }]);
    const assetB = Object.values(runtime.videos.mirror(videoId)!.video.assets).find((asset) => asset.name.startsWith('tone-b'))!;
    await edit(videoId, [
      { type: 'addItem', sequenceId, asset: { assetId: assetB.id }, trackId: visualTrack, at: at(2), alignment: 'nearest-frame' },
    ]);
    // B 取源的 1–3 秒放在 2–4 秒：剪切点前有 1 秒 handles 给入场的一侧。
    const b = video(videoId).items[1]!;
    await edit(videoId, [{ type: 'trimItem', sequenceId, itemId: b.id, edge: 'start', at: at(3), alignment: 'nearest-frame' }]);
    await edit(videoId, [{ type: 'moveItem', sequenceId, itemId: b.id, at: at(2), alignment: 'nearest-frame' }]);
    await edit(videoId, [
      {
        type: 'setTransition',
        sequenceId,
        leftItemId: a.id,
        rightItemId: b.id,
        kind: 'dissolve',
        duration: at(1),
        alignment: 'nearest-frame',
        placement: 'center',
        audioCrossfade: true,
      },
    ]);
    expect(sequence().transitions).toEqual([expect.objectContaining({ audioCrossfade: true, durationFrames: 30 })]);

    const job = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav' } });
    expect(job.warnings.map((w) => w.code)).not.toContain('CROSSFADE_HANDLE_SHORT');
    const pcm = samples(job.result!.outputs![0]!.path!);
    const refA = tone(pcm, 440, 1);
    const refB = tone(pcm, 1000, 3);
    expect(refA).toBeGreaterThan(0.05);
    expect(refB).toBeGreaterThan(0.05);
    expect(tone(pcm, 1000, 1) / refB).toBeLessThan(0.02);
    expect(tone(pcm, 440, 3) / refA).toBeLessThan(0.02);
    // 转场居中在 2 秒、长 1 秒：[1.5, 2.5) 里 A 的振幅是 cos(pπ/2)，B 是 sin(pπ/2)；2 秒处两边都是 −3 dB。
    for (const t of [1.6, 1.8, 2, 2.2, 2.4]) {
      const p = t - 1.5;
      expect(tone(pcm, 440, t) / refA, `A @ ${t}`).toBeCloseTo(Math.cos((p * Math.PI) / 2), 1);
      expect(tone(pcm, 1000, t) / refB, `B @ ${t}`).toBeCloseTo(Math.sin((p * Math.PI) / 2), 1);
    }
    expect(Math.abs(tone(pcm, 440, 2) / refA - Math.SQRT1_2)).toBeLessThan(0.03);
    expect(Math.abs(tone(pcm, 1000, 2) / refB - Math.SQRT1_2)).toBeLessThan(0.03);

    // 关掉声音交叉淡化：硬切。
    await edit(videoId, [
      {
        type: 'setTransition',
        sequenceId,
        leftItemId: a.id,
        rightItemId: b.id,
        kind: 'dissolve',
        duration: at(1),
        alignment: 'nearest-frame',
        placement: 'center',
        audioCrossfade: false,
      },
    ]);
    const hard = samples((await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav' } })).result!.outputs![0]!.path!);
    expect(tone(hard, 440, 1.8) / refA).toBeCloseTo(1, 1);
    expect(tone(hard, 1000, 1.8) / refB).toBeLessThan(0.02);
    expect(tone(hard, 1000, 2.2) / refB).toBeCloseTo(1, 1);
  });

  it('音频：闪避按规则的梯形压低目标（attack、release 在线性增益上过渡）', async () => {
    const aPath = await fixture('a.wav');
    const bPath = await fixture('tone-b.mp4');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '闪避' });
    const videoId = ref.videoId;
    const { sequenceId, audioTrack } = video(videoId);
    const visualTrack = runtime.videos.mirror(videoId)!.video.sequences[sequenceId]!.tracks.find((t) => t.kind === 'visual')!.id;
    await edit(videoId, [
      { type: 'importAsset', path: aPath, ref: 'a' },
      { type: 'importAsset', path: bPath, ref: 'b' },
      { type: 'addItem', sequenceId, asset: { ref: 'a' }, trackId: audioTrack, at: at(0), alignment: 'nearest-frame' },
      { type: 'addItem', sequenceId, asset: { ref: 'b' }, trackId: visualTrack, at: at(1), alignment: 'nearest-frame' },
    ]);
    const trigger = video(videoId).items.find((i) => i.type !== 'audio')!;
    await edit(videoId, [{ type: 'trimItem', sequenceId, itemId: trigger.id, edge: 'end', at: at(2), alignment: 'nearest-frame' }]);
    // 画面里的声音在 1–2 秒：音乐在 [0.8, 1] 降 12 dB，[2, 2.4] 回来。斜坡在线性增益上：中点是 (1 + 10^(−12/20)) / 2，
    // 约 −4.1 dB；release 走到四分之三处约 −1.8 dB。
    await edit(videoId, [
      {
        type: 'setDucking',
        sequenceId,
        trigger: { kind: 'items', trackIds: [visualTrack] },
        target: { trackIds: [audioTrack] },
        depth: 12,
        attack: '0.2',
        release: '0.4',
      },
    ]);
    const job = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav' } });
    const pcm = samples(job.result!.outputs![0]!.path!);
    const level = tone(pcm, 440, 0.4);
    expect(level).toBeGreaterThan(0.05);
    const db = (t: number) => 20 * Math.log10(tone(pcm, 440, t) / level);
    expect(db(0.6)).toBeCloseTo(0, 0);
    expect(db(0.9)).toBeCloseTo(-4.1, 0);
    expect(db(1.5)).toBeCloseTo(-12, 0);
    expect(db(2.2)).toBeCloseTo(-4.1, 0);
    expect(db(2.3)).toBeCloseTo(-1.8, 0);
    expect(db(3)).toBeCloseTo(0, 0);
    // 触发的声音本身不受影响。
    expect(tone(pcm, 1000, 1.5)).toBeGreaterThan(0.05);

    // 只导出一段范围：压低量按序列时间，不从范围起点重算。
    const ranged = samples(
      (await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav', range: { start: 1.2, end: 3 } } })).result!.outputs![0]!.path!,
    );
    expect(20 * Math.log10(tone(ranged, 440, 0.3) / level)).toBeCloseTo(-12, 0);
    expect(20 * Math.log10(tone(ranged, 440, 1.0) / level)).toBeCloseTo(-4.1, 0);
  });

  it('音频：音量包络取代音量，与淡出相乘；缓动在后一点上；只导出一段范围时按实例时间取样', async () => {
    const aPath = await fixture('a.wav');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '包络' });
    const videoId = ref.videoId;
    const { sequenceId, audioTrack } = video(videoId);
    await edit(videoId, [
      { type: 'importAsset', path: aPath, ref: 'a' },
      { type: 'addItem', sequenceId, asset: { ref: 'a' }, trackId: audioTrack, at: at(0), alignment: 'nearest-frame' },
    ]);
    const placed = video(videoId).items[0] as AudioItem;
    await edit(videoId, [{ type: 'trimItem', sequenceId, itemId: placed.id, edge: 'end', at: at(3), alignment: 'nearest-frame' }]);
    const trimmed = video(videoId).items[0] as AudioItem;
    const point = (seconds: number, volume: number, ease?: string) => ({
      at: { ticks: String(seconds), timescale: 1 },
      volume,
      ...(ease ? { ease } : {}),
    });
    // 0.25 线性升到 1 秒的 1.0，按 easeInQuad 降到 2 秒的 0.5，之后保持；最后半秒淡出。`volume` 不再起作用。
    const { id: _id, ...rest } = trimmed;
    await edit(videoId, [
      { type: 'deleteItems', sequenceId, itemIds: [trimmed.id] },
      {
        type: 'insertItems',
        sequenceId,
        items: [
          {
            ...rest,
            mix: {
              volume: 0.1,
              fadeOut: { ticks: '1', timescale: 2 },
              envelope: [point(0, 0.25), point(1, 1), point(2, 0.5, 'easeInQuad')],
            },
          } as never,
        ],
      },
    ]);
    const job = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav' } });
    expect(job.warnings.map((w) => w.code)).not.toContain('GAIN_ABOVE_PREVIEW');
    const pcm = samples(job.result!.outputs![0]!.path!);
    const level = tone(pcm, 440, 1);
    expect(level).toBeGreaterThan(0.05);
    const db = (t: number) => 20 * Math.log10(tone(pcm, 440, t) / level);
    const expected = (gain: number) => 20 * Math.log10(gain);
    expect(db(0.2)).toBeCloseTo(expected(0.4), 1);
    expect(db(0.5)).toBeCloseTo(expected(0.625), 1);
    // 缓动段的一半：easeInQuad 走了 1/4。
    expect(db(1.5)).toBeCloseTo(expected(0.875), 1);
    expect(db(2.25)).toBeCloseTo(expected(0.5), 1);
    // 淡出的中点：0.5 × 0.5。
    expect(db(2.75)).toBeCloseTo(expected(0.25), 1);

    const ranged = samples(
      (await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav', range: { start: 1.5, end: 3 } } })).result!.outputs![0]!.path!,
    );
    expect(20 * Math.log10(tone(ranged, 440, 0.25) / level)).toBeCloseTo(expected(1 - 0.5 * 0.75 ** 2), 1);
    expect(20 * Math.log10(tone(ranged, 440, 0.75) / level)).toBeCloseTo(expected(0.5), 1);
  });

  it('冻结：提交之后的修改不影响这次导出（AT-25）', async () => {
    const { videoId } = await speechVideo();
    const before = video(videoId);
    const { jobId } = await client.request('exports.create', { videoId, settings: { kind: 'subtitles', format: 'srt' } });
    // 立即删掉所有实例：冻结的快照里还在。
    await edit(videoId, [{ type: 'deleteItems', sequenceId: before.sequenceId, itemIds: before.items.map((i) => i.id) }]);
    const job = await finish(jobId);
    expect(job.state).toBe('completed');
    expect(job.export!.videoRevision).toBe(before.revision);
    const text = await fs.readFile(job.result!.outputs![0]!.path!, 'utf8');
    expect(cueTimes(text)).toHaveLength(2);
    // 现在序列是空的：范围为空。
    const empty = await rejection(client.request('exports.create', { videoId, settings: { kind: 'subtitles', format: 'srt' } }));
    expect(empty.details).toMatchObject({ code: 'EXPORT_RANGE_EMPTY' });
  });

  it('预检：空范围、没有文档、目标已存在或不可写、素材缺失或被改、缺 ffmpeg，都不建任务', async () => {
    const { videoId } = await speechVideo();
    const codeOf = async (request: ExportCreateRequest) =>
      ((await rejection(client.request('exports.create', request))).details as { code: string }).code;

    expect(await codeOf({ videoId, settings: { kind: 'subtitles', format: 'srt', range: { start: 100, end: 200 } } })).toBe(
      'EXPORT_RANGE_EMPTY',
    );
    expect(await codeOf({ videoId, settings: { kind: 'subtitles', format: 'srt', language: 'fr' } })).toBe('EXPORT_SOURCE_NOT_FOUND');
    // 两句之间的空隙：范围里没有文字。
    expect(await codeOf({ videoId, settings: { kind: 'subtitles', format: 'srt', range: { start: 0.92, end: 0.98 } } })).toBe(
      'EXPORT_NOTHING_TO_EXPORT',
    );
    expect(await codeOf({ videoId, settings: { kind: 'subtitles', format: 'srt', bilingual: true } })).toBe('EXPORT_SOURCE_NOT_FOUND');
    expect(await codeOf({ videoId, settings: { kind: 'subtitles', format: 'srt' }, destination: { dir: path.join(dir, 'nope') } })).toBe(
      'EXPORT_DESTINATION_UNWRITABLE',
    );
    expect(await codeOf({ videoId, settings: { kind: 'subtitles', format: 'srt' }, destination: { dir: 'relative' } })).toBe(
      'EXPORT_DESTINATION_UNWRITABLE',
    );
    const taken = path.join(dir, 'taken');
    await fs.mkdir(taken);
    await fs.writeFile(path.join(taken, 'x.srt'), 'mine');
    expect(await codeOf({ videoId, settings: { kind: 'subtitles', format: 'srt' }, destination: { dir: taken, fileName: 'x' } })).toBe(
      'EXPORT_DESTINATION_EXISTS',
    );
    // 明确要求覆盖时替换。
    const overwritten = await exportOnce({
      videoId,
      settings: { kind: 'subtitles', format: 'srt' },
      destination: { dir: taken, fileName: 'x.srt', overwrite: true },
    });
    expect(overwritten.result!.outputs![0]!.path).toBe(path.join(taken, 'x.srt'));
    expect(await fs.readFile(path.join(taken, 'x.srt'), 'utf8')).toContain('Keep this.');

    // 两份同语言的转写：要指定。
    const { items } = video(videoId);
    const assetId = (items[0] as AudioItem).assetRef.id;
    await edit(videoId, [
      { type: 'putDocument', kind: 'speech', name: '第二份', language: 'en', sourceAsset: { assetId }, body: speechBody() },
    ]);
    const ambiguous = await rejection(client.request('exports.create', { videoId, settings: { kind: 'subtitles', format: 'srt' } }));
    expect(ambiguous.details).toMatchObject({ code: 'EXPORT_SOURCE_AMBIGUOUS', candidates: [expect.any(Object), expect.any(Object)] });

    // 显示着两条字幕层：字幕导出要指定，候选连同转写一起列出（同样可以用 documentId 选转写）。
    const cue = (text: string) => ({
      schema: 'baocut.caption/1',
      clock: 'sequence',
      timescale: 1000,
      cues: [{ id: 'c1', start: 0, end: 900, text }],
    });
    await edit(videoId, [
      { type: 'putDocument', ref: 'zh', kind: 'caption', name: '中文字幕', language: 'zh', body: cue('第一句。') },
      { type: 'putDocument', ref: 'ja', kind: 'caption', name: '日文字幕', language: 'ja', body: cue('一文目。') },
      { type: 'addTrack', kind: 'subtitle', ref: 'subs' },
      {
        type: 'insertItems',
        sequenceId: video(videoId).sequenceId,
        items: [
          { type: 'caption', trackRef: 'subs', documentRef: 'zh', span: { fromFrame: 0, durationFrames: 20 } },
          { type: 'caption', trackRef: 'subs', documentRef: 'ja', span: { fromFrame: 20, durationFrames: 20 } },
        ],
      },
    ]);
    const shown = await rejection(client.request('exports.create', { videoId, settings: { kind: 'subtitles', format: 'srt' } }));
    const candidates = (shown.details as { candidates: Array<{ kind: string; language: string }> }).candidates;
    expect(shown.details).toMatchObject({ code: 'EXPORT_SOURCE_AMBIGUOUS' });
    expect(candidates.map((c) => `${c.kind}:${c.language}`).sort()).toEqual(['caption:ja', 'caption:zh', 'speech:en', 'speech:en']);

    // 缺 ffmpeg：带补救办法。
    const saved = process.env.BAOCUT_FFMPEG;
    process.env.BAOCUT_FFMPEG = path.join(dir, 'no-such-ffmpeg');
    try {
      const missing = await rejection(client.request('exports.create', { videoId, settings: { kind: 'audio', format: 'wav' } }));
      expect(missing.details).toMatchObject({ code: 'EXPORT_TOOL_MISSING', remedy: expect.stringContaining('ffmpeg') });
    } finally {
      if (saved === undefined) delete process.env.BAOCUT_FFMPEG;
      else process.env.BAOCUT_FFMPEG = saved;
    }

    // 链接的素材被换了内容（长度相同）、被删掉。
    const linked = path.join(project.path, 'media', 'a.wav');
    await fs.copyFile(path.join(fixtures, 'a-other.wav'), linked);
    expect(await codeOf({ videoId, settings: { kind: 'audio', format: 'wav' } })).toBe('ASSET_CHANGED');
    await fs.rm(linked);
    expect(await codeOf({ videoId, settings: { kind: 'audio', format: 'wav' } })).toBe('ASSET_MISSING');

    // 预检失败的都没有建任务：只有那一次覆盖导出。
    const { jobs } = await client.request('exports.list', { videoId });
    expect(jobs.map((j) => j.jobId)).toEqual([overwritten.jobId]);
  });

  it('取消：清掉 staging，不留半个文件；重启之后任务与产物仍可查（AT-26）', async () => {
    const long = await fixture('long.wav');
    const { ref } = await client.request('videos.create', { projectId: project.id, name: '长音频' });
    const videoId = ref.videoId;
    await edit(videoId, [
      { type: 'importAsset', path: long, ref: 'l' },
      { type: 'addItem', sequenceId: video(videoId).sequenceId, asset: { ref: 'l' }, at: at(0), alignment: 'nearest-frame' },
    ]);
    const { jobId } = await client.request('exports.create', {
      videoId,
      settings: { kind: 'audio', format: 'mp3', loudness: { integratedLufs: -16, truePeakDb: -1.5 } },
    });
    await until(async () => (await client.request('exports.get', { jobId })).state === 'running');
    const staging = path.join(home.stagingDir, 'jobs', jobId);
    await client.request('jobs.cancel', { jobId });
    const cancelled = await finish(jobId);
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.result).toBeNull();
    await until(async () => !(await fs.stat(staging).catch(() => null)));
    const exportsDir = path.join(project.path, 'exports');
    expect(await fs.readdir(exportsDir).catch(() => [])).toEqual([]);

    // 完成一次，再重启：任务记录、输出与产物都还在。
    const done = await exportOnce({ videoId, settings: { kind: 'subtitles', format: 'srt' } }).catch((e: unknown) => e);
    expect(done).toBeInstanceOf(RpcError); // 这个视频没有文档
    const audio = await exportOnce({ videoId, settings: { kind: 'audio', format: 'wav', range: { start: 0, end: 2 } } });
    const output = audio.result!.outputs![0]!;
    client.close();
    await runtime.close();
    await start();
    const again = await client.request('exports.get', { jobId: audio.jobId });
    expect(again.state).toBe('completed');
    expect(again.result!.outputs![0]).toEqual(output);
    expect(await runtime.models.jobs.artifacts.locate(output.artifactId)).toBeTruthy();
    expect((await fs.stat(output.path!)).isFile()).toBe(true);
    const listed = await client.request('exports.list', { videoId });
    expect(listed.jobs.map((j) => [j.jobId, j.state])).toEqual(
      expect.arrayContaining([
        [audio.jobId, 'completed'],
        [jobId, 'cancelled'],
      ]),
    );
    expect((await rejection(client.request('exports.get', { jobId: 'job_nope' }))).code).toBe('not-found');
  });
});
