import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fixtures for checking where decoded audio really starts, against the source rather than against another ffmpeg decode:
 * what ffmpeg does after a seek changes between versions, so it cannot be its own reference.
 */

/** The rate of the fixtures. */
export const TIMING_RATE = 44_100;
/** Where the cut fixture's timeline starts in the source. Far enough past a keyframe to give the edit list a real offset. */
export const CUT_OFFSET_SEC = 2.77;

export interface TimingFixtures {
  /** Fixed-seed noise, mono 16-bit PCM: no priming and no lossy codec, so this is the ground truth for timing. */
  wav: string;
  /** The same audio as AAC in M4A, with its 1024 frames of priming. */
  m4a: string;
  /** Video with a keyframe every second, audio as AAC. A seek lands on the keyframe before the window. */
  video: string;
  /** `video` cut with `-c copy` at `CUT_OFFSET_SEC`, so it carries an edit list. Its time 0 is the source at that offset. */
  cut: string;
}

/** Whether this machine has an ffmpeg that can build the fixtures. */
export function canBuildTimingFixtures(ffmpeg = 'ffmpeg'): boolean {
  try {
    const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 24 });
    return /\baac\b/.test(encoders) && /\bmpeg4\b/.test(encoders);
  } catch {
    return false;
  }
}

/** Band-limited noise: AAC keeps its waveform, and it lines up with itself at one lag only. */
function noise(frames: number): Int16Array {
  const out = new Int16Array(frames);
  let state = 0x12345678;
  let low = 0;
  for (let i = 0; i < frames; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    low += 0.25 * ((state / 2 ** 32) * 2 - 1 - low);
    out[i] = Math.round(low * 0.8 * 32767);
  }
  return out;
}

function wavBytes(samples: Int16Array, rate: number): Buffer {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(36 + samples.byteLength, 4);
  head.write('WAVEfmt ', 8, 'ascii');
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36, 'ascii');
  head.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([head, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}

/** Write the fixtures into `dir`. `seconds` has to reach past the last window a test asks for, plus `CUT_OFFSET_SEC`. */
export function buildTimingFixtures(dir: string, seconds = 12, ffmpeg = 'ffmpeg'): TimingFixtures {
  const run = (args: string[]) => execFileSync(ffmpeg, ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wav = path.join(dir, 'timing-source.wav');
  const m4a = path.join(dir, 'timing-source.m4a');
  const video = path.join(dir, 'timing-video.mp4');
  const cut = path.join(dir, 'timing-cut.mp4');
  fs.writeFileSync(wav, wavBytes(noise(TIMING_RATE * seconds), TIMING_RATE));
  // Noise substitution has a running PRNG, so its samples would not survive a seek.
  const aac = ['-c:a', 'aac', '-b:a', '192k', '-aac_pns', '0'];
  run(['-i', wav, ...aac, m4a]);
  run(['-f', 'lavfi', '-i', `color=c=gray:s=64x64:r=30:d=${seconds}`, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-g', '30', ...aac, video]);
  run(['-ss', String(CUT_OFFSET_SEC), '-i', video, '-c', 'copy', cut]);
  return { wav, m4a, video, cut };
}

/** Little-endian f32 PCM, as `-f f32le` writes it. */
export function f32leSamples(bytes: Buffer): Float32Array {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~3));
  return new Float32Array(copy);
}

const SHRINK = 4;

function shrink(samples: Float32Array): Float32Array {
  const out = new Float32Array(Math.floor(samples.length / SHRINK));
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (let j = 0; j < SHRINK; j += 1) sum += samples[i * SHRINK + j]!;
    out[i] = sum;
  }
  return out;
}

/**
 * Where `candidate` really starts in `source`, in frames past `expected`. Accurate is 0, and positive means it starts late,
 * so it plays early. Searches 2 s either way: a seek can lose most of a second, which a narrow search would misread.
 */
export function startDrift(source: Float32Array, candidate: Float32Array, expected: number, rate = TIMING_RATE): number {
  if (candidate.length < 2048) throw new Error(`Only ${candidate.length} frames to line up`);
  const coarseSource = shrink(source);
  const coarse = shrink(candidate);
  const length = Math.min(coarse.length, 2048);
  const reach = Math.floor((2 * rate) / SHRINK);
  const centre = Math.floor(expected / SHRINK);
  let best = centre;
  let score = -Infinity;
  for (let at = Math.max(0, centre - reach); at <= Math.min(coarseSource.length - length, centre + reach); at += 1) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += coarseSource[at + i]! * coarse[i]!;
    if (sum > score) {
      score = sum;
      best = at;
    }
  }
  const fineLength = Math.min(candidate.length, 8192);
  let fine = best * SHRINK;
  let top = -Infinity;
  for (let at = Math.max(0, best * SHRINK - 2 * SHRINK); at <= Math.min(source.length - fineLength, best * SHRINK + 2 * SHRINK); at += 1) {
    let sum = 0;
    for (let i = 0; i < fineLength; i += 1) sum += source[at + i]! * candidate[i]!;
    if (sum > top) {
      top = sum;
      fine = at;
    }
  }
  return fine - expected;
}
