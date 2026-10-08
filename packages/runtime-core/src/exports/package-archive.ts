import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { refOf, type Localized, type MessageRef } from '@baocut/protocol';
import { RcCommon, RcPackage } from '@baocut/protocol/messages/runtime-core';

/**
 * `.baocut` 归档的容器（视频格式规范 §8）：不压缩的 POSIX ustar tar。只用 Node 自带的模块，读写都是流式的，
 * 素材不必整个读进内存。
 *
 * 只写普通文件，名字按 ustar 的 prefix + name 最长 255 字节，单个文件小于 8 GiB（ustar 的长度字段是 11 位八进制）；
 * 更长的名字与更大的文件要 pax 扩展头，这一版不写也不读，在预检时逐项拒绝。
 *
 * 读的时候不信任归档：头的校验和要对，只接受普通文件与目录项（硬链接、符号链接、设备与 pax / GNU 扩展头都拒绝），
 * 路径必须是相对的、不含 `..`、不含空段与反斜杠、在包的固定布局之内（`video.manifest.json`、`video.snapshot.json`、
 * `assets/`、`documents/`），同一个路径不能出现两次。
 */

const BLOCK = 512;
/** ustar 的长度字段能表示的上限（11 位八进制）。 */
export const MAX_ENTRY_BYTES = 8 * 1024 ** 3 - 1;
export const MAX_PATH_BYTES = 255;
const TOP_FILES = new Set(['video.manifest.json', 'video.snapshot.json']);
const TOP_DIRS = ['assets/', 'documents/'];

export class ArchiveError extends Error {
  readonly code: 'PACKAGE_INVALID' | 'PACKAGE_PATH_UNSAFE';
  readonly path: string | undefined;
  readonly messageRef: MessageRef | undefined;
  constructor(code: 'PACKAGE_INVALID' | 'PACKAGE_PATH_UNSAFE', message: string | Localized, path?: string) {
    super(String(message));
    this.code = code;
    this.path = path;
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }
}

/** 包里的路径能不能写进 ustar 头：按 `/` 拆成 prefix（≤155 字节）与 name（≤100 字节）。不能时返回原因。 */
export function ustarProblem(name: string, size: number): string | null {
  if (size > MAX_ENTRY_BYTES) return RcPackage.tarFileTooLarge().text;
  if (splitName(name) === null) return RcPackage.tarPathTooLong({ max: MAX_PATH_BYTES }).text;
  return null;
}

