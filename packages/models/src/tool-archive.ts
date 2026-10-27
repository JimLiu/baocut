import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGunzip, inflateRawSync } from 'node:zlib';

/**
 * 预编译工具的压缩包（受管外部工具，架构设计 §12.9；模型包的发布页组件，§6.3）：核对过 sha256 的 `.tar.gz` 或 `.zip`，只解开包根
 * 目录里的普通文件，进程内完成，不调用系统的 tar 或 unzip（Windows 上 PATH 里的 tar 可能是不认 zip 的 GNU tar）。
 *
 * - 只认根目录（可带 `./` 前缀）下的普通文件；子目录、目录项、链接、设备文件一律略过，名字里有 `..`、反斜杠、绝对路径或盘符的
 *   也略过，所以写不出目标目录。macOS 打包时附带的 AppleDouble 文件（`._` 开头）也略过。
 * - `skip` 里的文件（同包的其他工具）不解开。
 * - 给了 `root`（包里的一个目录，`/` 分隔、不带首尾斜杠）时，「根目录」换成这个目录：只解开直接位于它之下的普通文件（LiteRT-LM 的
 *   动态库在 xcframework 的 `CLiteRTLM_mac.xcframework/macos-arm64_x86_64/` 里）。
 * - 给了 `dirs`（根目录下的子目录名）时，这些子目录里直接的普通文件也解开，放进 `dest` 下的同名子目录（Real-ESRGAN 的权重在
 *   可执行文件旁边的 `models/` 里）；只认一层，更深的照旧略过。`skip` 按相对根目录的名字（`models/x.bin`）比较。
 * - tar 按流解开，不整包读进内存；保留可执行位（没有的按 0644）。zip 读中央目录，只支持「不压缩」与 deflate，不支持 ZIP64 与加密。
 */

export interface ToolArchiveSpec {
  format: 'tar.gz' | 'zip';
  skip: readonly string[];
  /** 当作根目录的包内目录（`/` 分隔、不带首尾斜杠）；没有时是包的根目录。 */
  root?: string;
  /** 一并解开的子目录（根目录下的目录名，只认一层）。 */
  dirs?: readonly string[];
}

export class ToolArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolArchiveError';
  }
}

/** 把 `archive` 根目录（与 `dirs` 里的子目录）里的普通文件解开到 `dest`（已存在的空目录）；返回解开的文件名（子目录里的带 `目录/` 前缀）。 */
export async function extractToolArchive(archive: string, spec: ToolArchiveSpec, dest: string, signal?: AbortSignal): Promise<string[]> {
  const skip = new Set(spec.skip);
  const entry = (raw: string) => rootEntryName(raw, spec.root, spec.dirs);
  const names = spec.format === 'zip' ? await extractZip(archive, dest, skip, entry, signal) : await extractTarGz(archive, dest, skip, entry, signal);
  if (names.length === 0) throw new ToolArchiveError('archive has no files at its root');
  return names;
}

/**
 * 包里的名字 → 根目录（给了 `root` 时是这个包内目录）里的文件名；`dirs` 里的子目录下直接的文件是 `目录/文件名`。不在根目录或
 * 这些子目录里、或名字不安全时 null。
 */
export function rootEntryName(raw: string, root?: string, dirs: readonly string[] = []): string | null {
  let name = raw.replace(/^(\.\/)+/, '');
  if (root) {
    const prefix = `${root.replace(/^\/+|\/+$/g, '')}/`;
    if (!name.startsWith(prefix)) return null;
    name = name.slice(prefix.length);
  }
  const slash = name.indexOf('/');
  if (slash > 0 && dirs.includes(name.slice(0, slash))) {
    const file = safeName(name.slice(slash + 1));
    return file === null ? null : `${name.slice(0, slash)}/${file}`;
  }
  return safeName(name);
}

/** 一层的文件名：不能为空、不能带分隔符、盘符或 NUL，也不是 AppleDouble 文件。 */
function safeName(name: string): string | null {
  if (!name || name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('\0') || /^[a-zA-Z]:/.test(name)) return null;
  if (name.startsWith('._')) return null;
  return name;
}

/** 写一个解开的文件之前：在子目录里时先建出子目录。 */
async function prepareTarget(dest: string, name: string): Promise<string> {
  const file = path.join(dest, name);
  if (name.includes('/')) await fs.mkdir(path.dirname(file), { recursive: true });
  return file;
}

// ---- tar ----

const BLOCK = 512;

function tarString(header: Buffer, offset: number, length: number): string {
  const slice = header.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString('utf8');
}

function tarNumber(header: Buffer, offset: number, length: number): number {
  const field = header.subarray(offset, offset + length);
  // GNU 的 base-256 写法（最高位为 1）：大文件才用。
  if (field[0]! & 0x80) {
    let value = field[0]! & 0x7f;
    for (let i = 1; i < length; i++) value = value * 256 + field[i]!;
    return value;
  }
  const text = tarString(header, offset, length).trim();
  return text ? Number.parseInt(text, 8) : 0;
}

