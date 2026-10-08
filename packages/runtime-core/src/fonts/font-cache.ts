import fs from 'node:fs/promises';
import path from 'node:path';
import type { DownloadedFontFace, FontLicence } from '@baocut/protocol';
import { JsonStoreFile, type StoreLog } from '@baocut/runtime-storage';

/**
 * 下载的字体的缓存（架构设计 §9.1），在 Runtime Home 的 `fonts/` 下，不在项目目录里：
 *
 * - `files/<族>/<族>-<字重>[i]-<摘要前 12 位>.ttf`：字体文件。引擎按这个目录挑 face（本机没有的族），预览与导出用同一个文件。
 * - `index.json`：每个 face 一条（族、字重、斜体、许可、sha256、大小、文件、下载时间），不记下载地址。
 * - `.staging/`：下载中的临时文件（核对过才改名进 `files/`）。
 *
 * 文件名里有内容摘要：同一个 face 换了内容是另一个文件，冻结了旧文件的导出不受影响。
 */

const INDEX_VERSION = 1;
const INDEX_SCHEMA = `baocut.font-cache/${INDEX_VERSION}`;

/** `baocut.font-cache/<n>` → n；别的写法 null。 */
function indexVersion(value: unknown): number | null {
  const match = typeof value === 'string' ? /^baocut\.font-cache\/(\d+)$/.exec(value) : null;
  return match ? Number(match[1]) : null;
}

export interface FontCacheEntry extends DownloadedFontFace {
  /** 相对 `files/` 的路径。 */
  file: string;
}

interface IndexFile {
  schema: string;
  faces: FontCacheEntry[];
}

const keyOf = (family: string, weight: number, italic: boolean) => `${family.toLowerCase()}\u0000${weight}\u0000${italic ? 1 : 0}`;

export function faceKey(face: { family: string; weight: number; italic: boolean }): string {
  return keyOf(face.family.trim(), face.weight, face.italic);
}

/** 族名做目录名与文件名：小写字母与数字，其余写成 `-`。 */
export function familySlug(family: string): string {
  const slug = family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'font';
}

export class FontCache {
  readonly root: string;
  readonly filesDir: string;
  readonly stagingDir: string;
  readonly #index: JsonStoreFile;
  #faces: FontCacheEntry[] | null = null;
  #writes: Promise<void> = Promise.resolve();

  constructor(root: string, options: { log?: StoreLog } = {}) {
    this.root = root;
    this.filesDir = path.join(root, 'files');
    this.stagingDir = path.join(root, '.staging');
    this.#index = new JsonStoreFile(path.join(root, 'index.json'), options.log);
  }

  /** 读索引（第一次时）：文件不见了的条目去掉。 */
  async #load(): Promise<FontCacheEntry[]> {
    if (this.#faces) return this.#faces;
    await fs.mkdir(this.filesDir, { recursive: true });
    // 索引坏了改名保留、从空开始（文件还在 `files/` 里，下次用到时重新下载登记）；更新版本写下的不改写（`store-file.ts`）。
    const { value } = await this.#index.read({
      version: { key: 'schema', known: INDEX_VERSION, parse: indexVersion },
      recognize: (raw) => (raw.schema === INDEX_SCHEMA && Array.isArray(raw.faces) ? (raw.faces as FontCacheEntry[]) : null),
      tolerateReadErrors: true,
    });
    const faces = value ?? [];
    const present: FontCacheEntry[] = [];
    for (const face of faces) {
      if (typeof face?.file !== 'string' || face.file.includes('..') || path.isAbsolute(face.file)) continue;
      const stat = await fs.stat(this.pathOf(face)).catch(() => null);
      if (stat?.isFile()) present.push(face);
    }
    this.#faces ??= present;
    return this.#faces;
  }

  /** 缓存里的全部 face（按族名、斜体、字重排）。 */
  async list(): Promise<FontCacheEntry[]> {
    const faces = await this.#load();
    return [...faces].sort((a, b) => a.family.localeCompare(b.family) || Number(a.italic) - Number(b.italic) || a.weight - b.weight);
  }

  /** 这个 face 在不在（按族名不分大小写）；文件被外面删了时当作不在。 */
  async find(family: string, weight: number, italic: boolean): Promise<FontCacheEntry | null> {
    const key = keyOf(family.trim(), weight, italic);
    const found = (await this.#load()).find((face) => faceKey(face) === key) ?? null;
    if (found && !(await fs.stat(this.pathOf(found)).catch(() => null))) {
      await this.remove([found]);
      return null;
    }
    return found;
  }

  pathOf(face: { file: string }): string {
    return path.join(this.filesDir, face.file);
  }

  /** 下载好的临时文件（已核对）改名进 `files/`，记进索引；同一个 face 原来的条目换掉（旧文件删掉）。 */
  async add(
    temp: string,
    face: { family: string; weight: number; italic: boolean; licence: FontLicence; sha256: string; sizeBytes: number },
  ): Promise<FontCacheEntry> {
    const slug = familySlug(face.family);
    const file = `${slug}/${slug}-${face.weight}${face.italic ? 'i' : ''}-${face.sha256.slice(0, 12)}.ttf`;
    const entry: FontCacheEntry = {
      family: face.family,
      weight: face.weight,
      italic: face.italic,
      licence: face.licence,
      sha256: face.sha256,
      sizeBytes: face.sizeBytes,
      downloadedAt: new Date().toISOString(),
      file,
    };
    await this.#write(async (faces) => {
      await fs.mkdir(path.join(this.filesDir, slug), { recursive: true });
      await fs.rename(temp, this.pathOf(entry));
      const key = faceKey(entry);
      const old = faces.filter((f) => faceKey(f) === key && f.file !== file);
      for (const f of old) await fs.rm(this.pathOf(f), { force: true });
      return [...faces.filter((f) => faceKey(f) !== key), entry];
    });
    return entry;
  }

  /** 删掉这些 face 的文件与条目（空了的族目录一并删掉）。 */
  async remove(entries: readonly FontCacheEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const files = new Set(entries.map((e) => e.file));
    await this.#write(async (faces) => {
      for (const file of files) {
        await fs.rm(path.join(this.filesDir, file), { force: true });
        await fs.rmdir(path.dirname(path.join(this.filesDir, file))).catch(() => {});
      }
      return faces.filter((f) => !files.has(f.file));
    });
  }

  async #write(change: (faces: FontCacheEntry[]) => Promise<FontCacheEntry[]>): Promise<void> {
    const write = this.#writes.then(async () => {
      const next = await change(await this.#load());
      await this.#index.write({ schema: INDEX_SCHEMA, faces: next } satisfies IndexFile);
      this.#faces = next;
    });
    this.#writes = write.catch(() => {});
    await write;
  }
}
