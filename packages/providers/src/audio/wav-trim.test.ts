import { describe, expect, it } from 'vitest';
import { inspectWav } from '@baocut/models';
import { mp3Fixture, wavFixture } from '../testing/media-fixtures.ts';
import { trimWavHead } from './wav-trim.ts';

/**
 * 克隆参考录音的截短（架构设计 §6.4「音色克隆的请求」）：比上限长的 WAV 只留开头、切在上限前最后 3 秒里最安静的地方；
 * 别的输入逐字节原样返回。录音是这里合成的：「说话」是带一点噪声的正弦波，字与字之间留出更安静的间隙。
 */

interface Synth {
  sampleRate: number;
  seconds: number;
  channels?: number;
  bits?: 16 | 24;
  /** 第 `t` 秒、第 `channel` 个声道的样本（满幅为 1）。 */
  sample: (t: number, channel: number) => number;
}

function synthWav({ sampleRate, seconds, channels = 1, bits = 16, sample }: Synth): Buffer {
  const width = bits / 8;
  const frames = Math.round(seconds * sampleRate);
  const data = frames * channels * width;
  const buffer = Buffer.alloc(44 + data + (data % 2));
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * width, 28);
  buffer.writeUInt16LE(channels * width, 32);
  buffer.writeUInt16LE(bits, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(data, 40);
  let at = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++, at += width) {
      const value = Math.max(-1, Math.min(1, sample(i / sampleRate, c)));
      if (bits === 16) buffer.writeInt16LE(Math.round(value * 32_767), at);
      else buffer.writeIntLE(Math.round(value * 8_388_607), at, 3);
    }
  }
  return buffer;
}

/** 确定的伪随机噪声（-1..1）。 */
function noise(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 1_073_741_824 - 1;
  };
}

/** 一直在说话，每秒有一个轻声的间隙（0.80–0.95 秒处）；`silence` 里的那段是真正的静音。 */
function speech(silence: [number, number]): (t: number) => number {
  const rand = noise();
  return (t) => {
    if (t >= silence[0] && t < silence[1]) return 0;
    const inWord = t % 1 < 0.8 || t % 1 >= 0.95;
    return inWord ? 0.5 * Math.sin(2 * Math.PI * 220 * t) + 0.05 * rand() : 0.01 * rand();
  };
}

function chunks(bytes: Buffer): Array<{ id: string; size: number }> {
  const out: Array<{ id: string; size: number }> = [];
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const size = bytes.readUInt32LE(offset + 4);
    out.push({ id: bytes.toString('ascii', offset, offset + 4), size });
    offset += 8 + size + (size % 2);
  }
  return out;
}

