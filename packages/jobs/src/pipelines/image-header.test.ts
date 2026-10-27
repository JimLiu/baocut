import { describe, expect, it } from 'vitest';
import { parseImageHeader } from './image-header.ts';

/** 图片文件头（不解码像素）：PNG、JPEG（含 EXIF 方向）、WebP 三种块；认不出的与尺寸为 0 的给 null。 */

function pngHead(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpegHead(width: number, height: number, orientation?: number, little = false): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  if (orientation !== undefined) {
    const tiff = Buffer.alloc(8 + 2 + 12 + 4);
    tiff.write(little ? 'II' : 'MM', 0, 'latin1');
    const u16 = (v: number, at: number) => (little ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
    const u32 = (v: number, at: number) => (little ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
    u16(42, 2);
    u32(8, 4);
    u16(1, 8);
    u16(0x0112, 10);
    u16(3, 12);
    u32(1, 14);
    u16(orientation, 18);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const seg = Buffer.alloc(4);
    seg[0] = 0xff;
    seg[1] = 0xe1;
    seg.writeUInt16BE(body.length + 2, 2);
    parts.push(seg, body);
  }
  // 一段 DHT（不是帧头），再是 SOF2。
  parts.push(Buffer.from([0xff, 0xc4, 0x00, 0x04, 0x00, 0x00]));
  const sof = Buffer.from([0xff, 0xc2, 0x00, 0x11, 0x08, 0, 0, 0, 0]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  parts.push(sof);
  return Buffer.concat(parts);
}

function webpHead(chunk: 'VP8 ' | 'VP8L' | 'VP8X', width: number, height: number): Buffer {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write(chunk, 12, 'latin1');
  if (chunk === 'VP8 ') {
    b[23] = 0x9d;
    b[24] = 0x01;
    b[25] = 0x2a;
    b.writeUInt16LE(width, 26);
    b.writeUInt16LE(height, 28);
  } else if (chunk === 'VP8L') {
    b[20] = 0x2f;
    b.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  } else {
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
  }
  return b;
}

describe('图片文件头', () => {
  it('PNG：IHDR 的宽高', () => {
    expect(parseImageHeader(pngHead(1920, 1080))).toEqual({ mediaType: 'image/png', width: 1920, height: 1080, orientation: null });
  });

  it('JPEG：跳过非帧头的段找到 SOF；APP1 里的 EXIF 方向（大端与小端）', () => {
    expect(parseImageHeader(jpegHead(4032, 3024))).toEqual({ mediaType: 'image/jpeg', width: 4032, height: 3024, orientation: null });
    expect(parseImageHeader(jpegHead(4032, 3024, 6))).toMatchObject({ width: 4032, height: 3024, orientation: 6 });
    expect(parseImageHeader(jpegHead(640, 480, 3, true))).toMatchObject({ orientation: 3 });
  });

  it('WebP：有损、无损与扩展三种块', () => {
    expect(parseImageHeader(webpHead('VP8 ', 800, 600))).toMatchObject({ mediaType: 'image/webp', width: 800, height: 600 });
    expect(parseImageHeader(webpHead('VP8L', 1000, 16384))).toMatchObject({ width: 1000, height: 16384 });
    expect(parseImageHeader(webpHead('VP8X', 70000, 3))).toMatchObject({ width: 70000, height: 3 });
  });

  it('认不出的、截断的、尺寸为 0 的给 null', () => {
    expect(parseImageHeader(Buffer.from('GIF89a......'))).toBeNull();
    expect(parseImageHeader(pngHead(0, 10))).toBeNull();
    expect(parseImageHeader(jpegHead(100, 100).subarray(0, 8))).toBeNull();
    expect(parseImageHeader(Buffer.alloc(0))).toBeNull();
  });
});
