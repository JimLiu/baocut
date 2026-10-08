import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RpcError, type PackageEntry, type PackageManifest } from '@baocut/protocol';
import { MAX_ENTRY_BYTES, TarWriter, listArchive, safePackagePath, ustarProblem } from './package-archive.ts';
import { PackageError, readPackage } from './package-reader.ts';
import { checkSpace } from './portable-export.ts';
import { pathUrl, xmemlRate } from './project-export.ts';

/** `.baocut` 归档的读写与核对：不信任包里的路径、条目种类、清单与内容。 */

const sha = (data: string | Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-package-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const ASSET = Buffer.from('fake image bytes');
const DOC = '{"schema":"baocut.speech/1"}';

function baseFiles(): Record<string, Buffer> {
  return {
    'video.snapshot.json': Buffer.from('{"id":"vid_1"}\n'),
    'documents/doc_1/rev_1.json': Buffer.from(DOC),
    [`assets/${sha(ASSET).slice(7)}.png`]: ASSET,
  };
}

function manifestFor(files: Record<string, Buffer>, patch: Partial<PackageManifest> = {}): PackageManifest {
  const entries: PackageEntry[] = [
    {
      ref: { id: 'ast_1', revision: 'rev_1' },
      kind: 'asset',
      path: `assets/${sha(ASSET).slice(7)}.png`,
      contentHash: sha(ASSET),
      byteLength: ASSET.length,
      inclusion: 'included',
    },
    {
      ref: { id: 'doc_1', revision: 'rev_1' },
      kind: 'document',
      path: 'documents/doc_1/rev_1.json',
      contentHash: sha(DOC),
      byteLength: DOC.length,
      inclusion: 'included',
    },
  ];
  return {
    format: 'baocut.package',
    packageVersion: 1,
    videoSchemaVersion: 1,
    timeContractVersion: 1,
    videoId: 'vid_1',
    videoName: 'v',
    videoRevision: 'rev_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    entries,
    files: Object.entries(files).map(([p, data]) => ({ path: p, byteLength: data.length, sha256: sha(data) })),
    ...patch,
  };
}

/** 按给定的条目写一个归档（清单可以单独给，用来造不一致的包）。 */
async function archive(files: Record<string, Buffer>, manifest: PackageManifest | null = manifestFor(files)): Promise<string> {
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.baocut`);
  const writer = await TarWriter.create(file, 0);
  for (const [name, data] of Object.entries(files)) await writer.addBuffer(name, data);
  if (manifest) await writer.addBuffer('video.manifest.json', Buffer.from(JSON.stringify(manifest)));
  await writer.finish();
  return file;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PackageError) return error.code;
    throw error;
  }
  throw new Error('应该被拒绝');
}

/** 改第 `index` 个头的一个字节，并重算这个头的校验和。 */
async function patchHeader(file: string, index: number, offset: number, value: string): Promise<void> {
  const entries = await listArchive(file);
  const headerAt = entries[index]!.offset - 512;
  const bytes = await fs.readFile(file);
  bytes.write(value, headerAt + offset, 'ascii');
  bytes.fill(' ', headerAt + 148, headerAt + 156);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += bytes[headerAt + i]!;
  bytes.write(sum.toString(8).padStart(6, '0') + '\0 ', headerAt + 148, 'ascii');
  await fs.writeFile(file, bytes);
}

describe('便携包的归档', () => {
  it('写出再读：逐个文件核对摘要，可以同时解开', async () => {
    const files = baseFiles();
    const file = await archive(files);
    const out = path.join(dir, 'out');
    await fs.mkdir(out);
    const result = await readPackage(file, { extractTo: out });
    expect(result.files).toBe(3);
    expect(result.manifest.videoId).toBe('vid_1');
    for (const [name, data] of Object.entries(files)) expect(await fs.readFile(path.join(out, name))).toEqual(data);
    expect((await listArchive(file)).map((e) => e.path)).toEqual([...Object.keys(files), 'video.manifest.json']);
    // 是标准的 ustar：系统的 tar 能列出来（有 tar 时）。
    const listed = (() => {
      try {
        return execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).trim().split('\n');
      } catch {
        return null;
      }
    })();
    if (listed) expect(listed).toEqual([...Object.keys(files), 'video.manifest.json']);
  });

  it('路径越出包、绝对路径、包的布局之外的文件：PACKAGE_PATH_UNSAFE', async () => {
    for (const name of ['../escape', '/etc/passwd', 'assets/../../x', 'documents//x', 'other.txt', 'assets\\x', 'C:/x']) {
      expect(safePackagePath(name), name).toBe(false);
      const file = await archive({ ...baseFiles(), [name]: Buffer.from('x') }, null);
      expect(await codeOf(readPackage(file)), name).toBe('PACKAGE_PATH_UNSAFE');
    }
    // 清单里写着不安全的路径同样拒绝。
    const files = baseFiles();
    const manifest = manifestFor(files);
    manifest.files.push({ path: '../x', byteLength: 0, sha256: sha('') });
    expect(await codeOf(readPackage(await archive(files, manifest)))).toBe('PACKAGE_PATH_UNSAFE');
  });

  it('符号链接与硬链接条目：PACKAGE_PATH_UNSAFE；其他条目种类与坏的头：PACKAGE_INVALID', async () => {
    for (const [type, code] of [
      ['2', 'PACKAGE_PATH_UNSAFE'],
      ['1', 'PACKAGE_PATH_UNSAFE'],
      ['3', 'PACKAGE_INVALID'],
      ['x', 'PACKAGE_INVALID'],
    ] as const) {
      const file = await archive(baseFiles());
      await patchHeader(file, 1, 156, type);
      expect(await codeOf(readPackage(file)), type).toBe(code);
    }
    const corrupt = await archive(baseFiles());
    const bytes = await fs.readFile(corrupt);
    bytes[10] = bytes[10]! ^ 0xff;
    await fs.writeFile(corrupt, bytes);
    expect(await codeOf(readPackage(corrupt))).toBe('PACKAGE_INVALID');
  });

  it('更高的打包版本：PACKAGE_VERSION_UNSUPPORTED；不是 BaoCut 包：PACKAGE_INVALID', async () => {
    const files = baseFiles();
    const newer = await archive(files, manifestFor(files, { packageVersion: 2 }));
    expect(await codeOf(readPackage(newer))).toBe('PACKAGE_VERSION_UNSUPPORTED');
    const other = await archive(files, { ...manifestFor(files), format: 'zip' } as unknown as PackageManifest);
    expect(await codeOf(readPackage(other))).toBe('PACKAGE_INVALID');
    expect(await codeOf(readPackage(await archive(files, null)))).toBe('PACKAGE_INVALID');
  });

  it('内容被改：PACKAGE_DIGEST_MISMATCH，解开的半成品由调用方删', async () => {
    const file = await archive(baseFiles());
    const [, doc] = await listArchive(file);
    const bytes = await fs.readFile(file);
    bytes[doc!.offset] = bytes[doc!.offset]! ^ 1;
    await fs.writeFile(file, bytes);
    expect(await codeOf(readPackage(file))).toBe('PACKAGE_DIGEST_MISMATCH');

    // 清单说收进来的版本，文件的摘要却不是版本的内容摘要。
    const files = baseFiles();
    const manifest = manifestFor(files);
    manifest.entries[0] = { ...manifest.entries[0]!, contentHash: sha('something else') };
    expect(await codeOf(readPackage(await archive(files, manifest)))).toBe('PACKAGE_DIGEST_MISMATCH');
  });

  it('清单与归档不一一对应：多出、缺少、重复的文件都拒绝', async () => {
    const files = baseFiles();
    const extra = await archive({ ...files, 'assets/extra.bin': Buffer.from('x') }, manifestFor(files));
    expect(await codeOf(readPackage(extra))).toBe('PACKAGE_INVALID');
    const { 'documents/doc_1/rev_1.json': _doc, ...fewer } = files;
    const missing = await archive(fewer, manifestFor(files));
    expect(await codeOf(readPackage(missing))).toBe('PACKAGE_INVALID');
    const twice = path.join(dir, 'twice.baocut');
    const writer = await TarWriter.create(twice, 0);
    for (const [name, data] of Object.entries(files)) await writer.addBuffer(name, data);
    await writer.addBuffer('video.snapshot.json', files['video.snapshot.json']!);
    await writer.addBuffer('video.manifest.json', Buffer.from(JSON.stringify(manifestFor(files))));
    await writer.finish();
    expect(await codeOf(readPackage(twice))).toBe('PACKAGE_INVALID');
  });

  it('ustar 写不下的：路径超过 255 字节、单个文件 8 GiB 以上', () => {
    expect(ustarProblem(`assets/${'a'.repeat(90)}/${'b'.repeat(90)}.png`, 1)).toBeNull();
    expect(ustarProblem(`assets/${'a'.repeat(300)}`, 1)).toMatch(/太长/);
    expect(ustarProblem('assets/x.png', MAX_ENTRY_BYTES + 1)).toMatch(/8 GiB/);
  });
});

describe('便携包导出的预检与工程导出的小工具', () => {
  it('空间不够时以 EXPORT_INSUFFICIENT_SPACE 拒绝', async () => {
    const tight = async () => ({ bavail: 10, bsize: 4096 });
    const error = await checkSpace(dir, 1024, tight).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).details).toMatchObject({ code: 'EXPORT_INSUFFICIENT_SPACE', required: 1024 + 64 * 1024 * 1024 });
    await expect(checkSpace(dir, 1024, async () => ({ bavail: 1n << 30n, bsize: 4096n }))).resolves.toBeUndefined();
  });

  it('xmeml 的帧率与路径 URL', () => {
    expect(xmemlRate({ num: 30000, den: 1001 })).toEqual({ timebase: 30, ntsc: true, exact: true });
    expect(xmemlRate({ num: 25, den: 1 })).toEqual({ timebase: 25, ntsc: false, exact: true });
    expect(xmemlRate({ num: 25, den: 2 })).toMatchObject({ timebase: 13, exact: false });
    expect(pathUrl('/Users/me/My Clips/视频#1.mp4')).toBe('file://localhost/Users/me/My%20Clips/%E8%A7%86%E9%A2%91%231.mp4');
  });
});