describe('trimWavHead', () => {
  it('不比上限长的 WAV 原样返回（同一个 Buffer）', () => {
    const short = wavFixture(12, 48_000);
    const kept = trimWavHead(short, 30);
    expect(kept.bytes).toBe(short);
    expect(kept.keptSec).toBeNull();
    const exact = wavFixture(30, 8_000);
    expect(trimWavHead(exact, 30).bytes).toBe(exact);
  });

  it('48 kHz、180 秒的样本截到 30 秒以内：头是合法的 WAV，数据是原录音的开头', () => {
    const sampleRate = 48_000;
    const long = synthWav({ sampleRate, seconds: 180, sample: speech([28.4, 28.7]) });
    const { bytes, keptSec } = trimWavHead(long, 30);
    expect(keptSec).not.toBeNull();
    expect(keptSec!).toBeLessThanOrEqual(30);
    expect(keptSec!).toBeGreaterThanOrEqual(27);
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
    expect(chunks(bytes)).toEqual([
      { id: 'fmt ', size: 16 },
      { id: 'data', size: bytes.length - 44 },
    ]);
    expect(bytes.subarray(12, 36)).toEqual(long.subarray(12, 36));
    expect(bytes.subarray(44).equals(long.subarray(44, bytes.length))).toBe(true);
    const wav = inspectWav(bytes);
    expect(wav).toMatchObject({ ok: true, wav: { sampleRate, channels: 1, bitsPerSample: 16 } });
    expect(wav.ok && wav.wav.durationSec).toBeCloseTo(keptSec!, 6);
  });

  it('切在上限前最安静的间隙里，不切在字中间', () => {
    const sampleRate = 48_000;
    const long = synthWav({ sampleRate, seconds: 40, sample: speech([28.4, 28.7]) });
    const { bytes, keptSec } = trimWavHead(long, 30);
    expect(keptSec!).toBeGreaterThan(28.4);
    expect(keptSec!).toBeLessThan(28.7);
    // 切点前后各 5 ms 都是静音。
    const at = 44 + Math.round(keptSec! * sampleRate) * 2;
    const around = long.subarray(at - 480, at + 480);
    for (let i = 0; i < around.length; i += 2) expect(around.readInt16LE(i)).toBe(0);
    expect(bytes.length).toBe(at);

    // 没有真正的静音时，切在一个轻声的间隙里（每秒的 0.80–0.95 秒处），而不是 30 秒处的字中间。
    const noisy = trimWavHead(synthWav({ sampleRate, seconds: 40, sample: speech([0, 0]) }), 30);
    expect(noisy.keptSec!).toBeGreaterThan(27);
    expect(noisy.keptSec! % 1).toBeGreaterThan(0.8);
    expect(noisy.keptSec! % 1).toBeLessThan(0.95);
  });

  it('双声道 24 位：按采样帧切，数据长度为奇数时补齐', () => {
    const sampleRate = 11_025;
    const quiet: [number, number] = [4.2, 4.5];
    const voice = speech(quiet);
    const long = synthWav({ sampleRate, seconds: 9, channels: 2, bits: 24, sample: (t, c) => voice(t) * (c === 0 ? 1 : 0.5) });
    const { bytes, keptSec } = trimWavHead(long, 5);
    expect(keptSec!).toBeGreaterThan(quiet[0]);
    expect(keptSec!).toBeLessThan(quiet[1]);
    const [, data] = chunks(bytes);
    expect(data!.size % 6).toBe(0);
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(inspectWav(bytes)).toMatchObject({ ok: true, wav: { channels: 2, bitsPerSample: 24, sampleRate } });

    // 单声道 24 位、切下奇数个采样帧：data 的长度是奇数，块后补一个字节，RIFF 的长度算上它。
    const mono = synthWav({ sampleRate: 8_001, seconds: 4, bits: 24, sample: speech([2.5, 2.7]) });
    const odd = trimWavHead(mono, 3).bytes;
    const size = odd.readUInt32LE(40);
    expect(size % 2).toBe(1);
    expect(odd.length).toBe(44 + size + 1);
    expect(odd.readUInt32LE(4)).toBe(odd.length - 8);
    expect(inspectWav(odd)).toMatchObject({ ok: true, wav: { channels: 1, bitsPerSample: 24 } });
  });

  it('流式写成的 WAV（data 长度为 0xFFFFFFFF）按文件大小算', () => {
    const long = synthWav({ sampleRate: 8_000, seconds: 40, sample: speech([28.4, 28.7]) });
    long.writeUInt32LE(0xffffffff, 4);
    long.writeUInt32LE(0xffffffff, 40);
    const { bytes, keptSec } = trimWavHead(long, 30);
    expect(keptSec!).toBeLessThanOrEqual(30);
    expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  });

  it('不是 WAV 或格式读不出时原样返回', () => {
    const mp3 = mp3Fixture(4000);
    expect(trimWavHead(mp3, 30).bytes).toBe(mp3);
    expect(trimWavHead(mp3, 30).keptSec).toBeNull();
    // 8 位 PCM、A-law：不支持的编码不截。
    for (const [format, bits] of [
      [1, 8],
      [6, 8],
    ] as const) {
      const odd = wavFixture(40, 8_000);
      odd.writeUInt16LE(format, 20);
      odd.writeUInt16LE(bits, 34);
      expect(trimWavHead(odd, 30).bytes).toBe(odd);
    }
    // 没有 data 块、fmt 块越界。
    const headless = wavFixture(40, 8_000).subarray(0, 36);
    expect(trimWavHead(headless, 30).bytes).toBe(headless);
    const truncated = wavFixture(40, 8_000).subarray(0, 30);
    expect(trimWavHead(truncated, 30).bytes).toBe(truncated);
  });
});
