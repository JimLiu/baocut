import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIO_SEEK_MARGIN_SEC, audioWindow } from './ffmpeg-audio-window.ts';
import {
  CUT_OFFSET_SEC,
  TIMING_RATE,
  buildTimingFixtures,
  canBuildTimingFixtures,
  f32leSamples,
  startDrift,
  type TimingFixtures,
} from './testing/audio-timing.ts';

describe('audioWindow', () => {
  it('does not seek or cut for a window at the top of the file', () => {
    expect(audioWindow(0, null)).toEqual({ inputArgs: [], filters: [] });
    expect(audioWindow(0, 1.5)).toEqual({ inputArgs: ['-t', '1.500000'], filters: [] });
    expect(audioWindow(-1, 1.5)).toEqual({ inputArgs: ['-t', '1.500000'], filters: [] });
  });

  it('does not seek inside the margin: the window is cut from the top', () => {
    expect(audioWindow(0.5, 1)).toEqual({
      inputArgs: ['-t', '1.500000'],
      filters: ['atrim=start=0.500000', 'asetpts=PTS-STARTPTS'],
    });
    expect(audioWindow(AUDIO_SEEK_MARGIN_SEC, null).inputArgs).toEqual([]);
  });

  it('past the margin it seeks ahead and lengthens the read by what it will cut', () => {
    expect(audioWindow(5, 1)).toEqual({
      inputArgs: ['-ss', '3.000000', '-t', '3.000000'],
      filters: ['atrim=start=2.000000', 'asetpts=PTS-STARTPTS'],
    });
    expect(audioWindow(5, null).inputArgs).toEqual(['-ss', '3.000000']);
  });
});

describe.skipIf(!canBuildTimingFixtures())('audioWindow against the source', () => {
  let dir: string;
  let files: TimingFixtures;
  let source: Float32Array;

  const decode = (file: string, startSec: number, durationSec: number): Float32Array => {
    const { inputArgs, filters } = audioWindow(startSec, durationSec);
    return f32leSamples(
      execFileSync(
        'ffmpeg',
        [
          ...['-nostdin', '-hide_banner', '-v', 'error', ...inputArgs, '-i', `file:${file}`, '-map', '0:a:0'],
          ...(filters.length > 0 ? ['-af', filters.join(',')] : []),
          ...['-f', 'f32le', '-ac', '1', '-ar', String(TIMING_RATE), '-'],
        ],
        { maxBuffer: 1 << 28 },
      ),
    );
  };

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-audio-window-'));
    files = buildTimingFixtures(dir);
    source = f32leSamples(execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', `file:${files.wav}`, '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 1 << 28 }));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const DURATION = 0.5;
  const frames = Math.round(DURATION * TIMING_RATE);

  // Inside the margin, on its edge, past it, on a keyframe of the video, and just after one.
  const starts = [0, 0.3, 1, 1.5, 2, 2.01, 2.5, 3, 4, 5.5, 7];

  it.each(starts)('starts on the requested sample of an M4A at %s s', (start) => {
    const pcm = decode(files.m4a, start, DURATION);
    expect(pcm.length).toBe(frames);
    expect(startDrift(source, pcm, Math.round(start * TIMING_RATE))).toBe(0);
  });

  it.each(starts)('starts on the requested sample of AAC in a video at %s s', (start) => {
    const pcm = decode(files.video, start, DURATION);
    expect(pcm.length).toBe(frames);
    expect(startDrift(source, pcm, Math.round(start * TIMING_RATE))).toBe(0);
  });

  // The file the mechanism hits hardest: the discard is the whole edit-list offset, not just the priming.
  it.each(starts)('starts on the requested sample of a file cut with -c copy at %s s', (start) => {
    const pcm = decode(files.cut, start, DURATION);
    expect(pcm.length).toBe(frames);
    expect(startDrift(source, pcm, Math.round((CUT_OFFSET_SEC + start) * TIMING_RATE))).toBe(0);
  });

  // The furthest the discard was measured to reach: the demuxer keeps about a second of pre-roll ahead of an edit, and a cut
  // 1.2 s past a keyframe of a 2 s GOP gets all of it. A seek landing right on a keyframe has nothing else to give up, so this
  // is what sets the margin: 1 s came up 492 frames (11 ms) short here.
  it('outlasts the discard on a cut as far past a keyframe as the demuxer keeps', () => {
    const video = path.join(dir, 'long-gop.mp4');
    const cut = path.join(dir, 'long-gop-cut.mp4');
    const offset = 3.2;
    execFileSync('ffmpeg', [
      ...['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:r=30:d=12', '-i', files.wav],
      ...['-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-g', '60', '-c:a', 'aac', '-b:a', '192k', '-aac_pns', '0', video],
    ]);
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', String(offset), '-i', video, '-c', 'copy', cut]);
    for (const keyframe of [0.8, 2.8, 4.8]) {
      for (const after of [0, 0.01, 0.1, 0.4]) {
        const start = keyframe + AUDIO_SEEK_MARGIN_SEC + after;
        const pcm = decode(cut, start, DURATION);
        expect(startDrift(source, pcm, Math.round((offset + start) * TIMING_RATE)), `at ${start} s`).toBe(0);
      }
    }
  });

  it('gives empty output for a window past the end, as a plain seek does', () => {
    expect(decode(files.m4a, 100, DURATION)).toHaveLength(0);
    // Inside the margin of the end, where the seek still finds audio and only the cut runs out.
    expect(decode(files.m4a, 12.5, DURATION)).toHaveLength(0);
  });
});