function splitName(name: string): { prefix: string; name: string } | null {
  const bytes = Buffer.byteLength(name);
  if (bytes <= 100) return { prefix: '', name };
  if (bytes > MAX_PATH_BYTES) return null;
  // 从后往前找一个 `/`，使两边都放得下。
  for (let i = name.length - 1; i > 0; i--) {
    if (name[i] !== '/') continue;
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100 && rest.length > 0) return { prefix, name: rest };
  }
  return null;
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function header(name: string, size: number, mtime: number): Buffer {
  const split = splitName(name);
  if (!split) throw new ArchiveError('PACKAGE_INVALID', RcPackage.archivePathTooLong({ path: name }), name);
  if (size > MAX_ENTRY_BYTES) throw new ArchiveError('PACKAGE_INVALID', RcPackage.archiveFileTooLarge({ path: name }), name);
  const block = Buffer.alloc(BLOCK);
  block.write(split.name, 0, 100, 'utf8');
  block.write(octal(0o644, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(size, 12), 124, 12, 'ascii');
  block.write(octal(Math.max(0, Math.floor(mtime)), 12), 136, 12, 'ascii');
  block.fill(' ', 148, 156);
  block.write('0', 156, 1, 'ascii');
  block.write('ustar\0', 257, 6, 'ascii');
  block.write('00', 263, 2, 'ascii');
  block.write(split.prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + ' ', 148, 8, 'ascii');
  return block;
}

/** 顺序写一个 tar 文件。每个条目边写边算 sha256，返回长度与摘要，由调用方写进清单。 */
export class TarWriter {
  readonly #file: fs.FileHandle;
  readonly #mtime: number;
  #offset = 0;

  private constructor(file: fs.FileHandle, mtime: number) {
    this.#file = file;
    this.#mtime = mtime;
  }

  /** 新建（`wx`：已经存在时失败）。`mtime` 是写进每个头的修改时间（秒）。 */
  static async create(target: string, mtime: number): Promise<TarWriter> {
    return new TarWriter(await fs.open(target, 'wx'), mtime);
  }

  async #write(data: Buffer): Promise<void> {
    let done = 0;
    while (done < data.length) {
      const { bytesWritten } = await this.#file.write(data, done, data.length - done, this.#offset);
      done += bytesWritten;
      this.#offset += bytesWritten;
    }
  }

  async addBuffer(name: string, data: Buffer): Promise<{ byteLength: number; sha256: string }> {
    return this.addStream(
      name,
      data.length,
      (async function* () {
        yield data;
      })(),
    );
  }

  /**
   * 写一个文件条目。`size` 是预期的长度：源的实际长度不同时抛错（文件在读的时候被改了），摘要按真正写进去的 bytes 算。
   * `signal` 中止时在块之间停下。
   */
  async addStream(
    name: string,
    size: number,
    source: AsyncIterable<Buffer | Uint8Array>,
    signal?: AbortSignal,
  ): Promise<{ byteLength: number; sha256: string }> {
    await this.#write(header(name, size, this.#mtime));
    const hash = createHash('sha256');
    let written = 0;
    for await (const chunk of source) {
      if (signal?.aborted) throw new Error(RcCommon.cancelled().text);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      written += buffer.length;
      if (written > size) throw new ArchiveError('PACKAGE_INVALID', RcPackage.entryLongerThanExpected({ path: name }), name);
      hash.update(buffer);
      await this.#write(buffer);
    }
    if (written !== size) throw new ArchiveError('PACKAGE_INVALID', RcPackage.entryShorterThanExpected({ path: name }), name);
    const pad = (BLOCK - (size % BLOCK)) % BLOCK;
    if (pad) await this.#write(Buffer.alloc(pad));
    return { byteLength: size, sha256: `sha256:${hash.digest('hex')}` };
  }

  /** 写结尾的两个空块，落盘并关闭。 */
  async finish(): Promise<void> {
    await this.#write(Buffer.alloc(BLOCK * 2));
    await this.#file.sync();
    await this.#file.close();
  }

  /** 出错时关闭（文件由调用方删掉）。 */
  async abort(): Promise<void> {
    await this.#file.close().catch(() => {});
  }
}

export interface ArchiveEntry {
  path: string;
  size: number;
  /** 数据在归档里的起点。 */
  offset: number;
}

function readString(block: Buffer, start: number, length: number): string {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString('utf8');
}

function readOctal(block: Buffer, start: number, length: number): number {
  const text = readString(block, start, length).trim();
  if (!/^[0-7]+$/.test(text)) throw new ArchiveError('PACKAGE_INVALID', RcPackage.archiveHeaderCorrupt());
  return parseInt(text, 8);
}

