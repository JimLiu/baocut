import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolArchiveError, extractToolArchive, rootEntryName } from './tool-archive.ts';

/**
 * 受管工具压缩包的解开（架构设计 §12.9）：包在测试里逐字节拼出来，覆盖穿越目录的名字、链接、子目录、跳过列表、pax 长名字、
 * 可执行位，以及 zip 的「不压缩」与 deflate。
 */

interface TarEntry {
  name: string;
  body?: string;
  type?: string;
  mode?: number;
  linkName?: string;
}

function tarHeader(name: string, size: number, type: string, mode: number, linkName = ''): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write(mode.toString(8).padStart(7, '0') + '\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(size.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write(type, 156);
  header.write(linkName, 157);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return header;
}

function block(data: Buffer): Buffer {
  const padding = (512 - (data.length % 512)) % 512;
  return Buffer.concat([data, Buffer.alloc(padding)]);
}

function tarGz(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '');
    if (entry.name.length > 100) {
      const record = `path=${entry.name}\n`;
      let length = record.length + 3;
      if (`${length} ${record}`.length !== length) length += 1;
      const pax = Buffer.from(`${length} ${record}`);
      parts.push(tarHeader('PaxHeader', pax.length, 'x', 0o644), block(pax));
    }
    parts.push(tarHeader(entry.name, body.length, entry.type ?? '0', entry.mode ?? 0o644, entry.linkName), block(body));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

interface ZipEntry {
  name: string;
  body?: string;
  deflate?: boolean;
  unixMode?: number;
}

function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.body ?? '');
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.unixMode ?? 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

