import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { JobRecord } from '@baocut/protocol';
import { downloadTranscript, transcriptText } from './download-transcript.ts';
import type { PipelineStepContext } from './pipeline.ts';
import type { PipelineTranscriber } from './video-create.ts';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'download-transcript-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
const result = { timescale: 48000, segments: [{ start: 24000, end: 72000, text: ' Hello ' }, { start: 172800000, end: 172848000, text: 'World' }] };

it('converts ASR ticks into SRT timestamps and plain text', () => {
  expect(transcriptText(result as never)).toEqual({ txt: 'Hello\nWorld\n', srt: '1\n00:00:00,500 --> 00:00:01,500\nHello\n\n2\n01:00:00,000 --> 01:00:01,000\nWorld\n' });
});

it('publishes beside the downloaded video and reuses completed ASR on retry', async () => {
  const video = path.join(directory, 'video.mp4');
  await fs.writeFile(video, 'video bytes');
  const records: JobRecord[] = [];
  const submitFile = vi.fn(async () => {
    records.push({ jobId: 'asr', kind: 'transcribe', videoId: null, state: 'completed', submitter: { kind: 'pipeline', id: 'download' }, result: { artifactId: 'asr-result' } } as JobRecord);
    return { jobId: 'asr' };
  });
  const jobs = { submitFile, list: () => records, settled: async () => 'completed', inspect: () => records[0], cancel: async () => ({}) } as unknown as PipelineTranscriber;
  const context = { parentJobId: 'download', signal: new AbortController().signal, progress: () => {}, artifacts: { read: async () => Buffer.from(JSON.stringify(result)), put: async (_bytes: Buffer, extension: string) => ({ artifactId: `saved-${extension}` }) } } as unknown as PipelineStepContext<unknown>;
  const first = await downloadTranscript(jobs, context, { file: video, directory });
  expect(first.files).toEqual([path.join(directory, 'video-download.txt'), path.join(directory, 'video-download.srt')]);
  expect(await fs.readFile(first.files[0]!, 'utf8')).toBe('Hello\nWorld\n');
  await downloadTranscript(jobs, context, { file: video, directory });
  expect(submitFile).toHaveBeenCalledTimes(1);
  await fs.writeFile(first.files[0]!, 'user edit');
  await expect(downloadTranscript(jobs, context, { file: video, directory })).rejects.toThrow();
  expect(await fs.readFile(first.files[0]!, 'utf8')).toBe('user edit');
  expect(await fs.readFile(video, 'utf8')).toBe('video bytes');
});

it('ASR failure preserves the downloaded file and does not create transcript files', async () => {
  const video = path.join(directory, 'video.mp4');
  await fs.writeFile(video, 'keep');
  const jobs = { submitFile: async () => ({ jobId: 'asr' }), settled: async () => 'failed', inspect: () => ({ error: { code: 'MODEL_FAILED', message: 'ASR failed' } }), cancel: async () => ({}) } as unknown as PipelineTranscriber;
  const context = { parentJobId: 'download', signal: new AbortController().signal, progress: () => {} } as unknown as PipelineStepContext<unknown>;
  await expect(downloadTranscript(jobs, context, { file: video, directory })).rejects.toMatchObject({ code: 'MODEL_FAILED' });
  expect(await fs.readdir(directory)).toEqual(['video.mp4']);
});
