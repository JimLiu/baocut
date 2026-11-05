import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JobRecord, SeparateAudioSummary } from '@baocut/protocol';
import type { JobManager } from '../job-manager.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import type { DubSeparator } from './dub.ts';
import { PipelineRunner } from './pipeline-runner.ts';
import { parseSeparateAudioParams, separateAudioPipeline, SEPARATE_AUDIO_PIPELINE } from './separate-audio.ts';

/** 分轨（架构设计 §7.9）：假的分离模型（把输入转成 WAV 当作每一轨），真实的 ffmpeg 与 ffprobe；没有 ffmpeg 时跳过。 */

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const ffprobe = async () => ({ command: 'ffprobe', env: process.env });

describe('分轨的参数', () => {
  it('补上默认值；不合的参数拒绝', () => {
    expect(parseSeparateAudioParams({ inputs: ['/a.mp3'] })).toEqual({ inputs: ['/a.mp3'], stems: 'vocals' });
    for (const bad of [{ inputs: ['a.mp3'] }, { inputs: [] }, { inputs: ['/a.mp3'], stems: 'six' }, { inputs: ['/a.mp3'], outDir: 'rel' }, { inputs: ['/a.mp3'], extra: 1 }]) {
      expect(() => parseSeparateAudioParams(bad)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
    }
  });
});

describe.skipIf(!hasFfmpeg)('分轨（假的分离模型）', () => {
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let fourStems: boolean;
  let requests: Array<{ file: string; allStems?: boolean }>;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-separate-'));
    await fs.mkdir(path.join(dir, 'in'));
    fourStems = true;
    requests = [];
    // song() makes a one-second AAC fixture; do not emit its encoder padding as extra stem audio.
    const wav = (input: string, output: string) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', input, '-map', '0:a:0', '-t', '1', '-c:a', 'pcm_s16le', output]);
    const separator = async (): Promise<DubSeparator> => ({
      providerId: 'local',
      modelId: 'htdemucs-test',
      workerWeightBytes: null,
      fourStems,
      separate: async ({ file, staging, allStems }) => {
        requests.push({ file, ...(allStems ? { allStems } : {}) });
        const stem = (name: string) => {
          const out = path.join(staging, `${name}.wav`);
          wav(file, out);
          return out;
        };
        return {
          vocals: stem('vocals'),
          background: stem('background'),
          ...(allStems ? { drums: stem('drums'), bass: stem('bass'), other: stem('other') } : {}),
        };
      },
    });
    jobs = testJobManager(path.join(dir, 'home'));
    await jobs.open();
    runner = new PipelineRunner({
      jobs,
      stagingDir: path.join(dir, 'home', 'staging'),
      definitions: [separateAudioPipeline({ separator, ffprobe, saveDirectory: () => path.join(dir, 'saved') })],
    });
    await runner.open();
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  function song(name: string): string {
    const file = path.join(dir, 'in', name);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-c:a', 'aac', file]);
    return file;
  }

  async function run(params: Record<string, unknown>): Promise<JobRecord> {
    const { jobId } = await runner.start({ pipeline: SEPARATE_AUDIO_PIPELINE, params }, { kind: 'connection', id: 'c' });
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  it('两轨：人声与伴奏，发布成 <源文件名>-<轨>.wav', async () => {
    const source = song('song.m4a');
    const record = await run({ inputs: [source] });
    expect(record).toMatchObject({ state: 'completed', providerId: 'local', modelId: 'htdemucs-test' });
    const summary = record.pipeline!.summary as unknown as SeparateAudioSummary;
    const saved = path.join(dir, 'saved');
    expect(summary).toMatchObject({
      stems: 'vocals',
      executor: { providerId: 'local', modelId: 'htdemucs-test' },
      files: [path.join(saved, 'song-vocals.wav'), path.join(saved, 'song-background.wav')],
    });
    expect(summary.items[0]!.files).toEqual({ vocals: path.join(saved, 'song-vocals.wav'), background: path.join(saved, 'song-background.wav') });
    expect(requests).toEqual([{ file: source }]);
    expect(record.result!.outputs!.map((o) => o.media)).toEqual([
      expect.objectContaining({ kind: 'audio', channels: 1, durationSec: 1 }),
      expect.objectContaining({ kind: 'audio', channels: 1, durationSec: 1 }),
    ]);
  });

  it('四轨：另出鼓、贝斯与其他', async () => {
    const source = song('song.m4a');
    const record = await run({ inputs: [source], stems: 'four', outDir: path.join(dir, 'out') });
    expect(record.state).toBe('completed');
    const summary = record.pipeline!.summary as unknown as SeparateAudioSummary;
    expect(Object.keys(summary.items[0]!.files).sort()).toEqual(['background', 'bass', 'drums', 'other', 'vocals']);
    expect(requests).toEqual([{ file: source, allStems: true }]);
    await expect(fs.stat(path.join(dir, 'out', 'song-drums.wav'))).resolves.toBeTruthy();
  });

  it('模型只能分两轨时，四轨在启动时拒绝', async () => {
    fourStems = false;
    await expect(run({ inputs: [song('song.m4a')], stems: 'four' })).rejects.toMatchObject({
      code: 'invalid-request',
      details: expect.objectContaining({ code: 'SEPARATION_STEMS_UNSUPPORTED' }),
    });
    expect(requests).toEqual([]);
  });

  it('没有音轨时在启动时拒绝', async () => {
    const silent = path.join(dir, 'in', 'silent.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:size=64x64:rate=10:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silent]);
    await expect(run({ inputs: [silent] })).rejects.toMatchObject({ details: expect.objectContaining({ code: 'AUDIO_NO_STREAM' }) });
  });
});
