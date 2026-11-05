import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audioWindow } from '@baocut/process-host';
import { buildTimingFixtures, canBuildTimingFixtures, f32leSamples, startDrift, type TimingFixtures } from '@baocut/process-host/testing';
// @ts-expect-error A standalone script with no types.
import { audioWindow as scriptWindow, quoteCutArgs } from '../skills/baocut/built-in-skills/production-scripts/scripts/lib.mjs';

const SCRIPTS = path.resolve(import.meta.dirname, '../skills/baocut/built-in-skills/production-scripts/scripts');

/** The production scripts get copied away from the repository, so they keep their own copy of `audioWindow`. */
describe('the scripts’ audio window', () => {
  it.each([
    [0, null],
    [0, 1.5],
    [0.5, 1],
    [2, 1],
    [5, 1],
    [5, null],
  ])('matches the original at %s s for %s s', (start, duration) => {
    const { inputArgs, filters } = audioWindow(start, duration);
    expect(scriptWindow(start, duration)).toEqual({ input: inputArgs, filters });
  });
});

/** Each of these was off by the frames a decoder lost after `-ss`: the reference is always the source WAV. */
describe.skipIf(!canBuildTimingFixtures())('production scripts against the source', () => {
  let dir: string;
  let files: TimingFixtures;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'baocut-scripts-timing-'));
    files = buildTimingFixtures(dir);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  // It tells you to shift the audio by what it reports, so a false lag becomes a real one. An M4A and its own source read
  // 20 ms apart at 2 s before.
  it('level --lag reads no lag between an M4A and its own source', () => {
    const output = execFileSync(process.execPath, [path.join(SCRIPTS, 'level.mjs'), '--lag', files.m4a, files.wav, '--at', '2,3,4'], { encoding: 'utf8' });
    const readings = [...output.matchAll(/by ([\d.]+) ms/g)].map((match) => Number(match[1]));
    expect(readings).toHaveLength(3);
    for (const ms of readings) expect(ms).toBeLessThan(0.5);
  });

  it('quotes cuts from the requested sample', () => {
    const source = f32leSamples(execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', files.wav, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'], { maxBuffer: 1 << 28 }));
    for (const from of [0.5, 2, 3, 5.5]) {
      const out = path.join(dir, `quote-${from}.wav`);
      execFileSync('ffmpeg', ['-nostdin', ...(quoteCutArgs(files.m4a, from, from + 1, out) as string[])]);
      const pcm = f32leSamples(execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', out, '-f', 'f32le', '-ac', '1', '-'], { maxBuffer: 1 << 28 }));
      expect(startDrift(source, pcm, from * 16_000, 16_000)).toBe(0);
    }
  });

  it('envelope lines its bars up with the source', () => {
    // Noise that keeps switching level, so the bars have a shape to line up. The WAV is the reference: nothing is lost seeking in it.
    const gated = path.join(dir, 'gated.wav');
    const encoded = path.join(dir, 'gated.m4a');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', files.wav, '-af', "volume='if(lt(mod(t*7.3,1),0.5),1,0.1)':eval=frame", gated]);
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', gated, '-c:a', 'aac', '-b:a', '192k', '-aac_pns', '0', encoded]);
    const barsOf = (file: string): number[] => {
      const out = path.join(dir, 'wave.js');
      execFileSync(process.execPath, [path.join(SCRIPTS, 'envelope.mjs'), file, '--out', out, '--from', '2', '--to', '4', '--bars', '200', '--var', 'WAVE'], { stdio: 'ignore' });
      const window: { WAVE?: { bars: number[] } } = {};
      new Function('window', fs.readFileSync(out, 'utf8'))(window);
      return window.WAVE!.bars;
    };
    const [reference, bars] = [barsOf(gated), barsOf(encoded)];
    const scoreAt = (lag: number) => {
      let sum = 0;
      for (let i = 10; i < 190; i += 1) sum += reference[i]! * bars[i + lag]!;
      return sum;
    };
    const lags = Array.from({ length: 11 }, (_, i) => i - 5);
    // 10 ms a bar. A 20 ms loss moved the shape two bars.
    expect(lags.reduce((best, lag) => (scoreAt(lag) > scoreAt(best) ? lag : best))).toBe(0);
  });
});
