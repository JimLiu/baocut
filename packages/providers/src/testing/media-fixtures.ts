import zlib from 'node:zlib';

/**
 * 测试用的最小媒体文件（纯 JS 生成，不依赖 ffmpeg）：ffprobe 能解码的 WAV、MP3（静音帧）与 PNG，
 * 以及只有文件头对、内容解不开的坏文件。
 */

/** 16 位单声道 PCM 的 WAV（静音）。 */
export function wavFixture(durationSec = 0.5, sampleRate = 24_000): Buffer {
  const samples = Math.round(durationSec * sampleRate);
  const data = samples * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + data, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(data, 40);
  return buffer;
}

/**
 * MPEG-1 Layer III、128 kbps、44.1 kHz、单声道的静音帧（边信息全零，解出来是静音）。每帧 417 字节、1152 个采样。
 */
export function mp3Fixture(frames = 20): Buffer {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0xc0;
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

/** 纯色 RGB 的 PNG；`shade` 不同，内容就不同。 */
export function pngFixture(width = 16, height = 9, shade = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 位深
  header[9] = 2; // RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set([200, 80, (40 + shade) & 0xff], y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 文件头是 PNG、内容解不开。 */
export function corruptPngFixture(): Buffer {
  return Buffer.concat([pngFixture().subarray(0, 8), Buffer.from('not really a png at all')]);
}

/** 文件头是 RIFF/WAVE、内容解不开。 */
export function corruptWavFixture(): Buffer {
  return Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WAVE', 'latin1'), Buffer.from('garbage-garbage')]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
