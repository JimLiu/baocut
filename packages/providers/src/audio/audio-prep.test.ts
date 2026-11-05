import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUT_OFFSET_SEC, buildTimingFixtures, canBuildTimingFixtures, startDrift, type TimingFixtures } from '@baocut/process-host/testing';
import { SAMPLE_RATE, encodeChunk, extractAudio } from './audio-prep.ts';

/** Word times are the range's start plus a position in the master, so the master has to start on the range's first sample. */
describe.skipIf(!canBuildTimingFixtures())('the online master sits on its source', () => {
  const ffmpeg = async () => ({ command: 'ffmpeg', env: process.env });
  const signal = new AbortController().signal;
  let dir: string;
  let files: TimingFixtures;
  let serial = 0;
  /** The source WAV as a master, read from the top where nothing seeks. */
  let source: Float32Array;

  const extract = async (file: string, range?: { startSec: number; durationSec: number | null }) => {
    const out = path.join(dir, `master-${serial++}.wav`);
    const result = await extractAudio({ ffmpeg, file, track: 0, ...(range ? { range } : {}), out, signal });
    return { result, out };
  };

  /** The `data` chunk of a WAV, which ffmpeg can put after a `LIST` chunk. */
  const pcmBytes = async (file: string): Promise<Buffer> => {
    const bytes = await fs.readFile(file);
    for (let at = 12; at + 8 <= bytes.length; ) {
      const size = bytes.readUInt32LE(at + 4);
      if (bytes.toString('ascii', at, at + 4) === 'data') return bytes.subarray(at + 8, at + 8 + size);
      at += 8 + size + (size % 2);
    }
    throw new Error('No data chunk');
  };
  const samples = async (file: string): Promise<Float32Array> => {
    const pcm = await pcmBytes(file);
    return Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768);
  };

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-audio-prep-'));
    files = buildTimingFixtures(dir);
    source = await samples((await extract(files.wav)).out);
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  // Whole frames at both the source rate and 16 kHz, so rounding cannot tell the two apart.
  const starts = [0.5, 1, 1.5, 2, 2.5, 3, 5.5];

  it.each(starts)('from an M4A at %s s', async (startSec) => {
    const { result, out } = await extract(files.m4a, { startSec, durationSec: 1 });
    expect(result).toEqual({ durationSec: 1 });
    expect(startDrift(source, await samples(out), Math.round(startSec * SAMPLE_RATE), SAMPLE_RATE)).toBe(0);
  });

  it.each(starts)('from AAC in a video at %s s', async (startSec) => {
    const { result, out } = await extract(files.video, { startSec, durationSec: 1 });
    expect(result).toEqual({ durationSec: 1 });
    expect(startDrift(source, await samples(out), Math.round(startSec * SAMPLE_RATE), SAMPLE_RATE)).toBe(0);
  });

  it.each(starts)('from a file cut with -c copy at %s s', async (startSec) => {
    const { result, out } = await extract(files.cut, { startSec, durationSec: 1 });
    expect(result).toEqual({ durationSec: 1 });
    expect(startDrift(source, await samples(out), Math.round((CUT_OFFSET_SEC + startSec) * SAMPLE_RATE), SAMPLE_RATE)).toBe(0);
  });

  it('runs to the end of the file without a duration, and says when a track is missing', async () => {
    const { result, out } = await extract(files.m4a, { startSec: 11, durationSec: null });
    expect(result).toEqual({ durationSec: expect.closeTo(1, 2) });
    expect(startDrift(source, await samples(out), 11 * SAMPLE_RATE, SAMPLE_RATE)).toBe(0);
    await expect(extractAudio({ ffmpeg, file: files.m4a, track: 3, out: path.join(dir, 'none.wav'), signal })).resolves.toBe('no-audio-track');
  });

  it('gives an empty master for a range past the end', async () => {
    expect((await extract(files.m4a, { startSec: 100, durationSec: 1 })).result).toEqual({ durationSec: 0 });
    // Inside the margin of the end, where the seek still finds audio and only the cut runs out.
    expect((await extract(files.m4a, { startSec: 12.5, durationSec: 1 })).result).toEqual({ durationSec: 0 });
  });

  /** The chunks are cut from the master with a plain seek. That is safe because it is PCM in WAV; this is what says so. */
  it.each([
    [0, 0.5],
    [0.25, 1],
    [1.5, 2],
    [3.125, 5],
  ])('cuts a chunk from the master sample for sample, %s to %s s', async (startSec, endSec) => {
    const master = (await extract(files.wav)).out;
    const out = path.join(dir, `chunk-${serial++}.wav`);
    await encodeChunk({ ffmpeg, master, startSec, endSec, format: 'wav', out, signal });
    expect(await samples(out)).toEqual(source.subarray(startSec * SAMPLE_RATE, endSec * SAMPLE_RATE));
  });
});
