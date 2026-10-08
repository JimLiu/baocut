import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileTypeFromBuffer } from 'file-type';
import type { FileContentKind, TextEncoding } from '@baocut/protocol';

export const FILE_SAMPLE_BYTES = 64 * 1024;
export interface FileContentInfo { contentKind: FileContentKind; mimeType: string; textEncoding?: TextEncoding }
const ARCHIVES = new Set(['zip', 'gz', 'bz2', 'xz', '7z', 'rar', 'tar', 'zst', 'lz', 'lzh', 'cab', 'ar', 'iso']);
const binary = (): FileContentInfo => ({ contentKind: 'binary', mimeType: 'application/octet-stream' });

/** 内容优先；仅在确认是文本之后，用扩展名保留 JSON、字幕等文本媒体类型。 */
export async function classifyFileContent(sample: Uint8Array, complete: boolean, name: string): Promise<FileContentInfo> {
  // 不为识别扩展名解压容器：压缩包先按头部识别，避免小采样触发大规模解压。
  const begins = (...signature: number[]) => signature.every((byte, i) => sample[i] === byte);
  const archiveMime = begins(0x50, 0x4b, 3, 4) || begins(0x50, 0x4b, 5, 6) || begins(0x50, 0x4b, 7, 8) ? 'application/zip'
    : begins(0x1f, 0x8b) ? 'application/gzip'
    : begins(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c) ? 'application/x-7z-compressed'
    : begins(0x52, 0x61, 0x72, 0x21) ? 'application/vnd.rar'
    : begins(0x28, 0xb5, 0x2f, 0xfd) ? 'application/zstd'
    : begins(0x42, 0x5a, 0x68) ? 'application/x-bzip2'
    : begins(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0) ? 'application/x-xz' : null;
  if (archiveMime) return { contentKind: 'archive', mimeType: archiveMime };
  let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
  try { detected = await fileTypeFromBuffer(sample); } catch { /* 容器的索引可能超出采样范围；不继续读整个文件。 */ }
  if (detected && detected.mime !== 'application/xml') {
    const contentKind: FileContentKind = detected.mime.startsWith('image/') ? 'image'
      : detected.mime.startsWith('video/') ? 'video'
      : detected.mime.startsWith('audio/') ? 'audio'
      : detected.mime === 'application/pdf' ? 'pdf'
      : ARCHIVES.has(detected.ext) ? 'archive' : 'binary';
    return { contentKind, mimeType: detected.mime };
  }
  const encoding: TextEncoding = sample[0] === 0xff && sample[1] === 0xfe ? 'utf-16le'
    : sample[0] === 0xfe && sample[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(sample, { stream: !complete }); }
  catch { return binary(); }
  // NUL 与不可打印控制字符不能当作文本；保留换行、制表、回车与换页。
  if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/u.test(text)) return binary();
  const start = text.trimStart().replace(/^<\?xml[\s\S]*?\?>\s*/i, '').replace(/^(?:<!--[\s\S]*?-->\s*)+/, '');
  if (/^<svg(?:[\s/>])|^<!doctype\s+svg\b/i.test(start)) return { contentKind: 'image', mimeType: 'image/svg+xml' };
  const ext = name.split('.').pop()?.toLowerCase();
  const mime = /^<!doctype\s+html\b|^<html(?:\s|>)/i.test(start) || ext === 'html' || ext === 'htm' ? 'text/html'
    : ext === 'json' ? 'application/json'
    : ext === 'md' || ext === 'markdown' ? 'text/markdown'
    : ext === 'vtt' ? 'text/vtt'
    : 'text/plain';
  return { contentKind: 'text', mimeType: `${mime}; charset=${encoding}`, textEncoding: encoding };
}

/** 调用方先按资源作用域校验真实路径。只读一个有界前缀，并拒绝打开时被换成的末级符号链接。 */
export async function inspectFileContent(file: string, size: number): Promise<FileContentInfo> {
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle = await fs.open(file, flags);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('FILE_NOT_REGULAR');
    const sample = Buffer.alloc(Math.min(FILE_SAMPLE_BYTES, size));
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return await classifyFileContent(sample.subarray(0, bytesRead), bytesRead >= size, file);
  } finally { await handle.close(); }
}