/** 包里的路径是否安全：相对、不含 `..` 与空段、在包的固定布局之内。 */
export function safePackagePath(name: string): boolean {
  if (!name || name.length > MAX_PATH_BYTES || name.startsWith('/') || /[\\\0]/.test(name) || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return false;
  return TOP_FILES.has(name) || TOP_DIRS.some((dir) => name.startsWith(dir) && name.length > dir.length);
}

/**
 * 列出归档里的文件条目（不读数据）。头的校验和、条目种类与路径按上面的规则检查；目录项只检查路径，不列出。
 * 结尾的空块之后的内容忽略；没有结尾时以文件末尾为准。
 */
export async function listArchive(file: string): Promise<ArchiveEntry[]> {
  const handle = await fs.open(file, 'r');
  try {
    const { size: total } = await handle.stat();
    const entries: ArchiveEntry[] = [];
    const seen = new Set<string>();
    const block = Buffer.alloc(BLOCK);
    let offset = 0;
    while (offset + BLOCK <= total) {
      const { bytesRead } = await handle.read(block, 0, BLOCK, offset);
      if (bytesRead < BLOCK) throw new ArchiveError('PACKAGE_INVALID', RcPackage.archiveTruncated());
      if (block.every((b) => b === 0)) break;
      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]!;
      if (readOctal(block, 148, 8) !== sum) throw new ArchiveError('PACKAGE_INVALID', RcPackage.archiveChecksumMismatch());
      if (readString(block, 257, 6) !== 'ustar') throw new ArchiveError('PACKAGE_INVALID', RcPackage.notUstar());
      const name = readString(block, 0, 100);
      const prefix = readString(block, 345, 155);
      const full = prefix ? `${prefix}/${name}` : name;
      const type = String.fromCharCode(block[156]!);
      const size = readOctal(block, 124, 12);
      const dataOffset = offset + BLOCK;
      offset = dataOffset + Math.ceil(size / BLOCK) * BLOCK;
      if (type === '1' || type === '2') throw new ArchiveError('PACKAGE_PATH_UNSAFE', RcPackage.archiveHasLink({ path: full }), full);
      if (type === '5') {
        const dir = full.replace(/\/+$/, '');
        if (!safePackagePath(`${dir}/x`) && !TOP_DIRS.includes(`${dir}/`)) {
          throw new ArchiveError('PACKAGE_PATH_UNSAFE', RcPackage.unsafePath({ path: full }), full);
        }
        continue;
      }
      if (type !== '0' && type !== '\0') throw new ArchiveError('PACKAGE_INVALID', RcPackage.unsupportedEntryType({ path: full }), full);
      if (!safePackagePath(full)) throw new ArchiveError('PACKAGE_PATH_UNSAFE', RcPackage.unsafePath({ path: full }), full);
      if (seen.has(full)) throw new ArchiveError('PACKAGE_INVALID', RcPackage.duplicateEntry({ path: full }), full);
      if (dataOffset + size > total) throw new ArchiveError('PACKAGE_INVALID', RcPackage.archiveTruncated(), full);
      seen.add(full);
      entries.push({ path: full, size, offset: dataOffset });
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** 一个条目的数据流。 */
export function entryStream(file: string, entry: ArchiveEntry): AsyncIterable<Buffer> {
  if (entry.size === 0) return (async function* () {})();
  return createReadStream(file, { start: entry.offset, end: entry.offset + entry.size - 1 });
}

/** 读出一个条目的全部内容（清单、快照这类小文件）。 */
export async function readEntry(file: string, entry: ArchiveEntry, limit: number): Promise<Buffer> {
  if (entry.size > limit) throw new ArchiveError('PACKAGE_INVALID', RcPackage.entryTooLarge({ path: entry.path }), entry.path);
  const chunks: Buffer[] = [];
  for await (const chunk of entryStream(file, entry)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** 条目的 sha256（`sha256:<hex>`），可选地同时写到 `target`。 */
export async function hashEntry(file: string, entry: ArchiveEntry, target?: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  const out = target ? await fs.open(target, 'wx') : null;
  try {
    for await (const chunk of entryStream(file, entry)) {
      if (signal?.aborted) throw new Error(RcCommon.cancelled().text);
      hash.update(chunk);
      if (out) {
        let done = 0;
        while (done < chunk.length) done += (await out.write(chunk, done, chunk.length - done)).bytesWritten;
      }
    }
    if (out) await out.sync();
  } finally {
    await out?.close();
  }
  return `sha256:${hash.digest('hex')}`;
}
