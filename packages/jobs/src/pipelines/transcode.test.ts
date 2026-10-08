import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord, TranscodeSummary } from '@baocut/protocol';
import type { JobManager } from '../job-manager.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import { probeMedia } from './ffmpeg.ts';
import { PipelineRunner } from './pipeline-runner.ts';
import { extractAudioDecision, mergeDecision, outputName, parseTranscodeParams, transcodePipeline } from './transcode.ts';

/**
 * 文件转码（架构设计 §7.9）：真实的 ffmpeg 处理测试里现做的短片。压缩的编码与分辨率、一致的片段流复制、
 * 不一致的片段重新编码并说明原因、不覆盖已有的文件、取消不留下半成品；没有 ffmpeg 时跳过。
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
if (!hasFfmpeg) console.warn('跳过文件转码的测试：没有 ffmpeg');

const ffmpeg = async () => ({ command: 'ffmpeg', env: process.env });
const ffprobe = async () => ({ command: 'ffprobe', env: process.env });

describe('转码参数', () => {
  it('补上默认值；不合的参数拒绝', () => {
    expect(parseTranscodeParams({ inputs: ['/a.mp4'], action: 'compress' })).toEqual({
      inputs: ['/a.mp4'],
      action: 'compress',
      codec: 'h264',
      crf: 23,
      audioBitrateKbps: 128,
    });
    expect(parseTranscodeParams({ inputs: ['/a.mp4'], action: 'compress', codec: 'hevc', videoBitrateKbps: 800 })).toMatchObject({
      codec: 'hevc',
      videoBitrateKbps: 800,
    });
    for (const bad of [
      { inputs: ['a.mp4'], action: 'compress' },
      { inputs: ['/a.mp4'], action: 'merge' },
      { inputs: ['/a.mp4'], action: 'compress', crf: 20, videoBitrateKbps: 800 },
      { inputs: ['/a.mp4'], action: 'shrink' },
      { inputs: ['/a.mp4'], action: 'compress', outDir: 'rel' },
      { inputs: ['/a.mp4'], action: 'compress', extra: 1 },
      { inputs: ['/a.mp4'], action: 'extract' },
      // Space 条目由 Runtime 在 pipelines.start 换成路径；没换掉的到流程这里拒绝。
      { inputs: [{ entryId: 'ent_1' }], action: 'compress' },
    ]) {
      expect(() => parseTranscodeParams(bad)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
    }
  });

  it('提取音频：AAC、MP3、Opus、FLAC 流复制进对应的容器，其余重新编码为 AAC 并说明原因', () => {
    const audio = (codec: string) => ({ codec, sampleRate: 48000, channels: 2 });
    expect(parseTranscodeParams({ inputs: ['/a.mov', '/b.mov'], action: 'extract-audio' })).toMatchObject({ action: 'extract-audio' });
    expect(extractAudioDecision(audio('aac'))).toEqual({ copy: true, ext: '.m4a', mediaType: 'audio/mp4', reason: null });
    expect(extractAudioDecision(audio('mp3'))).toEqual({ copy: true, ext: '.mp3', mediaType: 'audio/mpeg', reason: null });
    expect(extractAudioDecision(audio('opus'))).toEqual({ copy: true, ext: '.ogg', mediaType: 'audio/ogg', reason: null });
    expect(extractAudioDecision(audio('flac'))).toEqual({ copy: true, ext: '.flac', mediaType: 'audio/flac', reason: null });
    const pcm = extractAudioDecision(audio('pcm_s16le'));
    expect(pcm).toMatchObject({ copy: false, ext: '.m4a', mediaType: 'audio/mp4' });
    expect(pcm.reason).toContain('pcm_s16le');
    // 名字：提取音频不加后缀，扩展名随容器；压缩、合并照旧。
    expect(outputName('extract-audio', '访谈', extractAudioDecision(audio('opus')))).toEqual({ name: '访谈', ext: '.ogg', mediaType: 'audio/ogg' });
    expect(outputName('compress', 'a', undefined)).toEqual({ name: 'a-compressed', ext: '.mp4', mediaType: 'video/mp4' });
    expect(outputName('merge', 'a', undefined)).toEqual({ name: 'a-merged', ext: '.mp4', mediaType: 'video/mp4' });
  });

  it('只有编码参数都一致时才流复制', () => {
    const clip = {
      durationSec: 2,
      formatName: 'mov,mp4',
      video: { codec: 'h264', width: 640, height: 360, pixFmt: 'yuv420p', frameRate: '30/1' },
      audio: { codec: 'aac', sampleRate: 44100, channels: 2 },
    };
    expect(mergeDecision([clip, clip])).toEqual({ mode: 'stream-copy', reason: null });
    const other = { ...clip, video: { ...clip.video, frameRate: '25/1' }, audio: { ...clip.audio, sampleRate: 48000 } };
    const decision = mergeDecision([clip, other]);
    expect(decision.mode).toBe('re-encode');
    expect(decision.reason).toContain('帧率不一致（30/1 / 25/1）');
    expect(decision.reason).toContain('采样率不一致');
    expect(
      mergeDecision([
        { ...clip, video: { ...clip.video, codec: 'vp9' } },
        { ...clip, video: { ...clip.video, codec: 'vp9' } },
      ]).reason,
    ).toContain('vp9');
  });
});

describe.skipIf(!hasFfmpeg)('文件转码（真实 ffmpeg）', () => {
  let clips: string;
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;

  function makeClip(name: string, options: { size: string; rate: number; seconds: number; sampleRate?: number; audio?: boolean }): string {
    const file = path.join(clips, name);
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${options.size}:rate=${options.rate}:duration=${options.seconds}`,
      ...(options.audio === false
        ? []
        : ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${options.sampleRate ?? 44100}:duration=${options.seconds}`]),
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      ...(options.audio === false ? [] : ['-c:a', 'aac', '-ac', '2']),
      '-shortest',
      '-y',
      file,
    ]);
    return file;
  }

  let clipA: string;
  let clipB: string;
  let clipC: string;

  beforeAll(async () => {
    clips = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-transcode-clips-'));
    clipA = makeClip('a.mp4', { size: '640x360', rate: 30, seconds: 2 });
    clipB = makeClip('b.mp4', { size: '640x360', rate: 30, seconds: 2 });
    clipC = makeClip('c.mp4', { size: '320x240', rate: 25, seconds: 1, audio: false });
  }, 60_000);

  afterAll(async () => {
    await fs.rm(clips, { recursive: true, force: true });
  });

  async function open(hardLink = true): Promise<void> {
    jobs = testJobManager(path.join(dir, 'home'));
    await jobs.open();
    runner = new PipelineRunner({
      jobs,
      stagingDir: path.join(dir, 'home', 'staging'),
      definitions: [transcodePipeline({ ffmpeg, ffprobe, hardLink, saveDirectory: () => path.join(dir, 'saved', 'nested') })],
    });
    await runner.open();
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-transcode-'));
    await fs.mkdir(path.join(dir, 'out'));
    await open();
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function transcode(params: Record<string, unknown>): Promise<JobRecord> {
    const { jobId } = await runner.start(
      { pipeline: 'transcode', params: { outDir: path.join(dir, 'out'), ...params } },
      { kind: 'connection', id: 'c' },
    );
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  const summaryOf = (record: JobRecord) => record.pipeline!.summary as unknown as TranscodeSummary;
  const outFiles = async () => (await fs.readdir(path.join(dir, 'out'))).sort();

  it('压缩：编码与高度符合要求，结果报告 ffmpeg 的版本与参数摘要', async () => {
    const record = await transcode({ inputs: [clipA], action: 'compress', maxHeight: 180 });
    expect(record).toMatchObject({ state: 'completed', providerId: 'ffmpeg', videoId: null });
    expect(record.pipeline!.steps.map((s) => s.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    const summary = summaryOf(record);
    const out = path.join(dir, 'out', 'a-compressed.mp4');
    expect(summary).toMatchObject({ action: 'compress', mode: 're-encode', reason: null, files: [out] });
    expect(summary.executor.version).toBe(record.modelId);
    const command = summary.executor.commands[0]!;
    expect(command).toContain('a.mp4');
    expect(command).toContain('libx264');
    expect(command.join(' ')).not.toContain(clips);
    // 输出是最终的文件名，不是 staging 里的临时名字。
    expect(command.at(-1)).toBe('a-compressed.mp4');
    expect(command.join(' ')).not.toMatch(/compressed-1\.mp4|staging/);
    const probed = await probeMedia(ffprobe, out);
    expect(probed.video).toMatchObject({ codec: 'h264', width: 320, height: 180 });
    expect(record.result!.outputs).toEqual([
      expect.objectContaining({
        path: out,
        mediaType: 'video/mp4',
        assetId: null,
        media: expect.objectContaining({ kind: 'video', width: 320, height: 180, videoCodec: 'h264', audioCodec: 'aac' }),
      }),
    ]);
    expect(record.result!.outputs![0]!.byteLength).toBe((await fs.stat(out)).size);
    // 编码的子任务按秒报告进度。
    const encode = jobs.inspect(record.pipeline!.steps[1]!.jobId!);
    expect(encode.progress).toMatchObject({ unit: 'seconds', total: expect.closeTo(2, 1) });
  }, 60_000);

  it('压缩为 HEVC', async () => {
    const record = await transcode({ inputs: [clipA], action: 'compress', codec: 'hevc', crf: 30 });
    expect(record.state).toBe('completed');
    const probed = await probeMedia(ffprobe, summaryOf(record).files[0]!);
    expect(probed.video).toMatchObject({ codec: 'hevc', width: 640, height: 360 });
  }, 60_000);

  it('编码参数一致的片段按顺序流复制合并', async () => {
    const record = await transcode({ inputs: [clipA, clipB], action: 'merge' });
    expect(record.state).toBe('completed');
    const summary = summaryOf(record);
    expect(summary).toMatchObject({ mode: 'stream-copy', reason: null, files: [path.join(dir, 'out', 'a-merged.mp4')] });
    expect(summary.executor.commands[0]).toEqual(expect.arrayContaining(['concat', 'copy', 'concat.txt']));
    expect(summary.executor.commands[0]!.at(-1)).toBe('a-merged.mp4');
    const probed = await probeMedia(ffprobe, summary.files[0]!);
    expect(probed.durationSec).toBeCloseTo(4, 0);
    expect(probed.video).toMatchObject({ codec: 'h264', width: 640, height: 360 });
  }, 60_000);

  it('参数不一致的片段重新编码，结果说明原因', async () => {
    const record = await transcode({ inputs: [clipA, clipC], action: 'merge' });
    expect(record.state).toBe('completed');
    const summary = summaryOf(record);
    expect(summary.mode).toBe('re-encode');
    expect(summary.reason).toContain('分辨率不一致（640x360 / 320x240）');
    expect(summary.reason).toContain('音轨不一致');
    const probed = await probeMedia(ffprobe, summary.files[0]!);
    expect(probed.durationSec).toBeCloseTo(3, 0);
    expect(probed.video).toMatchObject({ codec: 'h264', width: 640, height: 360 });
    expect(probed.audio).toMatchObject({ codec: 'aac', channels: 2 });
  }, 60_000);

  it('不覆盖已有的文件：重名时加序号；不在同一个文件系统时同样不覆盖、不留临时文件', async () => {
    await fs.writeFile(path.join(dir, 'out', 'a-compressed.mp4'), 'mine');
    const first = await transcode({ inputs: [clipA], action: 'compress' });
    expect(summaryOf(first).files).toEqual([path.join(dir, 'out', 'a-compressed-2.mp4')]);
    expect(summaryOf(first).executor.commands[0]!.at(-1)).toBe('a-compressed-2.mp4');
    expect(await fs.readFile(path.join(dir, 'out', 'a-compressed.mp4'), 'utf8')).toBe('mine');

    await runner.idle();
    await jobs.shutdown();
    await open(false);
    const second = await transcode({ inputs: [clipA], action: 'compress' });
    expect(summaryOf(second).files).toEqual([path.join(dir, 'out', 'a-compressed-3.mp4')]);
    expect(await outFiles()).toEqual(['a-compressed-2.mp4', 'a-compressed-3.mp4', 'a-compressed.mp4']);
    expect((await probeMedia(ffprobe, path.join(dir, 'out', 'a-compressed-3.mp4'))).video?.codec).toBe('h264');
  }, 60_000);

  it('没有指定输出目录时写在保存位置（不存在时创建），提交时冻结', async () => {
    const source = path.join(dir, 'src.mp4');
    await fs.copyFile(clipA, source);
    const { jobId } = await runner.start(
      { pipeline: 'transcode', params: { inputs: [source], action: 'compress' } },
      { kind: 'connection', id: 'c' },
    );
    expect(jobs.inspect(jobId).pipeline?.params).toMatchObject({ outDir: path.join(dir, 'saved', 'nested') });
    await jobs.settled(jobId);
    expect(summaryOf(jobs.inspect(jobId)).files).toEqual([path.join(dir, 'saved', 'nested', 'src-compressed.mp4')]);
    await expect(fs.stat(path.join(dir, 'src-compressed.mp4'))).rejects.toThrow();
  }, 60_000);

  it('取消时杀掉 ffmpeg，输出目录与 staging 里都不留下半成品', async () => {
    const long = makeClip('long.mp4', { size: '1280x720', rate: 30, seconds: 30 });
    const { jobId } = await runner.start(
      { pipeline: 'transcode', params: { inputs: [long], action: 'compress', codec: 'hevc', outDir: path.join(dir, 'out') } },
      { kind: 'connection', id: 'c' },
    );
    // 等编码开始并写出一点进度。
    await new Promise<void>((resolve) => {
      const off = jobs.onChange((job) => {
        if (job.parentJobId === jobId && job.step?.name === 'encode' && (job.progress?.done ?? 0) > 0) {
          off();
          resolve();
        }
      });
    });
    expect(await jobs.cancel(jobId)).toEqual({ state: 'cancelled' });
    await runner.idle();
    const record = jobs.inspect(jobId);
    expect(record).toMatchObject({ state: 'cancelled', pipeline: { stoppedAt: 'encode' } });
    expect(await outFiles()).toEqual([]);
    await expect(fs.stat(path.join(dir, 'home', 'staging', 'pipelines', jobId))).rejects.toThrow();
  }, 120_000);

  it('提取音频：AAC 音轨流复制成 .m4a，去掉画面；只校验时长与音频轨', async () => {
    const record = await transcode({ inputs: [clipA], action: 'extract-audio' });
    expect(record.state).toBe('completed');
    const summary = summaryOf(record);
    const out = path.join(dir, 'out', 'a.m4a');
    expect(summary).toMatchObject({ action: 'extract-audio', mode: 'stream-copy', reason: null, files: [out] });
    expect(summary.executor.commands[0]).toEqual(expect.arrayContaining(['-vn', 'copy']));
    expect(summary.executor.commands[0]!.at(-1)).toBe('a.m4a');
    const probed = await probeMedia(ffprobe, out);
    expect(probed.video).toBeNull();
    expect(probed.audio).toMatchObject({ codec: 'aac', channels: 2 });
    expect(record.result!.outputs).toEqual([
      expect.objectContaining({ path: out, mediaType: 'audio/mp4', media: expect.objectContaining({ kind: 'audio', channels: 2 }) }),
    ]);
    // 同名的已有文件不覆盖：再提取一次加序号。
    const again = await transcode({ inputs: [clipA], action: 'extract-audio' });
    expect(summaryOf(again).files).toEqual([path.join(dir, 'out', 'a-2.m4a')]);
  }, 60_000);

  it('提取音频：放不进常见容器的编码重新编码为 AAC 并说明原因；没有音频轨的输入以 TRANSCODE_NO_AUDIO 失败', async () => {
    const pcm = path.join(clips, 'pcm.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:a', 'pcm_s16le', '-y', pcm]);
    const record = await transcode({ inputs: [pcm], action: 'extract-audio' });
    expect(record.state).toBe('completed');
    const summary = summaryOf(record);
    expect(summary).toMatchObject({ mode: 're-encode', files: [path.join(dir, 'out', 'pcm.m4a')] });
    expect(summary.reason).toContain('pcm.mov');
    expect(summary.reason).toContain('pcm_s16le');
    expect((await probeMedia(ffprobe, summary.files[0]!)).audio?.codec).toBe('aac');

    const silent = await transcode({ inputs: [clipC], action: 'extract-audio' });
    expect(silent).toMatchObject({
      state: 'failed',
      error: { code: 'TRANSCODE_NO_AUDIO', details: { step: 'probe' } },
      pipeline: { stoppedAt: 'probe' },
    });
  }, 60_000);

  it('输入读不出来时停在读取这一步', async () => {
    const bogus = path.join(dir, 'bogus.mp4');
    await fs.writeFile(bogus, 'not a video');
    const record = await transcode({ inputs: [bogus], action: 'compress' });
    expect(record).toMatchObject({
      state: 'failed',
      error: { code: 'INPUT_UNREADABLE', details: { step: 'probe' } },
      pipeline: { stoppedAt: 'probe' },
    });
    expect(await outFiles()).toEqual([]);
  }, 60_000);
});

describe('保存位置不能写入', () => {
  it('输出目录是个文件：启动时以 OUTPUT_DESTINATION_UNAVAILABLE 拒绝，不建任务', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-transcode-dest-'));
    try {
      const jobs = testJobManager(dir);
      await jobs.open();
      const missing = async () => ({ command: path.join(dir, 'no-ffmpeg'), env: process.env });
      const blocked = path.join(dir, 'blocked');
      await fs.writeFile(blocked, 'x');
      const runner = new PipelineRunner({
        jobs,
        stagingDir: path.join(dir, 'staging'),
        definitions: [transcodePipeline({ ffmpeg: missing, ffprobe: missing, saveDirectory: () => blocked })],
      });
      const input = path.join(dir, 'in.mp4');
      await fs.writeFile(input, 'x');
      for (const params of [{ inputs: [input], action: 'compress' }, { inputs: [input], action: 'compress', outDir: path.join(blocked, 'sub') }]) {
        await expect(runner.start({ pipeline: 'transcode', params }, { kind: 'connection', id: 'c' })).rejects.toMatchObject({
          code: 'conflict',
          details: { code: 'OUTPUT_DESTINATION_UNAVAILABLE' },
        });
      }
      expect(jobs.list()).toEqual([]);
      await jobs.shutdown();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('没有 ffmpeg 时', () => {
  it('启动时以 MEDIA_TOOL_UNAVAILABLE 拒绝，不建任务', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-transcode-missing-'));
    try {
      const jobs = testJobManager(dir);
      await jobs.open();
      const missing = async () => ({ command: path.join(dir, 'no-ffmpeg'), env: process.env });
      const runner = new PipelineRunner({
        jobs,
        stagingDir: path.join(dir, 'staging'),
        definitions: [transcodePipeline({ ffmpeg: missing, ffprobe: missing })],
      });
      const input = path.join(dir, 'in.mp4');
      await fs.writeFile(input, 'x');
      await expect(
        runner.start({ pipeline: 'transcode', params: { inputs: [input], action: 'compress' } }, { kind: 'connection', id: 'c' }),
      ).rejects.toMatchObject({
        code: 'conflict',
        details: { code: 'MEDIA_TOOL_UNAVAILABLE', remedy: expect.stringContaining('安装 ffmpeg') },
      });
      expect(jobs.list()).toEqual([]);
      await jobs.shutdown();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
