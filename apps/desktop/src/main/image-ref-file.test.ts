import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IMAGE_REF_MAX_BYTES, imageRefData, imageRefExtension, writeImageRef } from './image-ref-file.ts';

const png = (bytes = 32) => {
  const data = new Uint8Array(8 + bytes);
  data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return data;
};
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const webp = () => new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'));

describe('粘贴或拖进来的参考图文件', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-image-ref-test-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('按文件头认 PNG、JPEG、WebP', () => {
    expect(imageRefExtension(png())).toBe('.png');
    expect(imageRefExtension(jpeg())).toBe('.jpg');
    expect(imageRefExtension(webp())).toBe('.webp');
    expect(imageRefExtension(new Uint8Array(Buffer.from('GIF89a......', 'latin1')))).toBeNull();
    expect(imageRefExtension(new Uint8Array(2))).toBeNull();
  });

  it('只收图片字节，有上限', () => {
    expect(() => imageRefData('png')).toThrow(/missing/);
    expect(() => imageRefData(new Uint8Array(100))).toThrow(/not a PNG/);
    const big = new Uint8Array(IMAGE_REF_MAX_BYTES + 1);
    big.set(png(0));
    expect(() => imageRefData(big)).toThrow(/too large/);
    expect(imageRefData(jpeg()).extension).toBe('.jpg');
  });

  it('写进临时目录，名字与扩展名由主进程起；顺手删掉一天前的', async () => {
    const old = path.join(dir, 'old.png');
    await fs.writeFile(old, png());
    const keep = path.join(dir, 'notes.txt');
    await fs.writeFile(keep, 'x');
    const day = 24 * 60 * 60 * 1000;
    const stat = await fs.stat(old);
    const file = await writeImageRef(webp(), dir, stat.mtimeMs + day + 1000);
    expect(path.dirname(file)).toBe(dir);
    expect(file).toMatch(/[0-9a-f-]{36}\.webp$/);
    expect((await fs.readFile(file)).byteLength).toBe(16);
    await expect(fs.stat(old)).rejects.toThrow();
    await expect(fs.stat(keep)).resolves.toBeTruthy();
  });
});