describe('extractToolArchive', () => {
  let dir: string;
  let dest: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-tool-archive-'));
    dest = path.join(dir, 'out');
    await fs.mkdir(dest);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rootEntryName：只认根目录里安全的名字', () => {
    expect(rootEntryName('./audiocpp_cli')).toBe('audiocpp_cli');
    expect(rootEntryName('audiocpp_cli.exe')).toBe('audiocpp_cli.exe');
    for (const raw of ['./', '.', '..', '../evil', 'tools/x', '/etc/passwd', 'C:evil', 'a\\b', '._audiocpp_cli']) expect(rootEntryName(raw)).toBeNull();
  });

  it('tar.gz：只解开根目录的普通文件，略过链接、子目录、穿越与跳过列表，保留可执行位，认 pax 长名字', async () => {
    const longName = `./${'l'.repeat(120)}.so`;
    const archive = path.join(dir, 'a.tar.gz');
    await fs.writeFile(
      archive,
      tarGz([
        { name: './', type: '5', mode: 0o755 },
        { name: './audiocpp_cli', body: '#!/bin/sh\necho hi\n', mode: 0o755 },
        { name: './audiocpp_server', body: 'server', mode: 0o755 },
        { name: './libggml.so', body: 'lib' },
        { name: './libggml.so.0', type: '2', linkName: 'libggml.so' },
        { name: './tools/', type: '5', mode: 0o755 },
        { name: './tools/helper', body: 'helper', mode: 0o755 },
        { name: '../escape', body: 'nope' },
        { name: longName, body: 'long' },
      ]),
    );
    const names = await extractToolArchive(archive, { format: 'tar.gz', skip: ['audiocpp_server'] }, dest);
    expect(names.sort()).toEqual(['audiocpp_cli', 'libggml.so', longName.slice(2)].sort());
    expect((await fs.readdir(dest)).sort()).toEqual(names.sort());
    expect(await fs.readFile(path.join(dest, 'audiocpp_cli'), 'utf8')).toBe('#!/bin/sh\necho hi\n');
    expect(await fs.readFile(path.join(dest, longName.slice(2)), 'utf8')).toBe('long');
    expect((await fs.stat(path.join(dest, 'audiocpp_cli'))).mode & 0o111).not.toBe(0);
    expect((await fs.stat(path.join(dest, 'libggml.so'))).mode & 0o111).toBe(0);
    await expect(fs.access(path.join(dir, 'escape'))).rejects.toThrow();
  });

  it('tar.gz：截断或不是 gzip 时报错', async () => {
    const whole = tarGz([{ name: './audiocpp_cli', body: 'x'.repeat(4096), mode: 0o755 }]);
    const { gunzipSync } = await import('node:zlib');
    const truncated = gzipSync(gunzipSync(whole).subarray(0, 512 + 1000));
    await fs.writeFile(path.join(dir, 't.tar.gz'), truncated);
    await expect(extractToolArchive(path.join(dir, 't.tar.gz'), { format: 'tar.gz', skip: [] }, dest)).rejects.toBeInstanceOf(ToolArchiveError);
    await fs.writeFile(path.join(dir, 'n.tar.gz'), 'not gzip');
    await expect(extractToolArchive(path.join(dir, 'n.tar.gz'), { format: 'tar.gz', skip: [] }, path.join(dir, 'out'))).rejects.toThrow();
  });

  it('zip：「不压缩」与 deflate，略过目录、链接、子目录与跳过列表；.exe 可执行', async () => {
    const archive = path.join(dir, 'a.zip');
    await fs.writeFile(
      archive,
      zip([
        { name: 'audiocpp_cli.exe', body: 'MZ'.repeat(100), deflate: true },
        { name: 'audiocpp_server.exe', body: 'server' },
        { name: 'ggml.dll', body: 'dll' },
        { name: 'tools/', unixMode: 0o040755 },
        { name: 'tools/helper.exe', body: 'helper' },
        { name: 'link', body: 'ggml.dll', unixMode: 0o120777 },
        { name: '../escape.dll', body: 'nope' },
      ]),
    );
    const names = await extractToolArchive(archive, { format: 'zip', skip: ['audiocpp_server.exe'] }, dest);
    expect(names.sort()).toEqual(['audiocpp_cli.exe', 'ggml.dll']);
    expect(await fs.readFile(path.join(dest, 'audiocpp_cli.exe'), 'utf8')).toBe('MZ'.repeat(100));
    if (process.platform !== 'win32') expect((await fs.stat(path.join(dest, 'audiocpp_cli.exe'))).mode & 0o111).not.toBe(0);
  });

  it('root：只解开包内那个目录下直接的普通文件（xcframework 里的动态库）', async () => {
    const archive = path.join(dir, 'x.zip');
    const root = 'CLiteRTLM_mac.xcframework/macos-arm64_x86_64';
    await fs.writeFile(
      archive,
      zip([
        { name: 'CLiteRTLM_mac.xcframework/', unixMode: 0o040755 },
        { name: 'CLiteRTLM_mac.xcframework/Info.plist', body: 'plist' },
        { name: `${root}/`, unixMode: 0o040755 },
        { name: `${root}/libCLiteRTLM_mac.dylib`, body: 'dylib'.repeat(50), deflate: true, unixMode: 0o100555 },
        { name: `${root}/Headers/engine.h`, body: 'header' },
        { name: `${root}-other/evil.dylib`, body: 'no' },
        { name: `${root}/../escape.dylib`, body: 'no' },
      ]),
    );
    const names = await extractToolArchive(archive, { format: 'zip', skip: [], root }, dest);
    expect(names).toEqual(['libCLiteRTLM_mac.dylib']);
    expect(await fs.readFile(path.join(dest, 'libCLiteRTLM_mac.dylib'), 'utf8')).toBe('dylib'.repeat(50));
    expect(rootEntryName(`${root}/a.dylib`, `${root}/`)).toBe('a.dylib');
    expect(rootEntryName('a.dylib', root)).toBeNull();
    const tarArchive = path.join(dir, 'x.tar.gz');
    await fs.writeFile(tarArchive, tarGz([{ name: 'pkg/lib/liblitert.so', body: 'so' }, { name: 'pkg/README', body: 'r' }]));
    const tarDest = path.join(dir, 'tar-out');
    await fs.mkdir(tarDest);
    expect(await extractToolArchive(tarArchive, { format: 'tar.gz', skip: [], root: 'pkg/lib' }, tarDest)).toEqual(['liblitert.so']);
  });

  it('dirs：根目录下指定子目录里直接的文件也解开（Real-ESRGAN 的 models/），更深的、别的子目录照旧略过', async () => {
    expect(rootEntryName('models/x4.bin', undefined, ['models'])).toBe('models/x4.bin');
    expect(rootEntryName('./models/x4.param', undefined, ['models'])).toBe('models/x4.param');
    for (const raw of ['models/deep/x.bin', 'models/../evil', 'models/._x', 'other/x.bin', 'models/']) {
      expect(rootEntryName(raw, undefined, ['models'])).toBeNull();
    }
    expect(rootEntryName('models/x4.bin')).toBeNull();
    const archive = path.join(dir, 'esr.zip');
    await fs.writeFile(
      archive,
      zip([
        { name: 'realesrgan-ncnn-vulkan', body: 'exe', unixMode: 0o100755 },
        { name: 'input.jpg', body: 'demo' },
        { name: 'models/', unixMode: 0o040755 },
        { name: 'models/realesrgan-x4plus.bin', body: 'w'.repeat(64), deflate: true },
        { name: 'models/realesrgan-x4plus.param', body: 'p' },
        { name: 'models/nested/skip.bin', body: 'no' },
        { name: 'docs/readme.md', body: 'no' },
      ]),
    );
    const names = await extractToolArchive(archive, { format: 'zip', skip: ['input.jpg', 'models/realesrgan-x4plus.param'], dirs: ['models'] }, dest);
    expect(names).toEqual(['realesrgan-ncnn-vulkan', 'models/realesrgan-x4plus.bin']);
    expect(await fs.readFile(path.join(dest, 'models', 'realesrgan-x4plus.bin'), 'utf8')).toBe('w'.repeat(64));
    expect((await fs.stat(path.join(dest, 'realesrgan-ncnn-vulkan'))).mode & 0o111).not.toBe(0);
    const tarArchive = path.join(dir, 'esr.tar.gz');
    await fs.writeFile(tarArchive, tarGz([{ name: './tool', body: 't', mode: 0o755 }, { name: './models/a.bin', body: 'a' }]));
    const tarDest = path.join(dir, 'esr-tar');
    await fs.mkdir(tarDest);
    expect(await extractToolArchive(tarArchive, { format: 'tar.gz', skip: [], dirs: ['models'] }, tarDest)).toEqual(['tool', 'models/a.bin']);
    expect(await fs.readFile(path.join(tarDest, 'models', 'a.bin'), 'utf8')).toBe('a');
  });

  it('zip：不是 zip、或根目录没有文件时报错', async () => {
    await fs.writeFile(path.join(dir, 'n.zip'), 'not a zip at all, definitely not');
    await expect(extractToolArchive(path.join(dir, 'n.zip'), { format: 'zip', skip: [] }, dest)).rejects.toBeInstanceOf(ToolArchiveError);
    await fs.writeFile(path.join(dir, 'e.zip'), zip([{ name: 'sub/only.exe', body: 'x' }]));
    await expect(extractToolArchive(path.join(dir, 'e.zip'), { format: 'zip', skip: [] }, dest)).rejects.toThrow(/no files/);
  });
});
