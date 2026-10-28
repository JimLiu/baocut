import type { FileHandle } from 'node:fs/promises';

/**
 * GGUF 文件头里添加模型用得上的几项（架构设计 §6.3「添加 audio.cpp 模型」）：`general.name`、audio.cpp 写的模型族
 * （`audiocpp.model_spec.family`），以及 audio.cpp 打包进文件的上游小文件（`audiocpp.embedded_files.*`，如 `config.json`）。
 * 只顺序读键值区：数组按元素大小跳过，不读进内存（`embedded_files.data` 有几 MB，张量名有上千个）。
 */
export interface GgufHeader {
  name: string | null;
  family: string | null;
  /** 打包进文件的一个上游小文件（按它在上游仓库里的相对路径）；没有或超过 1 MiB 时 null。 */
  embedded(file: string): Promise<Buffer | null>;
}

const GGUF_STRING = 8;
const GGUF_ARRAY = 9;
/** 标量类型 → 字节数（GGUF v2/v3）。 */
const SCALAR_BYTES: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const UINT32 = 4;
const UINT64 = 10;
const MAX_KEYS = 100_000;
const MAX_STRING = 1 << 20;
const MAX_LIST = 4096;
const MAX_EMBEDDED = 1 << 20;
const CHUNK = 1 << 16;

class Reader {
  #handle: FileHandle;
  #buf = Buffer.alloc(0);
  #start = 0;
  pos = 0;

  constructor(handle: FileHandle, pos: number) {
    this.#handle = handle;
    this.pos = pos;
  }

  async #need(n: number): Promise<Buffer> {
    const offset = this.pos - this.#start;
    if (offset >= 0 && offset + n <= this.#buf.length) return this.#buf.subarray(offset, offset + n);
    const size = Math.max(n, CHUNK);
    const buf = Buffer.alloc(size);
    const { bytesRead } = await this.#handle.read(buf, 0, size, this.pos);
    if (bytesRead < n) throw new Error('truncated GGUF header');
    this.#buf = buf.subarray(0, bytesRead);
    this.#start = this.pos;
    return this.#buf.subarray(0, n);
  }

  async u32(): Promise<number> {
    const v = (await this.#need(4)).readUInt32LE(0);
    this.pos += 4;
    return v;
  }

  async u64(): Promise<number> {
    const v = (await this.#need(8)).readBigUInt64LE(0);
    this.pos += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('GGUF value out of range');
    return Number(v);
  }

  async string(): Promise<string> {
    const n = await this.u64();
    if (n > MAX_STRING) throw new Error('GGUF string too long');
    const s = (await this.#need(n)).toString('utf8');
    this.pos += n;
    return s;
  }

  async skipString(): Promise<void> {
    const n = await this.u64();
    this.pos += n;
  }
}

export async function readGgufHeader(handle: FileHandle): Promise<GgufHeader> {
  const r = new Reader(handle, 4);
  const version = await r.u32();
  if (version < 2) throw new Error('unsupported GGUF version');
  await r.u64(); // 张量数
  const keys = await r.u64();
  if (keys > MAX_KEYS) throw new Error('too many GGUF keys');
  let name: string | null = null;
  let family: string | null = null;
  let names: string[] = [];
  let offsets: number[] = [];
  let data: { pos: number; length: number } | null = null;

  for (let i = 0; i < keys; i++) {
    const key = await r.string();
    const type = await r.u32();
    if (type === GGUF_STRING) {
      if (key === 'general.name') name = await r.string();
      else if (key === 'audiocpp.model_spec.family') family = await r.string();
      else await r.skipString();
    } else if (type === GGUF_ARRAY) {
      const element = await r.u32();
      const n = await r.u64();
      if (element === GGUF_STRING) {
        const keep = key === 'audiocpp.embedded_files.names' && n <= MAX_LIST;
        const out: string[] = [];
        for (let j = 0; j < n; j++) {
          if (keep) out.push(await r.string());
          else await r.skipString();
        }
        if (keep) names = out;
      } else if (element === GGUF_ARRAY) {
        throw new Error('nested GGUF arrays');
      } else {
        const size = SCALAR_BYTES[element];
        if (size === undefined) throw new Error('unknown GGUF type');
        if (key === 'audiocpp.embedded_files.offsets' && n <= MAX_LIST && (element === UINT64 || element === UINT32)) {
          const out: number[] = [];
          for (let j = 0; j < n; j++) out.push(element === UINT64 ? await r.u64() : await r.u32());
          offsets = out;
        } else {
          if (key === 'audiocpp.embedded_files.data' && size === 1) data = { pos: r.pos, length: n };
          r.pos += n * size;
        }
      }
    } else {
      const size = SCALAR_BYTES[type];
      if (size === undefined) throw new Error('unknown GGUF type');
      r.pos += size;
    }
  }

  return {
    name,
    family,
    async embedded(file) {
      const i = names.indexOf(file);
      if (i < 0 || !data) return null;
      const start = offsets[i];
      const end = offsets[i + 1] ?? data.length;
      if (start === undefined || end < start || end > data.length || end - start > MAX_EMBEDDED) return null;
      const buf = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buf, 0, buf.length, data.pos + start);
      return bytesRead === buf.length ? buf : null;
    },
  };
}