/** pax 扩展头里的 `path`（覆盖下一项的名字）。 */
function paxPath(data: Buffer): string | null {
  let rest = data.toString('utf8');
  let found: string | null = null;
  while (rest.length > 0) {
    const space = rest.indexOf(' ');
    const length = Number.parseInt(rest.slice(0, space), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = rest.slice(space + 1, length - 1);
    const eq = record.indexOf('=');
    if (record.slice(0, eq) === 'path') found = record.slice(eq + 1);
    rest = rest.slice(length);
  }
  return found;
}

async function extractTarGz(
  archive: string,
  dest: string,
  skip: Set<string>,
  entryName: (raw: string) => string | null,
  signal?: AbortSignal,
): Promise<string[]> {
  const extracted: string[] = [];
  let buffer: Buffer = Buffer.alloc(0);
  /** 正在读的那一项：剩余的数据字节、补齐到块边界的字节、写到哪里（null 表示丢弃）或收集到内存（扩展头）。 */
  let entry: { remaining: number; padding: number; handle: fs.FileHandle | null; collect: Buffer[] | null; kind: string } | null = null;
  let nextName: string | null = null;
  let ended = false;
  const finishEntry = async () => {
    if (!entry) return;
    if (entry.handle) await entry.handle.close();
    if (entry.collect) {
      const data = Buffer.concat(entry.collect);
      if (entry.kind === 'x') nextName = paxPath(data) ?? nextName;
      else if (entry.kind === 'L') nextName = data.toString('utf8').replace(/\0+$/, '');
    }
    entry = null;
  };
  const stream = createReadStream(archive).pipe(createGunzip());
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      signal?.throwIfAborted();
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      for (;;) {
        if (ended) break;
        if (entry) {
          if (entry.remaining > 0) {
            if (buffer.length === 0) break;
            const take = Math.min(entry.remaining, buffer.length);
            const piece = buffer.subarray(0, take);
            if (entry.handle) await entry.handle.write(piece);
            else if (entry.collect) entry.collect.push(Buffer.from(piece));
            entry.remaining -= take;
            buffer = buffer.subarray(take);
            continue;
          }
          if (buffer.length < entry.padding) break;
          buffer = buffer.subarray(entry.padding);
          await finishEntry();
          continue;
        }
        if (buffer.length < BLOCK) break;
        const header = buffer.subarray(0, BLOCK);
        buffer = buffer.subarray(BLOCK);
        if (header.every((b) => b === 0)) {
          ended = true;
          break;
        }
        const size = tarNumber(header, 124, 12);
        const type = String.fromCharCode(header[156]!) || '0';
        const padding = (BLOCK - (size % BLOCK)) % BLOCK;
        if (type === 'x' || type === 'L') {
          entry = { remaining: size, padding, handle: null, collect: [], kind: type };
          continue;
        }
        const prefix = tarString(header, 345, 155);
        const raw = nextName ?? (prefix ? `${prefix}/${tarString(header, 0, 100)}` : tarString(header, 0, 100));
        nextName = null;
        const name = type === '0' || type === '\0' ? entryName(raw) : null;
        let handle: fs.FileHandle | null = null;
        if (name && !skip.has(name)) {
          const mode = tarNumber(header, 100, 8) & 0o111 ? 0o755 : 0o644;
          handle = await fs.open(await prepareTarget(dest, name), 'wx', mode);
          extracted.push(name);
        }
        entry = { remaining: size, padding, handle, collect: null, kind: type };
      }
      if (ended) break;
    }
  } finally {
    const open = entry as { handle: fs.FileHandle | null } | null;
    if (open?.handle) await open.handle.close().catch(() => {});
    stream.destroy();
  }
  if (entry && (entry as { remaining: number }).remaining > 0) throw new ToolArchiveError('archive ends in the middle of a file');
  // 解开后再设一次权限（umask 可能去掉了可执行位）。
  for (const name of extracted) {
    const stat = await fs.stat(path.join(dest, name));
    if (stat.mode & 0o100) await fs.chmod(path.join(dest, name), 0o755);
  }
  return extracted;
}

// ---- zip ----

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function extractZip(
  archive: string,
  dest: string,
  skip: Set<string>,
  entryName: (raw: string) => string | null,
  signal?: AbortSignal,
): Promise<string[]> {
  const data = await fs.readFile(archive);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (data.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ToolArchiveError('not a zip archive');
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new ToolArchiveError('ZIP64 archives are not supported');
  const extracted: string[] = [];
  for (let i = 0; i < count; i++) {
    signal?.throwIfAborted();
    if (data.readUInt32LE(offset) !== CENTRAL) throw new ToolArchiveError('broken zip central directory');
    const flags = data.readUInt16LE(offset + 8);
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const external = data.readUInt32LE(offset + 38);
    const local = data.readUInt32LE(offset + 42);
    const raw = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    const unixMode = external >>> 16;
    // 目录项、链接（Unix 的 S_IFLNK）不解开。
    if (raw.endsWith('/') || (unixMode & 0o170000) === 0o120000) continue;
    const name = entryName(raw);
    if (!name || skip.has(name)) continue;
    if (flags & 0x1) throw new ToolArchiveError(`encrypted entry: ${name}`);
    if (data.readUInt32LE(local) !== LOCAL) throw new ToolArchiveError(`broken zip entry: ${name}`);
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const body = data.subarray(start, start + compressed);
    let content: Buffer;
    if (method === 0) content = body;
    else if (method === 8) content = inflateRawSync(body);
    else throw new ToolArchiveError(`unsupported zip compression ${method}: ${name}`);
    if (content.length !== size) throw new ToolArchiveError(`zip entry size mismatch: ${name}`);
    const mode = unixMode & 0o111 || /\.exe$/i.test(name) ? 0o755 : 0o644;
    await fs.writeFile(await prepareTarget(dest, name), content, { flag: 'wx', mode });
    extracted.push(name);
  }
  return extracted;
}
