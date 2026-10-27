import fs from 'node:fs/promises';

/**
 * 读图片文件头里的格式、像素尺寸与 EXIF 方向（不解码像素）：PNG 的 IHDR，JPEG 的帧头（SOF）与 APP1 里的 Exif，WebP 的
 * VP8 / VP8L / VP8X 块。格式按文件头判断，扩展名不算数。认不出、或尺寸为 0 时 null。
 */

export type ImageHeaderType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageHeader {
  mediaType: ImageHeaderType;
  width: number;
  height: number;
  /** EXIF 的方向（1–8）；没有 Exif 或没有这个标记时 null。只有 JPEG 读它。 */
  orientation: number | null;
}

/** 读文件头部做判断的上限：JPEG 的帧头在 Exif 与色彩配置之后，常见的在前几十 KB 里。 */
const HEAD_BYTES = 512 * 1024;

export async function readImageHeader(file: string): Promise<ImageHeader | null> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return parseImageHeader(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export function parseImageHeader(bytes: Buffer): ImageHeader | null {
  const header = png(bytes) ?? jpeg(bytes) ?? webp(bytes);
  return header && header.width > 0 && header.height > 0 ? header : null;
}

function png(bytes: Buffer): ImageHeader | null {
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { mediaType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), orientation: null };
}

function jpeg(bytes: Buffer): ImageHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation: number | null = null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xe1 && orientation === null) orientation = exifOrientation(bytes.subarray(offset + 4, offset + 2 + length));
    // 帧头（SOF0–SOF15，除去 DHT、JPG、DAC）。
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (offset + 9 > bytes.length) return null;
      return { mediaType: 'image/jpeg', height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), orientation };
    }
    offset += 2 + length;
  }
  return null;
}

/** APP1 段的内容（`Exif\0\0` 加 TIFF 头）里第 0 个 IFD 的方向标记（0x0112）。 */
function exifOrientation(app1: Buffer): number | null {
  if (app1.length < 14 || app1.toString('latin1', 0, 6) !== 'Exif\0\0') return null;
  const tiff = app1.subarray(6);
  const little = tiff.toString('latin1', 0, 2) === 'II';
  if (!little && tiff.toString('latin1', 0, 2) !== 'MM') return null;
  const u16 = (at: number) => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const u32 = (at: number) => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function webp(bytes: Buffer): ImageHeader | null {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') return null;
  const chunk = bytes.toString('latin1', 12, 16);
  const data = 20;
  if (chunk === 'VP8 ') {
    // 关键帧：3 字节帧标记、起始码 9d 01 2a，之后是 14 位的宽高。
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
    return { mediaType: 'image/webp', width: bytes.readUInt16LE(data + 6) & 0x3fff, height: bytes.readUInt16LE(data + 8) & 0x3fff, orientation: null };
  }
  if (chunk === 'VP8L') {
    if (bytes[data] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(data + 1);
    return { mediaType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, orientation: null };
  }
  if (chunk === 'VP8X') {
    return { mediaType: 'image/webp', width: bytes.readUIntLE(data + 4, 3) + 1, height: bytes.readUIntLE(data + 7, 3) + 1, orientation: null };
  }
  return null;
}
